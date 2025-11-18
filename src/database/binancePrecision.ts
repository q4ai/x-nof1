/**
 * Binance 合约下单精度存储
 */
import { createClient } from "@libsql/client";
import { createLogger } from "../utils/loggerUtils";
import type { BinanceContractPrecision } from "./schema";

const logger = createLogger({
  name: "binance-precision-store",
  level: "info",
});

const dbClient = createClient({
  url: process.env.DATABASE_URL || "file:./db/sqlite.db",
});

export type BinancePrecisionRecord = {
  contract: string;
  symbol: string;
  stepSize: string;
  minQty: string;
  maxQty: string;
  tickSize?: string;
  minNotional?: string;
  precision: number;
};

function normalizeContract(contract: string): string {
  if (!contract) return contract;
  return contract.replace(/-/g, "_").toUpperCase();
}

export async function upsertBinancePrecisions(records: BinancePrecisionRecord[]): Promise<void> {
  if (!records.length) {
    return;
  }

  const now = new Date().toISOString();
  const sql = `
    INSERT INTO binance_contract_precisions (contract, symbol, step_size, min_qty, max_qty, tick_size, min_notional, precision, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(contract) DO UPDATE SET
      symbol = excluded.symbol,
      step_size = excluded.step_size,
      min_qty = excluded.min_qty,
      max_qty = excluded.max_qty,
      tick_size = excluded.tick_size,
      min_notional = excluded.min_notional,
      precision = excluded.precision,
      updated_at = excluded.updated_at
  `;

  for (const record of records) {
    const contract = normalizeContract(record.contract);
    try {
      await dbClient.execute({
        sql,
        args: [
          contract,
          record.symbol.toUpperCase(),
          record.stepSize,
          record.minQty,
          record.maxQty,
          record.tickSize ?? null,
          record.minNotional ?? null,
          Number.isFinite(record.precision) ? record.precision : 0,
          now,
        ],
      });
    } catch (error) {
      logger.error(`保存 ${contract} 精度信息失败:`, error);
      throw error;
    }
  }
}

export async function getBinancePrecision(contract: string): Promise<BinanceContractPrecision | null> {
  const normalized = normalizeContract(contract);
  try {
    const result = await dbClient.execute({
      sql: "SELECT * FROM binance_contract_precisions WHERE contract = ? LIMIT 1",
      args: [normalized],
    });
    if (!result.rows?.length) {
      return null;
    }
    const row = result.rows[0] as unknown as BinanceContractPrecision;
    return row;
  } catch (error) {
    logger.error(`读取 ${normalized} 精度信息失败:`, error);
    return null;
  }
}

export function computePrecisionFromStep(stepSize: string | number | undefined, fallback = 6): number {
  if (typeof stepSize === "number") {
    if (!Number.isFinite(stepSize) || stepSize <= 0) {
      return fallback;
    }
    return computePrecisionFromStep(stepSize.toString(), fallback);
  }
  if (!stepSize) {
    return fallback;
  }
  if (!stepSize.includes(".")) {
    return 0;
  }
  const decimals = stepSize.split(".")[1]?.replace(/0+$/, "") ?? "";
  return decimals.length;
}

export function normalizeBinanceQuantity(quantity: number, precision: number, stepSize: number): number {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return 0;
  }
  if (!Number.isFinite(stepSize) || stepSize <= 0) {
    const factor = 10 ** Math.max(precision, 0);
    return Math.floor(quantity * factor) / factor;
  }
  const ratio = Math.floor((quantity + Number.EPSILON) / stepSize);
  const normalized = ratio * stepSize;
  if (precision <= 0) {
    return Math.floor(normalized);
  }
  return Number(normalized.toFixed(Math.min(precision, 12)));
}

export function formatBinanceQuantity(contract: string, quantity: number, precisionRecord?: BinanceContractPrecision): string {
  if (!precisionRecord) {
    return quantity.toString();
  }
  const step = Number.parseFloat(precisionRecord.step_size);
  const precision = Math.max(precisionRecord.precision ?? 0, 0);
  const normalized = normalizeBinanceQuantity(quantity, precision, Number.isFinite(step) && step > 0 ? step : Number.NaN);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return quantity.toString();
  }
  return normalized.toFixed(precision);
}