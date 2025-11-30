/**
 * 数据库迁移脚本：移除 ai_models 表的 provider 字段
 *
 * 直接运行此脚本：
 * npx tsx --no-warnings src/database/migrate-remove-provider-from-ai-models.ts
 */

import { createClient } from "@libsql/client";

const dbClient = createClient({
	url: process.env.DATABASE_URL || "file:./data/database/sqlite.db",
});

async function migrateRemoveProvider() {
	console.log("开始迁移：移除 ai_models 表的 provider 字段...");

	try {
		// 检查表是否存在
		const tableCheck = await dbClient.execute({
			sql: "SELECT name FROM sqlite_master WHERE type='table' AND name='ai_models'",
			args: [],
		});

		if (tableCheck.rows.length === 0) {
			console.log("ai_models 表不存在，无需迁移");
			return;
		}

		// 检查 provider 列是否存在
		const columnCheck = await dbClient.execute({
			sql: "PRAGMA table_info(ai_models)",
			args: [],
		});

		const hasProviderColumn = columnCheck.rows.some(
			(row: any) => row.name === "provider",
		);

		if (!hasProviderColumn) {
			console.log("✅ provider 列不存在，无需迁移");
			return;
		}

		console.log("发现 provider 列，开始迁移...");

		// SQLite 不支持直接删除列，需要重建表
		// 1. 创建新表（不包含 provider 字段）
		await dbClient.execute(`
      CREATE TABLE IF NOT EXISTS ai_models_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        api_key TEXT NOT NULL,
        base_url TEXT NOT NULL,
        model_name TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

		// 2. 复制数据（不包含 provider 字段）
		await dbClient.execute(`
      INSERT INTO ai_models_new (id, name, api_key, base_url, model_name, is_active, created_at, updated_at)
      SELECT id, name, api_key, base_url, model_name, is_active, created_at, updated_at
      FROM ai_models
    `);

		// 3. 删除旧表
		await dbClient.execute("DROP TABLE ai_models");

		// 4. 重命名新表
		await dbClient.execute("ALTER TABLE ai_models_new RENAME TO ai_models");

		// 5. 重建索引
		await dbClient.execute(`
      CREATE INDEX IF NOT EXISTS idx_ai_models_is_active ON ai_models(is_active)
    `);

		console.log("✅ 成功移除 provider 字段");
	} catch (error) {
		console.error("❌ 迁移失败:", error);
		throw error;
	} finally {
		// 关闭数据库连接
		dbClient.close();
	}
}

// 仅在直接运行此脚本时执行迁移
if (require.main === module) {
	migrateRemoveProvider()
		.then(() => {
			console.log("迁移完成");
			process.exit(0);
		})
		.catch((error) => {
			console.error("迁移失败:", error);
			process.exit(1);
		});
}

export { migrateRemoveProvider };
