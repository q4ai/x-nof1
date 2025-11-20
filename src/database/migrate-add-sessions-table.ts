/**
 * 数据库迁移：添加 sessions 表
 * 用于持久化用户登录状态，避免每次重启程序都需要重新登录
 */

import { createClient } from "@libsql/client";
import { createLogger } from "../utils/loggerUtils";

const logger = createLogger({
  name: "migrate-sessions",
  level: "info",
});

async function migrate() {
  const dbPath = process.env.DATABASE_PATH || "./db/trading.db";
  
  const client = createClient({
    url: `file:${dbPath}`,
  });

  try {
    logger.info("开始迁移：添加 sessions 表...");

    // 检查表是否已存在
    const checkResult = await client.execute({
      sql: "SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'",
      args: [],
    });

    if (checkResult.rows.length > 0) {
      logger.info("sessions 表已存在，跳过迁移");
      return;
    }

    // 创建 sessions 表
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

    // 创建索引
    await client.execute(`
      CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at)
    `);

    logger.info("✅ 成功添加 sessions 表");
  } catch (error) {
    logger.error("❌ 迁移失败:", error);
    throw error;
  } finally {
    client.close();
  }
}

migrate()
  .then(() => {
    logger.info("迁移完成");
    process.exit(0);
  })
  .catch((error) => {
    logger.error("迁移失败:", error);
    process.exit(1);
  });
