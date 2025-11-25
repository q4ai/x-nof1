/**
 * Community reporting scheduler - submits anonymized performance snapshots
 */
import cron, { type ScheduledTask } from "node-cron";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { createClient } from "@libsql/client";
import { fetch } from "undici";
import { createLogger } from "../utils/loggerUtils";
import { createOkxClient } from "../services/okxClient";
import { getAllConfig } from "../database/init-config";

const logger = createLogger({
  name: "community-reporter",
  level: "info",
});

const dbClient = createClient({
  url: process.env.DATABASE_URL || "file:./db/sqlite.db",
});

const REPORT_ENDPOINT = process.env.COMMUNITY_REPORT_URL || "http://report.q4.net/api/v1/competition";
const REPORT_TIMEOUT_MS = Number.parseInt(process.env.COMMUNITY_REPORT_TIMEOUT_MS || "15000", 10);
const HISTORY_LIMIT = Number.parseInt(process.env.COMMUNITY_REPORT_HISTORY_LIMIT || "500", 10);
const TRADES_LIMIT = Number.parseInt(process.env.COMMUNITY_REPORT_TRADES_LIMIT || "100", 10);
const REPORT_CRON = process.env.COMMUNITY_REPORT_CRON || "0 * * * *"; // top of every hour by default

let isRunning = false;

export function startCommunityReporter(): ScheduledTask {
  const task = cron.schedule(REPORT_CRON, () => {
    void runCommunityReport();
  });
  logger.info(`Community reporter scheduled with cron: ${REPORT_CRON}`);

  const timer = setTimeout(() => {
    void runCommunityReport();
  }, 10_000);
  if (typeof timer.unref === "function") {
    timer.unref();
  }

  return task;
}

export function stopCommunityReporter(task?: ScheduledTask) {
  if (!task) {
    return;
  }
  task.stop();
  logger.info("Community reporter stopped");
}

interface TradingStatistics {
  winRate: number;
  totalProfit: number;
  totalLoss: number;
  netPnl: number;
  returnPercent: number;
  maxDrawdown: number;
  profitFactor: number;
  totalTrades: number;
  winCount: number;
  lossCount: number;
  avgWin: number;
  avgLoss: number;
  maxWin: number;
  maxLoss: number;
  sharpeRatio: number;
  sortinoRatio: number;
}

interface AccountSnapshot {
  totalBalance: number;
  equityWithUnrealised: number;
  availableBalance: number;
  positionMargin: number;
  unrealisedPnl: number;
  returnPercent: number;
  winRate: number;
  maxDrawdown: number;
  initialBalance: number;
  timestamp: string;
  source: "okx" | "history";
}

interface EquityPoint {
  timestamp: string;
  totalValue: number;
  unrealisedPnl: number;
  returnPercent: number;
}

interface TradeRecord {
  id: string;
  symbol: string;
  side: string;
  type: string;
  price: number;
  quantity: number;
  leverage: number;
  pnl: number | null;
  fee: number | null;
  timestamp: string;
  status: string;
}

interface ReportPayload {
  metadata: {
    reportId: string;
    reportedAt: string;
    hostname: string;
    environment: string;
    sharePrompts: boolean;
    symbolsCount: number;
  };
  config: {
    activeStrategyName: string;
    intervalMinutes: number;
    symbols: string[];
    aiModel: string;
  };
  account: AccountSnapshot;
  statistics: TradingStatistics;
  equityHistory: EquityPoint[];
  recentTrades: TradeRecord[];
  prompts?: {
    entry: string;
    exit: string;
    variables: string;
  };
}

type DbRow = Record<string, unknown>;

async function runCommunityReport() {
  if (isRunning) {
    logger.warn("Previous community report still running, skipping this cycle");
    return;
  }
  isRunning = true;

  try {
    const config = await getAllConfig();
    if (!config || String(config.COMMUNITY_REPORT_ENABLED).toLowerCase() !== "true") {
      logger.debug("Community reporting disabled, skip current cycle");
      return;
    }

    const sharePrompts = String(config.COMMUNITY_SHARE_PROMPTS).toLowerCase() === "true";
    const statistics = await fetchTradingStatistics();
    const account = await fetchAccountSnapshot(statistics);

    if (!account) {
      logger.warn("Unable to build account snapshot, aborting report");
      return;
    }

    const [equityHistory, recentTrades] = await Promise.all([
      fetchEquityHistory(HISTORY_LIMIT),
      fetchRecentTrades(TRADES_LIMIT),
    ]);

    const payload = buildReportPayload({
      config,
      account,
      statistics,
      equityHistory,
      recentTrades,
      sharePrompts,
    });

    await sendReport(payload);
    logger.info("Community competition report sent successfully");
  } catch (error) {
    logger.error("Community report failed", error as any);
  } finally {
    isRunning = false;
  }
}

async function fetchAccountSnapshot(statistics: TradingStatistics): Promise<AccountSnapshot | null> {
  try {
    const okxClient = createOkxClient();
    const account = await okxClient.getFuturesAccount();

    const initialBalance = await fetchInitialBalance();
    const totalBalance = Number.parseFloat(account.total || "0");
    const availableBalance = Number.parseFloat(account.available || "0");
    const positionMargin = Number.parseFloat(account.positionMargin || "0");
    const unrealisedPnl = Number.parseFloat(account.unrealisedPnl || "0");
    const equityWithUnrealised = totalBalance + unrealisedPnl;
    const returnPercent = initialBalance > 0 ? ((totalBalance - initialBalance) / initialBalance) * 100 : 0;

    return {
      totalBalance,
      equityWithUnrealised,
      availableBalance,
      positionMargin,
      unrealisedPnl,
      returnPercent,
      winRate: statistics.winRate,
      maxDrawdown: statistics.maxDrawdown,
      initialBalance,
      timestamp: new Date().toISOString(),
      source: "okx",
    } satisfies AccountSnapshot;
  } catch (error) {
    logger.warn("Failed to fetch OKX account for community report, falling back to history snapshot", error as any);
    return fetchLatestAccountHistorySnapshot(statistics);
  }
}

async function fetchLatestAccountHistorySnapshot(statistics: TradingStatistics): Promise<AccountSnapshot | null> {
  const result = await dbClient.execute(
    "SELECT timestamp, total_value, available_cash, unrealized_pnl, return_percent FROM account_history ORDER BY timestamp DESC LIMIT 1",
  );
  const row = asDbRows(result.rows)[0];
  if (!row) {
    return null;
  }

  const totalValue = toNumber(row.total_value);
  const initialBalance = await fetchInitialBalance(totalValue || undefined);

  return {
    totalBalance: totalValue,
    equityWithUnrealised: totalValue,
    availableBalance: toNumber(row.available_cash),
    positionMargin: 0,
    unrealisedPnl: toNumber(row.unrealized_pnl),
    returnPercent: toNumber(row.return_percent),
    winRate: statistics.winRate,
    maxDrawdown: statistics.maxDrawdown,
    initialBalance,
    timestamp: toStringSafe(row.timestamp) || new Date().toISOString(),
    source: "history",
  } satisfies AccountSnapshot;
}

async function fetchInitialBalance(fallback?: number): Promise<number> {
  const result = await dbClient.execute(
    "SELECT total_value FROM account_history ORDER BY timestamp ASC LIMIT 1",
  );
  const row = asDbRows(result.rows)[0];
  if (row) {
    return toNumber(row.total_value, fallback ?? 100);
  }
  return fallback ?? 100;
}

async function fetchTradingStatistics(): Promise<TradingStatistics> {
  const [tradesResult, historyResult] = await Promise.all([
    dbClient.execute("SELECT pnl FROM trades WHERE type = 'close' AND pnl IS NOT NULL ORDER BY timestamp ASC"),
    dbClient.execute("SELECT total_value, timestamp FROM account_history ORDER BY timestamp ASC"),
  ]);

  const trades = asDbRows(tradesResult.rows);
  const history = asDbRows(historyResult.rows);

  const initialBalance = history.length > 0 ? toNumber(history[0].total_value, 100) : 100;
  const currentBalance = history.length > 0 ? toNumber(history[history.length - 1].total_value, initialBalance) : initialBalance;

  const totalTrades = trades.length;
  const winTrades = trades.filter((row) => toNumber(row.pnl) > 0);
  const lossTrades = trades.filter((row) => toNumber(row.pnl) < 0);
  const winCount = winTrades.length;
  const lossCount = lossTrades.length;
  const totalProfit = winTrades.reduce((sum, row) => sum + toNumber(row.pnl), 0);
  const totalLossAbs = Math.abs(lossTrades.reduce((sum, row) => sum + toNumber(row.pnl), 0));
  const netPnl = totalProfit - totalLossAbs;
  const winRate = totalTrades > 0 ? (winCount / totalTrades) * 100 : 0;
  const returnPercent = initialBalance > 0 ? ((currentBalance - initialBalance) / initialBalance) * 100 : 0;

  let maxDrawdown = 0;
  let peak = 0;
  for (const row of history) {
    const value = toNumber(row.total_value);
    if (value > peak) {
      peak = value;
    }
    if (peak > 0) {
      const drawdown = ((peak - value) / peak) * 100;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }
  }

  const profitFactor = totalLossAbs > 0 ? totalProfit / totalLossAbs : 0;
  const avgWin = winCount > 0 ? totalProfit / winCount : 0;
  const avgLoss = lossCount > 0 ? totalLossAbs / lossCount : 0;
  const maxWin = winTrades.length > 0 ? Math.max(...winTrades.map((row) => toNumber(row.pnl))) : 0;
  const maxLoss = lossTrades.length > 0 ? Math.abs(Math.min(...lossTrades.map((row) => toNumber(row.pnl)))) : 0;

  const returns: number[] = [];
  for (let i = 1; i < history.length; i += 1) {
    const prev = toNumber(history[i - 1].total_value);
    const curr = toNumber(history[i].total_value);
    if (prev > 0) {
      returns.push((curr - prev) / prev);
    }
  }

  let sharpeRatio = 0;
  let sortinoRatio = 0;
  if (returns.length > 0) {
    const avgReturn = returns.reduce((sum, value) => sum + value, 0) / returns.length;
    const variance = returns.reduce((sum, value) => sum + (value - avgReturn) ** 2, 0) / returns.length;
    const stdDev = Math.sqrt(variance);
    if (stdDev > 0) {
      sharpeRatio = (avgReturn / stdDev) * Math.sqrt(252);
    }

    const downReturns = returns.filter((value) => value < 0);
    if (downReturns.length > 0) {
      const downVariance = downReturns.reduce((sum, value) => sum + value ** 2, 0) / downReturns.length;
      const downStdDev = Math.sqrt(downVariance);
      if (downStdDev > 0) {
        sortinoRatio = (avgReturn / downStdDev) * Math.sqrt(252);
      }
    }
  }

  return {
    winRate,
    totalProfit,
    totalLoss: totalLossAbs,
    netPnl,
    returnPercent,
    maxDrawdown,
    profitFactor,
    totalTrades,
    winCount,
    lossCount,
    avgWin,
    avgLoss,
    maxWin,
    maxLoss,
    sharpeRatio,
    sortinoRatio,
  } satisfies TradingStatistics;
}

async function fetchEquityHistory(limit: number): Promise<EquityPoint[]> {
  const result = await dbClient.execute({
    sql: "SELECT timestamp, total_value, unrealized_pnl, return_percent FROM account_history ORDER BY timestamp DESC LIMIT ?",
    args: [limit],
  });

  return asDbRows(result.rows)
    .map((row) => ({
      timestamp: toStringSafe(row.timestamp),
      totalValue: toNumber(row.total_value),
      unrealisedPnl: toNumber(row.unrealized_pnl),
      returnPercent: toNumber(row.return_percent),
    }))
    .reverse();
}

async function fetchRecentTrades(limit: number): Promise<TradeRecord[]> {
  const result = await dbClient.execute({
    sql: "SELECT id, symbol, side, type, price, quantity, leverage, pnl, fee, timestamp, status FROM trades ORDER BY datetime(timestamp) DESC LIMIT ?",
    args: [limit],
  });

  return asDbRows(result.rows).map((row) => ({
    id: toStringSafe(row.id),
    symbol: toStringSafe(row.symbol),
    side: toStringSafe(row.side),
    type: toStringSafe(row.type),
    price: toNumber(row.price),
    quantity: toNumber(row.quantity),
    leverage: toNumber(row.leverage, 1),
    pnl: row.pnl === null || row.pnl === undefined ? null : toNumber(row.pnl),
    fee: row.fee === null || row.fee === undefined ? null : toNumber(row.fee),
    timestamp: toStringSafe(row.timestamp),
    status: toStringSafe(row.status),
  }));
}

function buildReportPayload(params: {
  config: Record<string, string>;
  account: AccountSnapshot;
  statistics: TradingStatistics;
  equityHistory: EquityPoint[];
  recentTrades: TradeRecord[];
  sharePrompts: boolean;
}): ReportPayload {
  const { config, account, statistics, equityHistory, recentTrades, sharePrompts } = params;
  const symbols = (config.TRADING_SYMBOLS || "")
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter((symbol, index, arr) => symbol && arr.indexOf(symbol) === index);

  const payload: ReportPayload = {
    metadata: {
      reportId: randomUUID(),
      reportedAt: new Date().toISOString(),
      hostname: os.hostname(),
      environment: process.env.NODE_ENV || "development",
      sharePrompts,
      symbolsCount: symbols.length,
    },
    config: {
      activeStrategyName: config.ACTIVE_STRATEGY_NAME || "",
      intervalMinutes: Number.parseInt(config.TRADING_INTERVAL_MINUTES || "20", 10),
      symbols,
      aiModel: config.AI_MODEL_NAME || "",
    },
    account,
    statistics,
    equityHistory,
    recentTrades,
  };

  if (sharePrompts) {
    payload.prompts = {
      entry: config.PROMPT_SECTION_ENTRY || "",
      exit: config.PROMPT_SECTION_EXIT || "",
      variables: config.PROMPT_SECTION_VARIABLES || "",
    };
  }

  return payload;
}

async function sendReport(payload: ReportPayload) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REPORT_TIMEOUT_MS);
  try {
    const response = await fetch(REPORT_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Report request failed: ${response.status} ${response.statusText} ${text}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

function asDbRows(rows: unknown[]): DbRow[] {
  return rows.filter((row): row is DbRow => Boolean(row) && typeof row === "object");
}

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function toStringSafe(value: unknown, fallback = ""): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "bigint") {
    return value.toString();
  }
  return fallback;
}
