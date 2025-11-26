/**
 * 添加 AI 模型配置表迁移脚本
 */

import { createClient } from "@libsql/client";
import "dotenv/config";

const dbClient = createClient({
  url: process.env.DATABASE_URL || "file:./data/database/sqlite.db",
});

async function migrateAiModelsTable() {
  console.log("开始添加 AI 模型配置表...");

  try {
    // 创建 ai_models 表
    await dbClient.execute(`
      CREATE TABLE IF NOT EXISTS ai_models (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        provider TEXT NOT NULL,
        api_key TEXT NOT NULL,
        base_url TEXT NOT NULL,
        model_name TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    console.log("✅ ai_models 表创建成功");

    // 创建索引
    await dbClient.execute(`
      CREATE INDEX IF NOT EXISTS idx_ai_models_is_active ON ai_models(is_active)
    `);

    console.log("✅ 索引创建成功");

    // 迁移现有配置到数据库
    const envApiKey = process.env.OPENAI_API_KEY;
    const envBaseUrl = process.env.OPENAI_BASE_URL;
    const envModelName = process.env.AI_MODEL_NAME;

    if (envApiKey && envBaseUrl && envModelName) {
      // 检查是否已存在模型
      const existingResult = await dbClient.execute(
        "SELECT COUNT(*) as count FROM ai_models"
      );
      const existingCount = existingResult.rows[0]?.count;

      if (!existingCount || Number(existingCount) === 0) {
        const now = new Date().toISOString();
        await dbClient.execute({
          sql: `INSERT INTO ai_models (name, provider, api_key, base_url, model_name, is_active, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            "Default Model",
            "OpenAI Compatible",
            envApiKey,
            envBaseUrl,
            envModelName,
            1, // 设为激活
            now,
            now,
          ],
        });

        console.log("✅ 已迁移现有 .env 配置到数据库");
      }
    }

    console.log("✅ AI 模型配置表迁移完成");
  } catch (error) {
    console.error("❌ 迁移失败:", error);
    throw error;
  } finally {
    dbClient.close();
  }
}

// 执行迁移
migrateAiModelsTable().catch((error) => {
  console.error("迁移脚本执行失败:", error);
  process.exit(1);
});
