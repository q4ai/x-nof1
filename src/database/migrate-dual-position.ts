/**
 * 数据库迁移：支持双向持仓模式
 * 将 positions 表的唯一键从 symbol 改为 (symbol, side)
 */

import { createClient } from "@libsql/client";
import { getDatabaseUrl } from "../utils/pathUtils";
import { createLogger } from "../utils/loggerUtils";

const logger = createLogger({
	name: "migrate-dual-position",
	level: "info",
});

const dbClient = createClient({
	url: getDatabaseUrl(),
});

async function migrateToDualPosition() {
	try {
		logger.info("开始迁移 positions 表以支持双向持仓...");

		// 1. 备份现有数据
		const existingPositions = await dbClient.execute("SELECT * FROM positions");
		logger.info(`备份了 ${existingPositions.rows.length} 条持仓记录`);

		// 2. 删除旧表
		await dbClient.execute("DROP TABLE IF EXISTS positions");
		logger.info("已删除旧 positions 表");

		// 3. 创建新表（支持双向持仓）
		await dbClient.execute(`
      CREATE TABLE IF NOT EXISTS positions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT NOT NULL,
        quantity REAL NOT NULL,
        entry_price REAL NOT NULL,
        current_price REAL NOT NULL,
        liquidation_price REAL NOT NULL,
        unrealized_pnl REAL NOT NULL,
        leverage INTEGER NOT NULL,
        side TEXT NOT NULL,
        profit_target REAL,
        stop_loss REAL,
        tp_order_id TEXT,
        sl_order_id TEXT,
        entry_order_id TEXT NOT NULL,
        opened_at TEXT NOT NULL,
        confidence REAL,
        risk_usd REAL,
        peak_pnl_percent REAL DEFAULT 0,
        partial_close_percentage REAL DEFAULT 0,
        UNIQUE(symbol, side)
      )
    `);
		logger.info("已创建新 positions 表（支持双向持仓）");

		// 4. 恢复数据（如果有的话）
		if (existingPositions.rows.length > 0) {
			for (const row of existingPositions.rows) {
				await dbClient.execute({
					sql: `INSERT INTO positions 
                (symbol, quantity, entry_price, current_price, liquidation_price, unrealized_pnl, 
                 leverage, side, profit_target, stop_loss, tp_order_id, sl_order_id, entry_order_id, 
                 opened_at, confidence, risk_usd, peak_pnl_percent, partial_close_percentage)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
					args: [
						row.symbol,
						row.quantity,
						row.entry_price,
						row.current_price,
						row.liquidation_price,
						row.unrealized_pnl,
						row.leverage,
						row.side,
						row.profit_target,
						row.stop_loss,
						row.tp_order_id,
						row.sl_order_id,
						row.entry_order_id,
						row.opened_at,
						row.confidence,
						row.risk_usd,
						row.peak_pnl_percent || 0,
						row.partial_close_percentage || 0,
					],
				});
			}
			logger.info(`已恢复 ${existingPositions.rows.length} 条持仓记录`);
		}

		logger.info("✅ 双向持仓迁移完成");
	} catch (error) {
		logger.error("迁移失败:", error);
		throw error;
	}
}

// 如果直接运行此脚本
if (require.main === module) {
	migrateToDualPosition()
		.then(() => {
			logger.info("迁移成功");
			process.exit(0);
		})
		.catch((error) => {
			logger.error("迁移失败:", error);
			process.exit(1);
		});
}

export { migrateToDualPosition };
