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
 * API 路由
 */
import { Hono } from "hono";
import type { MiddlewareHandler, Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { serveStatic } from "@hono/node-server/serve-static";
import { getCookie, setCookie } from "hono/cookie";
import { createClient } from "@libsql/client";
import { randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { readFile } from "node:fs/promises";
import { createOkxClient, OkxClient, createExchangeClientFromActiveAccount } from "../services/okxClient";
import { BinanceClient } from "../services/binanceClient";
import { BitgetClient } from "../services/bitgetClient";
import { createLogger } from "../utils/loggerUtils";
import { getChinaTimeISO } from "../utils/timeUtils";
import { getQuantoMultiplier } from "../utils/contractUtils";
import { executeClosePosition, executeOpenPosition } from "../tools/trading";
import type { AdminAuthConfig } from "../utils/adminAuth";
import type { TradingStrategy } from "../config/strategyTypes";
import { getStrategyPromptDefaultSections, getTradingStrategy } from "../agents/tradingAgent";
import { RISK_PARAMS, reloadRiskParams } from "../config/riskParams.new";
import { resetLiveDataToDefaults } from "../database/reset-live-data";
import { getExchangeProxy } from "../config/exchange";
import {
  executeTradingDecision,
  getTradingLoopState,
  initTradingSystem,
  restartTradingLoop,
  setIterationCount,
  setTradingLoopEnabled,
  setTradingStartTime,
} from "../scheduler/tradingLoop";
import { summarizeAgentResponseText } from "../database/agent-request-logs";
import { getActiveAccount } from "../services/accountConfigService";

const logger = createLogger({
  name: "api-routes",
  level: "info",
});

const dbClient = createClient({
  url: process.env.DATABASE_URL || "file:./db/sqlite.db",
});

type DbRow = Record<string, unknown>;

const AVAILABLE_LANGUAGE_CODES = new Set(["en", "zh", "ja"]);
const LANGUAGE_DIR_CANDIDATES = [
  new URL("../language/", import.meta.url),
  new URL("../../src/language/", import.meta.url),
];

const CSRF_HEADER = "x-csrf-token";

const DISALLOWED_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

const CONFIG_NUMERIC_KEYS = new Set([
  "TRADING_INTERVAL_MINUTES",
  "MAX_LEVERAGE",
  "MAX_POSITIONS",
  "MAX_HOLDING_HOURS",
  "MIN_HOLDING_MINUTES",
  "EXTREME_STOP_LOSS_PERCENT",
  "INITIAL_BALANCE",
  "ACCOUNT_STOP_LOSS_USDT",
  "ACCOUNT_TAKE_PROFIT_USDT",
  "ACCOUNT_DRAWDOWN_WARNING_PERCENT",
  "ACCOUNT_DRAWDOWN_NO_NEW_POSITION_PERCENT",
  "ACCOUNT_DRAWDOWN_FORCE_CLOSE_PERCENT",
]);

const CONFIG_BOOLEAN_KEYS = new Set(["OKX_USE_PAPER", "BINANCE_USE_TESTNET", "COMMUNITY_REPORT_ENABLED", "COMMUNITY_SHARE_PROMPTS"]);

const CONFIG_ENUM_VALUES: Record<string, string[]> = {
  TRADING_STRATEGY: ["conservative", "balanced", "aggressive", "ultra-short", "swing-trend"],
  PROMPT_LANGUAGE: ["zh", "en", "ja"],
  TRADING_MARGIN_MODE: ["cross", "isolated"],
  EXCHANGE_PROVIDER: ["okx", "binance", "bitget"],
};

const CONFIG_ALLOWED_KEYS = new Set([
  "TRADING_SYMBOLS",
  "TRADING_MARGIN_MODE",
  "TRADING_INTERVAL_MINUTES",
  "TRADING_STRATEGY",
  "MAX_LEVERAGE",
  "MAX_POSITIONS",
  "MAX_HOLDING_HOURS",
  "MIN_HOLDING_MINUTES",
  "EXTREME_STOP_LOSS_PERCENT",
  "INITIAL_BALANCE",
  "ACCOUNT_STOP_LOSS_USDT",
  "ACCOUNT_TAKE_PROFIT_USDT",
  "ACCOUNT_DRAWDOWN_WARNING_PERCENT",
  "ACCOUNT_DRAWDOWN_NO_NEW_POSITION_PERCENT",
  "ACCOUNT_DRAWDOWN_FORCE_CLOSE_PERCENT",
  "AI_MODEL_NAME",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "HTTP_PROXY_URL",
  "EMERGENCY_NOTICE_URL",
  "COMMUNITY_REPORT_ENABLED",
  "COMMUNITY_SHARE_PROMPTS",
  "OKX_API_KEY",
  "OKX_API_SECRET",
  "OKX_API_PASSPHRASE",
  "OKX_USE_PAPER",
  "BINANCE_API_KEY",
  "BINANCE_API_SECRET",
  "BINANCE_USE_TESTNET",
  "EXCHANGE_PROVIDER",
  "PROMPT_SECTION_ENTRY",
  "PROMPT_SECTION_EXIT",
  "PROMPT_SECTION_VARIABLES",
  "PROMPT_LANGUAGE",
]);
const ACTIVE_ACCOUNT_SWITCH_AT_KEY = "ACTIVE_ACCOUNT_SWITCH_AT";
const ACTIVE_ACCOUNT_ID_KEY = "ACTIVE_ACCOUNT_ID";

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".").map((segment) => Number.parseInt(segment, 10));
  if (parts.length !== 4 || parts.some((segment) => Number.isNaN(segment) || segment < 0 || segment > 255)) {
    return false;
  }
  if (parts[0] === 10) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 127) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  if (parts[0] === 0) return true;
  return false;
}

function isSafeHttpUrl(value: string, options: { allowLocal?: boolean } = {}): boolean {
  const { allowLocal = false } = options;
  try {
    const url = new URL(value);
    const protocol = url.protocol.toLowerCase();
    if (protocol !== "http:" && protocol !== "https:") {
      return false;
    }
    const hostname = url.hostname.toLowerCase();
    const ipType = isIP(hostname);
    const isLoopback = hostname === "localhost" || hostname === "::1" || hostname.startsWith("127.");

    if (!hostname) {
      return false;
    }

    if (url.username || url.password) {
      return false;
    }

    if (!allowLocal) {
      if (DISALLOWED_HOSTNAMES.has(hostname)) {
        return false;
      }
      if (hostname.endsWith(".local")) {
        return false;
      }
      if (hostname.startsWith("127.")) {
        return false;
      }
      if (ipType === 4 && isPrivateIpv4(hostname)) {
        return false;
      }
      if (ipType === 6) {
        return false;
      }
      return true;
    }

    if (hostname === "0.0.0.0") {
      return false;
    }
    if (hostname.endsWith(".local") && !isLoopback) {
      return false;
    }
    if (ipType === 6 && hostname !== "::1") {
      return false;
    }
    if (ipType === 4 && !isLoopback && isPrivateIpv4(hostname)) {
      return false;
    }
    return true;
  } catch (error) {
    logger.warn("URL 校验失败", error);
    return false;
  }
}

function sanitizeConfigPayload(raw: Record<string, unknown>): { ok: true; data: Record<string, string> } | { ok: false; error: string } {
  const sanitized: Record<string, string> = {};

  for (const [key, value] of Object.entries(raw)) {
    if (!CONFIG_ALLOWED_KEYS.has(key)) {
      continue;
    }

    if (value === undefined || value === null) {
      continue;
    }

    if (CONFIG_ENUM_VALUES[key]) {
      if (typeof value !== "string") {
        return { ok: false, error: `配置项 ${key} 必须为字符串` };
      }
      const normalized = value.trim();
      if (!CONFIG_ENUM_VALUES[key].includes(normalized)) {
        return { ok: false, error: `配置项 ${key} 的值无效` };
      }
      sanitized[key] = normalized;
      continue;
    }

    if (CONFIG_BOOLEAN_KEYS.has(key)) {
      if (typeof value === "boolean") {
        sanitized[key] = value ? "true" : "false";
        continue;
      }
      if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (normalized === "true" || normalized === "false") {
          sanitized[key] = normalized;
          continue;
        }
      }
      return { ok: false, error: `配置项 ${key} 必须为布尔值` };
    }

    if (CONFIG_NUMERIC_KEYS.has(key)) {
      const numericValue = typeof value === "number" ? value : Number.parseFloat(String(value));
      if (!Number.isFinite(numericValue)) {
        return { ok: false, error: `配置项 ${key} 必须为有效数字` };
      }
      sanitized[key] = numericValue.toString();
      continue;
    }

    if (key === "TRADING_SYMBOLS") {
      if (typeof value !== "string") {
        return { ok: false, error: "TRADING_SYMBOLS 必须为字符串" };
      }
      const normalized = value
        .split(",")
        .map((symbol) => symbol.trim().toUpperCase())
        .filter(Boolean)
        .join(",");
      if (!normalized) {
        return { ok: false, error: "TRADING_SYMBOLS 不能为空" };
      }
      if (!/^[A-Z0-9,]+$/.test(normalized)) {
        return { ok: false, error: "TRADING_SYMBOLS 仅允许字母、数字和逗号" };
      }
      sanitized[key] = normalized;
      continue;
    }

    if (key === "HTTP_PROXY_URL") {
      if (typeof value !== "string" || value.trim() === "") {
        sanitized[key] = "";
        continue;
      }
      if (!isSafeHttpUrl(value, { allowLocal: true })) {
        return { ok: false, error: `${key} 的地址不安全` };
      }
      sanitized[key] = value.trim();
      continue;
    }

    if (key === "EMERGENCY_NOTICE_URL") {
      if (typeof value !== "string" || value.trim() === "") {
        sanitized[key] = "";
        continue;
      }
      if (!isSafeHttpUrl(value)) {
        return { ok: false, error: `${key} 的地址不安全` };
      }
      sanitized[key] = value.trim();
      continue;
    }

    if (key === "OPENAI_BASE_URL") {
      if (typeof value !== "string" || value.trim() === "") {
        sanitized[key] = "";
        continue;
      }
      if (!isSafeHttpUrl(value)) {
        return { ok: false, error: `${key} 的地址不安全` };
      }
      sanitized[key] = value.trim();
      continue;
    }

    if (typeof value === "string") {
      sanitized[key] = value.trim();
    } else {
      sanitized[key] = String(value);
    }
  }

  if (Object.keys(sanitized).length === 0) {
    return { ok: false, error: "未提供有效的配置项" };
  }

  return { ok: true, data: sanitized };
}

type ExchangeTestPayload = {
  exchange?: string;
  apiKey?: string;
  apiSecret?: string;
  passphrase?: string;
  usePaper?: boolean;
  testnet?: boolean;
  proxyUrl?: string;
};

type ExchangeTestResult =
  | { success: true; exchange: "okx" | "binance" | "bitget"; balance?: string }
  | { success: false; error: string; status?: number };

type AccountConnectionTestOptions = {
  provider: "okx" | "binance" | "bitget";
  apiKey: string;
  apiSecret: string;
  apiPassphrase?: string;
  usePaper?: boolean;
  proxyUrl?: string;
};

type AccountConnectionTestResult =
  | { success: true; provider: "OKX" | "Binance" | "Bitget"; mode: string; balance: string }
  | { success: false; error: string };

function normalizeProxyUrl(raw: string | undefined): { ok: true; value: string } | { ok: false; error: string } {
  const trimmed = (raw || "").trim();
  if (!trimmed) {
    return { ok: true, value: "" };
  }
  if (!isSafeHttpUrl(trimmed, { allowLocal: true })) {
    return { ok: false, error: "代理地址不安全" };
  }
  return { ok: true, value: trimmed };
}

async function performExchangeConnectionTest(payload: ExchangeTestPayload): Promise<ExchangeTestResult> {
  const exchange = (payload.exchange || "okx").toLowerCase();
  const proxyCheck = normalizeProxyUrl(typeof payload.proxyUrl === "string" ? payload.proxyUrl : undefined);
  if (!proxyCheck.ok) {
    return { success: false, error: proxyCheck.error, status: 400 };
  }
  const proxyUrl = proxyCheck.value || undefined;

  if (exchange === "binance") {
    const apiKey = (payload.apiKey || "").trim();
    const apiSecret = (payload.apiSecret || "").trim();
    if (!apiKey || !apiSecret) {
      return { success: false, error: "缺少必需的 API 凭证", status: 400 };
    }
    try {
      const client = new BinanceClient(apiKey, apiSecret, payload.testnet === true, proxyUrl);
      const account = await client.getFuturesAccount();
      return { success: true, exchange: "binance", balance: account.total || "0" };
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      return { success: false, error: message };
    }
  }

  if (exchange === "bitget") {
    const apiKey = (payload.apiKey || "").trim();
    const apiSecret = (payload.apiSecret || "").trim();
    const passphrase = (payload.passphrase || "").trim();
    if (!apiKey || !apiSecret || !passphrase) {
      return { success: false, error: "缺少必需的 API 凭证", status: 400 };
    }
    try {
      const client = new BitgetClient(apiKey, apiSecret, passphrase, payload.testnet === true, proxyUrl);
      const account = await client.getFuturesAccount();
      return { success: true, exchange: "bitget", balance: account.total || "0" };
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      return { success: false, error: message };
    }
  }

  const apiKey = (payload.apiKey || "").trim();
  const apiSecret = (payload.apiSecret || "").trim();
  const passphrase = (payload.passphrase || "").trim();
  if (!apiKey || !apiSecret || !passphrase) {
    return { success: false, error: "缺少必需的 API 凭证", status: 400 };
  }

  try {
    const client = new OkxClient(apiKey, apiSecret, passphrase, payload.usePaper === true, proxyUrl);
    const account = await client.getFuturesAccount();
    return { success: true, exchange: "okx", balance: account.total || "0" };
  } catch (error: any) {
    const message = error instanceof Error ? error.message : "未知错误";
    let friendly = message;
    if (message.includes("401") || message.includes("Unauthorized")) {
      friendly = "API 密钥无效或权限不足";
    } else if (message.includes("403")) {
      friendly = "IP 地址未加入白名单";
    } else if (/timeout|ETIMEDOUT/i.test(message)) {
      friendly = "连接超时，请检查网络或代理设置";
    } else if (/ECONNREFUSED/i.test(message)) {
      friendly = "连接被拒绝，请检查代理设置";
    }
    return { success: false, error: friendly };
  }
}

async function runAccountConnectionTest(options: AccountConnectionTestOptions): Promise<AccountConnectionTestResult> {
  const proxyCheck = normalizeProxyUrl(options.proxyUrl);
  if (!proxyCheck.ok) {
    return { success: false, error: proxyCheck.error };
  }

  const proxyFromSettings = (getExchangeProxy() || "").trim();
  const effectiveProxy = proxyFromSettings || (proxyCheck.value ? proxyCheck.value : undefined);
  if (proxyFromSettings) {
    logger.info(`账户连接测试强制使用系统代理: ${proxyFromSettings}`);
  }

  try {
    if (options.provider === "binance") {
      const client = new BinanceClient(options.apiKey, options.apiSecret, options.usePaper === true, effectiveProxy);
      const account = await client.getFuturesAccount();
      return {
        success: true,
        provider: "Binance",
        mode: options.usePaper ? "测试网" : "主网",
        balance: account.total || "0",
      };
    }

    if (options.provider === "bitget") {
      if (!options.apiPassphrase) {
        return { success: false, error: "Bitget 账户需要 API Passphrase" };
      }
      const client = new BitgetClient(options.apiKey, options.apiSecret, options.apiPassphrase, options.usePaper === true, effectiveProxy);
      const account = await client.getFuturesAccount();
      return {
        success: true,
        provider: "Bitget",
        mode: options.usePaper ? "模拟盘" : "实盘",
        balance: account.total || "0",
      };
    }

    if (!options.apiPassphrase) {
      return { success: false, error: "OKX 账户需要 API Passphrase" };
    }

    const testClient = new OkxClient(options.apiKey, options.apiSecret, options.apiPassphrase, options.usePaper === true, effectiveProxy);
    const account = await testClient.getFuturesAccount();
    return {
      success: true,
      provider: "OKX",
      mode: options.usePaper ? "模拟盘" : "实盘",
      balance: account.total || "0",
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "未知错误";
    return { success: false, error: message };
  }
}

function asDbRows(rows: unknown[]): DbRow[] {
  return rows.filter((row): row is DbRow => Boolean(row) && typeof row === "object");
}

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function toStringSafe(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") {
    return value.toString();
  }
  return fallback;
}

async function getSystemConfigString(key: string): Promise<string | null> {
  try {
    const result = await dbClient.execute({
      sql: "SELECT value FROM system_config WHERE key = ? LIMIT 1",
      args: [key],
    });

    if (result.rows && result.rows.length > 0) {
      const rawValue = result.rows[0].value;
      if (typeof rawValue === "string") {
        return rawValue;
      }
      if (typeof rawValue === "number" || typeof rawValue === "bigint") {
        return rawValue.toString();
      }
    }
  } catch (error) {
    logger.warn(`读取配置 ${key} 失败:`, error);
  }
  return null;
}

async function getActiveAccountSwitchTimestamp(): Promise<string | null> {
  return getSystemConfigString(ACTIVE_ACCOUNT_SWITCH_AT_KEY);
}

async function recordActiveAccountSnapshot(snapshotTimestamp: string): Promise<void> {
  try {
    const client = createOkxClient();
    const account = await client.getFuturesAccount();

    const accountTotal = Number.parseFloat(account.total || "0");
    const availableBalance = Number.parseFloat(account.available || "0");
    const unrealisedPnl = Number.parseFloat(account.unrealisedPnl || "0");
    const totalBalance = accountTotal + unrealisedPnl;

    await dbClient.execute({
      sql: `INSERT INTO account_history (timestamp, total_value, available_cash, unrealized_pnl, realized_pnl, return_percent)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [snapshotTimestamp, totalBalance, availableBalance, unrealisedPnl, 0, 0],
    });

    logger.info("已记录账户切换快照，用于刷新统计数据");
  } catch (error) {
    logger.error("记录账户切换快照失败:", error);
  }
}

async function loadLanguageResource(lang: string): Promise<Record<string, unknown>> {
  const fileName = `${lang}.json`;

  for (const directory of LANGUAGE_DIR_CANDIDATES) {
    try {
      const fileUrl = new URL(fileName, directory);
      const fileContent = await readFile(fileUrl, "utf-8");
      return JSON.parse(fileContent) as Record<string, unknown>;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err?.code === "ENOENT") {
        continue;
      }
      throw err;
    }
  }

  const notFoundError = new Error(`Language file not found for code: ${lang}`);
  (notFoundError as NodeJS.ErrnoException).code = "ENOENT";
  throw notFoundError;
}

export function createApiRoutes(adminAuth: AdminAuthConfig) {
  type SessionRecord = {
    id: string;
    username: string;
    csrfToken: string;
    expiresAt: number;
  };

  type ApiEnv = {
    Variables: {
      session?: SessionRecord;
    };
  };

  const app = new Hono<ApiEnv>();

  // Session 内存缓存（提升性能，避免每次请求都查数据库）
  const sessionCache = new Map<string, SessionRecord>();
  const SESSION_COOKIE = "q4ai_session";
  const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12小时会话

  const loginTemplatePath = new URL("../../public/login.html", import.meta.url);
  let cachedLoginTemplate: string | null = null;

  const loadLoginTemplate = async () => {
    if (cachedLoginTemplate) {
      return cachedLoginTemplate;
    }
    cachedLoginTemplate = await readFile(loginTemplatePath, "utf-8");
    return cachedLoginTemplate;
  };

  // 从数据库加载 session
  const loadSessionFromDb = async (sessionId: string): Promise<SessionRecord | null> => {
    try {
      const result = await dbClient.execute({
        sql: "SELECT id, username, csrf_token, expires_at FROM sessions WHERE id = ? AND expires_at > ?",
        args: [sessionId, Date.now()],
      });
      
      if (!result.rows || result.rows.length === 0) {
        return null;
      }
      
      const row = result.rows[0] as any;
      return {
        id: String(row.id),
        username: String(row.username),
        csrfToken: String(row.csrf_token),
        expiresAt: Number(row.expires_at),
      };
    } catch (error) {
      logger.error("从数据库加载 session 失败:", error);
      return null;
    }
  };

  // 保存 session 到数据库
  const saveSessionToDb = async (session: SessionRecord): Promise<void> => {
    try {
      const now = getChinaTimeISO();
      await dbClient.execute({
        sql: `INSERT INTO sessions (id, username, csrf_token, expires_at, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                expires_at = excluded.expires_at,
                updated_at = excluded.updated_at`,
        args: [session.id, session.username, session.csrfToken, session.expiresAt, now, now],
      });
    } catch (error) {
      logger.error("保存 session 到数据库失败:", error);
    }
  };

  // 从数据库删除 session
  const deleteSessionFromDb = async (sessionId: string): Promise<void> => {
    try {
      await dbClient.execute({
        sql: "DELETE FROM sessions WHERE id = ?",
        args: [sessionId],
      });
    } catch (error) {
      logger.error("从数据库删除 session 失败:", error);
    }
  };

  const refreshSession = async (session: SessionRecord): Promise<SessionRecord> => {
    session.expiresAt = Date.now() + SESSION_TTL_MS;
    sessionCache.set(session.id, session);
    await saveSessionToDb(session);
    return session;
  };

  const getSessionFromRequest = async (c: Context<ApiEnv>): Promise<SessionRecord | null> => {
    const sessionId = getCookie(c, SESSION_COOKIE);
    if (!sessionId) return null;
    
    // 先从缓存查找
    let record: SessionRecord | null | undefined = sessionCache.get(sessionId);
    
    // 缓存未命中，从数据库加载
    if (!record) {
      record = await loadSessionFromDb(sessionId);
      if (!record) return null;
      sessionCache.set(sessionId, record);
    }
    
    // 检查是否过期
    if (record.expiresAt <= Date.now()) {
      sessionCache.delete(sessionId);
      await deleteSessionFromDb(sessionId);
      return null;
    }
    
    return refreshSession(record);
  };

  const createSession = (): SessionRecord => {
    const id = randomBytes(24).toString("hex");
    const csrfToken = randomBytes(24).toString("hex");
    return {
      id,
      username: adminAuth.username,
      csrfToken,
      expiresAt: Date.now() + SESSION_TTL_MS,
    };
  };

  const attachSessionCookie = async (c: Context<ApiEnv>, session: SessionRecord) => {
    sessionCache.set(session.id, session);
    await saveSessionToDb(session);
    setCookie(c, SESSION_COOKIE, session.id, {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      maxAge: Math.floor(SESSION_TTL_MS / 1000),
      secure: process.env.NODE_ENV === "production",
    });
  };

  const clearSessionCookie = async (c: Context<ApiEnv>) => {
    const sessionId = getCookie(c, SESSION_COOKIE);
    if (sessionId) {
      sessionCache.delete(sessionId);
      await deleteSessionFromDb(sessionId);
    }
    setCookie(c, SESSION_COOKIE, "", {
      path: "/",
      maxAge: 0,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Lax",
    });
  };

  const requireAuth: MiddlewareHandler<ApiEnv> = async (c, next) => {
    const session = await getSessionFromRequest(c);
    if (!session) {
      return c.json({ error: "未登录或会话已过期" }, 401);
    }
    c.set("session", session);
    return next();
  };

  const requireAuthWithCsrf: MiddlewareHandler<ApiEnv> = async (c, next) => {
    const session = await getSessionFromRequest(c);
    if (!session) {
      return c.json({ error: "未登录或会话已过期" }, 401);
    }
    const csrfToken = c.req.header(CSRF_HEADER);
    if (!csrfToken || csrfToken !== session.csrfToken) {
      return c.json({ error: "CSRF token 无效" }, 403);
    }
    c.set("session", session);
    return next();
  };

  const renderLoginPage = async (c: Context<ApiEnv>) => {
    const session = await getSessionFromRequest(c);
    if (session) {
      return c.redirect("/");
    }

    const template = await loadLoginTemplate();
    const page = template.replace(/{{ADMIN_PATH}}/g, adminAuth.adminPath);
    return c.html(page);
  };

  app.get(adminAuth.adminPath, renderLoginPage);
  if (!adminAuth.adminPath.endsWith("/")) {
    app.get(`${adminAuth.adminPath}/`, renderLoginPage);
  }

  app.post("/api/auth/login", async (c) => {
    try {
      const body = await c.req.json<{ username?: string; password?: string }>();
      if (body.username !== adminAuth.username || body.password !== adminAuth.password) {
        return c.json({ success: false, error: "用户名或密码错误" }, 401);
      }

      const session = createSession();
      await attachSessionCookie(c, session);

      return c.json({ success: true, csrfToken: session.csrfToken });
    } catch (error: unknown) {
      return c.json({ success: false, error: "请求格式错误" }, 400);
    }
  });

  app.post("/api/auth/logout", requireAuthWithCsrf, async (c) => {
    await clearSessionCookie(c);
    return c.json({ success: true });
  });

  app.get("/api/auth/status", async (c) => {
    const session = await getSessionFromRequest(c);
    if (!session) {
      return c.json({ authenticated: false });
    }
    return c.json({ authenticated: true, username: session.username, csrfToken: session.csrfToken });
  });

  // 定期清理过期的 session（每小时执行一次）
  const cleanupExpiredSessions = async () => {
    try {
      const result = await dbClient.execute({
        sql: "DELETE FROM sessions WHERE expires_at <= ?",
        args: [Date.now()],
      });
      if (result.rowsAffected > 0) {
        logger.info(`清理了 ${result.rowsAffected} 个过期的 session`);
      }
    } catch (error) {
      logger.error("清理过期 session 失败:", error);
    }
  };

  // 启动定期清理任务
  setInterval(cleanupExpiredSessions, 60 * 60 * 1000); // 每小时清理一次
  // 程序启动时立即清理一次
  cleanupExpiredSessions().catch((error) => logger.error("初始清理 session 失败:", error));

  app.get("/api/public-config", async (c) => {
    try {
      const { getAllConfig } = await import("../database/init-config");
      const config = await getAllConfig();
      return c.json({
        config: {
          TRADING_SYMBOLS: config.TRADING_SYMBOLS ?? "",
          AI_MODEL_NAME: config.AI_MODEL_NAME ?? "",
        },
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "未知错误";
      return c.json({ error: message }, 500);
    }
  });

  app.get("/language/:lang", async (c) => {
    const lang = c.req.param("lang").toLowerCase();
    if (!AVAILABLE_LANGUAGE_CODES.has(lang)) {
      return c.json({ error: "Language not supported" }, 404);
    }

    try {
      const payload = await loadLanguageResource(lang);
      return c.json(payload);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err?.code === "ENOENT") {
        return c.json({ error: "Language pack not found" }, 404);
      }
      logger.error("加载语言包失败", { lang, error: err });
      return c.json({ error: "Failed to load language pack" }, 500);
    }
  });

  // 静态文件服务 - 需要使用绝对路径
  app.use("/*", serveStatic({ root: "./public" }));

  /**
   * ========================================
   * 多账户管理 API
   * ========================================
   */

  /**
   * 获取所有账户配置
   */
  app.get("/api/accounts", requireAuth, async (c) => {
    try {
      const { getAllAccounts } = await import("../services/accountConfigService");
      const accounts = await getAllAccounts();
      
      // 隐藏敏感信息
      const safeAccounts = accounts.map(acc => ({
        id: acc.id,
        name: acc.name,
        provider: acc.provider,
        use_paper: acc.use_paper,
        is_active: acc.is_active,
        created_at: acc.created_at,
        updated_at: acc.updated_at,
        // 部分隐藏 API Key
        api_key_preview: acc.api_key ? `${acc.api_key.substring(0, 8)}...${acc.api_key.substring(acc.api_key.length - 4)}` : '',
      }));
      
      return c.json({ accounts: safeAccounts });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "未知错误";
      logger.error("获取账户列表失败:", error);
      return c.json({ error: message }, 500);
    }
  });

  /**
   * 获取当前激活的账户
   */
  app.get("/api/accounts/active", requireAuth, async (c) => {
    try {
      const { getActiveAccount } = await import("../services/accountConfigService");
      const account = await getActiveAccount();
      
      if (!account) {
        return c.json({ account: null });
      }
      
      // 隐藏敏感信息
      const safeAccount = {
        id: account.id,
        name: account.name,
        provider: account.provider,
        use_paper: account.use_paper,
        is_active: account.is_active,
        created_at: account.created_at,
        updated_at: account.updated_at,
        api_key_preview: account.api_key ? `${account.api_key.substring(0, 8)}...${account.api_key.substring(account.api_key.length - 4)}` : '',
      };
      
      return c.json({ account: safeAccount });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "未知错误";
      logger.error("获取当前账户失败:", error);
      return c.json({ error: message }, 500);
    }
  });

  /**
   * 创建新账户
   */
  app.post("/api/accounts", requireAuthWithCsrf, async (c) => {
    try {
      const body = await c.req.json();
      const { name, provider, api_key, api_secret, api_passphrase, use_paper, proxy_url, stop_loss_usdt, take_profit_usdt } = body;
      
      if (!name || !provider || !api_key || !api_secret) {
        return c.json({ error: "缺少必需参数" }, 400);
      }
      
      if (!['okx', 'binance', 'bitget'].includes(provider)) {
        return c.json({ error: "不支持的交易所" }, 400);
      }
      
      const { createAccount, getActiveAccount } = await import("../services/accountConfigService");
      const account = await createAccount({
        name: String(name),
        provider: provider as 'okx' | 'binance' | 'bitget',
        api_key: String(api_key),
        api_secret: String(api_secret),
        api_passphrase: api_passphrase ? String(api_passphrase) : undefined,
        use_paper: Boolean(use_paper),
        proxy_url: proxy_url ? String(proxy_url) : undefined,
        stop_loss_usdt: stop_loss_usdt ? Number(stop_loss_usdt) : undefined,
        take_profit_usdt: take_profit_usdt ? Number(take_profit_usdt) : undefined,
      });
      
      logger.info(`创建账户成功: ${account.name} (ID: ${account.id})`);

      // 如果是第一个账户或被自动激活，尝试获取余额并设置 INITIAL_BALANCE
      const activeAccount = await getActiveAccount();
      if (activeAccount && activeAccount.id === account.id) {
        try {
          const client = await createExchangeClientFromActiveAccount();
          const balance = await client.getFuturesAccount();
          const total = Number.parseFloat(balance.total || "0");
          if (Number.isFinite(total) && total > 0) {
            await dbClient.execute({
              sql: "INSERT INTO system_config (key, value, updated_at) VALUES ('INITIAL_BALANCE', ?, ?) ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?",
              args: [total.toString(), new Date().toISOString(), total.toString(), new Date().toISOString()],
            });
            logger.info(`[Auto-Config] 自动设置初始本金为: ${total} (Account: ${account.name})`);
          }
        } catch (err) {
          logger.warn(`[Auto-Config] 无法自动获取初始本金: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      
      return c.json({ 
        success: true, 
        account: {
          id: account.id,
          name: account.name,
          provider: account.provider,
          use_paper: account.use_paper,
          is_active: account.is_active,
          created_at: account.created_at,
        }
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "未知错误";
      logger.error("创建账户失败:", error);
      return c.json({ error: message }, 500);
    }
  });

  /**
   * 更新账户配置
   */
  app.put("/api/accounts/:id", requireAuthWithCsrf, async (c) => {
    try {
      const id = Number(c.req.param("id"));
      if (!Number.isFinite(id) || id <= 0) {
        return c.json({ error: "无效的账户ID" }, 400);
      }
      
      const body = await c.req.json();
      const { name, provider, api_key, api_secret, api_passphrase, use_paper, proxy_url, stop_loss_usdt, take_profit_usdt } = body;
      
      const { updateAccount } = await import("../services/accountConfigService");
      const account = await updateAccount(id, {
        name: name !== undefined ? String(name) : undefined,
        provider: provider !== undefined ? provider as 'okx' | 'binance' | 'bitget' : undefined,
        api_key: api_key !== undefined ? String(api_key) : undefined,
        api_secret: api_secret !== undefined ? String(api_secret) : undefined,
        api_passphrase: api_passphrase !== undefined ? String(api_passphrase) : undefined,
        use_paper: use_paper !== undefined ? Boolean(use_paper) : undefined,
        proxy_url: proxy_url !== undefined ? String(proxy_url) : undefined,
        stop_loss_usdt: stop_loss_usdt !== undefined ? (stop_loss_usdt === "" || stop_loss_usdt === null ? 0 : Number(stop_loss_usdt)) : undefined,
        take_profit_usdt: take_profit_usdt !== undefined ? (take_profit_usdt === "" || take_profit_usdt === null ? 0 : Number(take_profit_usdt)) : undefined,
      });
      
      logger.info(`更新账户成功: ${account.name} (ID: ${account.id})`);
      
      return c.json({ 
        success: true,
        account: {
          id: account.id,
          name: account.name,
          provider: account.provider,
          use_paper: account.use_paper,
          is_active: account.is_active,
          updated_at: account.updated_at,
        }
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "未知错误";
      logger.error("更新账户失败:", error);
      return c.json({ error: message }, 500);
    }
  });

  /**
   * 删除账户
   */
  app.delete("/api/accounts/:id", requireAuthWithCsrf, async (c) => {
    try {
      const id = Number(c.req.param("id"));
      if (!Number.isFinite(id) || id <= 0) {
        return c.json({ error: "无效的账户ID" }, 400);
      }
      
      const { deleteAccount } = await import("../services/accountConfigService");
      await deleteAccount(id);
      
      logger.info(`删除账户成功: ID ${id}`);
      
      return c.json({ success: true });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "未知错误";
      logger.error("删除账户失败:", error);
      return c.json({ error: message }, 500);
    }
  });

  /**
   * 设置当前激活的账户
   */
  app.post("/api/accounts/:id/activate", requireAuthWithCsrf, async (c) => {
    try {
      const id = Number(c.req.param("id"));
      if (!Number.isFinite(id) || id <= 0) {
        return c.json({ error: "无效的账户ID" }, 400);
      }
      
      const { setActiveAccount } = await import("../services/accountConfigService");
      const account = await setActiveAccount(id);
      const switchTimestamp = new Date().toISOString();
      const { setConfigValue } = await import("../database/init-config");
      await Promise.all([
        setConfigValue(ACTIVE_ACCOUNT_ID_KEY, String(account.id)),
        setConfigValue(ACTIVE_ACCOUNT_SWITCH_AT_KEY, switchTimestamp),
      ]);
      
      logger.info(`切换当前账户成功: ${account.name} (ID: ${account.id})`);
      
      // 重置并重新初始化客户端
      logger.info("正在重置交易客户端...");
      const { resetOkxClient, initExchangeClient } = await import("../services/okxClient");
      resetOkxClient();
      await initExchangeClient();
      await recordActiveAccountSnapshot(switchTimestamp);
      
      // 重载交易循环以使用新账户
      logger.info("正在重新加载交易系统以使用新账户...");
      await reloadRiskParams();
      await restartTradingLoop();

      // 切换账户后，自动更新 INITIAL_BALANCE
      try {
        const client = await createExchangeClientFromActiveAccount();
        const balance = await client.getFuturesAccount();
        const total = Number.parseFloat(balance.total || "0");
        if (Number.isFinite(total) && total > 0) {
          await dbClient.execute({
            sql: "INSERT INTO system_config (key, value, updated_at) VALUES ('INITIAL_BALANCE', ?, ?) ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?",
            args: [total.toString(), new Date().toISOString(), total.toString(), new Date().toISOString()],
          });
          logger.info(`[Auto-Config] 切换账户后自动更新初始本金为: ${total}`);
        }
      } catch (err) {
        logger.warn(`[Auto-Config] 切换账户后无法自动更新初始本金: ${err instanceof Error ? err.message : String(err)}`);
      }
      
      return c.json({ 
        success: true,
        account: {
          id: account.id,
          name: account.name,
          provider: account.provider,
          use_paper: account.use_paper,
          is_active: account.is_active,
        },
        message: "账户已切换，交易系统已重载"
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "未知错误";
      logger.error("切换账户失败:", error);
      return c.json({ error: message }, 500);
    }
  });

  /**
   * 测试账户连接
   */
  app.post("/api/accounts/test", requireAuthWithCsrf, async (c) => {
    try {
      const body = await c.req.json();
      const { provider, api_key, api_secret, api_passphrase, use_paper, proxy_url } = body;
      
      if (!provider || !api_key || !api_secret) {
        return c.json({ error: "缺少必需参数" }, 400);
      }
      
      if (!['okx', 'binance', 'bitget'].includes(provider)) {
        return c.json({ error: "不支持的交易所" }, 400);
      }
      
      const result = await runAccountConnectionTest({
        provider: provider as 'okx' | 'binance' | 'bitget',
        apiKey: String(api_key),
        apiSecret: String(api_secret),
        apiPassphrase: api_passphrase ? String(api_passphrase) : undefined,
        usePaper: Boolean(use_paper),
        proxyUrl: proxy_url ? String(proxy_url) : undefined,
      });

      if (!result.success) {
        return c.json(result, 400);
      }

      logger.info(`账户连接测试成功: ${provider}`);
      return c.json(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "未知错误";
      logger.error("账户连接测试失败:", error);
      return c.json({ 
        success: false, 
        error: message 
      }, 400);
    }
  });

  /**
   * 测试特定账户的连接（使用数据库凭证）
   */
  app.post("/api/accounts/:id/test", requireAuthWithCsrf, async (c) => {
    try {
      const id = Number(c.req.param("id"));
      if (!Number.isFinite(id) || id <= 0) {
        return c.json({ error: "无效的账户ID" }, 400);
      }

      const { getAccountById } = await import("../services/accountConfigService");
      const account = await getAccountById(id);
      if (!account) {
        return c.json({ error: "账户不存在" }, 404);
      }

      if (!account.api_key || !account.api_secret) {
        return c.json({ error: "账户缺少必需的 API 凭证" }, 400);
      }

      const result = await runAccountConnectionTest({
        provider: account.provider as "okx" | "binance" | "bitget",
        apiKey: account.api_key,
        apiSecret: account.api_secret,
        apiPassphrase: account.api_passphrase,
        usePaper: account.use_paper,
        proxyUrl: account.proxy_url,
      });

      if (!result.success) {
        return c.json(result, 400);
      }

      logger.info(`账户(${account.name})连接测试成功`);
      return c.json(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "未知错误";
      logger.error("账户连接测试失败:", error);
      return c.json({ success: false, error: message }, 500);
    }
  });

  /**
   * 获取账户总览
   * 
   * OKX 账户结构：
   * - totalEq = 账户权益（包含未实现盈亏）
   * - availBal = 可用余额
   * - upl = 未实现盈亏
   * 
   * API 返回说明：
   * - totalBalance: 仍按旧逻辑视作“扣除未实现盈亏后的净值”
   * - unrealisedPnl: 当前持仓的未实现盈亏
   * - returnPercent: 基于 totalBalance 计算的收益率
   */
  app.get("/api/account", async (c) => {
    try {
      const okxClient = await createExchangeClientFromActiveAccount();
      const account = await okxClient.getFuturesAccount();
      const activeSince = await getActiveAccountSwitchTimestamp();
      
      const { getActiveAccount } = await import("../services/accountConfigService");
      const activeAccount = await getActiveAccount();
      const accountId = activeAccount ? activeAccount.id : null;

      let historySql = "SELECT total_value, timestamp FROM account_history WHERE ";
      const historyArgs: any[] = [];

      if (accountId) {
        historySql += "account_id = ? ";
        historyArgs.push(accountId);
      } else {
        historySql += "(account_id IS NULL OR account_id = 'default') ";
      }

      if (activeSince) {
        historySql += "AND timestamp >= ? ";
        historyArgs.push(activeSince);
      }
      
      historySql += "ORDER BY timestamp ASC";

      const historyResult = await dbClient.execute({ sql: historySql, args: historyArgs });
      const history = historyResult.rows || [];
      const historyInitial = history.length > 0 ? Number.parseFloat(history[0].total_value as string || "0") : undefined;
      const unrealisedPnl = Number.parseFloat(account.unrealisedPnl || "0");
      const accountTotal = Number.parseFloat(account.total || "0");
      const totalBalance = accountTotal + unrealisedPnl;
      const availableBalance = Number.parseFloat(account.available || "0");
      const initialBalance = historyInitial && Number.isFinite(historyInitial) && historyInitial > 0
        ? historyInitial
        : Math.max(totalBalance, 1);
      
      // 收益率 = (总资产 - 初始资金) / 初始资金 * 100
      // totalBalance 包含未实现盈亏，以便与 account_history 对齐
      const returnPercent = initialBalance > 0 ? ((totalBalance - initialBalance) / initialBalance) * 100 : 0;
      
      // 计算胜率 - 从已平仓交易计算
      let winRate = 0;
      try {
        let tradesSql = "SELECT pnl FROM trades WHERE type = 'close' AND pnl IS NOT NULL ";
        const tradesArgs: any[] = [];

        if (accountId) {
          tradesSql += "AND account_id = ? ";
          tradesArgs.push(accountId);
        } else {
          tradesSql += "AND (account_id IS NULL OR account_id = 'default') ";
        }

        if (activeSince) {
          tradesSql += "AND timestamp >= ? ";
          tradesArgs.push(activeSince);
        }

        const closedTradesResult = await dbClient.execute({ sql: tradesSql, args: tradesArgs });
        const closedTrades = closedTradesResult.rows || [];
        
        if (closedTrades.length > 0) {
          const winCount = closedTrades.filter(row => {
            const pnl = Number.parseFloat(row.pnl as string || "0");
            return pnl > 0;
          }).length;
          winRate = (winCount / closedTrades.length) * 100;
        }
      } catch (error) {
        console.error("计算胜率失败:", error);
      }
      
      // 计算最大回撤 - 从权益历史计算
      let maxDrawdown = 0;
      try {
        if (history.length > 0) {
          let peak = 0;
          let maxDD = 0;
          
          for (const row of history) {
            const value = Number.parseFloat(row.total_value as string || "0");
            if (value > peak) {
              peak = value;
            }
            if (peak > 0) {
              const drawdown = ((peak - value) / peak) * 100;
              if (drawdown > maxDD) {
                maxDD = drawdown;
              }
            }
          }
          
          maxDrawdown = maxDD;
        }
      } catch (error) {
        console.error("计算最大回撤失败:", error);
      }
      
      return c.json({
        totalBalance,  // 总资产（包含未实现盈亏）
        availableBalance,
        positionMargin: Number.parseFloat(account.positionMargin || "0"),
        unrealisedPnl,
        returnPercent,  // 收益率（基于 totalBalance 计算）
        winRate,        // 胜率
        maxDrawdown,    // 最大回撤
        initialBalance,
        timestamp: new Date().toISOString(),
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "未知错误";
      return c.json({ error: message }, 500);
    }
  });

  /**
   * 获取当前持仓 - 从 OKX 获取实时数据
   */
  app.get("/api/positions", async (c) => {
    try {
      const okxClient = await createExchangeClientFromActiveAccount();
      const okxPositions = await okxClient.getPositions();
      
      const { getActiveAccount } = await import("../services/accountConfigService");
      const activeAccount = await getActiveAccount();
      const isBitget = activeAccount?.provider === 'bitget';
      const isBinance = activeAccount?.provider === 'binance';

      // 从数据库获取止损止盈信息
      let positionsSql = "SELECT symbol, stop_loss, profit_target FROM positions";
      const positionsArgs: any[] = [];
      
      if (activeAccount) {
        positionsSql += " WHERE account_id = ?";
        positionsArgs.push(activeAccount.id);
      } else {
        positionsSql += " WHERE account_id IS NULL OR account_id = 'default'";
      }

      const dbResult = await dbClient.execute({ sql: positionsSql, args: positionsArgs });
      const dbRows = asDbRows(dbResult.rows);
      const dbPositionsMap = new Map<string, DbRow>(
        dbRows
          .map((row) => {
            const symbol = toStringSafe(row.symbol);
            return symbol ? ([symbol, row] as [string, DbRow]) : null;
          })
          .filter((entry): entry is [string, DbRow] => entry !== null),
      );
      
      // 过滤并格式化持仓
      const positions = await Promise.all(
        okxPositions
          .map((position) => ({ position, size: Number.parseFloat(position.size || "0") }))
          .filter(({ size }) => size !== 0)
          .map(async ({ position, size }) => {
            const symbol = position.contract.replace("_USDT", "");
            const dbPos = dbPositionsMap.get(symbol);
            const entryPrice = Number.parseFloat(position.entryPrice || "0");
            const leverage = Number.parseInt(position.leverage || "1", 10);
            const marginUsed = Number.parseFloat(position.margin || "0");
            const contracts = Math.abs(size);

            let contractMultiplier = 1;
            // Bitget 和 Binance 没有张数概念，size 就是币的数量，不需要乘以合约乘数
            if (!isBitget && !isBinance) {
              try {
                contractMultiplier = await getQuantoMultiplier(position.contract);
              } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                logger.warn(`获取 ${position.contract} 合约乘数失败: ${message}`);
              }
            }
            if (!Number.isFinite(contractMultiplier) || contractMultiplier <= 0) {
              contractMultiplier = 1;
            }

            // Bitget/Binance: quantity = size (already in coins)
            // OKX: quantity = contracts * multiplier
            const quantity = (isBitget || isBinance) ? contracts : (contracts * contractMultiplier);
            const currentPrice = Number.parseFloat(position.markPrice || "0");
            const openValue = Number.isFinite(quantity) && Number.isFinite(entryPrice)
              ? quantity * entryPrice
              : marginUsed;

            const profitTarget = dbPos ? toNumber(dbPos.profit_target, Number.NaN) : Number.NaN;
            const stopLoss = dbPos ? toNumber(dbPos.stop_loss, Number.NaN) : Number.NaN;
            const exchangeOpenedAt = position.createTime ?? position.updateTime ?? null;
            const dbOpenedAt = dbPos ? toStringSafe(dbPos.opened_at) : "";
            const openedAt = exchangeOpenedAt ?? (dbOpenedAt || new Date().toISOString());

            return {
              symbol,
              quantity,
              contracts,
              contractMultiplier,
              entryPrice,
              currentPrice,
              liquidationPrice: Number.parseFloat(position.liqPrice || "0"),
              unrealizedPnl: Number.parseFloat(position.unrealisedPnl || "0"),
              leverage,
              side: size > 0 ? "long" : "short",
              marginMode: position.marginMode || null,
              openValue,
              margin: marginUsed,
              profitTarget: Number.isFinite(profitTarget) ? profitTarget : null,
              stopLoss: Number.isFinite(stopLoss) ? stopLoss : null,
              openedAt,
              exchangeOpenedAt,
            };
          })
      );

      return c.json({ positions });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "未知错误";
      return c.json({ error: message }, 500);
    }
  });

  app.post("/api/positions/:symbol/close", requireAuthWithCsrf, async (c) => {
    const symbolParam = c.req.param("symbol");
    if (!symbolParam) {
      return c.json({ success: false, error: "缺少币种参数" }, 400);
    }

    const symbol = symbolParam.toUpperCase();

    let percentage = 100;
    try {
      const body = await c.req.json<{ percentage?: number }>();
      if (body && typeof body.percentage !== "undefined") {
        const parsed = Number(body.percentage);
        if (Number.isFinite(parsed)) {
          percentage = parsed;
        }
      }
    } catch (error) {
      const err = error as Error;
      if (err?.name !== "SyntaxError") {
        logger.warn("解析平仓请求体失败", { error: err?.message });
      }
    }

    if (!Number.isFinite(percentage) || percentage <= 0 || percentage > 100) {
      return c.json({ success: false, error: "平仓百分比必须在 1-100 之间" }, 400);
    }

    try {
      const result = await executeClosePosition({
        symbol,
        percentage,
        skipGuards: true,
        enforceWhitelist: false,
      });
      const success = Boolean(result?.success);
      const message = typeof result?.message === "string" && result.message.length > 0
        ? result.message
        : success
          ? `已提交 ${symbol} 平仓请求`
          : `平仓 ${symbol} 失败`;
      logger.info(`manual-close ${symbol}`, { success, percentage });
      return c.json({ success, message, payload: result }, success ? 200 : 400);
    } catch (error) {
      const err = error as Error;
      const message = err?.message || "未知错误";
      logger.error(`手动平仓 ${symbol} 失败`, err);
      return c.json({ success: false, error: message, message: `平仓失败: ${message}` }, 500);
    }
  });

  /**
   * 获取当前挂单
   */
  app.get("/api/open-orders", async (c) => {
    try {
      const { getConfigValue } = await import("../database/init-config");
      const provider = (await getConfigValue("EXCHANGE_PROVIDER")) || "okx";
      const client = await createExchangeClientFromActiveAccount();
      const orders = await client.getOpenOrders();
      logger.debug(`获取到 ${orders.length} 个挂单`);

      // 统一格式化订单数据
      const formattedOrders = await Promise.all(
        orders.map(async (order: any) => {
          const inferredContractFromInstId = typeof order.instId === "string"
            ? order.instId.replace(/-SWAP$/i, "").replace(/-/g, "_")
            : "";
          const rawContractCandidate = order.contract || inferredContractFromInstId;
          const rawContract = rawContractCandidate?.includes("_USDT")
            ? rawContractCandidate
            : rawContractCandidate
              ? `${rawContractCandidate}_USDT`
              : "";
          const symbol = (rawContract || String(order.symbol || "")).replace("_USDT", "").toUpperCase();
          const side = (order.side || order.posSide || "").toLowerCase();
          const orderType = (order.orderType || order.ordType || order.type || "").toUpperCase();
          const price = Number.parseFloat(order.px || order.price || "0");
          const quantityContracts = Number.parseFloat(order.sz || order.origQty || order.size || "0");
          const filledContracts = Number.parseFloat(order.fillSz || order.executedQty || "0");
          const remainingContracts = Math.max(quantityContracts - filledContracts, 0);
          const createTime = order.cTime || order.time || order.updateTime || Date.now();

          let multiplier = 1;
          if (provider === "okx" && rawContract) {
            multiplier = await getQuantoMultiplier(rawContract).catch((error: unknown) => {
              const message = error instanceof Error ? error.message : String(error);
              logger.warn(`获取 ${rawContract} 合约乘数失败: ${message}`);
              return 1;
            });
          }

          const convertSize = (value: number) => (Number.isFinite(value) ? value * multiplier : value);
          const quantity = convertSize(quantityContracts);
          const filled = convertSize(filledContracts);
          const remaining = convertSize(remainingContracts);

          const formatted = {
            orderId: order.ordId || order.orderId?.toString() || order.clientOrderId,
            symbol,
            side,
            orderType,
            price,
            quantity,
            filled,
            remaining,
            createTime,
            status: order.state || order.status,
            contract: rawContract,
            contracts: Number.isFinite(quantityContracts) ? quantityContracts : undefined,
            filledContracts: Number.isFinite(filledContracts) ? filledContracts : undefined,
            remainingContracts: Number.isFinite(remainingContracts) ? remainingContracts : undefined,
          };

          logger.debug(`格式化挂单: ${formatted.orderId} - ${formatted.symbol} ${formatted.side} ${formatted.orderType}`);
          return formatted;
        })
      );

      logger.debug(`返回 ${formattedOrders.length} 个格式化后的挂单`);
      return c.json({ orders: formattedOrders });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "未知错误";
      logger.error("获取挂单失败", error);
      return c.json({ error: message }, 500);
    }
  });

  /**
   * 取消订单
   */
  app.post("/api/cancel-order", requireAuthWithCsrf, async (c) => {
    try {
      const body = await c.req.json<{ orderId: string; symbol: string }>();
      const { orderId, symbol } = body;

      if (!orderId || !symbol) {
        return c.json({ success: false, error: "缺少订单 ID 或币种参数" }, 400);
      }

      const contract = `${symbol.toUpperCase()}_USDT`;
      const { getConfigValue } = await import("../database/init-config");
      const provider = (await getConfigValue("EXCHANGE_PROVIDER")) || "okx";
      
      const client = await createExchangeClientFromActiveAccount();
      const orders = await client.getOpenOrders();
      logger.debug(`获取到 ${orders.length} 个挂单`);

      // 统一格式化订单数据
      const formattedOrders = await Promise.all(
        orders.map(async (order: any) => {
          const inferredContractFromInstId = typeof order.instId === "string"
            ? order.instId.replace(/-SWAP$/i, "").replace(/-/g, "_")
            : "";
          const rawContractCandidate = order.contract || inferredContractFromInstId;
          const rawContract = rawContractCandidate?.includes("_USDT")
            ? rawContractCandidate
            : rawContractCandidate
              ? `${rawContractCandidate}_USDT`
              : "";
          const symbol = (rawContract || String(order.symbol || "")).replace("_USDT", "").toUpperCase();
          const side = (order.side || order.posSide || "").toLowerCase();
          const orderType = (order.orderType || order.ordType || order.type || "").toUpperCase();
          const price = Number.parseFloat(order.px || order.price || "0");
          const quantityContracts = Number.parseFloat(order.sz || order.origQty || order.size || "0");
          const filledContracts = Number.parseFloat(order.fillSz || order.executedQty || "0");
          const remainingContracts = Math.max(quantityContracts - filledContracts, 0);
          const createTime = order.cTime || order.time || order.updateTime || Date.now();

          let multiplier = 1;
          if (provider === "okx" && rawContract) {
            multiplier = await getQuantoMultiplier(rawContract).catch((error: unknown) => {
              const message = error instanceof Error ? error.message : String(error);
              logger.warn(`获取 ${rawContract} 合约乘数失败: ${message}`);
              return 1;
            });
          }

          const convertSize = (value: number) => (Number.isFinite(value) ? value * multiplier : value);
          const quantity = convertSize(quantityContracts);
          const filled = convertSize(filledContracts);
          const remaining = convertSize(remainingContracts);

          const formatted = {
            orderId: order.ordId || order.orderId?.toString() || order.clientOrderId,
            symbol,
            side,
            orderType,
            price,
            quantity,
            filled,
            remaining,
            createTime,
            status: order.state || order.status,
            contract: rawContract,
            contracts: Number.isFinite(quantityContracts) ? quantityContracts : undefined,
            filledContracts: Number.isFinite(filledContracts) ? filledContracts : undefined,
            remainingContracts: Number.isFinite(remainingContracts) ? remainingContracts : undefined,
          };

          logger.debug(`格式化挂单: ${formatted.orderId} - ${formatted.symbol} ${formatted.side} ${formatted.orderType}`);
          return formatted;
        })
      );

      logger.debug(`返回 ${formattedOrders.length} 个格式化后的挂单`);
      return c.json({ orders: formattedOrders });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "未知错误";
      logger.error("获取挂单失败", error);
      return c.json({ error: message }, 500);
    }
  });

  /**
   * 获取系统配置
   */
  app.get("/api/config", requireAuth, async (c) => {
    try {
      const { getAllConfigMasked } = await import("../database/init-config");
      const config = await getAllConfigMasked();
      
      return c.json({ config });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "未知错误";
      logger.error("获取配置失败:", error);
      return c.json({ error: message }, 500);
    }
  });

  /**
   * 更新系统配置
   */
  app.put("/api/config", requireAuthWithCsrf, async (c) => {
    try {
      const body = await c.req.json();
      const { updateConfig } = await import("../database/init-config");
      
      await updateConfig(body as Record<string, string>);
      
      return c.json({ success: true });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "未知错误";
      logger.error("更新配置失败:", error);
      return c.json({ error: message }, 500);
    }
  });

  /**
   * 重置所有配置为默认值
   */
  app.post("/api/reset-config", requireAuthWithCsrf, async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as { confirmation?: unknown };
      if (body.confirmation !== "RESET") {
        return c.json({ error: "确认口令无效" }, 400);
      }

      logger.warn("收到重置所有配置请求，开始恢复默认状态...");
      const result = await dbClient.execute({
        sql: "DELETE FROM system_config",
        args: [],
      });

      // 重新初始化默认配置
      const { initConfig } = await import("../database/init-config");
      await initConfig();

      return c.json({ success: true, data: result });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "未知错误";
      logger.error("重置配置失败:", error);
      return c.json({ error: message }, 500);
    }
  });

  /**
   * 重新加载配置并重启交易循环
   */
  app.post("/api/reload", requireAuthWithCsrf, async (c) => {
    try {
      logger.info("收到配置重载请求...");
      
      // 重新加载风险参数
      const { reloadRiskParams } = await import("../config/riskParams.new");
      await reloadRiskParams();
      await initTradingSystem();
      await restartTradingLoop();

      return c.json({ success: true, message: "配置已重新加载并重启交易循环" });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "未知错误";
      logger.error("重载配置失败:", error);
      return c.json({ error: message }, 500);
    }
  });

  /**
   * 查询交易循环状态
   */
  app.get("/api/trading-loop/status", requireAuth, (c) => {
    try {
      const state = getTradingLoopState();
      return c.json({ success: true, state });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "未知错误";
      logger.error("获取交易循环状态失败:", error);
      return c.json({ success: false, error: message }, 500);
    }
  });

  /**
   * 更新交易循环状态（启用/停用）
   */
  app.post("/api/trading-loop/state", requireAuthWithCsrf, async (c) => {
    try {
  const body = (await c.req.json().catch(() => ({}))) as { enabled?: unknown };
  const enabledValue = body.enabled;
      if (typeof enabledValue !== "boolean") {
        return c.json({ success: false, error: "缺少 enabled 字段或类型错误" }, 400);
      }

      const state = await setTradingLoopEnabled(enabledValue);
      return c.json({ success: true, state });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "未知错误";
      logger.error("更新交易循环状态失败:", error);
      return c.json({ success: false, error: message }, 500);
    }
  });

  /**
   * 获取多个币种的实时价格
   */
  app.get("/api/prices", async (c) => {
    try {
      const symbolsParam = c.req.query("symbols") || "BTC,ETH,SOL,BNB,DOGE,XRP";
      const symbols = symbolsParam.split(",").map(s => s.trim());
      
      const okxClient = await createExchangeClientFromActiveAccount();
      const prices: Record<string, number> = {};
      
      // 并发获取所有币种价格
      await Promise.all(
        symbols.map(async (symbol) => {
          try {
            const contract = `${symbol}_USDT`;
            const ticker = await okxClient.getFuturesTicker(contract);
            prices[symbol] = Number.parseFloat(ticker.last || "0");
          } catch (error: unknown) {
            if (error instanceof Error) {
              logger.error(`获取 ${symbol} 价格失败:`, error);
            } else {
              logger.error(`获取 ${symbol} 价格失败: 未知错误`, error as Record<string, unknown>);
            }
            prices[symbol] = 0;
          }
        })
      );
      
      return c.json({ prices });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "未知错误";
      return c.json({ error: message }, 500);
    }
  });

  /**
   * 测试任意交易所 API 连接
   */
  app.post("/api/test-exchange", requireAuthWithCsrf, async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as ExchangeTestPayload;
      const result = await performExchangeConnectionTest(body);
      if (!result.success) {
        const numericStatus = Number.isFinite(result.status) ? Number(result.status) : 500;
        const status = Math.min(Math.max(numericStatus, 200), 599) as ContentfulStatusCode;
        return c.json({ success: false, error: result.error }, status);
      }
      return c.json({
        success: true,
        exchange: result.exchange,
        balance: result.balance || "0",
        message: "API 连接成功",
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "未知错误";
      logger.error("测试交易所 API 失败:", error);
      return c.json({ success: false, error: message }, 500);
    }
  });

  // 兼容旧接口：默认测试 OKX
  app.post("/api/test-okx", requireAuthWithCsrf, async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as ExchangeTestPayload;
      const result = await performExchangeConnectionTest({ ...body, exchange: "okx" });
      if (!result.success) {
        const numericStatus = Number.isFinite(result.status) ? Number(result.status) : 500;
        const status = Math.min(Math.max(numericStatus, 200), 599) as ContentfulStatusCode;
        return c.json({ success: false, error: result.error }, status);
      }
      return c.json({ success: true, balance: result.balance || "0", message: "API 连接成功" });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "未知错误";
      logger.error("测试 OKX API 失败:", error);
      return c.json({ success: false, error: message }, 500);
    }
  });

  /**
   * 测试 AI API 连接
   */
  app.post("/api/test-ai", requireAuthWithCsrf, async (c) => {
    try {
      const body = await c.req.json<Record<string, unknown>>();
      const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
      const baseUrl = typeof body.baseUrl === "string" ? body.baseUrl.trim() : "";
      const modelName = typeof body.modelName === "string" ? body.modelName.trim() : "";
      const proxyUrlRaw = typeof body.proxyUrl === "string" ? body.proxyUrl.trim() : "";
      
      if (!apiKey || !baseUrl || !modelName) {
        return c.json({ success: false, error: "缺少必需的 API 配置" }, 400);
      }

      if (!isSafeHttpUrl(baseUrl)) {
        return c.json({ success: false, error: "API 基础地址不安全" }, 400);
      }

      let proxyUrl = "";
      if (proxyUrlRaw) {
        if (!isSafeHttpUrl(proxyUrlRaw, { allowLocal: true })) {
          return c.json({ success: false, error: "代理地址不安全" }, 400);
        }
        proxyUrl = proxyUrlRaw;
      }
      
      const startTime = Date.now();
      
      // 构建请求选项
      const fetchOptions: RequestInit = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: modelName,
          messages: [
            {
              role: "user",
              content: "测试连接，请回复'OK'"
            }
          ],
          max_tokens: 10,
        }),
      };
      
      // 如果有代理，添加代理代理
      if (proxyUrl) {
        const { ProxyAgent } = await import("undici");
        (fetchOptions as any).dispatcher = new ProxyAgent(proxyUrl);
      }
      
      // 发送测试请求
      const response = await fetch(`${baseUrl}/chat/completions`, fetchOptions);
      
      if (!response.ok) {
        const errorText = await response.text();
        let errorMsg = `HTTP ${response.status}: ${response.statusText}`;
        
        try {
          const errorJson = JSON.parse(errorText);
          errorMsg = errorJson.error?.message || errorJson.message || errorMsg;
        } catch {
          // 解析失败，使用默认错误消息
        }
        
        // 返回友好的错误信息
        if (response.status === 401) {
          errorMsg = "API Key 无效或已过期";
        } else if (response.status === 403) {
          errorMsg = "API Key 权限不足";
        } else if (response.status === 429) {
          errorMsg = "请求频率过高，请稍后重试";
        } else if (response.status === 404) {
          errorMsg = "API 端点不存在，请检查基础地址";
        }
        
        return c.json({ success: false, error: errorMsg }, 500);
      }
      
      const result = await response.json();
      const responseTime = `${Date.now() - startTime}ms`;
      
      return c.json({
        success: true,
        model: result.model || modelName,
        responseTime,
        message: "AI API 连接成功"
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "未知错误";
      logger.error("测试 AI API 失败:", error);
      
      // 返回友好的错误信息
      let errorMsg = message;
      if (message.includes("timeout") || message.includes("ETIMEDOUT")) {
        errorMsg = "连接超时，请检查网络或代理设置";
      } else if (message.includes("ECONNREFUSED")) {
        errorMsg = "连接被拒绝，请检查代理设置";
      } else if (message.includes("ENOTFOUND")) {
        errorMsg = "无法解析域名，请检查 API 基础地址";
      }
      
      return c.json({ success: false, error: errorMsg }, 500);
    }
  });

  /**
   * 测试紧急通知端点
   */
  app.post("/api/test-emergency-notice", requireAuthWithCsrf, async (c) => {
    try {
      const body = await c.req.json<Record<string, unknown>>();
      const url = typeof body.url === "string" ? body.url.trim() : "";
      
      if (!url) {
        return c.json({ success: false, error: "缺少紧急通知 URL" }, 400);
      }

      if (!isSafeHttpUrl(url)) {
        return c.json({ success: false, error: "紧急通知 URL 不安全" }, 400);
      }

      // 构造测试参数
      const testParams = new URLSearchParams({
        reason: "测试通知 / Test Notification / テスト通知",
        severity: "low",
        details: "这是一条测试紧急通知，用于验证配置是否正确 / This is a test emergency notice to verify configuration / これはテストの緊急通知です",
        timestamp: new Date().toISOString(),
      });

      const fullUrl = `${url}${url.includes("?") ? "&" : "?"}${testParams.toString()}`;
      
      // 发送测试请求
      const response = await fetch(fullUrl, {
        method: "GET",
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => response.statusText);
        return c.json({ 
          success: false, 
          error: `HTTP ${response.status}: ${errorText || response.statusText}` 
        }, 500);
      }

      return c.json({ success: true });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "未知错误";
      logger.error("测试紧急通知失败:", error);
      
      let errorMsg = message;
      if (message.includes("timeout") || message.includes("ETIMEDOUT")) {
        errorMsg = "连接超时，请检查 URL 是否可达";
      } else if (message.includes("ECONNREFUSED")) {
        errorMsg = "连接被拒绝，请检查 URL";
      } else if (message.includes("ENOTFOUND")) {
        errorMsg = "无法解析域名，请检查 URL";
      }
      
      return c.json({ success: false, error: errorMsg }, 500);
    }
  });

  /**
   * 手动下单接口
   */
  app.post("/api/trading/manual", requireAuthWithCsrf, async (c) => {
    const session = c.get("session");
    if (!session) {
      return c.json({ success: false, error: "未登录或会话已过期" }, 401);
    }

    try {
      const body = await c.req.json();
      const { action, symbol, leverage, amount, direction, marginMode, amountUnit, orderType, price } = body;

      if (!symbol) return c.json({ success: false, error: "缺少币种参数" }, 400);

      const normalizedSymbol = symbol.toUpperCase();
      let result;

      if (action === "open") {
        if (!amount || !leverage) {
          return c.json({ success: false, error: "开仓需要金额和杠杆参数" }, 400);
        }
        
        // executeOpenPosition handles the logic
        result = await executeOpenPosition({
          symbol: normalizedSymbol,
          side: direction || "long",
          leverage: Number(leverage),
          amount: Number(amount),
          amountUnit: amountUnit === "coin" ? "coin" : "usdt",
          isNotional: amountUnit !== "coin", // Manual trade USDT is Notional
          marginMode: marginMode || "cross",
          orderType: orderType === "limit" ? "limit" : "market",
          price: orderType === "limit" ? Number(price) : undefined,
        });

      } else if (action === "close") {
        // executeClosePosition handles the logic
        // Default to 100% close if not specified, or handle partial close if UI supports it
        // For now, the UI button says "Close Position", implying full close.
        result = await executeClosePosition({
          symbol: normalizedSymbol,
          percentage: 100,
          skipGuards: true, // Manual close skips minimum holding time guards
        });
      } else {
        return c.json({ success: false, error: "无效的操作类型" }, 400);
      }

      if (result.success) {
        return c.json({ success: true, data: result });
      } else {
        return c.json({ success: false, error: result.message }, 400);
      }

    } catch (error: any) {
      logger.error("手动交易执行失败", error);
      return c.json({ success: false, error: error.message || "执行失败" }, 500);
    }
  });

  /**
   * 手动触发 AI 交易决策
   */
  app.post("/api/trading/execute-manual", requireAuthWithCsrf, async (c) => {
    try {
      logger.info("收到手动执行 AI 决策请求");
      
      // 执行交易决策（异步，不阻塞响应），传递 manual 触发标记
      executeTradingDecision("manual")
        .then(() => {
          logger.info("手动 AI 决策执行完成");
        })
        .catch((error: unknown) => {
          logger.error("手动 AI 决策执行失败:", error);
        });
      
      return c.json({
        success: true,
        message: "AI 决策已触发执行",
        timestamp: new Date().toISOString()
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "未知错误";
      logger.error("触发手动 AI 决策失败:", error);
      return c.json({ success: false, error: message }, 500);
    }
  });

  /**
   * 获取指定币种的K线数据
   */
  app.get("/api/candles", async (c) => {
    const symbolParam = c.req.query("symbol")?.trim().toUpperCase();
    const interval = c.req.query("interval")?.trim() || "5m";
    const limitParam = c.req.query("limit");

    const symbol = symbolParam && symbolParam.length >= 2 ? symbolParam : "BTC";
    const limitRaw = limitParam ? Number.parseInt(limitParam, 10) : 200;
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 20), 500) : 200;

    try {
      const client = await createExchangeClientFromActiveAccount();
      const contract = `${symbol}_USDT`;
      const candles = await client.getFuturesCandles(contract, interval, limit);

      return c.json({
        symbol,
        interval,
        candles,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "未知错误";
      logger.error(`获取 ${symbol} K线数据失败: ${message}`);
      return c.json({ error: message }, 500);
    }
  });

  /**
   * 获取用户语言偏好
   */
  app.get("/api/user/language", async (c) => {
    try {
      const { getConfigValue } = await import("../database/init-config");
      const language = (await getConfigValue("UI_LANGUAGE")) || "en";
      return c.json({ language });
    } catch (error: unknown) {
      return c.json({ language: "en" });
    }
  });

  /**
   * 获取当前 AI 模型
   */
  app.get("/api/public/model", async (c) => {
    try {
      const { getConfigValue } = await import("../database/init-config");
      const model = (await getConfigValue("AI_MODEL_NAME")) || "gpt-4o";
      return c.json({ model });
    } catch (error: unknown) {
      return c.json({ model: "unknown" });
    }
  });

  /**
   * 获取合约乘数
   */
  app.get("/api/public/contract-multipliers", async (c) => {
    try {
      const result = await dbClient.execute("SELECT symbol, multiplier FROM contract_multipliers");
      const multipliers: Record<string, number> = {};
      for (const row of result.rows) {
        if (row.symbol && row.multiplier) {
          multipliers[String(row.symbol)] = Number(row.multiplier);
        }
      }
      return c.json({ multipliers });
    } catch (error: unknown) {
      logger.error("获取合约乘数失败", error);
      return c.json({ multipliers: {} });
    }
  });

  /**
   * 获取账户价值历史（用于绘图）
   */
  app.get("/api/history", async (c) => {
    try {
      const limitParam = c.req.query("limit");
      const accountIdParam = c.req.query("accountId");
      
      let accountId: number | null = null;
      if (accountIdParam) {
        accountId = Number(accountIdParam);
      } else {
        const activeAccount = await getActiveAccount();
        accountId = activeAccount ? activeAccount.id : null;
      }
      
      type ExecuteResult = Awaited<ReturnType<typeof dbClient.execute>>;
      let result: ExecuteResult;
      
      let sql = "SELECT timestamp, total_value, unrealized_pnl, return_percent FROM account_history";
      const args: any[] = [];
      
      if (accountId) {
        sql += " WHERE account_id = ?";
        args.push(accountId);
      }
      
      sql += " ORDER BY timestamp DESC";
      
      if (limitParam) {
        sql += " LIMIT ?";
        args.push(Number.parseInt(limitParam, 10));
      }
      
      result = await dbClient.execute({ sql, args });
      
      const history = asDbRows(result.rows)
        .map((row) => ({
          timestamp: toStringSafe(row.timestamp),
          totalValue: toNumber(row.total_value),
          unrealizedPnl: toNumber(row.unrealized_pnl),
          returnPercent: toNumber(row.return_percent),
        }))
        .reverse(); // 反转，使时间从旧到新
      
      return c.json({ history });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "未知错误";
      return c.json({ error: message }, 500);
    }
  });

  /**
   * 获取详细交易统计数据
   */
  app.get("/api/statistics", async (c) => {
    try {
      const accountIdParam = c.req.query("accountId");
      let accountId: number | null = null;
      if (accountIdParam) {
        accountId = Number(accountIdParam);
      } else {
        const activeAccount = await getActiveAccount();
        accountId = activeAccount ? activeAccount.id : null;
      }

      // 获取所有已平仓交易
      let tradesSql = "SELECT pnl FROM trades WHERE type = 'close' AND pnl IS NOT NULL";
      const tradesArgs: any[] = [];
      if (accountId) {
        tradesSql += " AND account_id = ?";
        tradesArgs.push(accountId);
      }
      tradesSql += " ORDER BY timestamp ASC";

      const tradesResult = await dbClient.execute({ sql: tradesSql, args: tradesArgs });
      const trades = tradesResult.rows || [];
      
      // 获取权益历史
      let historySql = "SELECT total_value, timestamp FROM account_history";
      const historyArgs: any[] = [];
      if (accountId) {
        historySql += " WHERE account_id = ?";
        historyArgs.push(accountId);
      }
      historySql += " ORDER BY timestamp ASC";

      const historyResult = await dbClient.execute({ sql: historySql, args: historyArgs });
      const history = historyResult.rows || [];
      
      // 获取初始资金
      const initialBalance = history.length > 0 
        ? Number.parseFloat(history[0].total_value as string)
        : 100;
      
      // 当前总资产
      const currentBalance = history.length > 0
        ? Number.parseFloat(history[history.length - 1].total_value as string)
        : initialBalance;
      
      // 基础统计
      const totalTrades = trades.length;
      const winTrades = trades.filter(row => Number.parseFloat(row.pnl as string || "0") > 0);
      const lossTrades = trades.filter(row => Number.parseFloat(row.pnl as string || "0") < 0);
      
      const winCount = winTrades.length;
      const lossCount = lossTrades.length;
      const winRate = totalTrades > 0 ? (winCount / totalTrades) * 100 : 0;
      
      // 盈亏统计
      const totalProfit = winTrades.reduce((sum, row) => 
        sum + Number.parseFloat(row.pnl as string || "0"), 0);
      const totalLoss = Math.abs(lossTrades.reduce((sum, row) => 
        sum + Number.parseFloat(row.pnl as string || "0"), 0));
      const netPnl = totalProfit - totalLoss;
      
      // 收益率
      const returnPercent = ((currentBalance - initialBalance) / initialBalance) * 100;
      
      // 最大回撤
      let maxDrawdown = 0;
      let peak = 0;
      for (const row of history) {
        const value = Number.parseFloat(row.total_value as string || "0");
        if (value > peak) peak = value;
        if (peak > 0) {
          const drawdown = ((peak - value) / peak) * 100;
          if (drawdown > maxDrawdown) maxDrawdown = drawdown;
        }
      }
      
      // 盈亏比 (Profit Factor)
      const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : 0;
      
      // 平均盈利/亏损
      const avgWin = winCount > 0 ? totalProfit / winCount : 0;
      const avgLoss = lossCount > 0 ? totalLoss / lossCount : 0;
      
      // 最大盈利/亏损
      const maxWin = winTrades.length > 0 
        ? Math.max(...winTrades.map(row => Number.parseFloat(row.pnl as string || "0")))
        : 0;
      const maxLoss = lossTrades.length > 0
        ? Math.abs(Math.min(...lossTrades.map(row => Number.parseFloat(row.pnl as string || "0"))))
        : 0;
      
      // 夏普比率计算（简化版：使用日收益率）
      let sharpeRatio = 0;
      if (history.length > 1) {
        const returns: number[] = [];
        for (let i = 1; i < history.length; i++) {
          const prev = Number.parseFloat(history[i - 1].total_value as string || "0");
          const curr = Number.parseFloat(history[i].total_value as string || "0");
          if (prev > 0) {
            returns.push((curr - prev) / prev);
          }
        }
        
        if (returns.length > 0) {
          const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
          const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
          const stdDev = Math.sqrt(variance);
          
          if (stdDev > 0) {
            sharpeRatio = (avgReturn / stdDev) * Math.sqrt(252); // 年化，假设252个交易日
          }
        }
      }
      
      // Sortino比率（仅考虑下行波动）
      let sortinoRatio = 0;
      if (history.length > 1) {
        const returns: number[] = [];
        for (let i = 1; i < history.length; i++) {
          const prev = Number.parseFloat(history[i - 1].total_value as string || "0");
          const curr = Number.parseFloat(history[i].total_value as string || "0");
          if (prev > 0) {
            returns.push((curr - prev) / prev);
          }
        }
        
        if (returns.length > 0) {
          const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
          const downReturns = returns.filter(r => r < 0);
          
          if (downReturns.length > 0) {
            const downVariance = downReturns.reduce((sum, r) => sum + Math.pow(r, 2), 0) / downReturns.length;
            const downStdDev = Math.sqrt(downVariance);
            
            if (downStdDev > 0) {
              sortinoRatio = (avgReturn / downStdDev) * Math.sqrt(252);
            }
          }
        }
      }
      
      return c.json({
        winRate,
        totalProfit,
        totalLoss,
        netPnl,
        returnPercent,
        maxDrawdown,
        profitFactor,
        totalTrades,
        winCount,
        lossCount,
        avgWin,
        avgLoss,
        maxWin,
        maxLoss,
        sharpeRatio,
        sortinoRatio,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "未知错误";
      return c.json({ error: message }, 500);
    }
  });

  /**
   * 获取交易记录 - 从数据库获取历史仓位（已平仓的记录）
   */
  app.get("/api/trades", async (c) => {
    try {
      const { getActiveAccount } = await import("../services/accountConfigService");
      const activeAccount = await getActiveAccount();
      const isBitget = activeAccount?.provider === 'bitget';
      const isBinance = activeAccount?.provider === 'binance';

      const rawLimit = Number.parseInt(c.req.query("limit") || "10", 10);
      const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 10;
      const rawPage = Number.parseInt(c.req.query("page") || "1", 10);
      const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
      const offset = (page - 1) * limit;
      const symbol = c.req.query("symbol"); // 可选，筛选特定币种

      // 从数据库获取历史交易记录
      let sql = "SELECT * FROM trades ORDER BY timestamp DESC LIMIT ? OFFSET ?";
      let args: Array<string | number> = [limit, offset];

      let countSql = "SELECT COUNT(*) AS total FROM trades";
      let countArgs: Array<string | number> = [];

      if (symbol) {
        sql = "SELECT * FROM trades WHERE symbol = ? ORDER BY timestamp DESC LIMIT ? OFFSET ?";
        args = [symbol, limit, offset];
        countSql = "SELECT COUNT(*) AS total FROM trades WHERE symbol = ?";
        countArgs = [symbol];
      }

      const [result, countResult] = await Promise.all([
        dbClient.execute({ sql, args }),
        dbClient.execute({ sql: countSql, args: countArgs }),
      ]);

      if (!result.rows || result.rows.length === 0) {
        const totalRows = asDbRows(countResult.rows);
        const total = totalRows.length > 0 ? toNumber(totalRows[0].total, 0) : 0;
        return c.json({
          trades: [],
          pagination: {
            page,
            pageSize: limit,
            total,
          },
        });
      }

      // 转换数据库格式到前端需要的格式
      const trades = await Promise.all(
        asDbRows(result.rows).map(async (row) => {
          const pnlValue = toNumber(row.pnl, Number.NaN);
          const symbol = toStringSafe(row.symbol);
          const side = toStringSafe(row.side);
          const rawContracts = toNumber(row.quantity);
          const contracts = Number.isFinite(rawContracts) ? Math.abs(rawContracts) : 0;

          let contractMultiplier = 1;
          if (!isBitget && !isBinance && symbol) {
            try {
              contractMultiplier = await getQuantoMultiplier(`${symbol}_USDT`);
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              logger.warn(`获取 ${symbol}_USDT 合约乘数失败: ${message}`);
            }
          }
          if (!Number.isFinite(contractMultiplier) || contractMultiplier <= 0) {
            contractMultiplier = 1;
          }

          const quantity = (isBitget || isBinance) ? contracts : (contracts * contractMultiplier);

          return {
            id: toStringSafe(row.id),
            orderId: toStringSafe(row.order_id),
            symbol,
            side,
            type: toStringSafe(row.type),
            price: toNumber(row.price),
            quantity,
            contracts,
            contractMultiplier,
            leverage: Number.parseInt(toStringSafe(row.leverage, "1"), 10),
            pnl: Number.isFinite(pnlValue) ? pnlValue : null,
            fee: toNumber(row.fee),
            timestamp: toStringSafe(row.timestamp),
            status: toStringSafe(row.status),
          };
        })
      );

      const totalRows = asDbRows(countResult.rows);
      const total = totalRows.length > 0 ? toNumber(totalRows[0].total, trades.length) : trades.length;

      return c.json({
        trades,
        pagination: {
          page,
          pageSize: limit,
          total,
        },
      });
    } catch (error: unknown) {
      if (error instanceof Error) {
        logger.error("获取历史仓位失败:", error);
        return c.json({ error: error.message }, 500);
      }
      logger.error("获取历史仓位失败: 未知错误", error as Record<string, unknown>);
      return c.json({ error: "未知错误" }, 500);
    }
  });

  /**
   * 获取交易执行日志
   */
  app.get("/api/trade-logs", async (c) => {
    try {
      const rawLimit = Number.parseInt(c.req.query("limit") || "50", 10);
      const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 50;
      const rawPage = Number.parseInt(c.req.query("page") || "1", 10);
      const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
      const offset = (page - 1) * limit;

      const [result, countResult] = await Promise.all([
        dbClient.execute({
          sql: `SELECT * FROM trade_logs ORDER BY datetime(created_at) DESC LIMIT ? OFFSET ?`,
          args: [limit, offset],
        }),
        dbClient.execute({
          sql: `SELECT COUNT(*) AS total FROM trade_logs`,
          args: [],
        }),
      ]);

      const logs = asDbRows(result.rows).map((row) => {
        const leverageValue = row.leverage;
        const amountValue = row.amount_usdt;
        const sizeValue = row.size;

        return {
          id: toStringSafe(row.id),
          action: toStringSafe(row.action, "unknown"),
          symbol: toStringSafe(row.symbol) || null,
          side: toStringSafe(row.side) || null,
          leverage: leverageValue === null || leverageValue === undefined ? null : toNumber(leverageValue),
          amountUsdt: amountValue === null || amountValue === undefined ? null : toNumber(amountValue),
          size: sizeValue === null || sizeValue === undefined ? null : toNumber(sizeValue),
          status: toStringSafe(row.status, "unknown"),
          message: toStringSafe(row.message),
          orderId: toStringSafe(row.order_id) || null,
          rawRequest: toStringSafe(row.raw_request) || null,
          rawResponse: toStringSafe(row.raw_response) || null,
          createdAt: toStringSafe(row.created_at),
        };
      });

      const totalRows = asDbRows(countResult.rows);
      const total = totalRows.length > 0 ? toNumber(totalRows[0].total, logs.length) : logs.length;

      return c.json({
        logs,
        pagination: {
          page,
          pageSize: limit,
          total,
        },
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "未知错误";
      logger.error("获取交易执行日志失败", error);
      return c.json({ error: message }, 500);
    }
  });

  /**
   * 获取 Agent 决策日志
   */
  app.get("/api/logs", async (c) => {
    try {
      const rawLimit = Number.parseInt(c.req.query("limit") || "20", 10);
      const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 20;
      const rawPage = Number.parseInt(c.req.query("page") || "1", 10);
      const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
      const offset = (page - 1) * limit;

      const [result, countResult] = await Promise.all([
        dbClient.execute({
          sql: `SELECT * FROM agent_decisions 
                ORDER BY datetime(timestamp) DESC 
                LIMIT ? OFFSET ?`,
          args: [limit, offset],
        }),
        dbClient.execute({
          sql: `SELECT COUNT(*) AS total FROM agent_decisions`,
          args: [],
        }),
      ]);

      const logs = asDbRows(result.rows).map((row) => ({
        id: toStringSafe(row.id),
        timestamp: toStringSafe(row.timestamp),
        iteration: toNumber(row.iteration),
        decision: toStringSafe(row.decision),
        actionsTaken: toStringSafe(row.actions_taken),
        accountValue: toNumber(row.account_value),
        positionsCount: toNumber(row.positions_count),
      }));

      const totalRows = asDbRows(countResult.rows);
      const total = totalRows.length > 0 ? toNumber(totalRows[0].total, logs.length) : logs.length;

      return c.json({
        logs,
        pagination: {
          page,
          pageSize: limit,
          total,
        },
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "未知错误";
      return c.json({ error: message }, 500);
    }
  });

  /**
   * 获取 AI 决策请求日志
   */
  app.get("/api/decision-requests", async (c) => {
    try {
      const rawLimit = Number.parseInt(c.req.query("limit") || "20", 10);
      const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 20;
      const rawPage = Number.parseInt(c.req.query("page") || "1", 10);
      const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
      const offset = (page - 1) * limit;

      const [result, countResult] = await Promise.all([
        dbClient.execute({
          sql: `SELECT * FROM agent_request_logs ORDER BY datetime(created_at) DESC LIMIT ? OFFSET ?`,
          args: [limit, offset],
        }),
        dbClient.execute({
          sql: `SELECT COUNT(*) AS total FROM agent_request_logs`,
          args: [],
        }),
      ]);

      const logs = asDbRows(result.rows).map((row) => ({
        id: toStringSafe(row.id),
        createdAt: toStringSafe(row.created_at),
        instructions: toStringSafe(row.instructions),
        prompt: toStringSafe(row.prompt),
        response: toStringSafe(row.response),
        model: toStringSafe(row.model_name),
        durationMs: toNumber(row.duration_ms),
        tokensInput: toNumber(row.tokens_input),
        tokensOutput: toNumber(row.tokens_output),
        error: toStringSafe(row.error_message),
      }));

      const totalRows = asDbRows(countResult.rows);
      const total = totalRows.length > 0 ? toNumber(totalRows[0].total, logs.length) : logs.length;

      return c.json({
        logs,
        pagination: {
          page,
          pageSize: limit,
          total,
        },
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "未知错误";
      return c.json({ error: message }, 500);
    }
  });

  /**
   * 重置实盘数据（清空交易记录、持仓、日志，保留配置）
   */
  app.post("/api/reset-live-data", requireAuthWithCsrf, async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as { confirmation?: unknown };
      if (body.confirmation !== "RESET") {
        return c.json({ error: "确认口令无效" }, 400);
      }

      const activeAccount = await getActiveAccount();
      const accountId = activeAccount ? activeAccount.id.toString() : "default";

      logger.warn(`收到重置实盘数据请求 (account_id=${accountId})，开始清理数据...`);
      
      // 调用重置逻辑，仅清理当前账户数据
      const result = await resetLiveDataToDefaults(accountId);
      
      // 重置交易循环状态
      setIterationCount(0);
      setTradingStartTime(new Date());
      
      logger.info(`实盘数据重置完成 (account_id=${accountId})`);
      
      return c.json({ 
        success: true, 
        data: result 
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "未知错误";
      logger.error("重置实盘数据失败:", error);
      return c.json({ error: message }, 500);
    }
  });

  return app;
}


