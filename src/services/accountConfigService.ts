/**
 * open-nof1.ai - AI 加密货币自动交易系统
 * Copyright (C) 2025 195440
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 * 
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 * 
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * 账户配置服务 - 多账户管理
 */
import { createClient } from "@libsql/client";
import { createLogger } from "../utils/loggerUtils";
import type { AccountConfig } from "../database/schema";

const logger = createLogger({
  name: "account-config-service",
  level: "info",
});

const dbClient = createClient({
  url: process.env.DATABASE_URL || "file:./db/sqlite.db",
});

/**
 * 获取所有账户配置
 */
export async function getAllAccounts(): Promise<AccountConfig[]> {
  try {
    const result = await dbClient.execute("SELECT * FROM account_configs ORDER BY created_at DESC");
    return result.rows.map((row: any) => ({
      id: row.id,
      name: row.name,
      provider: row.provider,
      api_key: row.api_key,
      api_secret: row.api_secret,
      api_passphrase: row.api_passphrase || undefined,
      use_paper: Boolean(row.use_paper),
      proxy_url: row.proxy_url || undefined,
      is_active: Boolean(row.is_active),
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  } catch (error) {
    logger.error("获取账户列表失败:", error);
    throw error;
  }
}

/**
 * 获取当前激活的账户
 */
export async function getActiveAccount(): Promise<AccountConfig | null> {
  try {
    const result = await dbClient.execute({
      sql: "SELECT * FROM account_configs WHERE is_active = 1 LIMIT 1",
      args: [],
    });
    
    if (result.rows.length === 0) {
      return null;
    }
    
    const row: any = result.rows[0];
    return {
      id: row.id,
      name: row.name,
      provider: row.provider,
      api_key: row.api_key,
      api_secret: row.api_secret,
      api_passphrase: row.api_passphrase || undefined,
      use_paper: Boolean(row.use_paper),
      proxy_url: row.proxy_url || undefined,
      is_active: Boolean(row.is_active),
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  } catch (error) {
    logger.error("获取当前账户失败:", error);
    throw error;
  }
}

/**
 * 根据ID获取账户
 */
export async function getAccountById(id: number): Promise<AccountConfig | null> {
  try {
    const result = await dbClient.execute({
      sql: "SELECT * FROM account_configs WHERE id = ?",
      args: [id],
    });
    
    if (result.rows.length === 0) {
      return null;
    }
    
    const row: any = result.rows[0];
    return {
      id: row.id,
      name: row.name,
      provider: row.provider,
      api_key: row.api_key,
      api_secret: row.api_secret,
      api_passphrase: row.api_passphrase || undefined,
      use_paper: Boolean(row.use_paper),
      proxy_url: row.proxy_url || undefined,
      is_active: Boolean(row.is_active),
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  } catch (error) {
    logger.error(`获取账户 ${id} 失败:`, error);
    throw error;
  }
}

/**
 * 创建新账户
 */
export async function createAccount(data: {
  name: string;
  provider: 'okx' | 'binance' | 'bitget';
  api_key: string;
  api_secret: string;
  api_passphrase?: string;
  use_paper: boolean;
  proxy_url?: string;
}): Promise<AccountConfig> {
  try {
    const now = new Date().toISOString();
    
    const result = await dbClient.execute({
      sql: `INSERT INTO account_configs 
            (name, provider, api_key, api_secret, api_passphrase, use_paper, proxy_url, is_active, created_at, updated_at) 
            VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      args: [
        data.name,
        data.provider,
        data.api_key,
        data.api_secret,
        data.api_passphrase || null,
        data.use_paper ? 1 : 0,
        data.proxy_url || null,
        now,
        now,
      ],
    });
    
    const id = Number(result.lastInsertRowid);
    logger.info(`创建账户成功: ${data.name} (ID: ${id})`);
    
    const account = await getAccountById(id);
    if (!account) {
      throw new Error("创建账户后无法获取");
    }
    
    return account;
  } catch (error) {
    logger.error("创建账户失败:", error);
    throw error;
  }
}

/**
 * 更新账户
 */
export async function updateAccount(id: number, data: {
  name?: string;
  provider?: 'okx' | 'binance' | 'bitget';
  api_key?: string;
  api_secret?: string;
  api_passphrase?: string;
  use_paper?: boolean;
  proxy_url?: string;
}): Promise<AccountConfig> {
  try {
    const existing = await getAccountById(id);
    if (!existing) {
      throw new Error(`账户 ${id} 不存在`);
    }
    
    const now = new Date().toISOString();
    const updates: string[] = [];
    const args: any[] = [];
    
    if (data.name !== undefined) {
      updates.push("name = ?");
      args.push(data.name);
    }
    if (data.provider !== undefined) {
      updates.push("provider = ?");
      args.push(data.provider);
    }
    if (data.api_key !== undefined) {
      updates.push("api_key = ?");
      args.push(data.api_key);
    }
    if (data.api_secret !== undefined) {
      updates.push("api_secret = ?");
      args.push(data.api_secret);
    }
    if (data.api_passphrase !== undefined) {
      updates.push("api_passphrase = ?");
      args.push(data.api_passphrase || null);
    }
    if (data.use_paper !== undefined) {
      updates.push("use_paper = ?");
      args.push(data.use_paper ? 1 : 0);
    }
    if (data.proxy_url !== undefined) {
      updates.push("proxy_url = ?");
      args.push(data.proxy_url || null);
    }
    
    updates.push("updated_at = ?");
    args.push(now);
    args.push(id);
    
    await dbClient.execute({
      sql: `UPDATE account_configs SET ${updates.join(", ")} WHERE id = ?`,
      args,
    });
    
    logger.info(`更新账户成功: ID ${id}`);
    
    const updated = await getAccountById(id);
    if (!updated) {
      throw new Error("更新账户后无法获取");
    }
    
    return updated;
  } catch (error) {
    logger.error(`更新账户 ${id} 失败:`, error);
    throw error;
  }
}

/**
 * 删除账户
 */
export async function deleteAccount(id: number): Promise<void> {
  try {
    const existing = await getAccountById(id);
    if (!existing) {
      throw new Error(`账户 ${id} 不存在`);
    }
    
    if (existing.is_active) {
      throw new Error("无法删除当前激活的账户，请先切换到其他账户");
    }
    
    await dbClient.execute({
      sql: "DELETE FROM account_configs WHERE id = ?",
      args: [id],
    });
    
    logger.info(`删除账户成功: ID ${id}`);
  } catch (error) {
    logger.error(`删除账户 ${id} 失败:`, error);
    throw error;
  }
}

/**
 * 设置当前激活的账户
 */
export async function setActiveAccount(id: number): Promise<AccountConfig> {
  try {
    const account = await getAccountById(id);
    if (!account) {
      throw new Error(`账户 ${id} 不存在`);
    }
    
    // 先将所有账户设为非激活
    await dbClient.execute("UPDATE account_configs SET is_active = 0");
    
    // 再将指定账户设为激活
    await dbClient.execute({
      sql: "UPDATE account_configs SET is_active = 1, updated_at = ? WHERE id = ?",
      args: [new Date().toISOString(), id],
    });
    
    logger.info(`切换当前账户成功: ${account.name} (ID: ${id})`);
    
    const updated = await getAccountById(id);
    if (!updated) {
      throw new Error("切换账户后无法获取");
    }
    
    return updated;
  } catch (error) {
    logger.error(`切换账户 ${id} 失败:`, error);
    throw error;
  }
}

/**
 * 从环境变量迁移账户配置（首次启动时调用）
 */
export async function migrateFromEnv(): Promise<void> {
  try {
    // 检查是否已有账户
    const existing = await getAllAccounts();
    if (existing.length > 0) {
      logger.info("已存在账户配置，跳过环境变量迁移");
      return;
    }
    
    // 从环境变量读取配置
    const provider = process.env.EXCHANGE_PROVIDER || 'okx';
    const apiKey = provider === 'okx' ? process.env.OKX_API_KEY : process.env.BINANCE_API_KEY;
    const apiSecret = provider === 'okx' ? process.env.OKX_API_SECRET : process.env.BINANCE_API_SECRET;
    const apiPassphrase = process.env.OKX_API_PASSPHRASE;
    const usePaper = provider === 'okx' 
      ? process.env.OKX_USE_PAPER === 'true' 
      : process.env.BINANCE_USE_TESTNET === 'true';
    const proxyUrl = process.env.HTTP_PROXY_URL;
    
    if (!apiKey || !apiSecret) {
      logger.warn("环境变量中未配置API凭证，跳过迁移");
      return;
    }
    
    // 创建默认账户
    const account = await createAccount({
      name: `默认账户 (${provider.toUpperCase()})`,
      provider: provider as 'okx' | 'binance',
      api_key: apiKey,
      api_secret: apiSecret,
      api_passphrase: apiPassphrase,
      use_paper: usePaper,
      proxy_url: proxyUrl,
    });
    
    // 设为激活账户
    await setActiveAccount(account.id);
    
    logger.info("✅ 从环境变量迁移账户配置成功");
  } catch (error) {
    logger.error("从环境变量迁移账户失败:", error);
    throw error;
  }
}
