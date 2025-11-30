import {
	getExchangeCredentials,
	getExchangeProvider,
	getExchangeProxy,
} from "../config/exchange";
import {
	type BinancePrecisionRecord,
	computePrecisionFromStep,
	upsertBinancePrecisions,
} from "../database/binancePrecision";
import { BinanceClient } from "../services/binanceClient";
/**
 * Binance 合约下单精度同步任务
 */
import { createLogger } from "../utils/loggerUtils";

const logger = createLogger({
	name: "binance-precision-sync",
	level: "info",
});

function symbolToContract(symbol: string): string {
	if (!symbol) return symbol;
	const normalized = symbol.toUpperCase();
	if (normalized.endsWith("USDT")) {
		const base = normalized.slice(0, -4);
		return `${base}_USDT`;
	}
	return normalized.replace(/-/g, "_");
}

function extractFilter(instrument: any, type: string) {
	return instrument?.filters?.find(
		(filter: any) => filter?.filterType === type,
	);
}

function parsePositive(value: unknown): number | null {
	if (typeof value === "number") {
		return Number.isFinite(value) && value > 0 ? value : null;
	}
	if (typeof value === "string") {
		const num = Number.parseFloat(value);
		return Number.isFinite(num) && num > 0 ? num : null;
	}
	return null;
}

function pickStepSize(
	lotSize?: any,
	marketLotSize?: any,
	fallback?: string,
): string {
	const candidates = [
		parsePositive(lotSize?.stepSize),
		parsePositive(marketLotSize?.stepSize),
		parsePositive(fallback),
	];
	const valid = candidates.filter((value): value is number => value !== null);
	if (!valid.length) {
		return "1";
	}
	return Math.max(...valid).toString();
}

function pickMinQty(
	lotSize?: any,
	marketLotSize?: any,
	fallback?: string,
): string {
	const candidates = [
		parsePositive(lotSize?.minQty),
		parsePositive(marketLotSize?.minQty),
		parsePositive(fallback),
	];
	const valid = candidates.filter((value): value is number => value !== null);
	if (!valid.length) {
		return "0.001";
	}
	return Math.max(...valid).toString();
}

function pickMaxQty(
	lotSize?: any,
	marketLotSize?: any,
	fallback?: string,
): string {
	const candidates = [
		parsePositive(lotSize?.maxQty),
		parsePositive(marketLotSize?.maxQty),
		parsePositive(fallback),
	];
	const valid = candidates.filter((value): value is number => value !== null);
	if (!valid.length) {
		return "1000000";
	}
	return Math.min(...valid).toString();
}

async function fetchBinancePrecisionRecords(): Promise<
	BinancePrecisionRecord[]
> {
	const credentials = getExchangeCredentials();
	if (credentials.provider !== "binance") {
		logger.debug("当前非 Binance 交易商，跳过精度同步");
		return [];
	}

	if (!credentials.apiKey || !credentials.apiSecret) {
		logger.warn("缺少 Binance API Key/Secret，无法同步精度信息");
		return [];
	}

	const proxyUrl = getExchangeProxy() || undefined;
	const client = new BinanceClient(
		credentials.apiKey,
		credentials.apiSecret,
		credentials.testnet,
		proxyUrl,
	);

	const instruments = await client.getAllContracts();
	if (!instruments?.length) {
		logger.warn("未获取到 Binance 合约列表");
		return [];
	}

	const records: BinancePrecisionRecord[] = [];

	for (const instrument of instruments) {
		if (
			!instrument?.symbol ||
			!instrument?.contractType ||
			instrument.contractType === "INDEX"
		) {
			continue;
		}

		if (
			!instrument.quoteAsset ||
			instrument.quoteAsset.toUpperCase() !== "USDT"
		) {
			continue;
		}

		const lotSize = extractFilter(instrument, "LOT_SIZE") || {};
		const marketLotSize = extractFilter(instrument, "MARKET_LOT_SIZE") || {};
		const priceFilter = extractFilter(instrument, "PRICE_FILTER") || {};
		const minNotional = extractFilter(instrument, "MIN_NOTIONAL") || {};

		const stepSize = pickStepSize(lotSize, marketLotSize, instrument.stepSize);
		const minQty = pickMinQty(lotSize, marketLotSize, instrument.minQty);
		const maxQty = pickMaxQty(lotSize, marketLotSize, instrument.maxQty);

		// 优先从 stepSize 计算精度，因为 quantityPrecision 可能是资产精度而非交易精度
		const precision = computePrecisionFromStep(stepSize, 6);

		records.push({
			contract: symbolToContract(instrument.symbol),
			symbol: instrument.symbol,
			stepSize,
			minQty,
			maxQty,
			tickSize: priceFilter.tickSize,
			minNotional: minNotional.notional,
			precision,
		});
	}

	logger.info(`解析 Binance 合约精度 ${records.length} 条`);
	return records;
}

export async function syncBinancePrecisions(): Promise<void> {
	try {
		const records = await fetchBinancePrecisionRecords();
		if (!records.length) {
			return;
		}
		await upsertBinancePrecisions(records);
		logger.info(`Binance 合约精度同步完成，共 ${records.length} 条`);
	} catch (error) {
		logger.error("同步 Binance 合约精度失败:", error);
	}
}

export function startBinancePrecisionSync(
	intervalHours = 1,
): NodeJS.Timeout | null {
	if (getExchangeProvider() !== "binance") {
		logger.info("当前未启用 Binance 交易通道，跳过精度同步任务");
		return null;
	}

	logger.info(`启动 Binance 精度同步任务 (每 ${intervalHours} 小时)`);
	syncBinancePrecisions().catch((error) => {
		logger.error("首次 Binance 精度同步失败:", error);
	});

	const intervalMs = Math.max(intervalHours, 0.5) * 60 * 60 * 1000;
	const timer = setInterval(() => {
		syncBinancePrecisions().catch((error) => {
			logger.error("定时 Binance 精度同步失败:", error);
		});
	}, intervalMs);

	return timer;
}

export function stopBinancePrecisionSync(timer: NodeJS.Timeout | null): void {
	if (timer) {
		clearInterval(timer);
		logger.info("已停止 Binance 精度同步任务");
	}
}
