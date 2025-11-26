/**
 * 多实例交易循环调度器
 * 
 * 负责管理多个 Strategy Task 的并行执行。
 * 每个实例有独立的：
 * - 账户配置（API密钥）
 * - AI模型配置
 * - 策略配置
 * - 执行间隔
 * 
 * 调度逻辑：
 * 1. 主循环每分钟检查一次所有 running 状态的实例
 * 2. 根据每个实例的 interval_minutes 和 last_executed_at 判断是否需要执行
 * 3. 满足条件的实例异步并行执行（使用 Promise.allSettled）
 * 4. 每个实例执行完成后更新 last_executed_at 和 last_execution_status
 */

import { createClient } from "@libsql/client";
import { createLogger } from "../utils/loggerUtils";
import { getChinaTimeISO } from "../utils/timeUtils";
import { websocketService } from "../services/websocketService";
import {
  getRunningInstances,
  updateInstanceExecutionStatus,
  shouldInstanceExecute,
  type TradingInstanceWithDetails,
} from "../services/tradingInstanceService";

const logger = createLogger({
  name: "multi-instance-trading",
  level: "info",
});

const dbClient = createClient({
  url: process.env.DATABASE_URL || "file:./db/sqlite.db",
});

// 多实例调度状态
let multiInstanceScheduler: NodeJS.Timeout | null = null;
let isMultiInstanceMode = false;

// 实例执行锁（防止同一实例重复执行）
const instanceExecutionLocks = new Map<number, boolean>();

/**
 * 获取实例执行锁
 */
function acquireInstanceLock(instanceId: number): boolean {
  if (instanceExecutionLocks.get(instanceId)) {
    return false;
  }
  instanceExecutionLocks.set(instanceId, true);
  return true;
}

/**
 * 释放实例执行锁
 */
function releaseInstanceLock(instanceId: number): void {
  instanceExecutionLocks.delete(instanceId);
}

/**
 * 执行单个 Strategy Task
 */
async function executeInstance(instance: TradingInstanceWithDetails): Promise<void> {
  const instanceId = instance.id;
  const instanceName = instance.name;
  
  // 尝试获取锁
  if (!acquireInstanceLock(instanceId)) {
    logger.warn(`实例 ${instanceName} (ID: ${instanceId}) 正在执行中，跳过本次调度`);
    return;
  }
  
  try {
    logger.info(`\n${"=".repeat(60)}`);
    logger.info(`[实例 ${instanceName}] 开始执行`);
    logger.info(`  账户: ${instance.account_name} (${instance.account_provider})`);
    logger.info(`  模型: ${instance.ai_model_name} (${instance.model_name})`);
    logger.info(`  策略: ${instance.strategy_name}`);
    logger.info(`${"=".repeat(60)}\n`);
    
    // 广播实例执行状态
    websocketService.pushInstanceStatus(instanceId, "executing", `Instance ${instanceName} is executing`);
    
    // 动态导入执行器（避免循环依赖）
    const { executeInstanceTradingDecision } = await import("./instanceExecutor");
    
    // 执行交易决策（传入实例配置）
    await executeInstanceTradingDecision(instance);
    
    // 更新执行状态
    await updateInstanceExecutionStatus(instanceId, "success");
    
    logger.info(`[实例 ${instanceName}] 执行成功`);
    websocketService.pushInstanceStatus(instanceId, "idle", `Instance ${instanceName} completed`);
    
  } catch (error) {
    logger.error(`[实例 ${instanceName}] 执行失败:`, error);
    await updateInstanceExecutionStatus(instanceId, "error");
    websocketService.pushInstanceStatus(instanceId, "error", `Instance ${instanceName} failed`);
  } finally {
    releaseInstanceLock(instanceId);
  }
}

/**
 * 多实例调度检查
 * 每分钟执行一次，检查所有 running 状态的实例是否需要执行
 */
async function checkAndExecuteInstances(): Promise<void> {
  try {
    // 获取所有 running 状态的实例
    const runningInstances = await getRunningInstances();
    
    if (runningInstances.length === 0) {
      logger.debug("没有正在运行的实例");
      return;
    }
    
    // 筛选出需要执行的实例
    const instancesToExecute = runningInstances.filter(shouldInstanceExecute);
    
    if (instancesToExecute.length === 0) {
      logger.debug(`${runningInstances.length} 个实例正在运行，暂无需执行`);
      return;
    }
    
    logger.info(`调度 ${instancesToExecute.length}/${runningInstances.length} 个实例执行`);
    
    // 并行执行所有需要执行的实例
    const results = await Promise.allSettled(
      instancesToExecute.map(instance => executeInstance(instance))
    );
    
    // 统计执行结果
    const succeeded = results.filter(r => r.status === "fulfilled").length;
    const failed = results.filter(r => r.status === "rejected").length;
    
    if (failed > 0) {
      logger.warn(`实例执行完成: ${succeeded} 成功, ${failed} 失败`);
    } else {
      logger.info(`实例执行完成: ${succeeded} 成功`);
    }
    
  } catch (error) {
    logger.error("多实例调度检查失败:", error);
  }
}

/**
 * 启动多实例交易模式
 */
export function startMultiInstanceTrading(): void {
  if (multiInstanceScheduler) {
    logger.warn("多实例交易调度器已在运行");
    return;
  }
  
  isMultiInstanceMode = true;
  
  logger.info("启动多实例交易调度器（每分钟检查一次）");
  
  // 立即执行一次检查
  void checkAndExecuteInstances();
  
  // 每分钟检查一次
  multiInstanceScheduler = setInterval(() => {
    void checkAndExecuteInstances();
  }, 60 * 1000);
}

/**
 * 停止多实例交易模式
 */
export function stopMultiInstanceTrading(): void {
  if (multiInstanceScheduler) {
    clearInterval(multiInstanceScheduler);
    multiInstanceScheduler = null;
  }
  isMultiInstanceMode = false;
  instanceExecutionLocks.clear();
  logger.info("多实例交易调度器已停止");
}

/**
 * 检查是否处于多实例模式
 */
export function isInMultiInstanceMode(): boolean {
  return isMultiInstanceMode;
}

/**
 * 获取多实例调度状态
 */
export async function getMultiInstanceStatus(): Promise<{
  enabled: boolean;
  runningCount: number;
  executingCount: number;
}> {
  const runningInstances = await getRunningInstances();
  const executingCount = Array.from(instanceExecutionLocks.values()).filter(v => v).length;
  
  return {
    enabled: isMultiInstanceMode,
    runningCount: runningInstances.length,
    executingCount,
  };
}

/**
 * 手动触发指定实例执行
 */
export async function triggerInstanceExecution(instanceId: number): Promise<{
  success: boolean;
  message: string;
}> {
  try {
    const { getTradingInstanceById } = await import("../services/tradingInstanceService");
    const instance = await getTradingInstanceById(instanceId);
    
    if (!instance) {
      return { success: false, message: "实例不存在" };
    }
    
    if (instanceExecutionLocks.get(instanceId)) {
      return { success: false, message: "实例正在执行中" };
    }
    
    // 获取完整的实例信息（包含账户和模型详情）
    const runningInstances = await getRunningInstances();
    const fullInstance = runningInstances.find(i => i.id === instanceId);
    
    if (!fullInstance) {
      // 即使实例不是 running 状态，也可以手动触发执行
      // 需要单独查询完整信息
      const { getAllTradingInstances } = await import("../services/tradingInstanceService");
      const allInstances = await getAllTradingInstances();
      const targetInstance = allInstances.find(i => i.id === instanceId);
      
      if (!targetInstance) {
        return { success: false, message: "无法获取实例详情" };
      }
      
      // 异步执行，不等待结果
      void executeInstance(targetInstance as TradingInstanceWithDetails);
      return { success: true, message: `实例 ${instance.name} 已触发执行` };
    }
    
    // 异步执行，不等待结果
    void executeInstance(fullInstance);
    return { success: true, message: `实例 ${instance.name} 已触发执行` };
    
  } catch (error) {
    logger.error("触发实例执行失败:", error);
    return { success: false, message: "触发执行失败" };
  }
}
