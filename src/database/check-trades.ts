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

import { createClient } from "@libsql/client";
import { createLogger } from "../utils/loggerUtils";
import "dotenv/config";

const logger = createLogger({
	name: "check-trades",
	level: "info",
});

type TradeRow = {
	id?: unknown;
	symbol?: unknown;
	side?: unknown;
	type?: unknown;
	price?: unknown;
	quantity?: unknown;
	leverage?: unknown;
	fee?: unknown;
	timestamp?: unknown;
};

function isTradeRow(row: unknown): row is TradeRow {
	return Boolean(row && typeof row === "object");
}

function formatSide(side: unknown): "long" | "short" {
	return side === "short" ? "short" : "long";
}

function formatType(type: unknown): "open" | "close" {
	return type === "close" ? "close" : "open";
}

function formatNumber(value: unknown, fractionDigits = 4): string {
	if (typeof value === "number") {
		return value.toFixed(fractionDigits);
	}
	if (typeof value === "string") {
		const parsed = Number.parseFloat(value);
		if (Number.isFinite(parsed)) {
			return parsed.toFixed(fractionDigits);
		}
	}
	if (typeof value === "bigint") {
		return Number(value).toFixed(fractionDigits);
	}
	return "0.0000";
}

function formatInteger(value: unknown): string {
	if (typeof value === "number" && Number.isFinite(value)) {
		return String(value);
	}
	if (typeof value === "bigint") {
		return value.toString();
	}
	if (typeof value === "string" && value.length > 0) {
		return value;
	}
	return "0";
}

function formatId(value: unknown): string {
	if (typeof value === "string" || typeof value === "number") {
		return String(value);
	}
	if (typeof value === "bigint") {
		return value.toString();
	}
	return "未知";
}

async function checkTrades() {
	const dbUrl = process.env.DATABASE_URL || "file:./data/database/sqlite.db";
	const client = createClient({ url: dbUrl });

	try {
		logger.info("📊 查询最近5条交易记录...\n");

		const result = await client.execute({
			sql: "SELECT id, symbol, side, type, price, quantity, leverage, fee, timestamp FROM trades ORDER BY timestamp DESC LIMIT 5",
			args: [],
		});

		const rows = result.rows.filter(isTradeRow);

		if (rows.length === 0) {
			logger.info("没有交易记录");
			return;
		}

		console.log("交易记录：");
		console.log("=".repeat(100));

		for (const row of rows) {
			const side = formatSide(row.side);
			const type = formatType(row.type);
			const typeText = type === "open" ? "开" : "平";
			const sideText = side === "long" ? "多" : "空";
			const feeText = formatNumber(row.fee);

			console.log(`ID: ${formatId(row.id)}`);
			console.log(`  币种: ${row.symbol ?? "未知"}`);
			console.log(
				`  操作: ${typeText}${sideText} (side=${side}, type=${type})`,
			);
			console.log(`  价格: ${formatNumber(row.price)}`);
			console.log(`  数量: ${formatInteger(row.quantity)}`);
			console.log(`  杠杆: ${formatInteger(row.leverage)}x`);
			console.log(`  手续费: ${feeText} USDT`);
			console.log(`  时间: ${row.timestamp ?? "未知"}`);
			console.log("-".repeat(100));
		}

		process.exit(0);
	} catch (error: unknown) {
		if (error instanceof Error) {
			logger.error(`❌ 查询失败: ${error.message}`);
		} else {
			logger.error("❌ 查询失败: 未知错误", error as Record<string, unknown>);
		}
		process.exit(1);
	} finally {
		client.close();
	}
}

checkTrades();
