/**
 * open-nof1.ai - AI 加密货币自动交易系统
 * Copyright (C) 2025 195440
 *
 * 该模块提供监控面板所需的数据抓取工具，便于在 API 与 WebSocket 推送之间复用逻辑。
 */

import { createClient } from "@libsql/client";
import { getDatabaseUrl } from "../utils/pathUtils";
import { getQuantoMultiplier } from "../utils/contractUtils";
import { createLogger } from "../utils/loggerUtils";
import {
	createExchangeClientForAccount,
	createExchangeClientFromActiveAccount,
} from "./okxClient";
import { getActiveAccount } from "./accountConfigService";

const logger = createLogger({
	name: "dashboard-data-service",
	level: "info",
});

const dbClient = createClient({
	url: getDatabaseUrl(),
});

type DbRow = Record<string, unknown>;

function asDbRows(rows: unknown[]): DbRow[] {
	return rows.filter(
		(row): row is DbRow => Boolean(row) && typeof row === "object",
	);
}

function toNumber(value: unknown, fallback = 0): number {
	if (typeof value === "number") return value;
	if (typeof value === "bigint") return Number(value);
	if (typeof value === "string") {
		const parsed = Number.parseFloat(value);
		return Number.isFinite(parsed) ? parsed : fallback;
	}
	return fallback;
}

function toStringSafe(value: unknown, fallback = ""): string {
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "bigint") {
		return value.toString();
	}
	return fallback;
}

type MaybePromiseArray<T> = Promise<T>[];

export interface PositionSnapshot {
	symbol: string;
	quantity: number;
	contracts: number;
	contractMultiplier: number;
	entryPrice: number;
	currentPrice: number;
	liquidationPrice: number;
	unrealizedPnl: number;
	leverage: number;
	side: "long" | "short";
	marginMode: "cross" | "isolated" | null;
	openValue: number;
	margin: number;
	profitTarget: number | null;
	stopLoss: number | null;
	openedAt: string | null;
	exchangeOpenedAt: string | null;
}

export interface PricePoint {
	symbol: string;
	price: number;
}

export interface CandlePoint {
	time: number;
	open: number;
	high: number;
	low: number;
	close: number;
}

export async function getCurrentPositions(): Promise<PositionSnapshot[]> {
	const activeAccount = await getActiveAccount();
	const exchangeClient = activeAccount
		? createExchangeClientForAccount(activeAccount)
		: await createExchangeClientFromActiveAccount();
	const exchangePositions = await exchangeClient.getPositions();
	const isBitget = activeAccount?.provider === "bitget";
	const isBinance = activeAccount?.provider === "binance";

	const dbResult = await dbClient.execute(
		"SELECT symbol, stop_loss, profit_target, opened_at FROM positions",
	);
	const dbRows = asDbRows(dbResult.rows);
	const dbPositionsMap = new Map<string, DbRow>(
		dbRows
			.map((row) => {
				const symbol = toStringSafe(row.symbol).toUpperCase();
				return symbol ? ([symbol, row] as [string, DbRow]) : null;
			})
			.filter((entry): entry is [string, DbRow] => entry !== null),
	);

	const tasks: MaybePromiseArray<PositionSnapshot> = [];

	for (const position of exchangePositions) {
		const size = Number.parseFloat(position.size || "0");
		if (size === 0) {
			continue;
		}

		tasks.push(
			(async () => {
				const contract = position.contract || "";
				const symbol = contract.replace("_USDT", "");
				const dbPos = dbPositionsMap.get(symbol.toUpperCase());
				const entryPrice = Number.parseFloat(position.entryPrice || "0");
				const leverage = Number.parseInt(position.leverage || "1", 10);
				const marginUsed = Number.parseFloat(position.margin || "0");
				const contracts = Math.abs(size);
				const rawMarginMode =
					typeof position.marginMode === "string"
						? position.marginMode.toLowerCase()
						: "";
				const marginMode =
					rawMarginMode === "isolated"
						? "isolated"
						: rawMarginMode === "cross"
							? "cross"
							: null;

				let contractMultiplier = 1;
				if (!isBitget && !isBinance) {
					try {
						contractMultiplier = await getQuantoMultiplier(contract);
					} catch (error) {
						const message =
							error instanceof Error ? error.message : String(error);
						logger.warn(`获取 ${contract} 合约乘数失败: ${message}`);
					}
				}
				if (!Number.isFinite(contractMultiplier) || contractMultiplier <= 0) {
					contractMultiplier = 1;
				}

				const quantity = (isBitget || isBinance) ? contracts : (contracts * contractMultiplier);
				const currentPrice = Number.parseFloat(position.markPrice || "0");
				const liquidationPrice = Number.parseFloat(position.liqPrice || "0");
				const unrealizedPnl = Number.parseFloat(position.unrealisedPnl || "0");
				const openValue =
					Number.isFinite(quantity) && Number.isFinite(entryPrice)
						? quantity * entryPrice
						: marginUsed;

				const profitTargetRaw = dbPos
					? toNumber(dbPos.profit_target, Number.NaN)
					: Number.NaN;
				const stopLossRaw = dbPos
					? toNumber(dbPos.stop_loss, Number.NaN)
					: Number.NaN;
				const profitTarget = Number.isFinite(profitTargetRaw)
					? profitTargetRaw
					: null;
				const stopLoss = Number.isFinite(stopLossRaw) ? stopLossRaw : null;
				const exchangeOpenedAt =
					position.createTime ?? position.updateTime ?? null;
				const dbOpenedAt = dbPos ? toStringSafe(dbPos.opened_at) : "";
				const openedAt =
					exchangeOpenedAt ?? (dbOpenedAt || new Date().toISOString());

				return {
					symbol,
					quantity,
					contracts,
					contractMultiplier,
					entryPrice,
					currentPrice,
					liquidationPrice,
					unrealizedPnl,
					leverage,
					side: size > 0 ? "long" : "short",
					marginMode,
					openValue,
					margin: marginUsed,
					profitTarget,
					stopLoss,
					openedAt,
					exchangeOpenedAt,
				} satisfies PositionSnapshot;
			})(),
		);
	}

	return Promise.all(tasks);
}

export async function getSymbolPrices(
	symbols: string[],
): Promise<PricePoint[]> {
	if (!symbols.length) {
		return [];
	}

	const exchangeClient = await createExchangeClientFromActiveAccount();
	const uniqueSymbols = Array.from(
		new Set(
			symbols
				.map((symbol) =>
					typeof symbol === "string" ? symbol.trim().toUpperCase() : "",
				)
				.filter((symbol) => symbol.length > 0),
		),
	);

	try {
		// 仅使用批量接口，彻底避免逐个请求触发限流
		const allTickers = await exchangeClient.getAllSwapTickers();
		const tickerMap = new Map<string, number>();

		for (const ticker of allTickers) {
			const rawSymbol =
				typeof ticker.symbol === "string"
					? ticker.symbol.trim().toUpperCase()
					: "";
			if (!rawSymbol) {
				continue;
			}
			const priceValue = Number.parseFloat(
				typeof ticker.price === "string"
					? ticker.price
					: ticker.price !== undefined
						? String(ticker.price)
						: "0",
			);
			if (!Number.isFinite(priceValue)) {
				continue;
			}
			tickerMap.set(rawSymbol, priceValue);
		}

		const supportedSymbols = new Set(tickerMap.keys());
		const validSymbols = uniqueSymbols.filter((symbol) => supportedSymbols.has(symbol));
		if (validSymbols.length !== uniqueSymbols.length) {
			const missingSymbols = uniqueSymbols.filter((symbol) => !supportedSymbols.has(symbol));
			if (missingSymbols.length) {
				logger.debug?.(
					`过滤掉 ${missingSymbols.length} 个不受当前交易所支持的标的: ${missingSymbols.slice(0, 20).join(",")}`,
				);
			}
		}

		return validSymbols.map((symbol) => {
			const price = tickerMap.get(symbol);
			return { symbol, price: price ?? 0 } satisfies PricePoint;
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logger.error(`批量获取价格失败: ${message}，已返回默认价格 0`);
		return uniqueSymbols.map((symbol) => ({ symbol, price: 0 }));
	}
}

function normalizeCandleEntry(entry: unknown): CandlePoint | null {
	if (!entry) {
		return null;
	}

	const asObject = entry as Record<string, unknown>;

	if (typeof asObject === "object" && !Array.isArray(asObject)) {
		const timeCandidate = Number(
			asObject.t ?? asObject.timestamp ?? asObject.time,
		);
		const openCandidate = Number(asObject.o ?? asObject.open);
		const highCandidate = Number(asObject.h ?? asObject.high);
		const lowCandidate = Number(asObject.l ?? asObject.low);
		const closeCandidate = Number(asObject.c ?? asObject.close);

		if (
			[openCandidate, highCandidate, lowCandidate, closeCandidate].every(
				Number.isFinite,
			) &&
			Number.isFinite(timeCandidate)
		) {
			return {
				time: Math.floor(timeCandidate / 1000),
				open: openCandidate,
				high: highCandidate,
				low: lowCandidate,
				close: closeCandidate,
			} satisfies CandlePoint;
		}
	}

	if (Array.isArray(entry)) {
		const [ts, open, high, low, close] = entry as unknown[];
		const timeCandidate = Number(ts);
		const openCandidate = Number(open);
		const highCandidate = Number(high);
		const lowCandidate = Number(low);
		const closeCandidate = Number(close);

		if (
			[openCandidate, highCandidate, lowCandidate, closeCandidate].every(
				Number.isFinite,
			) &&
			Number.isFinite(timeCandidate)
		) {
			return {
				time: Math.floor(timeCandidate / 1000),
				open: openCandidate,
				high: highCandidate,
				low: lowCandidate,
				close: closeCandidate,
			} satisfies CandlePoint;
		}
	}

	return null;
}

export async function getCandles(
	symbol: string,
	interval: string,
	limit: number,
): Promise<CandlePoint[]> {
	const exchangeClient = await createExchangeClientFromActiveAccount();
	const contract = `${symbol}_USDT`;
	const raw = await exchangeClient.getFuturesCandles(contract, interval, limit);

	return raw
		.map((entry: unknown) => normalizeCandleEntry(entry))
		.filter((item): item is CandlePoint => {
			if (!item) {
				return false;
			}
			return Number.isInteger(item.time);
		})
		.sort((a, b) => a.time - b.time);
}
