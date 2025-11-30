import { createClient } from "@libsql/client";
import { createLogger } from "../utils/loggerUtils";

const logger = createLogger({
	name: "migrate-add-account-id",
	level: "info",
});

const dbClient = createClient({
	url: process.env.DATABASE_URL || "file:./data/database/sqlite.db",
});

async function migrate() {
	try {
		logger.info("开始添加 account_id 字段到相关表...");

		// 1. trades 表
		try {
			await dbClient.execute(
				"ALTER TABLE trades ADD COLUMN account_id INTEGER",
			);
			logger.info("trades 表已添加 account_id 字段");
		} catch (e: any) {
			if (!e.message.includes("duplicate column name")) {
				logger.warn(`trades 表添加字段失败: ${e.message}`);
			}
		}

		// 2. positions 表
		try {
			await dbClient.execute(
				"ALTER TABLE positions ADD COLUMN account_id INTEGER",
			);
			logger.info("positions 表已添加 account_id 字段");
		} catch (e: any) {
			if (!e.message.includes("duplicate column name")) {
				logger.warn(`positions 表添加字段失败: ${e.message}`);
			}
		}

		// 3. account_history 表
		try {
			await dbClient.execute(
				"ALTER TABLE account_history ADD COLUMN account_id INTEGER",
			);
			logger.info("account_history 表已添加 account_id 字段");
		} catch (e: any) {
			if (!e.message.includes("duplicate column name")) {
				logger.warn(`account_history 表添加字段失败: ${e.message}`);
			}
		}

		// 4. trade_logs 表
		try {
			await dbClient.execute(
				"ALTER TABLE trade_logs ADD COLUMN account_id INTEGER",
			);
			logger.info("trade_logs 表已添加 account_id 字段");
		} catch (e: any) {
			if (!e.message.includes("duplicate column name")) {
				logger.warn(`trade_logs 表添加字段失败: ${e.message}`);
			}
		}

		// 5. agent_decisions 表
		try {
			await dbClient.execute(
				"ALTER TABLE agent_decisions ADD COLUMN account_id INTEGER",
			);
			logger.info("agent_decisions 表已添加 account_id 字段");
		} catch (e: any) {
			if (!e.message.includes("duplicate column name")) {
				logger.warn(`agent_decisions 表添加字段失败: ${e.message}`);
			}
		}

		// 6. agent_request_logs 表
		try {
			await dbClient.execute(
				"ALTER TABLE agent_request_logs ADD COLUMN account_id INTEGER",
			);
			logger.info("agent_request_logs 表已添加 account_id 字段");
		} catch (e: any) {
			if (!e.message.includes("duplicate column name")) {
				logger.warn(`agent_request_logs 表添加字段失败: ${e.message}`);
			}
		}

		// 尝试为现有数据填充默认 account_id (如果有活跃账户)
		try {
			const activeAccountResult = await dbClient.execute(
				"SELECT value FROM system_config WHERE key = 'ACTIVE_ACCOUNT_ID'",
			);
			if (activeAccountResult.rows.length > 0) {
				const activeAccountId = Number(activeAccountResult.rows[0].value);
				if (activeAccountId > 0) {
					logger.info(
						`正在将现有数据的 account_id 更新为当前活跃账户 ID: ${activeAccountId}`,
					);

					await dbClient.execute({
						sql: "UPDATE trades SET account_id = ? WHERE account_id IS NULL",
						args: [activeAccountId],
					});
					await dbClient.execute({
						sql: "UPDATE positions SET account_id = ? WHERE account_id IS NULL",
						args: [activeAccountId],
					});
					await dbClient.execute({
						sql: "UPDATE account_history SET account_id = ? WHERE account_id IS NULL",
						args: [activeAccountId],
					});
					await dbClient.execute({
						sql: "UPDATE trade_logs SET account_id = ? WHERE account_id IS NULL",
						args: [activeAccountId],
					});
					await dbClient.execute({
						sql: "UPDATE agent_decisions SET account_id = ? WHERE account_id IS NULL",
						args: [activeAccountId],
					});
					await dbClient.execute({
						sql: "UPDATE agent_request_logs SET account_id = ? WHERE account_id IS NULL",
						args: [activeAccountId],
					});

					logger.info("现有数据更新完成");
				}
			}
		} catch (e: any) {
			logger.warn(`更新现有数据失败: ${e.message}`);
		}

		logger.info("数据库迁移完成");
	} catch (error) {
		logger.error("迁移失败:", error);
		process.exit(1);
	} finally {
		dbClient.close();
	}
}

migrate();
