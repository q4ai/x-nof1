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
