/**
 * 数据库迁移助手
 */
import type { Client } from "@libsql/client";
import { createLogger } from "../utils/loggerUtils";

const logger = createLogger({
	name: "db-migrations",
	level: "info",
});

export async function ensureAgentDecisionExecutionColumn(
	client: Client,
): Promise<void> {
	try {
		const result = await client.execute("PRAGMA table_info(agent_decisions)");
		const hasColumn = Array.isArray(result.rows)
			? result.rows.some((row: any) => {
					const name =
						typeof row === "object" && row !== null
							? (row.name ?? row.column_name)
							: null;
					return (
						typeof name === "string" &&
						name.toLowerCase() === "execution_started_at"
					);
				})
			: false;

		if (!hasColumn) {
			logger.info("为 agent_decisions 表新增 execution_started_at 列...");
			await client.execute(
				"ALTER TABLE agent_decisions ADD COLUMN execution_started_at TEXT",
			);
			await client.execute(
				"UPDATE agent_decisions SET execution_started_at = timestamp WHERE execution_started_at IS NULL OR execution_started_at = ''",
			);
			logger.info("execution_started_at 列已添加并回填");
		}
	} catch (error) {
		logger.error("检查/添加 execution_started_at 列失败:", error as any);
	}
}

export async function ensureContractMultipliersTable(
	client: Client,
): Promise<void> {
	try {
		// 检查表是否存在
		const result = await client.execute(
			"SELECT name FROM sqlite_master WHERE type='table' AND name='contract_multipliers'",
		);

		if (result.rows.length === 0) {
			logger.info("创建 contract_multipliers 表...");
			await client.execute(`
        CREATE TABLE IF NOT EXISTS contract_multipliers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          symbol TEXT NOT NULL UNIQUE,
          multiplier REAL NOT NULL,
          contract_value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `);
			logger.info("contract_multipliers 表已创建");
		}
	} catch (error) {
		logger.error("检查/创建 contract_multipliers 表失败:", error as any);
	}
}

export async function ensureAgentRequestLogsTable(
	client: Client,
): Promise<void> {
	try {
		const result = await client.execute(
			"SELECT name FROM sqlite_master WHERE type='table' AND name='agent_request_logs'",
		);

		if (result.rows.length === 0) {
			logger.info("创建 agent_request_logs 表...");
			await client.execute(`
        CREATE TABLE IF NOT EXISTS agent_request_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          iteration INTEGER,
          model_name TEXT NOT NULL,
          instructions TEXT NOT NULL,
          prompt TEXT NOT NULL,
          response TEXT,
          response_summary TEXT,
          status TEXT NOT NULL DEFAULT 'success',
          error_message TEXT,
          output_duration_ms INTEGER
        )
      `);
			await client.execute(
				"CREATE INDEX IF NOT EXISTS idx_agent_request_logs_created_at ON agent_request_logs(created_at)",
			);
			logger.info("agent_request_logs 表已创建");
		} else {
			await ensureAgentRequestLogsDurationColumn(client);
		}

		if (result.rows.length === 0) {
			// 表新建后也要确保列存在（防止旧版本 SQL 未更新）
			await ensureAgentRequestLogsDurationColumn(client);
		}
	} catch (error) {
		logger.error("检查/创建 agent_request_logs 表失败", error as any);
	}
}

async function ensureAgentRequestLogsDurationColumn(
	client: Client,
): Promise<void> {
	try {
		const tableInfo = await client.execute(
			"PRAGMA table_info(agent_request_logs)",
		);
		const hasColumn = Array.isArray(tableInfo.rows)
			? tableInfo.rows.some(
					(row: any) =>
						row && typeof row === "object" && row.name === "output_duration_ms",
				)
			: false;

		if (!hasColumn) {
			logger.info("为 agent_request_logs 表添加 output_duration_ms 列...");
			await client.execute(
				"ALTER TABLE agent_request_logs ADD COLUMN output_duration_ms INTEGER",
			);
			logger.info("output_duration_ms 列添加完成");
		}
	} catch (error) {
		logger.error(
			"确保 agent_request_logs.output_duration_ms 列存在时出错",
			error as any,
		);
	}
}

/**
 * 确保 positions 表支持双向持仓（UNIQUE(symbol, side) 而不是 UNIQUE(symbol)）
 */
export async function ensureDualPositionSupport(client: Client): Promise<void> {
	try {
		// 检查是否已经是新结构
		const indexInfo = await client.execute(
			"SELECT sql FROM sqlite_master WHERE type='table' AND name='positions'",
		);
		if (indexInfo.rows.length > 0) {
			const createSql = (indexInfo.rows[0] as any).sql || "";
			// 如果已经包含 UNIQUE(symbol, side)，说明已迁移
			if (
				createSql.includes("UNIQUE(symbol, side)") ||
				createSql.includes("UNIQUE (symbol, side)")
			) {
				logger.info("positions 表已支持双向持仓");
				return;
			}
		}

		logger.info("开始迁移 positions 表以支持双向持仓...");

		// 1. 备份现有数据
		const existingPositions = await client.execute("SELECT * FROM positions");
		logger.info(`备份了 ${existingPositions.rows.length} 条持仓记录`);

		// 2. 删除旧表
		await client.execute("DROP TABLE IF EXISTS positions");

		// 3. 创建新表（支持双向持仓）
		await client.execute(`
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

		// 4. 恢复数据
		if (existingPositions.rows.length > 0) {
			for (const row of existingPositions.rows) {
				await client.execute({
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
		logger.error("双向持仓迁移失败:", error);
	}
}

/**
 * 确保 sessions 表存在（用于持久化登录状态）
 */
export async function ensureSessionsTable(client: Client): Promise<void> {
	try {
		const result = await client.execute({
			sql: "SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'",
			args: [],
		});

		if (result.rows.length > 0) {
			return; // 表已存在
		}

		logger.info("创建 sessions 表...");

		await client.execute(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        csrf_token TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

		await client.execute(`
      CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at)
    `);

		logger.info("✅ sessions 表创建成功");
	} catch (error) {
		logger.error("创建 sessions 表失败:", error);
	}
}

/**
 * 确保 account_configs 表存在（用于多账户管理）
 */
export async function ensureAccountConfigsTable(client: Client): Promise<void> {
	try {
		const result = await client.execute({
			sql: "SELECT name FROM sqlite_master WHERE type='table' AND name='account_configs'",
			args: [],
		});

		if (result.rows.length > 0) {
			return; // 表已存在
		}

		logger.info("创建 account_configs 表...");

		await client.execute(`
      CREATE TABLE IF NOT EXISTS account_configs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        provider TEXT NOT NULL,
        api_key TEXT NOT NULL,
        api_secret TEXT NOT NULL,
        api_passphrase TEXT,
        use_paper INTEGER NOT NULL DEFAULT 0,
        proxy_url TEXT,
        is_active INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

		await client.execute(`
      CREATE INDEX IF NOT EXISTS idx_account_configs_is_active ON account_configs(is_active)
    `);

		logger.info("✅ account_configs 表创建成功");
	} catch (error) {
		logger.error("创建 account_configs 表失败:", error);
	}
}

/**
 * 确保 trading_instances 表存在（用于多账户并行策略任务管理）
 */
export async function ensureTradingInstancesTable(
	client: Client,
): Promise<void> {
	try {
		const result = await client.execute({
			sql: "SELECT name FROM sqlite_master WHERE type='table' AND name='trading_instances'",
			args: [],
		});

		if (result.rows.length > 0) {
			return; // 表已存在
		}

		logger.info("创建 trading_instances 表...");

		await client.execute(`
      CREATE TABLE IF NOT EXISTS trading_instances (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        account_id INTEGER NOT NULL,
        ai_model_id INTEGER NOT NULL,
        strategy_name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'stopped',
        interval_minutes INTEGER NOT NULL DEFAULT 20,
        last_executed_at TEXT,
        last_execution_status TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (account_id) REFERENCES account_configs(id) ON DELETE CASCADE,
        FOREIGN KEY (ai_model_id) REFERENCES ai_models(id) ON DELETE CASCADE
      )
    `);

		await client.execute(`
      CREATE INDEX IF NOT EXISTS idx_trading_instances_status ON trading_instances(status)
    `);

		await client.execute(`
      CREATE INDEX IF NOT EXISTS idx_trading_instances_account_id ON trading_instances(account_id)
    `);

		logger.info("✅ trading_instances 表创建成功");
	} catch (error) {
		logger.error("创建 trading_instances 表失败:", error);
	}
}
