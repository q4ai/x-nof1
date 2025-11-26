/**
 * Strategy Task 执行上下文管理
 * 
 * 使用 AsyncLocalStorage 来管理每个并行执行的实例上下文。
 * 这样工具函数可以获取到当前正在执行的实例的交易所客户端，
 * 而不是使用全局激活账户的客户端。
 * 
 * 使用方式：
 * 1. 执行实例交易决策时，调用 runWithInstanceContext(context, fn)
 * 2. 在工具函数中，调用 getCurrentInstanceContext() 获取当前实例上下文
 * 3. 如果返回 null，说明是旧版单实例模式，继续使用全局客户端
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { createLogger } from "../utils/loggerUtils";

const logger = createLogger({
  name: "instance-context",
  level: "info",
});

/**
 * 实例执行上下文
 */
export interface InstanceContext {
  /** 实例 ID */
  instanceId: number;
  /** 实例名称 */
  instanceName: string;
  /** 账户 ID */
  accountId: number;
  /** 交易所客户端实例（已初始化） */
  exchangeClient: any;
  /** 交易所提供商 */
  provider: "okx" | "binance" | "bitget";
  /** 策略名称 */
  strategyName: string;
  /** 账户级止损（USDT） */
  stopLossUsdt?: number;
  /** 账户级止盈（USDT） */
  takeProfitUsdt?: number;
}

// 使用 AsyncLocalStorage 存储实例上下文
// 这允许在异步调用链中保持上下文，同时支持并行执行
const instanceContextStorage = new AsyncLocalStorage<InstanceContext>();

/**
 * 在指定的实例上下文中运行函数
 * 
 * @param context 实例上下文
 * @param fn 要执行的函数
 * @returns 函数返回值
 * 
 * @example
 * ```typescript
 * await runWithInstanceContext(context, async () => {
 *   // 在这里执行的代码可以通过 getCurrentInstanceContext() 获取上下文
 *   await agent.generateText(prompt);
 * });
 * ```
 */
export function runWithInstanceContext<T>(
  context: InstanceContext,
  fn: () => T | Promise<T>
): T | Promise<T> {
  logger.debug(`进入实例上下文: ${context.instanceName} (ID: ${context.instanceId})`);
  return instanceContextStorage.run(context, fn);
}

/**
 * 获取当前实例上下文
 * 
 * @returns 当前实例上下文，如果不在实例上下文中则返回 null
 * 
 * @example
 * ```typescript
 * const context = getCurrentInstanceContext();
 * if (context) {
 *   // 使用实例专属的客户端
 *   const client = context.exchangeClient;
 * } else {
 *   // 回退到全局激活账户
 *   const client = await createExchangeClientFromActiveAccount();
 * }
 * ```
 */
export function getCurrentInstanceContext(): InstanceContext | null {
  const context = instanceContextStorage.getStore();
  return context || null;
}

/**
 * 检查当前是否在实例上下文中执行
 */
export function isInInstanceContext(): boolean {
  return instanceContextStorage.getStore() !== undefined;
}

/**
 * 获取当前上下文的交易所客户端
 * 如果在实例上下文中，返回实例的客户端
 * 否则返回 null，调用方应回退到全局客户端
 */
export function getInstanceExchangeClient(): any | null {
  const context = getCurrentInstanceContext();
  return context?.exchangeClient || null;
}

/**
 * 获取当前上下文的账户 ID
 * 如果在实例上下文中，返回实例的账户 ID
 * 否则返回 null
 */
export function getInstanceAccountId(): number | null {
  const context = getCurrentInstanceContext();
  return context?.accountId || null;
}

/**
 * 获取当前上下文的交易所提供商
 */
export function getInstanceProvider(): "okx" | "binance" | "bitget" | null {
  const context = getCurrentInstanceContext();
  return context?.provider || null;
}
