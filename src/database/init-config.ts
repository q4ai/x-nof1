/**
 * 配置初始化和管理
 */
import { createClient } from "@libsql/client";
import {
	DEFAULT_PROMPT_ENTRY,
	DEFAULT_PROMPT_EXIT,
	DEFAULT_PROMPT_VARIABLES,
} from "../config/promptDefaults";
import { DEFAULT_STRATEGY_LANGUAGE } from "../config/strategyTypes";
import { createLogger } from "../utils/loggerUtils";

const logger = createLogger({ name: "init-config", level: "info" });

const dbClient = createClient({
	url: process.env.DATABASE_URL || "file:./data/database/sqlite.db",
});

// 默认配置值
const DEFAULT_CONFIG = {
	// 交易配置
	TRADING_SYMBOLS: process.env.TRADING_SYMBOLS || "BTC,ETH,SOL,XRP,BNB,BCH",
	TRADING_INTERVAL_MINUTES: process.env.TRADING_INTERVAL_MINUTES || "20",
	TRADING_MARGIN_MODE: process.env.TRADING_MARGIN_MODE || "cross",

	// 风险参数
	MAX_LEVERAGE: process.env.MAX_LEVERAGE || "10",
	MAX_POSITIONS: process.env.MAX_POSITIONS || "5",
	MAX_HOLDING_HOURS: process.env.MAX_HOLDING_HOURS || "36",
	MIN_HOLDING_MINUTES: process.env.MIN_HOLDING_MINUTES || "10",
	EXTREME_STOP_LOSS_PERCENT: process.env.EXTREME_STOP_LOSS_PERCENT || "-30",

	// 账户参数
	INITIAL_BALANCE: process.env.INITIAL_BALANCE || "100",
	ACCOUNT_STOP_LOSS_USDT: process.env.ACCOUNT_STOP_LOSS_USDT || "50",
	ACCOUNT_TAKE_PROFIT_USDT: process.env.ACCOUNT_TAKE_PROFIT_USDT || "20000",

	// 回撤风控
	ACCOUNT_DRAWDOWN_WARNING_PERCENT:
		process.env.ACCOUNT_DRAWDOWN_WARNING_PERCENT || "20",
	ACCOUNT_DRAWDOWN_NO_NEW_POSITION_PERCENT:
		process.env.ACCOUNT_DRAWDOWN_NO_NEW_POSITION_PERCENT || "30",
	ACCOUNT_DRAWDOWN_FORCE_CLOSE_PERCENT:
		process.env.ACCOUNT_DRAWDOWN_FORCE_CLOSE_PERCENT || "50",

	// AI 配置
	AI_MODEL_NAME: process.env.AI_MODEL_NAME || "deepseek/deepseek-v3.2-exp",
	OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
	OPENAI_BASE_URL:
		process.env.OPENAI_BASE_URL || "https://openrouter.ai/api/v1",

	// 网络配置
	HTTP_PROXY_URL: process.env.HTTP_PROXY_URL || "",

	// 社区上报配置
	COMMUNITY_REPORT_ENABLED: process.env.COMMUNITY_REPORT_ENABLED || "true",
	COMMUNITY_SHARE_PROMPTS: process.env.COMMUNITY_SHARE_PROMPTS || "true",

	// 交易所配置
	EXCHANGE_PROVIDER: process.env.EXCHANGE_PROVIDER || "okx",

	// OKX 配置
	OKX_API_KEY: process.env.OKX_API_KEY || "",
	OKX_API_SECRET: process.env.OKX_API_SECRET || "",
	OKX_API_PASSPHRASE: process.env.OKX_API_PASSPHRASE || "",
	OKX_USE_PAPER: process.env.OKX_USE_PAPER || "false",

	// Binance 配置
	BINANCE_API_KEY: process.env.BINANCE_API_KEY || "",
	BINANCE_API_SECRET: process.env.BINANCE_API_SECRET || "",
	BINANCE_USE_TESTNET: process.env.BINANCE_USE_TESTNET || "false",

	// 策略提示词片段
	PROMPT_SECTION_ENTRY: DEFAULT_PROMPT_ENTRY,
	PROMPT_SECTION_EXIT: DEFAULT_PROMPT_EXIT,
	PROMPT_SECTION_VARIABLES: DEFAULT_PROMPT_VARIABLES,

	// 语言设置
	PROMPT_LANGUAGE: process.env.PROMPT_LANGUAGE || DEFAULT_STRATEGY_LANGUAGE,
};

export function getDefaultConfigSnapshot(): Record<string, string> {
	return { ...DEFAULT_CONFIG };
}

/**
 * 初始化配置表
 */
export async function initConfig() {
	try {
		logger.info("初始化系统配置...");

		for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
			const result = await dbClient.execute({
				sql: "SELECT value FROM system_config WHERE key = ?",
				args: [key],
			});

			if (result.rows.length === 0) {
				// 插入新配置
				await dbClient.execute({
					sql: "INSERT INTO system_config (key, value, updated_at) VALUES (?, ?, ?)",
					args: [key, value, new Date().toISOString()],
				});
				logger.info(`  已设置 ${key} = ${value}`);
			}
		}

		logger.info("系统配置初始化完成");
	} catch (error) {
		logger.error("初始化配置失败:", error);
		throw error;
	}
}

/**
 * 获取单个配置值
 */
export async function getConfigValue(key: string): Promise<string | null> {
	try {
		const result = await dbClient.execute({
			sql: "SELECT value FROM system_config WHERE key = ?",
			args: [key],
		});

		if (result.rows.length > 0) {
			return result.rows[0].value as string;
		}

		return DEFAULT_CONFIG[key as keyof typeof DEFAULT_CONFIG] || null;
	} catch (error) {
		logger.error(`获取配置 ${key} 失败:`, error);
		return null;
	}
}

/**
 * 获取所有配置（返回真实值，内部使用）
 */
export async function getAllConfig(): Promise<Record<string, string>> {
	try {
		const result = await dbClient.execute(
			"SELECT key, value FROM system_config",
		);
		const config: Record<string, string> = {};

		for (const row of result.rows) {
			config[row.key as string] = row.value as string;
		}

		return config;
	} catch (error) {
		logger.error("获取所有配置失败:", error);
		return {};
	}
}

/**
 * 获取所有配置（脱敏版本，用于API返回）
 */
export async function getAllConfigMasked(): Promise<Record<string, string>> {
	try {
		const config = await getAllConfig();

		// 敏感字段列表（需要脱敏处理）
		const sensitiveKeys = [
			"OKX_API_KEY",
			"OKX_API_SECRET",
			"OKX_API_PASSPHRASE",
			"BINANCE_API_KEY",
			"BINANCE_API_SECRET",
		];

		const maskedConfig: Record<string, string> = {};

		for (const [key, value] of Object.entries(config)) {
			// 敏感信息脱敏：如果有值，显示前4位+***+后4位
			if (sensitiveKeys.includes(key) && value && value.length > 8) {
				maskedConfig[key] =
					`${value.substring(0, 4)}***${value.substring(value.length - 4)}`;
			} else if (sensitiveKeys.includes(key) && value) {
				maskedConfig[key] = "***";
			} else {
				maskedConfig[key] = value;
			}
		}

		return maskedConfig;
	} catch (error) {
		logger.error("获取脱敏配置失败:", error);
		return {};
	}
}

/**
 * 更新配置值
 */
export async function setConfigValue(
	key: string,
	value: string,
): Promise<void> {
	try {
		await dbClient.execute({
			sql: `INSERT INTO system_config (key, value, updated_at) 
            VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?`,
			args: [
				key,
				value,
				new Date().toISOString(),
				value,
				new Date().toISOString(),
			],
		});

		logger.info(`配置已更新: ${key} = ${value}`);
	} catch (error) {
		logger.error(`更新配置 ${key} 失败:`, error);
		throw error;
	}
}

/**
 * 批量更新配置
 */
export async function updateConfig(
	config: Record<string, string>,
): Promise<void> {
	try {
		const timestamp = new Date().toISOString();

		for (const [key, value] of Object.entries(config)) {
			await dbClient.execute({
				sql: `INSERT INTO system_config (key, value, updated_at) 
              VALUES (?, ?, ?)
              ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?`,
				args: [key, value, timestamp, value, timestamp],
			});
		}

		logger.info(`已更新 ${Object.keys(config).length} 个配置项`);
	} catch (error) {
		logger.error("批量更新配置失败:", error);
		throw error;
	}
}

/**
 * 更新系统配置
 * @param updates 键值对对象
 */
export async function updateSystemConfig(updates: Record<string, string>) {
	try {
		const now = new Date().toISOString();

		// 使用事务批量更新
		const transaction = await dbClient.transaction("write");

		try {
			for (const [key, value] of Object.entries(updates)) {
				// 检查键是否存在
				const check = await transaction.execute({
					sql: "SELECT 1 FROM system_config WHERE key = ?",
					args: [key],
				});

				if (check.rows.length > 0) {
					await transaction.execute({
						sql: "UPDATE system_config SET value = ?, updated_at = ? WHERE key = ?",
						args: [value, now, key],
					});
				} else {
					await transaction.execute({
						sql: "INSERT INTO system_config (key, value, updated_at) VALUES (?, ?, ?)",
						args: [key, value, now],
					});
				}
			}

			await transaction.commit();
			logger.info(`已更新 ${Object.keys(updates).length} 项系统配置`);
		} catch (error) {
			await transaction.rollback();
			throw error;
		}
	} catch (error) {
		logger.error("更新系统配置失败:", error);
		throw error;
	}
}
