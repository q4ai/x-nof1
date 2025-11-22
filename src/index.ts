/**
 * open-nof1.ai - AI 加密货币自动交易系统
 * Copyright (C) 2025 195440
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 * 
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 * 
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

import "dotenv/config";
import { createLogger } from "./utils/loggerUtils";
import { serve } from "@hono/node-server";
import { createApiRoutes } from "./api/routes";
import { startTradingLoop, initTradingSystem } from "./scheduler/tradingLoop";
import { startAccountRecorder } from "./scheduler/accountRecorder";
// 注意：独立的止损/止盈监控器已禁用，改由 AI Agent 根据策略提示词自主决策
// import { startTrailingStopMonitor, stopTrailingStopMonitor } from "./scheduler/trailingStopMonitor";
// import { startStopLossMonitor, stopStopLossMonitor } from "./scheduler/stopLossMonitor";
import { startContractMultiplierSync, stopContractMultiplierSync } from "./scheduler/contractMultiplierSync";
import { startBinancePrecisionSync, stopBinancePrecisionSync } from "./scheduler/binancePrecisionSync";
import { startCommunityReporter, stopCommunityReporter } from "./scheduler/communityReporter";
import { initDatabase } from "./database/init";
import { RISK_PARAMS } from "./config/riskParams.new";
import { getAccountRiskConfig, getTradingStrategy } from "./agents/tradingAgent";
import { getStrategyLabel } from "./config/strategyTypes";
// 注意：strategyControls.ts 中的硬编码参数已废弃，改为在策略提示词中定义
// import { SWING_TREND_TRAILING_STOP_CONFIG, SWING_TREND_STOP_LOSS_CONFIG } from "./config/strategyControls";
import { initializeTerminalEncoding } from "./utils/encodingUtils";
import { initializeAdminAuth } from "./utils/adminAuth";
import { websocketService } from "./services/websocketService";
import { startDashboardBroadcaster, stopDashboardBroadcaster } from "./services/dashboardBroadcaster";

// 设置时区为中国时间（Asia/Shanghai，UTC+8）
process.env.TZ = 'Asia/Shanghai';

// 初始化终端编码设置（解决Windows中文乱码问题）
initializeTerminalEncoding();

// 创建日志实例
const logger = createLogger({
  name: "ai-btc",
  level: "info",
});

// 全局服务器实例
let server: any = null;
let contractMultiplierSyncTimer: NodeJS.Timeout | null = null;
let binancePrecisionSyncTimer: NodeJS.Timeout | null = null;
let communityReporterTask: ReturnType<typeof startCommunityReporter> | null = null;

/**
 * 主函数
 */
async function main() {
  logger.info("启动 AI 加密货币自动交易系统");
  
  // 1. 初始化数据库
  logger.info("初始化数据库...");
  await initDatabase();
  
  // 2. 初始化系统配置
  logger.info("初始化系统配置...");
  const { initConfig } = await import("./database/init-config");
  const { loadRiskParams } = await import("./config/riskParams.new");
  await initConfig();
  await loadRiskParams();

  // 3. 迁移账户配置（从环境变量到数据库）
  logger.info("迁移账户配置...");
  const { migrateFromEnv } = await import("./services/accountConfigService");
  await migrateFromEnv();

  // 4. 初始化交易客户端（使用活跃账户）
  logger.info("初始化交易客户端...");
  const { initExchangeClient } = await import("./services/okxClient");
  await initExchangeClient();

  // 5. 初始化后台登录凭证
  const adminAuth = await initializeAdminAuth(logger);
  
  // 6. 初始化交易系统配置（读取环境变量并同步到数据库）
  await initTradingSystem();
  
  // 7. 启动 API 服务器
  logger.info("🌐 启动 Web 服务器...");
  const apiRoutes = createApiRoutes(adminAuth);
  
  const port = Number.parseInt(process.env.PORT || "3141");
  
  server = serve({
    fetch: apiRoutes.fetch,
    port,
  });
  
  logger.info(`Web 服务器已启动: http://localhost:${port}`);
  logger.info(`监控界面: http://localhost:${port}/`);
  
  // 8. 初始化 WebSocket 服务器
  logger.info("🔌 启动 WebSocket 服务器...");
  websocketService.initialize(server);
  logger.info("WebSocket 服务器已启动: ws://localhost:${port}/ws/trading-status");
  startDashboardBroadcaster();
  logger.info("仪表盘实时推送服务已启动");
  
  // 9. 启动交易循环
  logger.info("启动交易循环...");
  startTradingLoop();
  
  // 10. 启动账户资产记录器
  logger.info("启动账户资产记录器...");
  startAccountRecorder();

  // 11. 启动社区竞赛上报任务
  logger.info("启动社区竞赛上报任务...");
  communityReporterTask = startCommunityReporter();
  
  // 12. 移动止盈监控器已禁用
  // 注意：移动止盈逻辑已移至策略提示词中，由 AI Agent 根据提示词自主决策
  // logger.info("启动移动止盈监控器...");
  // startTrailingStopMonitor();
  
  // 13. 止损监控器已禁用
  // 注意：止损逻辑已移至策略提示词中，由 AI Agent 根据提示词自主决策
  // logger.info("启动止损监控器...");
  // startStopLossMonitor();
  
  // 14. 启动合约乘数同步定时任务（每1小时执行一次）
  logger.info("启动合约乘数同步定时任务...");
  contractMultiplierSyncTimer = startContractMultiplierSync(1);

  logger.info("启动 Binance 合约精度同步定时任务...");
  binancePrecisionSyncTimer = startBinancePrecisionSync(1);
  
  const strategy = getTradingStrategy();
  const strategyLabel = getStrategyLabel(strategy);
  const isCodeLevelEnabled = strategy === "swing-trend";
  const accountRisk = await getAccountRiskConfig();

  logger.info("\n" + "=".repeat(80));
  logger.info("系统启动完成！");
  logger.info("=".repeat(80));
  logger.info(`\n监控界面: http://localhost:${port}/`);
  logger.info(`交易策略: ${strategyLabel} (AI主导控制)`);
  logger.info(`交易间隔: ${RISK_PARAMS.TRADING_INTERVAL_MINUTES} 分钟`);
  logger.info(`账户记录间隔: ${process.env.ACCOUNT_RECORD_INTERVAL_MINUTES || 10} 分钟`);
  
  // 注意：代码级监控已禁用，止损/止盈/仓位管理等完全由 AI Agent 根据策略提示词决策
  logger.info(`\n⚠️  止损止盈策略完全由 AI 根据策略提示词控制，无硬编码规则`);
  
  logger.info(`\n支持币种: ${RISK_PARAMS.TRADING_SYMBOLS.join(', ')}`);
  logger.info(`最大杠杆: ${RISK_PARAMS.MAX_LEVERAGE}x`);
  logger.info(`最大持仓数: ${RISK_PARAMS.MAX_POSITIONS}`);
  logger.info(`\n🔴 账户止损线: ${accountRisk.stopLossUsdt} USDT (触发后全部清仓并退出)`);
  logger.info(`🟢 账户止盈线: ${accountRisk.takeProfitUsdt} USDT (触发后全部清仓并退出)`);
  logger.info("\n按 Ctrl+C 停止系统\n");
}

process.on("uncaughtException", (error) => {
  logger.error("未捕获的异常:", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason: unknown) => {
  logger.error("未处理的 Promise 拒绝:", { reason });
});

// 优雅退出处理
async function gracefulShutdown(signal: string) {
  logger.info(`\n\n收到 ${signal} 信号，正在关闭系统...`);
  
  try {
    // 停止合约乘数同步定时任务
    if (contractMultiplierSyncTimer) {
      logger.info("正在停止合约乘数同步定时任务...");
      stopContractMultiplierSync(contractMultiplierSyncTimer);
      logger.info("合约乘数同步定时任务已停止");
    }

    if (binancePrecisionSyncTimer) {
      logger.info("正在停止 Binance 合约精度同步定时任务...");
      stopBinancePrecisionSync(binancePrecisionSyncTimer);
      binancePrecisionSyncTimer = null;
    }
    
    // 移动止盈监控器已禁用，无需停止
    // stopTrailingStopMonitor();
    
    // 止损监控器已禁用，无需停止
    // stopStopLossMonitor();

    if (communityReporterTask) {
      logger.info("正在停止社区竞赛上报任务...");
      stopCommunityReporter(communityReporterTask);
      communityReporterTask = null;
    }
    
    // 关闭 WebSocket 服务器
    logger.info("正在关闭 WebSocket 服务器...");
  stopDashboardBroadcaster();
    websocketService.close();
    logger.info("WebSocket 服务器已关闭");
    
    // 关闭服务器
    if (server) {
      logger.info("正在关闭 Web 服务器...");
      server.close();
      logger.info("Web 服务器已关闭");
    }
    
    logger.info("系统已安全关闭");
    process.exit(0);
  } catch (error) {
    logger.error("关闭系统时出错:", error as any);
    process.exit(1);
  }
}

// 监听退出信号
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

// 启动应用
await main();
