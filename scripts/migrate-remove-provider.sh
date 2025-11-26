#!/bin/bash

# 移除 ai_models 表的 provider 字段

echo "开始迁移：移除 ai_models 表的 provider 字段..."

DB_PATH="./data/database/sqlite.db"

# 检查数据库文件是否存在
if [ ! -f "$DB_PATH" ]; then
    echo "❌ 数据库文件不存在: $DB_PATH"
    exit 1
fi

# 使用sqlite3执行迁移
sqlite3 "$DB_PATH" <<EOF
-- 检查表是否存在
.headers off
.mode list

-- 开始事务
BEGIN TRANSACTION;

-- 创建新表（不包含 provider 字段）
CREATE TABLE IF NOT EXISTS ai_models_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  api_key TEXT NOT NULL,
  base_url TEXT NOT NULL,
  model_name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 复制数据（不包含 provider 字段）
INSERT INTO ai_models_new (id, name, api_key, base_url, model_name, is_active, created_at, updated_at)
SELECT id, name, api_key, base_url, model_name, is_active, created_at, updated_at
FROM ai_models;

-- 删除旧表
DROP TABLE ai_models;

-- 重命名新表
ALTER TABLE ai_models_new RENAME TO ai_models;

-- 重建索引
CREATE INDEX IF NOT EXISTS idx_ai_models_is_active ON ai_models(is_active);

-- 提交事务
COMMIT;

-- 显示结果
SELECT 'Migration completed successfully' as status;
EOF

if [ $? -eq 0 ]; then
    echo "✅ 成功移除 provider 字段"
else
    echo "❌ 迁移失败"
    exit 1
fi
