/**
 * Binance 合约下单精度同步任务
 */
import { createLogger } from "../utils/loggerUtils";
import { BinanceClient } from "../services/binanceClient";
import { getExchangeCredentials, getExchangeProxy, getExchangeProvider } from "../config/exchange";
import { upsertBinancePrecisions, type BinancePrecisionRecord, computePrecisionFromStep } from "../database/binancePrecision";

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
  return instrument?.filters?.find((filter: any) => filter?.filterType === type);
}

async function fetchBinancePrecisionRecords(): Promise<BinancePrecisionRecord[]> {
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
  const client = new BinanceClient(credentials.apiKey, credentials.apiSecret, credentials.testnet, proxyUrl);

  const instruments = await client.getAllContracts();
  if (!instruments?.length) {
    logger.warn("未获取到 Binance 合约列表");
    return [];
  }

  const records: BinancePrecisionRecord[] = [];

  for (const instrument of instruments) {
    if (!instrument?.symbol || !instrument?.contractType || instrument.contractType === "INDEX") {
      continue;
    }

    if (!instrument.quoteAsset || instrument.quoteAsset.toUpperCase() !== "USDT") {
      continue;
    }

    const lotSize = extractFilter(instrument, "LOT_SIZE") || {};
    const marketLotSize = extractFilter(instrument, "MARKET_LOT_SIZE") || {};
    const priceFilter = extractFilter(instrument, "PRICE_FILTER") || {};
    const minNotional = extractFilter(instrument, "MIN_NOTIONAL") || {};

    const stepSize = marketLotSize.stepSize || lotSize.stepSize || instrument.stepSize || "1";
    const minQty = marketLotSize.minQty || lotSize.minQty || instrument.minQty || "0.001";
    const maxQty = marketLotSize.maxQty || lotSize.maxQty || instrument.maxQty || "1000000";
    const precision = Number.isInteger(instrument.quantityPrecision)
      ? instrument.quantityPrecision
      : computePrecisionFromStep(stepSize, 6);

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

export function startBinancePrecisionSync(intervalHours = 1): NodeJS.Timeout | null {
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
