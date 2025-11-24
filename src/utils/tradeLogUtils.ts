import { createClient } from "@libsql/client";
import { getChinaTimeISO } from "./timeUtils";
import { createLogger } from "./loggerUtils";
import { getActiveAccount } from "../services/accountConfigService";

type TradeLogStatus = "success" | "failed" | "warning";
type TradeLogAction = "open" | "close" | "cancel" | "adjust";

type TradeLogEntry = {
  action: TradeLogAction;
  message: string;
  status: TradeLogStatus;
  symbol?: string;
  side?: "long" | "short";
  leverage?: number;
  amountUsdt?: number;
  size?: number;
  orderId?: string;
  request?: unknown;
  response?: unknown;
};

const logger = createLogger({
  name: "trade-log-utils",
  level: "info",
});

const dbClient = createClient({
  url: process.env.DATABASE_URL || "file:./db/sqlite.db",
});

function safeSerialize(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === "string") {
    return value.length > 4000 ? `${value.slice(0, 4000)}...` : value;
  }

  try {
    const serialized = JSON.stringify(value);
    return serialized.length > 4000 ? `${serialized.slice(0, 4000)}...` : serialized;
  } catch (error) {
    logger.warn("无法序列化日志对象", error);
    return "[unserializable]";
  }
}

export async function recordTradeLog(entry: TradeLogEntry): Promise<void> {
  try {
    const activeAccount = await getActiveAccount();
    const accountId = activeAccount ? activeAccount.id.toString() : "default";

    await dbClient.execute({
      sql: `INSERT INTO trade_logs (
        account_id,
        action,
        symbol,
        side,
        leverage,
        amount_usdt,
        size,
        status,
        message,
        order_id,
        raw_request,
        raw_response,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
      args: [
        accountId,
        entry.action,
        entry.symbol || null,
        entry.side || null,
        typeof entry.leverage === "number" ? entry.leverage : null,
        typeof entry.amountUsdt === "number" ? entry.amountUsdt : null,
        typeof entry.size === "number" ? entry.size : null,
        entry.status,
        entry.message,
        entry.orderId || null,
        safeSerialize(entry.request),
        safeSerialize(entry.response),
        getChinaTimeISO(),
      ],
    });
  } catch (error) {
    logger.error("记录交易日志失败", error);
  }
}
