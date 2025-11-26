import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createClient } from "@libsql/client";
import { createLogger } from "../utils/loggerUtils";
import { getChinaTimeISO } from "../utils/timeUtils";
import { CREATE_TABLES_SQL } from "../database/schema";

const logger = createLogger({ name: "install-service", level: "info" });

/**
 * 生成随机字符串
 */
function generateRandomString(length: number, chars: string): string {
  let result = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}

/**
 * 生成后台管理凭证
 */
function generateAdminCredentials() {
  // 生成随机路径（8位字母数字）
  const pathChars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const adminPath = generateRandomString(8, pathChars);
  
  // 生成随机用户名（8位字母数字）
  const username = 'admin_' + generateRandomString(6, pathChars);
  
  // 生成随机密码（16位，包含大小写字母、数字、特殊字符）
  const passwordChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  const password = generateRandomString(16, passwordChars);
  
  return { adminPath, username, password };
}

// 数据库路径
const DATA_DIR = path.resolve(process.cwd(), "data");
const DB_DIR = path.resolve(process.cwd(), "data/database");
const DB_PATH = path.join(DB_DIR, "sqlite.db");
const INSTALL_LOCK_PATH = path.join(DATA_DIR, "install.lock");

export interface InstallData {
  systemConfig: {
    initial_balance: number;
    trading_interval: number;
    max_leverage: number;
    max_positions: number;
    trading_symbols: string;
    http_proxy_url?: string;
    community_report_enabled?: boolean;
    community_share_prompts?: boolean;
  };
  accountConfig: {
    name: string;
    provider: "okx" | "binance" | "bitget";
    api_key: string;
    api_secret: string;
    api_passphrase?: string;
    use_paper: boolean;
    proxy_url?: string;
    stop_loss_usdt?: number | null;
    take_profit_usdt?: number | null;
  };
  aiModelConfig: {
    name: string;
    provider: string;
    model_name: string;
    api_key: string;
    base_url?: string;
  };
}

/**
 * 检查系统是否已安装
 * 依据：data/install.lock 文件和 data/database/sqlite.db 文件是否都存在
 */
export function isSystemInstalled(): boolean {
  return fs.existsSync(INSTALL_LOCK_PATH) && fs.existsSync(DB_PATH);
}

export interface InstallResult {
  success: boolean;
  adminCredentials: {
    adminPath: string;
    username: string;
    password: string;
  };
}

/**
 * 执行安装
 */
export async function installSystem(data: InstallData): Promise<InstallResult> {
  logger.info("开始系统安装...");

  // 1. 确保目录存在
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }

  // 2. 初始化数据库连接 (会自动创建文件)
  const db = createClient({ url: `file:${DB_PATH}` });
  let installationSucceeded = false;
  let adminCredentials: { adminPath: string; username: string; password: string } | null = null;

  try {
    // 3. 创建表结构
    logger.info("正在初始化数据库表结构...");
    await db.executeMultiple(CREATE_TABLES_SQL);

    const now = getChinaTimeISO();
    const normalizedSymbols = data.systemConfig.trading_symbols
      .split(",")
      .map((symbol) => symbol.trim().toUpperCase())
      .filter((symbol) => symbol.length > 0);

    if (normalizedSymbols.length === 0) {
      throw new Error("交易币种不能为空");
    }

    const accountProvider = data.accountConfig.provider.toLowerCase();
    const supportedProviders = new Set(["okx", "binance", "bitget"]);
    if (!supportedProviders.has(accountProvider)) {
      throw new Error(`不支持的交易所类型: ${accountProvider}`);
    }

    const stopLossValue = typeof data.accountConfig.stop_loss_usdt === "number" && Number.isFinite(data.accountConfig.stop_loss_usdt)
      ? data.accountConfig.stop_loss_usdt
      : null;
    const takeProfitValue = typeof data.accountConfig.take_profit_usdt === "number" && Number.isFinite(data.accountConfig.take_profit_usdt)
      ? data.accountConfig.take_profit_usdt
      : null;
    const httpProxy = data.systemConfig.http_proxy_url?.trim() ?? "";
    const communityReportEnabled = Boolean(data.systemConfig.community_report_enabled);
    const communitySharePrompts = communityReportEnabled ? Boolean(data.systemConfig.community_share_prompts) : false;

    // 4. 写入系统配置
    logger.info("写入系统配置...");
    const sysConfigs = [
      { key: "INITIAL_BALANCE", value: String(data.systemConfig.initial_balance) },
      { key: "TRADING_INTERVAL_MINUTES", value: String(data.systemConfig.trading_interval) },
      { key: "MAX_LEVERAGE", value: String(data.systemConfig.max_leverage) },
      { key: "MAX_POSITIONS", value: String(data.systemConfig.max_positions) },
      { key: "TRADING_SYMBOLS", value: normalizedSymbols.join(",") },
      { key: "HTTP_PROXY_URL", value: httpProxy },
      { key: "COMMUNITY_REPORT_ENABLED", value: communityReportEnabled ? "true" : "false" },
      { key: "COMMUNITY_SHARE_PROMPTS", value: communitySharePrompts ? "true" : "false" },
      // 默认值
      { key: "MAX_HOLDING_HOURS", value: "36" },
      { key: "MIN_HOLDING_MINUTES", value: "1" },
      { key: "EXTREME_STOP_LOSS_PERCENT", value: "12.5" }
    ];

    for (const conf of sysConfigs) {
      await db.execute({
        sql: "INSERT OR REPLACE INTO system_config (key, value, updated_at) VALUES (?, ?, ?)",
        args: [conf.key, conf.value, now],
      });
    }

    // 5. 写入账户配置
    logger.info("写入账户配置...");
    await db.execute({
      sql: `
        INSERT INTO account_configs 
        (name, provider, api_key, api_secret, api_passphrase, use_paper, proxy_url, stop_loss_usdt, take_profit_usdt, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `,
      args: [
        data.accountConfig.name,
        accountProvider,
        data.accountConfig.api_key,
        data.accountConfig.api_secret,
        data.accountConfig.api_passphrase || null,
        data.accountConfig.use_paper ? 1 : 0,
        data.accountConfig.proxy_url || null,
        stopLossValue,
        takeProfitValue,
        now,
        now
      ]
    });

    // 6. 写入 AI 模型配置
    logger.info("写入 AI 模型配置...");
    await db.execute({
      sql: `
        INSERT INTO ai_models 
        (name, model_name, api_key, base_url, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, 1, ?, ?)
      `,
      args: [
        data.aiModelConfig.name,
        data.aiModelConfig.model_name,
        data.aiModelConfig.api_key,
        data.aiModelConfig.base_url || null,
        now,
        now
      ]
    });

    // 7. 生成并写入后台管理凭证
    logger.info("生成后台管理凭证...");
    adminCredentials = generateAdminCredentials();
    
    // 密码使用 SHA-256 哈希存储
    const passwordHash = crypto.createHash('sha256').update(adminCredentials.password).digest('hex');
    
    await db.execute({
      sql: `
        INSERT INTO admin_credentials 
        (username, password_hash, admin_path, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `,
      args: [
        adminCredentials.username,
        passwordHash,
        adminCredentials.adminPath,
        now,
        now
      ]
    });

    installationSucceeded = true;
    logger.info("系统安装完成！");
    logger.info(`后台路径: /${adminCredentials.adminPath}`);
    logger.info(`管理员用户名: ${adminCredentials.username}`);
    logger.info(`管理员密码: ${adminCredentials.password}`);
    logger.info("准备返回凭证信息...", { adminCredentials });
    
    // 创建 install.lock 文件标记安装完成（必须在数据库写入成功后）
    try {
      const lockData = {
        timestamp: now,
        version: "1.0",
        installed_at: new Date(now).toISOString()
      };
      fs.writeFileSync(INSTALL_LOCK_PATH, JSON.stringify(lockData, null, 2));
      logger.info("已创建安装锁文件: install.lock");
    } catch (lockError) {
      logger.error("创建安装锁文件失败:", lockError);
      throw lockError; // 如果无法创建锁文件，安装应视为失败
    }
    
    // 返回安装结果和凭证信息
    return {
      success: true,
      adminCredentials: adminCredentials!
    };
  } catch (error) {
    logger.error("安装过程中出错:", error);
    throw error;
  } finally {
    db.close();
    if (!installationSucceeded) {
      // 安装失败时清理数据库文件
      if (fs.existsSync(DB_PATH)) {
        try {
          fs.unlinkSync(DB_PATH);
          logger.warn("已删除不完整的数据库文件，等待重新安装");
        } catch (cleanupError) {
          logger.error("删除失败数据库文件时出错:", cleanupError);
        }
      }
      // 安装失败时同时清理锁文件（如果存在）
      if (fs.existsSync(INSTALL_LOCK_PATH)) {
        try {
          fs.unlinkSync(INSTALL_LOCK_PATH);
          logger.warn("已删除不完整的安装锁文件");
        } catch (lockCleanupError) {
          logger.error("删除失败锁文件时出错:", lockCleanupError);
        }
      }
    }
  }
}
