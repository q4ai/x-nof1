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

