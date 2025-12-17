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
import fs from "node:fs";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { installSystem, isSystemInstalled } from "./services/installService";
import { initializeTerminalEncoding } from "./utils/encodingUtils";
import { createLogger } from "./utils/loggerUtils";
import { getPublicFilePath, getPublicDir } from "./utils/pathUtils";

// 设置时区为中国时间（Asia/Shanghai，UTC+8）
process.env.TZ = "Asia/Shanghai";

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
let communityReporterTask: any = null;

/**
 * 主函数
 */
async function main() {
	logger.info("启动 AI 加密货币自动交易系统");

	if (!isSystemInstalled()) {
		logger.info("检测到系统未安装，启动安装服务...");
		await runInstallServer();
		logger.info("安装完成，启动主程序...");
	}

	// 只有在系统已安装的情况下才启动主应用
	await startApp();
}

async function runInstallServer() {
	return new Promise<void>((resolve) => {
		const app = new Hono();
		const port = Number.parseInt(process.env.PORT || "3888");

		// 优先处理特定路由，防止被 serveStatic 拦截
		app.get("/", (c) => c.redirect("/install"));

		app.get("/install", (c) => {
			const installPath = getPublicFilePath("install.html");
			const html = fs.readFileSync(installPath, "utf-8");
			return c.html(html);
		});

		// 测试账户连接（安装阶段需要）
		app.post("/api/accounts/test", async (c) => {
			try {
				const body = await c.req.json();
				const {
					provider,
					api_key,
					api_secret,
					api_passphrase,
					use_paper,
					proxy_url,
				} = body;

				if (!provider || !api_key || !api_secret) {
					return c.json({ error: "缺少必需参数" }, 400);
				}

				if (!["okx", "binance", "bitget", "gate"].includes(provider)) {
					return c.json({ error: "不支持的交易所" }, 400);
				}

				// 导入所需的客户端类
				const { OkxClient } = await import("./services/okxClient");
				const { BinanceClient } = await import("./services/binanceClient");
				const { BitgetClient } = await import("./services/bitgetClient");
				const { GateClient } = await import("./services/gateClient");

				// 简单的代理 URL 验证
				const normalizedProxy = proxy_url
					? String(proxy_url).trim()
					: undefined;

				try {
					if (provider === "binance") {
						const client = new BinanceClient(
							String(api_key),
							String(api_secret),
							Boolean(use_paper),
							normalizedProxy,
						);
						const account = await client.getFuturesAccount();
						return c.json({
							success: true,
							provider: "Binance",
							mode: use_paper ? "测试网" : "主网",
							balance: account.total || "0",
						});
					}

					if (provider === "bitget") {
						if (!api_passphrase) {
							return c.json({ error: "Bitget 账户需要 API Passphrase" }, 400);
						}
						const client = new BitgetClient(
							String(api_key),
							String(api_secret),
							String(api_passphrase),
							Boolean(use_paper),
							normalizedProxy,
						);
						const account = await client.getFuturesAccount();
						return c.json({
							success: true,
							provider: "Bitget",
							mode: use_paper ? "模拟盘" : "实盘",
							balance: account.total || "0",
						});
					}

					if (provider === "gate") {
						const client = new GateClient(
							String(api_key),
							String(api_secret),
							Boolean(use_paper),
							normalizedProxy,
						);
						const account = await client.getFuturesAccount();
						return c.json({
							success: true,
							provider: "Gate.io",
							mode: use_paper ? "测试网" : "实盘",
							balance: account.total || "0",
						});
					}

					// OKX
					if (!api_passphrase) {
						return c.json({ error: "OKX 账户需要 API Passphrase" }, 400);
					}
					const client = new OkxClient(
						String(api_key),
						String(api_secret),
						String(api_passphrase),
						Boolean(use_paper),
						normalizedProxy,
					);
					const account = await client.getFuturesAccount();
					return c.json({
						success: true,
						provider: "OKX",
						mode: use_paper ? "模拟盘" : "实盘",
						balance: account.total || "0",
					});
				} catch (error: unknown) {
					const message = error instanceof Error ? error.message : "未知错误";
					logger.error("账户连接测试失败:", error);
					return c.json(
						{
							success: false,
							error: message,
						},
						400,
					);
				}
			} catch (error: unknown) {
				const message = error instanceof Error ? error.message : "未知错误";
				logger.error("测试连接接口错误:", error);
				return c.json(
					{
						success: false,
						error: message,
					},
					400,
				);
			}
		});

		app.post("/api/install", async (c) => {
			try {
				const data = await c.req.json();
				const result = await installSystem(data);

				logger.info("安装完成，返回结果:", result);

				// 验证 adminCredentials 是否存在
				if (!result.adminCredentials) {
					logger.error("警告：installSystem 返回的结果中没有 adminCredentials");
					return c.json(
						{
							success: false,
							message: "安装过程出错：未能生成管理员凭证",
						},
						500,
					);
				}

				// Return success with admin credentials
				setTimeout(() => {
					if (installServer) {
						installServer.close();
						resolve();
					}
				}, 1000);

				return c.json({
					success: true,
					adminCredentials: result.adminCredentials,
				});
			} catch (e: any) {
				logger.error("安装失败", e);
				return c.json({ success: false, message: e.message }, 500);
			}
		});

		// 最后处理静态文件
		app.use("/*", serveStatic({ root: getPublicDir() }));

		logger.info(`安装服务运行在 http://localhost:${port}`);

		const installServer = serve({
			fetch: app.fetch,
			port,
		});
	});
}

async function startApp() {
	// Dynamic imports to avoid side effects before installation
	const { createApiRoutes } = await import("./api/routes");
	const { initTradingSystem } = await import("./scheduler/tradingSystemInit");
	const { startAccountRecorder } = await import("./scheduler/accountRecorder");
	const { startMultiInstanceTrading, stopMultiInstanceTrading } = await import(
		"./scheduler/multiInstanceTradingLoop"
	);
	const { startContractMultiplierSync, stopContractMultiplierSync } =
		await import("./scheduler/contractMultiplierSync");
	const { startBinancePrecisionSync, stopBinancePrecisionSync } = await import(
		"./scheduler/binancePrecisionSync"
	);
	const { startCommunityReporter, stopCommunityReporter } = await import(
		"./scheduler/communityReporter"
	);
	const { initDatabase } = await import("./database/init");
	const { RISK_PARAMS, getConfigStringValue, loadRiskParams } = await import(
		"./config/riskParams.new"
	);
	const { getAccountRiskConfig } = await import("./agents/tradingAgent");
	const { initializeAdminAuth } = await import("./utils/adminAuth");
	const { websocketService } = await import("./services/websocketService");
	const { startDashboardBroadcaster, stopDashboardBroadcaster } = await import(
		"./services/dashboardBroadcaster"
	);
	const { initConfig } = await import("./database/init-config");
	const { migrateFromEnv } = await import("./services/accountConfigService");
	const { ensureTradingInstancesTable } = await import(
		"./services/tradingInstanceService"
	);
	const { initExchangeClient } = await import("./services/okxClient");

	// 1. 初始化数据库
	logger.info("初始化数据库...");
	await initDatabase();

	// 2. 初始化系统配置
	logger.info("初始化系统配置...");
	await initConfig();
	await loadRiskParams();

	// 3. 迁移账户配置（从环境变量到数据库）
	logger.info("迁移账户配置...");
	await migrateFromEnv();

	// 3.5 确保 trading_instances 表存在
	logger.info("初始化 Strategy Tasks 表...");
	await ensureTradingInstancesTable();

	// 4. 初始化交易客户端（使用活跃账户）
	logger.info("初始化交易客户端...");
	await initExchangeClient();

	// 5. 初始化后台登录凭证
	const adminAuth = await initializeAdminAuth(logger);

	// 6. 初始化交易系统配置（读取环境变量并同步到数据库）
	await initTradingSystem();

	// 7. 启动 API 服务器
	logger.info("🌐 启动 Web 服务器...");
	const apiRoutes = createApiRoutes(adminAuth);

	const port = Number.parseInt(process.env.PORT || "3888");

	server = serve({
		fetch: apiRoutes.fetch,
		port,
	});

	logger.info(`Web 服务器已启动: http://localhost:${port}`);
	logger.info(`监控界面: http://localhost:${port}/`);

	// 8. 初始化 WebSocket 服务器
	logger.info("🔌 启动 WebSocket 服务器...");
	websocketService.initialize(server);
	logger.info(
		`WebSocket 服务器已启动: ws://localhost:${port}/ws/trading-status`,
	);
	startDashboardBroadcaster();
	logger.info("仪表盘实时推送服务已启动");

	// 9. 启动多实例交易调度器（执行 Strategy Tasks）
	logger.info("启动多实例交易调度器...");
	startMultiInstanceTrading();

	// 10. 启动账户资产记录器
	logger.info("启动账户资产记录器...");
	startAccountRecorder();

	// 11. 启动社区竞赛上报任务
	logger.info("启动社区竞赛上报任务...");
	communityReporterTask = startCommunityReporter();

	// 14. 启动合约乘数同步定时任务（每1小时执行一次）
	logger.info("启动合约乘数同步定时任务...");
	contractMultiplierSyncTimer = startContractMultiplierSync(1);

	logger.info("启动 Binance 合约精度同步定时任务...");
	binancePrecisionSyncTimer = startBinancePrecisionSync(1);

	const activeStrategyName = getConfigStringValue(
		"ACTIVE_STRATEGY_NAME",
		"custom",
	);
	const accountRisk = await getAccountRiskConfig();

	logger.info("\n" + "=".repeat(80));
	logger.info("系统启动完成！");
	logger.info("=".repeat(80));
	logger.info(`\n监控界面: http://localhost:${port}/`);
	logger.info(`交易策略: ${activeStrategyName || "custom"} (AI主导控制)`);
	logger.info(`交易间隔: ${RISK_PARAMS.TRADING_INTERVAL_MINUTES} 分钟`);
	logger.info(
		`账户记录间隔: ${process.env.ACCOUNT_RECORD_INTERVAL_MINUTES || 10} 分钟`,
	);

	logger.info(`\n⚠️  止损止盈策略完全由 AI 根据策略提示词控制，无硬编码规则`);

	logger.info(`\n支持币种: ${RISK_PARAMS.TRADING_SYMBOLS.join(", ")}`);
	logger.info(`最大杠杆: ${RISK_PARAMS.MAX_LEVERAGE}x`);
	logger.info(`最大持仓数: ${RISK_PARAMS.MAX_POSITIONS}`);
	logger.info(
		`\n🔴 账户止损线: ${accountRisk.stopLossUsdt} USDT (触发后全部清仓并退出)`,
	);
	logger.info(
		`🟢 账户止盈线: ${accountRisk.takeProfitUsdt} USDT (触发后全部清仓并退出)`,
	);
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
		// Re-import to get access to stop functions
		const { stopMultiInstanceTrading } = await import(
			"./scheduler/multiInstanceTradingLoop"
		);
		const { stopContractMultiplierSync } = await import(
			"./scheduler/contractMultiplierSync"
		);
		const { stopBinancePrecisionSync } = await import(
			"./scheduler/binancePrecisionSync"
		);
		const { stopCommunityReporter } = await import(
			"./scheduler/communityReporter"
		);
		const { websocketService } = await import("./services/websocketService");
		const { stopDashboardBroadcaster } = await import(
			"./services/dashboardBroadcaster"
		);

		// 停止多实例交易调度器
		logger.info("正在停止多实例交易调度器...");
		stopMultiInstanceTrading();
		logger.info("多实例交易调度器已停止");

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
