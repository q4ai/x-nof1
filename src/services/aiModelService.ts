/**
 * AI 模型配置服务
 */

import { createClient } from "@libsql/client";
import { logger } from "../utils/loggerUtils";

const dbClient = createClient({
  url: process.env.DATABASE_URL || "file:./data/database/sqlite.db",
});

export interface AiModel {
  id: number;
  name: string;
  api_key: string;
  base_url: string;
  model_name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateAiModelInput {
  name: string;
  api_key: string;
  base_url: string;
  model_name: string;
}

export interface UpdateAiModelInput {
  name?: string;
  api_key?: string;
  base_url?: string;
  model_name?: string;
}

/**
 * 获取所有 AI 模型配置
 */
export async function getAllAiModels(): Promise<AiModel[]> {
  try {
    const result = await dbClient.execute("SELECT * FROM ai_models ORDER BY created_at DESC");
    return result.rows.map((row: any) => ({
      id: row.id,
      name: row.name,
      api_key: row.api_key,
      base_url: row.base_url,
      model_name: row.model_name,
      is_active: Boolean(row.is_active),
      created_at: row.created_at,
      updated_at: row.updated_at,
    })) as AiModel[];
  } catch (error) {
    logger.error("获取 AI 模型列表失败:", error);
    throw error;
  }
}

/**
 * 获取当前激活的 AI 模型
 */
export async function getActiveAiModel(): Promise<AiModel | null> {
  try {
    const result = await dbClient.execute({
      sql: "SELECT * FROM ai_models WHERE is_active = 1 LIMIT 1",
      args: [],
    });
    
    if (result.rows.length === 0) {
      return null;
    }
    
    const row: any = result.rows[0];
    return {
      id: row.id,
      name: row.name,
      api_key: row.api_key,
      base_url: row.base_url,
      model_name: row.model_name,
      is_active: Boolean(row.is_active),
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  } catch (error) {
    logger.error("获取当前激活的 AI 模型失败:", error);
    throw error;
  }
}

/**
 * 根据 ID 获取 AI 模型
 */
export async function getAiModelById(id: number): Promise<AiModel | null> {
  try {
    const result = await dbClient.execute({
      sql: "SELECT * FROM ai_models WHERE id = ?",
      args: [id],
    });
    
    if (result.rows.length === 0) {
      return null;
    }
    
    const row: any = result.rows[0];
    return {
      id: row.id,
      name: row.name,
      api_key: row.api_key,
      base_url: row.base_url,
      model_name: row.model_name,
      is_active: Boolean(row.is_active),
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  } catch (error) {
    logger.error(`获取 AI 模型 ${id} 失败:`, error);
    throw error;
  }
}

/**
 * 创建新的 AI 模型配置
 */
export async function createAiModel(input: CreateAiModelInput): Promise<AiModel> {
  try {
    const now = new Date().toISOString();
    
    // 检查是否已存在同名模型
    const existingResult = await dbClient.execute({
      sql: "SELECT COUNT(*) as count FROM ai_models WHERE name = ?",
      args: [input.name],
    });
    const existingCount = existingResult.rows[0]?.count;
    
    if (existingCount && Number(existingCount) > 0) {
      throw new Error(`AI 模型配置 "${input.name}" 已存在`);
    }
    
    // 如果这是第一个模型，自动设为激活
    const countResult = await dbClient.execute("SELECT COUNT(*) as count FROM ai_models");
    const totalCount = countResult.rows[0]?.count;
    const isActive = totalCount && Number(totalCount) === 0 ? 1 : 0;
    
    const result = await dbClient.execute({
      sql: `INSERT INTO ai_models (name, api_key, base_url, model_name, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [input.name, input.api_key, input.base_url, input.model_name, isActive, now, now],
    });
    
    if (!result.lastInsertRowid) {
      throw new Error("创建 AI 模型配置失败");
    }
    
    const model = await getAiModelById(Number(result.lastInsertRowid));
    if (!model) {
      throw new Error("创建后无法获取 AI 模型配置");
    }
    
    logger.info(`创建 AI 模型配置: ${model.name} (ID: ${model.id})`);
    return model;
  } catch (error) {
    logger.error("创建 AI 模型配置失败:", error);
    throw error;
  }
}

/**
 * 更新 AI 模型配置
 */
export async function updateAiModel(id: number, input: UpdateAiModelInput): Promise<AiModel> {
  try {
    const now = new Date().toISOString();
    
    const existing = await getAiModelById(id);
    if (!existing) {
      throw new Error(`AI 模型配置 ID ${id} 不存在`);
    }
    
    // 检查名称是否与其他模型冲突
    if (input.name && input.name !== existing.name) {
      const duplicateResult = await dbClient.execute({
        sql: "SELECT COUNT(*) as count FROM ai_models WHERE name = ? AND id != ?",
        args: [input.name, id],
      });
      const duplicateCount = duplicateResult.rows[0]?.count;
      if (duplicateCount && Number(duplicateCount) > 0) {
        throw new Error(`AI 模型配置 "${input.name}" 已存在`);
      }
    }
    
    const updates: string[] = [];
    const values: (string | number)[] = [];
    
    if (input.name !== undefined) {
      updates.push("name = ?");
      values.push(input.name);
    }
    if (input.api_key !== undefined) {
      updates.push("api_key = ?");
      values.push(input.api_key);
    }
    if (input.base_url !== undefined) {
      updates.push("base_url = ?");
      values.push(input.base_url);
    }
    if (input.model_name !== undefined) {
      updates.push("model_name = ?");
      values.push(input.model_name);
    }
    
    if (updates.length === 0) {
      return existing;
    }
    
    updates.push("updated_at = ?");
    values.push(now);
    values.push(id);
    
    await dbClient.execute({
      sql: `UPDATE ai_models SET ${updates.join(", ")} WHERE id = ?`,
      args: values,
    });
    
    const updated = await getAiModelById(id);
    if (!updated) {
      throw new Error("更新后无法获取 AI 模型配置");
    }
    
    logger.info(`更新 AI 模型配置: ${updated.name} (ID: ${updated.id})`);
    return updated;
  } catch (error) {
    logger.error("更新 AI 模型配置失败:", error);
    throw error;
  }
}

/**
 * 删除 AI 模型配置
 */
export async function deleteAiModel(id: number): Promise<void> {
  try {
    const existing = await getAiModelById(id);
    if (!existing) {
      throw new Error(`AI 模型配置 ID ${id} 不存在`);
    }
    
    if (existing.is_active) {
      throw new Error("无法删除当前激活的 AI 模型配置");
    }
    
    await dbClient.execute({
      sql: "DELETE FROM ai_models WHERE id = ?",
      args: [id],
    });
    
    logger.info(`删除 AI 模型配置: ${existing.name} (ID: ${id})`);
  } catch (error) {
    logger.error("删除 AI 模型配置失败:", error);
    throw error;
  }
}

/**
 * 设置激活的 AI 模型
 */
export async function setActiveAiModel(id: number): Promise<AiModel> {
  try {
    const model = await getAiModelById(id);
    if (!model) {
      throw new Error(`AI 模型配置 ID ${id} 不存在`);
    }
    
    const now = new Date().toISOString();
    
    // 先将所有模型设为非激活
    await dbClient.execute("UPDATE ai_models SET is_active = 0");
    
    // 设置指定模型为激活
    await dbClient.execute({
      sql: "UPDATE ai_models SET is_active = 1, updated_at = ? WHERE id = ?",
      args: [now, id],
    });
    
    const updated = await getAiModelById(id);
    if (!updated) {
      throw new Error("激活后无法获取 AI 模型配置");
    }
    
    // 同步更新系统配置表，确保前端显示的图标和名称正确
    const { updateConfig } = await import("../database/init-config");
    await updateConfig({
      AI_MODEL_NAME: updated.model_name,
      OPENAI_API_KEY: updated.api_key,
      OPENAI_BASE_URL: updated.base_url,
    });
    
    logger.info(`激活 AI 模型配置: ${updated.name} (ID: ${updated.id})`);
    return updated;
  } catch (error) {
    logger.error("设置激活 AI 模型失败:", error);
    throw error;
  }
}
