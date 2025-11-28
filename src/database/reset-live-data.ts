/**
 * open-nof1.ai - AI 加密货币自动交易系统
 * Copyright (C) 2025 195440
 *
 * 本模块用于在运行中将数据库和配置恢复到初始状态。
 */
import { createClient } from "@libsql/client";
import { createLogger } from "../utils/loggerUtils";
import { getDefaultConfigSnapshot } from "./init-config";
import {
  createExchangeClientForAccount,
  createExchangeClientFromActiveAccount,
} from "../services/okxClient";
import { getActiveAccount } from "../services/accountConfigService";
import type { AccountConfig } from "./schema";

const logger = createLogger({
  name: "reset-live-data",
  level: "info",
});

const DATA_TABLES = [
  "trades",
  "trade_logs",
  "positions",
  "account_history",
  "trading_signals",
  "agent_decisions",
  "agent_request_logs",
];

const MEMORY_DB_URL = process.env.TRADING_MEMORY_DB_URL || "file:./data/database/trading-memory.db";

const PRESERVED_CONFIG_KEYS = new Set([
  // 交易所/账户配置（Account Settings）
  "EXCHANGE_PROVIDER",
  "OKX_API_KEY",
  "OKX_API_SECRET",
  "OKX_API_PASSPHRASE",
  "OKX_USE_PAPER",
  "BINANCE_API_KEY",
  "BINANCE_API_SECRET",
  "BINANCE_USE_TESTNET",
  // "INITIAL_BALANCE", // 移除 INITIAL_BALANCE，允许重置时更新
  "ACCOUNT_STOP_LOSS_USDT",
  "ACCOUNT_TAKE_PROFIT_USDT",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "AI_MODEL_NAME",
  "HTTP_PROXY_URL",
  "UI_LANGUAGE",
  // 策略配置相关，重置实盘数据时需要保留
  "TRADING_SYMBOLS",
  "TRADING_MARGIN_MODE",
  "TRADING_INTERVAL_MINUTES",
  "MAX_LEVERAGE",
  "MAX_POSITIONS",
  "MAX_HOLDING_HOURS",
  "EXTREME_STOP_LOSS_PERCENT",
  "ACCOUNT_DRAWDOWN_WARNING_PERCENT",
  "ACCOUNT_DRAWDOWN_NO_NEW_POSITION_PERCENT",
  "ACCOUNT_DRAWDOWN_FORCE_CLOSE_PERCENT",
  "PROMPT_LANGUAGE",
  "PROMPT_SECTION_ENTRY",
  "PROMPT_SECTION_EXIT",
  "PROMPT_SECTION_VARIABLES",
  "ACTIVE_ACCOUNT_ID",
  "ACTIVE_ACCOUNT_SWITCH_AT",
]);

export interface ResetLiveDataResult {
  initialBalance: number;
  configuredInitialBalance: number;
  preservedKeys: string[];
  updatedKeys: string[];
  removedKeys: string[];
  accountSnapshot?: {
    totalValue: number;
    availableCash: number;
    unrealizedPnl: number;
  };
  clearedMemoryTables: string[];
}

export async function resetLiveDataToDefaults(targetAccount?: AccountConfig | null): Promise<ResetLiveDataResult> {
  const dbUrl = process.env.DATABASE_URL || "file:./data/database/sqlite.db";
  const client = createClient({
    url: dbUrl,
  });

  const resolvedAccount = targetAccount ?? (await getActiveAccount());
  const targetAccountId = resolvedAccount?.id ? resolvedAccount.id.toString() : null;

  const defaults = getDefaultConfigSnapshot();
  const timestamp = new Date().toISOString();

  const updatedKeys = new Set<string>();
  const removedKeys = new Set<string>();

  const configuredInitialRaw = defaults.INITIAL_BALANCE || process.env.INITIAL_BALANCE || "1000";
  const configuredInitialParsed = Number.parseFloat(configuredInitialRaw);
  const configuredInitialBalance = Number.isFinite(configuredInitialParsed) ? configuredInitialParsed : 1000;

  let accountSnapshot: { totalValue: number; availableCash: number; unrealizedPnl: number } = {
    totalValue: configuredInitialBalance,
    availableCash: configuredInitialBalance,
    unrealizedPnl: 0,
  };

  try {
    const exchangeClient = resolvedAccount
      ? createExchangeClientForAccount(resolvedAccount)
      : await createExchangeClientFromActiveAccount();
    const account = await exchangeClient.getFuturesAccount();

    const accountTotal = Number.parseFloat(account.total ?? "0");
    const available = Number.parseFloat(account.available ?? "0");
    const unrealised = Number.parseFloat(account.unrealisedPnl ?? "0");

    const safeTotal = Number.isFinite(accountTotal) ? accountTotal : configuredInitialBalance;
    const safeUnrealised = Number.isFinite(unrealised) ? unrealised : 0;
    const safeAvailable = Number.isFinite(available) ? available : configuredInitialBalance;

    accountSnapshot = {
      totalValue: safeTotal,
      availableCash: safeAvailable,
      unrealizedPnl: safeUnrealised,
    };

    // 更新 INITIAL_BALANCE 为当前账户余额
    defaults.INITIAL_BALANCE = safeTotal.toString();

    logger.info(
      `[reset] 账户快照: total=${accountSnapshot.totalValue.toFixed(2)}, available=${accountSnapshot.availableCash.toFixed(2)}, unrealized=${accountSnapshot.unrealizedPnl.toFixed(2)}`,
    );
  } catch (error) {
    logger.warn("[reset] 获取账户快照失败，使用配置的初始余额", error as any);
  }

  const memoryClient = createClient({
    url: MEMORY_DB_URL,
  });

  const clearedMemoryTables: string[] = [];

  try {
    await client.execute("BEGIN");

    for (const tableName of DATA_TABLES) {
      // trading_signals 表没有 account_id 字段，且为市场公共数据，
      // 当指定账户重置时，跳过该表；仅在全量重置时清空。
      if (tableName === "trading_signals" && targetAccountId) {
        continue;
      }

      const deleteConditions = targetAccountId
        ? "account_id = ? OR account_id IS NULL OR account_id = 'default'"
        : "1=1";
      const deleteArgs = targetAccountId ? [targetAccountId] : [];
      logger.info(
        `[reset] 清空表 ${tableName} (${targetAccountId ? `account_id=${targetAccountId}` : "全量"})`,
      );
      await client.execute({
        sql: `DELETE FROM ${tableName} WHERE ${deleteConditions}`,
        args: deleteArgs,
      });
    }

    logger.info("[reset] 重建账户初始记录");
    await client.execute({
      sql: `INSERT INTO account_history (account_id, timestamp, total_value, available_cash, unrealized_pnl, realized_pnl, return_percent)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        targetAccountId ?? "default",
        timestamp,
        accountSnapshot.totalValue,
        accountSnapshot.availableCash,
        accountSnapshot.unrealizedPnl,
        0,
        0,
      ],
    });

    const allConfigRows = await client.execute({
      sql: "SELECT key FROM system_config",
      args: [],
    });

    for (const row of allConfigRows.rows) {
      const key = String((row as Record<string, unknown>).key ?? "");
      if (!key || PRESERVED_CONFIG_KEYS.has(key)) {
        continue;
      }

      if (!Object.hasOwn(defaults, key)) {
        await client.execute({
          sql: "DELETE FROM system_config WHERE key = ?",
          args: [key],
        });
        removedKeys.add(key);
      }
    }

    for (const [key, value] of Object.entries(defaults)) {
      if (PRESERVED_CONFIG_KEYS.has(key)) {
        continue;
      }

      await client.execute({
        sql: `INSERT INTO system_config (key, value, updated_at)
              VALUES (?, ?, ?)
              ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?`,
        args: [key, value, timestamp, value, timestamp],
      });
      updatedKeys.add(key);
    }

    // 强制更新 ACTIVE_ACCOUNT_SWITCH_AT 为当前时间，确保统计数据重置
    await client.execute({
      sql: `INSERT INTO system_config (key, value, updated_at)
            VALUES ('ACTIVE_ACCOUNT_SWITCH_AT', ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?`,
      args: [timestamp, timestamp, timestamp, timestamp],
    });
    updatedKeys.add("ACTIVE_ACCOUNT_SWITCH_AT");

    await client.execute("COMMIT");

    try {
      const tablesResult = await memoryClient.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
      );

      for (const row of tablesResult.rows as Record<string, unknown>[]) {
        const rawName = String(row.name ?? "");
        if (!rawName) {
          continue;
        }
        const safeName = rawName.replace(/"/g, '""');
        await memoryClient.execute({
          sql: `DELETE FROM "${safeName}"`,
          args: [],
        });
        clearedMemoryTables.push(rawName);
      }

      if (clearedMemoryTables.length > 0) {
        logger.info(`[reset] 已清空 AI 记忆库表: ${clearedMemoryTables.join(", ")}`);
      }
    } catch (memoryError) {
      logger.error("[reset] 清空 AI 记忆库失败", memoryError as any);
    }

    logger.info("[reset] 数据与配置已恢复到默认状态");

    return {
      initialBalance: accountSnapshot.totalValue,
      configuredInitialBalance,
      preservedKeys: Array.from(PRESERVED_CONFIG_KEYS),
      updatedKeys: Array.from(updatedKeys),
      removedKeys: Array.from(removedKeys),
      accountSnapshot,
      clearedMemoryTables,
    };
  } catch (error) {
    await client.execute("ROLLBACK").catch(() => {
      /* ignore rollback error */
    });
    logger.error("[reset] 恢复默认状态失败", error as any);
    throw error;
  } finally {
    client.close();
    memoryClient.close();
  }
}
