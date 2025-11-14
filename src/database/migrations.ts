/**
 * 数据库迁移助手
 */
import type { Client } from "@libsql/client";
import { createLogger } from "../utils/loggerUtils";

const logger = createLogger({
  name: "db-migrations",
  level: "info",
});

export async function ensureAgentDecisionExecutionColumn(client: Client): Promise<void> {
  try {
    const result = await client.execute("PRAGMA table_info(agent_decisions)");
    const hasColumn = Array.isArray(result.rows)
      ? result.rows.some((row: any) => {
          const name = typeof row === "object" && row !== null ? (row.name ?? row.column_name) : null;
          return typeof name === "string" && name.toLowerCase() === "execution_started_at";
        })
      : false;

    if (!hasColumn) {
      logger.info("为 agent_decisions 表新增 execution_started_at 列...");
      await client.execute("ALTER TABLE agent_decisions ADD COLUMN execution_started_at TEXT");
      await client.execute(
        "UPDATE agent_decisions SET execution_started_at = timestamp WHERE execution_started_at IS NULL OR execution_started_at = ''"
      );
      logger.info("execution_started_at 列已添加并回填");
    }
  } catch (error) {
    logger.error("检查/添加 execution_started_at 列失败:", error as any);
  }
}

export async function ensureContractMultipliersTable(client: Client): Promise<void> {
  try {
    // 检查表是否存在
    const result = await client.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='contract_multipliers'"
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

export async function ensureAgentRequestLogsTable(client: Client): Promise<void> {
  try {
    const result = await client.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='agent_request_logs'"
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
        "CREATE INDEX IF NOT EXISTS idx_agent_request_logs_created_at ON agent_request_logs(created_at)"
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

async function ensureAgentRequestLogsDurationColumn(client: Client): Promise<void> {
  try {
    const tableInfo = await client.execute("PRAGMA table_info(agent_request_logs)");
    const hasColumn = Array.isArray(tableInfo.rows)
      ? tableInfo.rows.some((row: any) => row && typeof row === "object" && row.name === "output_duration_ms")
      : false;

    if (!hasColumn) {
      logger.info("为 agent_request_logs 表添加 output_duration_ms 列...");
      await client.execute("ALTER TABLE agent_request_logs ADD COLUMN output_duration_ms INTEGER");
      logger.info("output_duration_ms 列添加完成");
    }
  } catch (error) {
    logger.error("确保 agent_request_logs.output_duration_ms 列存在时出错", error as any);
  }
}

