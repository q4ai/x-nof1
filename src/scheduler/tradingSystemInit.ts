/**
 * 交易系统初始化（不再包含旧版单实例交易循环）。
 * 负责保障关键数据表、日志表及会话表存在，并根据环境或数据库配置
 * 同步账户风控参数，确保 Binance 等交易所按预期配置仓位模式。
 */
import { createClient } from "@libsql/client";
import { getDatabaseUrl } from "../utils/pathUtils";
import {
	type AccountRiskConfig,
	getAccountRiskConfig,
} from "../agents/tradingAgent";
import {
	ensureAgentDecisionExecutionColumn,
	ensureAgentRequestLogsTable,
	ensureDualPositionSupport,
	ensureSessionsTable,
} from "../database/migrations";
import { createExchangeClientFromActiveAccount } from "../services/okxClient";
import { createLogger } from "../utils/loggerUtils";
import { getChinaTimeISO } from "../utils/timeUtils";

const logger = createLogger({
	name: "trading-system-init",
	level: "info",
});

const dbClient = createClient({
	url: getDatabaseUrl(),
});

async function syncRiskConfigToDatabase(
	config: AccountRiskConfig,
): Promise<void> {
	try {
		const timestamp = getChinaTimeISO();
		await dbClient.execute({
			sql: `INSERT OR REPLACE INTO system_config (key, value, updated_at) VALUES (?, ?, ?)`,
			args: [
				"account_stop_loss_usdt",
				String(config.stopLossUsdt ?? 0),
				timestamp,
			],
		});
		await dbClient.execute({
			sql: `INSERT OR REPLACE INTO system_config (key, value, updated_at) VALUES (?, ?, ?)`,
			args: [
				"account_take_profit_usdt",
				String(config.takeProfitUsdt ?? 0),
				timestamp,
			],
		});
		logger.info(
			`账户风控已同步到数据库: 止损=${config.stopLossUsdt ?? "Disabled"} USDT, 止盈=${config.takeProfitUsdt ?? "Disabled"} USDT`,
		);
	} catch (error) {
		logger.error("同步账户风控配置失败:", error as Error);
	}
}

async function loadRiskConfigFromDatabase(): Promise<AccountRiskConfig | null> {
	try {
		const [stopLossResult, takeProfitResult] = await Promise.all([
			dbClient.execute({
				sql: `SELECT value FROM system_config WHERE key = ?`,
				args: ["account_stop_loss_usdt"],
			}),
			dbClient.execute({
				sql: `SELECT value FROM system_config WHERE key = ?`,
				args: ["account_take_profit_usdt"],
			}),
		]);

		if (
			stopLossResult.rows.length === 0 &&
			takeProfitResult.rows.length === 0
		) {
			return null;
		}

		const stopLossValue = Number.parseFloat(
			String(stopLossResult.rows[0]?.value ?? "0"),
		);
		const takeProfitValue = Number.parseFloat(
			String(takeProfitResult.rows[0]?.value ?? "0"),
		);

		return {
			stopLossUsdt: Number.isFinite(stopLossValue) ? stopLossValue : undefined,
			takeProfitUsdt: Number.isFinite(takeProfitValue)
				? takeProfitValue
				: undefined,
			syncOnStartup: false,
		};
	} catch (error) {
		logger.warn(
			"从数据库读取账户风控配置失败，使用当前内存配置:",
			error as Error,
		);
		return null;
	}
}

export async function initTradingSystem(): Promise<void> {
	logger.info("初始化交易系统配置 (Strategy Tasks 模式)...");

	await ensureAgentDecisionExecutionColumn(dbClient);
	await ensureAgentRequestLogsTable(dbClient);
	await ensureDualPositionSupport(dbClient);
	await ensureSessionsTable(dbClient);

	const riskConfig = await getAccountRiskConfig(true);
	logger.info(
		`当前风险配置: 止损=${riskConfig.stopLossUsdt ?? "Disabled"} USDT, 止盈=${riskConfig.takeProfitUsdt ?? "Disabled"} USDT (syncOnStartup=${riskConfig.syncOnStartup ?? false})`,
	);

	if (riskConfig.syncOnStartup) {
		await syncRiskConfigToDatabase(riskConfig);
	} else {
		const dbSnapshot = await loadRiskConfigFromDatabase();
		if (dbSnapshot) {
			logger.info(
				`从数据库读取风险配置: 止损=${dbSnapshot.stopLossUsdt ?? "Disabled"} USDT, 止盈=${dbSnapshot.takeProfitUsdt ?? "Disabled"} USDT`,
			);
		}
	}

	const exchangeProvider = (
		process.env.EXCHANGE_PROVIDER || "okx"
	).toLowerCase();
	if (exchangeProvider === "binance") {
		try {
			const client = await createExchangeClientFromActiveAccount();
			if (typeof (client as any).setPositionMode === "function") {
				await (client as any).setPositionMode(true);
				logger.info("已将 Binance 账户设置为双向持仓模式 (Hedge Mode)");
			}
		} catch (error) {
			logger.error("设置 Binance 双向持仓模式失败:", error as Error);
		}
	}

	logger.info("交易系统初始化完成，所有 Strategy Tasks 将使用最新配置。");
}
