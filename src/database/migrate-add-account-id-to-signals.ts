
import { createClient } from "@libsql/client";
import { createLogger } from "../utils/loggerUtils";

const logger = createLogger({
  name: "migrate-add-account-id-to-signals",
  level: "info",
});

const dbClient = createClient({
  url: process.env.DATABASE_URL || "file:./data/database/sqlite.db",
});

async function migrate() {
  try {
    logger.info("开始添加 account_id 字段到 trading_signals 表...");

    try {
      await dbClient.execute("ALTER TABLE trading_signals ADD COLUMN account_id INTEGER");
      logger.info("trading_signals 表已添加 account_id 字段");
    } catch (e: any) {
      if (!e.message.includes("duplicate column name")) {
        logger.warn(`trading_signals 表添加字段失败: ${e.message}`);
      } else {
        logger.info("trading_signals 表已存在 account_id 字段");
      }
    }

    // 尝试为现有数据填充默认 account_id (如果有活跃账户)
    try {
      const activeAccountResult = await dbClient.execute("SELECT value FROM system_config WHERE key = 'ACTIVE_ACCOUNT_ID'");
      if (activeAccountResult.rows.length > 0) {
        const activeAccountId = Number(activeAccountResult.rows[0].value);
        if (activeAccountId > 0) {
          logger.info(`正在将 trading_signals 现有数据的 account_id 更新为当前活跃账户 ID: ${activeAccountId}`);
          await dbClient.execute({ sql: "UPDATE trading_signals SET account_id = ? WHERE account_id IS NULL", args: [activeAccountId] });
          logger.info("现有数据更新完成");
        }
      }
    } catch (e: any) {
      logger.warn(`更新现有数据失败: ${e.message}`);
    }

    logger.info("数据库迁移完成");
  } catch (error) {
    logger.error("迁移过程中发生错误:", error);
    process.exit(1);
  }
}

migrate();
