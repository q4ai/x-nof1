import { createClient } from "@libsql/client";
import { getDatabaseUrl } from "./pathUtils";
import { getActiveAccount } from "../services/accountConfigService";
import { getInstanceAccountId } from "../services/instanceContext";
import { createLogger } from "./loggerUtils";
import { getChinaTimeISO } from "./timeUtils";

type TradeLogStatus = "success" | "failed" | "warning";
type TradeLogAction = "open" | "close" | "cancel" | "adjust";

type TradeLogEntry = {
	action: TradeLogAction;
	message: string;
	status: TradeLogStatus;
	accountId?: number;
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
	url: getDatabaseUrl(),
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
		return serialized.length > 4000
			? `${serialized.slice(0, 4000)}...`
			: serialized;
	} catch (error) {
		logger.warn("无法序列化日志对象", error);
		return "[unserializable]";
	}
}

export async function recordTradeLog(entry: TradeLogEntry): Promise<void> {
	try {
		let resolvedAccountId: number | null = null;

		if (
			typeof entry.accountId === "number" &&
			Number.isFinite(entry.accountId)
		) {
			resolvedAccountId = entry.accountId;
		} else {
			const contextAccountId = getInstanceAccountId();
			if (contextAccountId !== null) {
				resolvedAccountId = contextAccountId;
			} else {
				const activeAccount = await getActiveAccount();
				resolvedAccountId = activeAccount?.id ?? null;
			}
		}

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
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			args: [
				resolvedAccountId,
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
