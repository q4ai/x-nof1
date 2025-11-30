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

/**
 * 合约工具函数
 */
import { createClient } from "@libsql/client";
import { createOkxClient } from "../services/okxClient";
import { createLogger } from "./loggerUtils";

const logger = createLogger({
	name: "contract-utils",
	level: "info",
});

const dbClient = createClient({
	url: process.env.DATABASE_URL || "file:./data/database/sqlite.db",
});

// 合约乘数缓存（避免重复API调用）
const quantoMultiplierCache = new Map<string, number>();

/**
 * 默认合约乘数映射
 * 从 OKX API 获取失败时使用
 */
const DEFAULT_MULTIPLIERS: Record<string, number> = {
	BTC: 0.0001, // 1张 = 0.0001 BTC
	ETH: 0.01, // 1张 = 0.01 ETH
	SOL: 1, // 1张 = 1 SOL
	XRP: 10, // 1张 = 10 XRP
	BNB: 0.001, // 1张 = 0.001 BNB (修复：原来错误地配置为0.01)
	BCH: 0.01, // 1张 = 0.01 BCH
	POL: 1, // 1张 = 1 POL
};

/**
 * 获取合约乘数（quanto multiplier）
 *
 * 合约乘数表示：1张合约代表多少个币
 * 例如：BTC_USDT合约，1张 = 0.0001 BTC
 *
 * 优先从 OKX API 获取，失败时使用默认值
 * 支持缓存以减少API调用次数
 *
 * @param contract 合约名称，如 "BTC_USDT"
 * @param useCache 是否使用缓存（默认true）
 * @returns 合约乘数
 */
async function getMultiplierFromDatabase(
	symbol: string,
): Promise<number | null> {
	try {
		const result = await dbClient.execute({
			sql: "SELECT multiplier FROM contract_multipliers WHERE symbol = ? LIMIT 1",
			args: [symbol],
		});
		type MultiplierRow = { multiplier?: number | string | null };
		const rows = result.rows as MultiplierRow[];
		if (!rows.length) {
			return null;
		}
		const raw = rows[0]?.multiplier;
		const value =
			typeof raw === "number" ? raw : Number.parseFloat(String(raw ?? ""));
		if (Number.isFinite(value) && value > 0) {
			logger.debug(`从数据库读取 ${symbol} 合约乘数: ${value}`);
			return value;
		}
		return null;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logger.warn(`读取 ${symbol} 合约乘数失败: ${message}`);
		return null;
	}
}

export async function getQuantoMultiplier(
	contract: string,
	useCache = true,
): Promise<number> {
	if (useCache && quantoMultiplierCache.has(contract)) {
		const cached = quantoMultiplierCache.get(contract)!;
		logger.debug(`使用缓存的 ${contract} 合约乘数: ${cached}`);
		return cached;
	}

	const symbol = contract.replace("_USDT", "").toUpperCase();

	const dbMultiplier = await getMultiplierFromDatabase(symbol);
	if (
		typeof dbMultiplier === "number" &&
		Number.isFinite(dbMultiplier) &&
		dbMultiplier > 0
	) {
		const value = dbMultiplier;
		if (useCache) {
			quantoMultiplierCache.set(contract, value);
		}
		return value;
	}

	try {
		const client = createOkxClient();
		const contractInfo = await client.getContractInfo(contract);
		const multiplier = Number.parseFloat(
			String(contractInfo.quantoMultiplier ?? ""),
		);

		if (!Number.isFinite(multiplier) || multiplier <= 0) {
			throw new Error(`Invalid quanto multiplier: ${multiplier}`);
		}

		logger.debug(`从API获取 ${contract} 合约乘数: ${multiplier}`);

		if (useCache) {
			quantoMultiplierCache.set(contract, multiplier);
		}

		return multiplier;
	} catch (error: any) {
		logger.warn(`获取 ${contract} 合约信息失败: ${error.message}，使用默认值`);

		const defaultValue = DEFAULT_MULTIPLIERS[symbol] || 0.01;
		logger.info(`使用 ${contract} 默认合约乘数: ${defaultValue}`);

		if (useCache) {
			quantoMultiplierCache.set(contract, defaultValue);
		}

		return defaultValue;
	}
}

/**
 * 清除缓存（用于测试或强制刷新）
 */
export function clearQuantoMultiplierCache(contract?: string) {
	if (contract) {
		quantoMultiplierCache.delete(contract);
		logger.debug(`清除 ${contract} 合约乘数缓存`);
	} else {
		quantoMultiplierCache.clear();
		logger.debug(`清除所有合约乘数缓存`);
	}
}

/**
 * 预加载常用合约的乘数（可选，用于启动时预热缓存）
 */
export async function preloadQuantoMultipliers(
	contracts: string[],
): Promise<void> {
	logger.info(`预加载 ${contracts.length} 个合约的乘数...`);

	const results = await Promise.allSettled(
		contracts.map((contract) => getQuantoMultiplier(contract, true)),
	);

	const successCount = results.filter((r) => r.status === "fulfilled").length;
	logger.info(`成功预加载 ${successCount}/${contracts.length} 个合约乘数`);
}
