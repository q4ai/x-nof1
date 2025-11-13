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
 * 数据库迁移脚本：添加 peak_pnl_percent 字段到 positions 表
 */
import { createClient } from "@libsql/client";

type TableInfoRow = {
  name?: string | null;
};

type PositionRow = {
  entry_price?: unknown;
  current_price?: unknown;
  leverage?: unknown;
  side?: unknown;
  symbol?: unknown;
};

function isTableInfoRow(row: unknown): row is TableInfoRow {
  return Boolean(row && typeof row === "object" && "name" in row);
}

function isPositionRow(row: unknown): row is PositionRow {
  return Boolean(row && typeof row === "object");
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

function toSymbol(value: unknown): string {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  if (typeof value === "number") {
    return value.toString();
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  return "";
}

async function addPeakPnlColumn() {
  const dbUrl = process.env.DATABASE_URL || "file:./db/sqlite.db";
  const dbClient = createClient({
    url: dbUrl,
  });

  try {
    console.log("开始数据库迁移：添加 peak_pnl_percent 字段...");

    // 检查字段是否已存在
    const tableInfo = await dbClient.execute("PRAGMA table_info(positions)");
    const columnExists = tableInfo.rows.some(
      (row) => isTableInfoRow(row) && row.name === "peak_pnl_percent",
    );

    if (columnExists) {
      console.log("✅ peak_pnl_percent 字段已存在，无需迁移");
      return;
    }

    // 添加字段
    await dbClient.execute(
      "ALTER TABLE positions ADD COLUMN peak_pnl_percent REAL DEFAULT 0",
    );

    console.log("✅ 成功添加 peak_pnl_percent 字段到 positions 表");

    // 为现有持仓初始化峰值盈亏
    const positions = await dbClient.execute("SELECT * FROM positions");
    const normalizedRows = positions.rows.filter(isPositionRow);

    for (const pos of normalizedRows) {
      const entryPrice = toNumber(pos.entry_price);
      const currentPrice = toNumber(pos.current_price);
      const leverage = toNumber(pos.leverage, 1);
      const side = pos.side === "short" ? "short" : "long";

      // 计算当前盈亏百分比
      const priceChangePercent = entryPrice > 0
        ? ((currentPrice - entryPrice) / entryPrice) * 100 * (side === "long" ? 1 : -1)
        : 0;
      const pnlPercent = priceChangePercent * leverage;

      // 初始化峰值为当前盈亏（如果是正数）或0
      const initialPeak = Math.max(pnlPercent, 0);

      await dbClient.execute({
        sql: "UPDATE positions SET peak_pnl_percent = ? WHERE symbol = ?",
        args: [initialPeak, toSymbol(pos.symbol)],
      });
    }

    console.log(`✅ 初始化了 ${normalizedRows.length} 个持仓的峰值盈亏百分比`);
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error("❌ 数据库迁移失败:", error.message);
    } else {
      console.error("❌ 数据库迁移失败: 未知错误", error);
    }
    process.exit(1);
  } finally {
    dbClient.close();
  }
}

addPeakPnlColumn().then(() => {
  console.log("数据库迁移完成");
  process.exit(0);
});

