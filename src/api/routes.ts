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
import { serveStatic } from "@hono/node-server/serve-static";
import { getCookie, setCookie } from "hono/cookie";
import { createClient } from "@libsql/client";
import { randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { readFile } from "node:fs/promises";
import { createOkxClient } from "../services/okxClient";
import { createLogger } from "../utils/loggerUtils";
import { getQuantoMultiplier } from "../utils/contractUtils";
import type { AdminAuthConfig } from "../utils/adminAuth";
import type { TradingStrategy } from "../config/strategyTypes";
import { getStrategyPromptDefaultSections, getTradingStrategy } from "../agents/tradingAgent";
import { RISK_PARAMS, reloadRiskParams } from "../config/riskParams.new";
import { resetLiveDataToDefaults } from "../database/reset-live-data";
import {
  executeTradingDecision,
  getTradingLoopState,
  initTradingSystem,
  restartTradingLoop,
  setIterationCount,
  setTradingLoopEnabled,
  setTradingStartTime,
} from "../scheduler/tradingLoop";

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
  "EXTREME_STOP_LOSS_PERCENT",
  "INITIAL_BALANCE",
  "ACCOUNT_STOP_LOSS_USDT",
  "ACCOUNT_TAKE_PROFIT_USDT",
  "ACCOUNT_DRAWDOWN_WARNING_PERCENT",
  "ACCOUNT_DRAWDOWN_NO_NEW_POSITION_PERCENT",
  "ACCOUNT_DRAWDOWN_FORCE_CLOSE_PERCENT",
]);

const CONFIG_BOOLEAN_KEYS = new Set(["OKX_USE_PAPER"]);

const CONFIG_ENUM_VALUES: Record<string, string[]> = {
  TRADING_STRATEGY: ["conservative", "balanced", "aggressive", "ultra-short", "swing-trend"],
  PROMPT_LANGUAGE: ["zh", "en", "ja"],
};

const CONFIG_ALLOWED_KEYS = new Set([
  "TRADING_SYMBOLS",
  "TRADING_INTERVAL_MINUTES",
  "TRADING_STRATEGY",
  "MAX_LEVERAGE",
  "MAX_POSITIONS",
  "MAX_HOLDING_HOURS",
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
  "OKX_API_KEY",
  "OKX_API_SECRET",
  "OKX_API_PASSPHRASE",
  "OKX_USE_PAPER",
  "PROMPT_SECTION_ENTRY",
  "PROMPT_SECTION_EXIT",
  "PROMPT_SECTION_VARIABLES",
  "PROMPT_LANGUAGE",
]);

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
  const app = new Hono();
  type SessionRecord = {
    id: string;
    username: string;
    csrfToken: string;
    expiresAt: number;
  };

  const sessions = new Map<string, SessionRecord>();
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

  const refreshSession = (session: SessionRecord): SessionRecord => {
    session.expiresAt = Date.now() + SESSION_TTL_MS;
    sessions.set(session.id, session);
    return session;
  };

  const getSessionFromRequest = (c: Context): SessionRecord | null => {
    const sessionId = getCookie(c, SESSION_COOKIE);
    if (!sessionId) return null;
    const record = sessions.get(sessionId);
    if (!record) return null;
    if (record.expiresAt <= Date.now()) {
      sessions.delete(sessionId);
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

  const attachSessionCookie = (c: Context, session: SessionRecord) => {
    sessions.set(session.id, session);
    setCookie(c, SESSION_COOKIE, session.id, {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      maxAge: Math.floor(SESSION_TTL_MS / 1000),
      secure: process.env.NODE_ENV === "production",
    });
  };

  const clearSessionCookie = (c: Context) => {
    const sessionId = getCookie(c, SESSION_COOKIE);
    if (sessionId) {
      sessions.delete(sessionId);
    }
    setCookie(c, SESSION_COOKIE, "", {
      path: "/",
      maxAge: 0,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Lax",
    });
  };

  const requireAuth: MiddlewareHandler = async (c, next) => {
    const session = getSessionFromRequest(c);
    if (!session) {
      return c.json({ error: "未登录或会话已过期" }, 401);
    }
    c.set("session", session);
    return next();
  };

  const requireAuthWithCsrf: MiddlewareHandler = async (c, next) => {
    const session = getSessionFromRequest(c);
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

  const renderLoginPage = async (c: Context) => {
    const session = getSessionFromRequest(c);
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
      attachSessionCookie(c, session);

      return c.json({ success: true, csrfToken: session.csrfToken });
    } catch (error: unknown) {
      return c.json({ success: false, error: "请求格式错误" }, 400);
    }
  });

  app.post("/api/auth/logout", requireAuthWithCsrf, async (c) => {
    clearSessionCookie(c);
    return c.json({ success: true });
  });

  app.get("/api/auth/status", async (c) => {
    const session = getSessionFromRequest(c);
    if (!session) {
      return c.json({ authenticated: false });
    }
    return c.json({ authenticated: true, username: session.username, csrfToken: session.csrfToken });
  });

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
      const okxClient = createOkxClient();
      const account = await okxClient.getFuturesAccount();
      
      // 从数据库获取初始资金
      const initialResult = await dbClient.execute(
        "SELECT total_value FROM account_history ORDER BY timestamp ASC LIMIT 1"
      );
      const initialBalance = initialResult.rows[0]
        ? Number.parseFloat(initialResult.rows[0].total_value as string)
        : 100;
      
  // OKX 的 account.total 不包含未实现盈亏
      // 总资产（不含未实现盈亏）= account.total
      const unrealisedPnl = Number.parseFloat(account.unrealisedPnl || "0");
      const totalBalance = Number.parseFloat(account.total || "0");
      
      // 收益率 = (总资产 - 初始资金) / 初始资金 * 100
      // 总资产不包含未实现盈亏，收益率反映已实现盈亏
      const returnPercent = ((totalBalance - initialBalance) / initialBalance) * 100;
      
      // 计算胜率 - 从已平仓交易计算
      let winRate = 0;
      try {
        const closedTradesResult = await dbClient.execute(
          "SELECT pnl FROM trades WHERE type = 'close' AND pnl IS NOT NULL"
        );
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
        const historyResult = await dbClient.execute(
          "SELECT total_value FROM account_history ORDER BY timestamp ASC"
        );
        const history = historyResult.rows || [];
        
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
        totalBalance,  // 总资产（不包含未实现盈亏）
        availableBalance: Number.parseFloat(account.available || "0"),
        positionMargin: Number.parseFloat(account.positionMargin || "0"),
        unrealisedPnl,
        returnPercent,  // 收益率（不包含未实现盈亏）
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
      const okxClient = createOkxClient();
      const okxPositions = await okxClient.getPositions();
      
      // 从数据库获取止损止盈信息
      const dbResult = await dbClient.execute("SELECT symbol, stop_loss, profit_target FROM positions");
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
            try {
              contractMultiplier = await getQuantoMultiplier(position.contract);
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              logger.warn(`获取 ${position.contract} 合约乘数失败: ${message}`);
            }
            if (!Number.isFinite(contractMultiplier) || contractMultiplier <= 0) {
              contractMultiplier = 1;
            }

            const quantity = contracts * contractMultiplier;
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

  /**
   * 获取账户价值历史（用于绘图）
   */
  app.get("/api/history", async (c) => {
    try {
      const limitParam = c.req.query("limit");
      
      type ExecuteResult = Awaited<ReturnType<typeof dbClient.execute>>;
      let result: ExecuteResult;
      if (limitParam) {
        // 如果传递了 limit 参数，使用 LIMIT 子句
        const limit = Number.parseInt(limitParam, 10);
        result = await dbClient.execute({
          sql: "SELECT timestamp, total_value, unrealized_pnl, return_percent FROM account_history ORDER BY timestamp DESC LIMIT ?",
          args: [limit],
        });
      } else {
        // 如果没有传递 limit 参数，返回全部数据
        result = await dbClient.execute(
          "SELECT timestamp, total_value, unrealized_pnl, return_percent FROM account_history ORDER BY timestamp DESC",
        );
      }
      
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
      // 获取所有已平仓交易
      const tradesResult = await dbClient.execute(
        "SELECT pnl FROM trades WHERE type = 'close' AND pnl IS NOT NULL ORDER BY timestamp ASC"
      );
      const trades = tradesResult.rows || [];
      
      // 获取权益历史
      const historyResult = await dbClient.execute(
        "SELECT total_value, timestamp FROM account_history ORDER BY timestamp ASC"
      );
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
          if (symbol) {
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

          const quantity = contracts * contractMultiplier;

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
   * 获取交易统计
   */
  app.get("/api/stats", async (c) => {
    try {
      // 统计总交易次数 - 使用 pnl IS NOT NULL 来确保这是已完成的平仓交易
      const totalTradesResult = await dbClient.execute(
        "SELECT COUNT(*) as count FROM trades WHERE type = 'close' AND pnl IS NOT NULL"
      );
      const totalTradesRow = asDbRows(totalTradesResult.rows)[0];
      const totalTrades = toNumber(totalTradesRow?.count);
      
      // 统计盈利交易
      const winTradesResult = await dbClient.execute(
        "SELECT COUNT(*) as count FROM trades WHERE type = 'close' AND pnl IS NOT NULL AND pnl > 0"
      );
      const winTradesRow = asDbRows(winTradesResult.rows)[0];
      const winTrades = toNumber(winTradesRow?.count);
      
      // 计算胜率
      const winRate = totalTrades > 0 ? (winTrades / totalTrades) * 100 : 0;
      
      // 计算总盈亏
      const pnlResult = await dbClient.execute(
        "SELECT SUM(pnl) as total_pnl FROM trades WHERE type = 'close' AND pnl IS NOT NULL"
      );
      const totalPnlRow = asDbRows(pnlResult.rows)[0];
      const totalPnl = toNumber(totalPnlRow?.total_pnl);
      
      // 获取最大单笔盈利和亏损
      const maxWinResult = await dbClient.execute(
        "SELECT MAX(pnl) as max_win FROM trades WHERE type = 'close' AND pnl IS NOT NULL"
      );
      const maxWinRow = asDbRows(maxWinResult.rows)[0];
      const maxWin = toNumber(maxWinRow?.max_win);
      
      const maxLossResult = await dbClient.execute(
        "SELECT MIN(pnl) as max_loss FROM trades WHERE type = 'close' AND pnl IS NOT NULL"
      );
      const maxLossRow = asDbRows(maxLossResult.rows)[0];
      const maxLoss = toNumber(maxLossRow?.max_loss);
      
      return c.json({
        totalTrades,
        winTrades,
        lossTrades: totalTrades - winTrades,
        winRate,
        totalPnl,
        maxWin,
        maxLoss,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "未知错误";
      return c.json({ error: message }, 500);
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
      const okxClient = createOkxClient();
      const contract = `${symbol}_USDT`;
      const candles = await okxClient.getFuturesCandles(contract, interval, limit);

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
   * 获取系统配置信息（返回真实值，前端通过密码框遮掩）
   */
  app.get("/api/config", requireAuth, async (c) => {
    try {
      const { getAllConfig } = await import("../database/init-config");
      const config = await getAllConfig();
      
      return c.json({ config });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "未知错误";
      return c.json({ error: message }, 500);
    }
  });

  app.get("/api/strategy/default-prompts", requireAuth, async (c) => {
    try {
      const requestedStrategy = c.req.query("strategy")?.trim().toLowerCase();
      const validStrategies: TradingStrategy[] = ["conservative", "balanced", "aggressive", "ultra-short", "swing-trend"];
      const fallbackStrategy = getTradingStrategy();
      const strategy: TradingStrategy = requestedStrategy && validStrategies.includes(requestedStrategy as TradingStrategy)
        ? (requestedStrategy as TradingStrategy)
        : fallbackStrategy;

      // Get language parameter (defaults to 'en') and validate
      const { normalizeStrategyLanguage } = await import("../config/strategyTypes");
      const rawLanguage = c.req.query("language")?.trim().toLowerCase();
      const requestedLanguage = normalizeStrategyLanguage(rawLanguage);
      
      const intervalParam = c.req.query("interval")?.trim().toLowerCase();
      const intervalMinutes = (() => {
        if (!intervalParam) {
          return RISK_PARAMS.TRADING_INTERVAL_MINUTES;
        }
        const numericCandidate = intervalParam.endsWith("m") ? intervalParam.slice(0, -1) : intervalParam;
        const parsed = Number.parseInt(numericCandidate, 10);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          return RISK_PARAMS.TRADING_INTERVAL_MINUTES;
        }
        return parsed;
      })();

      const sections = await getStrategyPromptDefaultSections(strategy, intervalMinutes, requestedLanguage);

      return c.json({
        strategy,
        intervalMinutes,
        language: requestedLanguage,
        sections,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "未知错误";
      logger.error("获取默认 Prompt 失败:", error);
      return c.json({ error: message }, 500);
    }
  });

  /**
   * 获取公开的模型配置（无需鉴权，仅返回 AI 模型名）
   */
  app.get("/api/public/model", async (c) => {
    try {
      const { getConfigValue } = await import("../database/init-config");
      const modelName = await getConfigValue("AI_MODEL_NAME");

      return c.json({ aiModelName: modelName || "" });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "未知错误";
      logger.error("获取公开模型配置失败:", error);
      return c.json({ error: message }, 500);
    }
  });

  /**
   * 获取交易循环的公开状态（不需要登录）
   */
  app.get("/api/public/trading-loop-status", async (c) => {
    try {
      const { getTradingLoopState } = await import("../scheduler/tradingLoop");
      const state = getTradingLoopState();
      
      // 只返回是否启用和调度状态，不返回敏感信息
      return c.json({
        enabled: state.enabled,
        scheduled: state.scheduled,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "未知错误";
      logger.error("获取公开交易循环状态失败:", error);
      return c.json({ error: message }, 500);
    }
  });

  /**
   * 获取合约乘数（公开接口，无需登录）
   */
  app.get("/api/public/contract-multipliers", async (c) => {
    try {
      const { getContractMultipliersFromDb } = await import("../scheduler/contractMultiplierSync");
      const multipliers = await getContractMultipliersFromDb();
      
      // 转换为前端需要的格式
      const result: Record<string, number> = {};
      for (const item of multipliers) {
        result[item.symbol] = item.multiplier;
      }
      
      return c.json({
        multipliers: result,
        lastUpdated: multipliers.length > 0 ? multipliers[0].updated_at : null,
        count: multipliers.length,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "未知错误";
      logger.error("获取合约乘数失败:", error);
      return c.json({ error: message }, 500);
    }
  });

  /**
   * 获取用户语言偏好
   */
  app.get("/api/user/language", requireAuth, async (c) => {
    try {
      const { getConfigValue } = await import("../database/init-config");
      const language = await getConfigValue("UI_LANGUAGE");
      
      return c.json({ language: language || "en" });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      logger.error("Failed to get user language preference:", error);
      return c.json({ error: message }, 500);
    }
  });

  /**
   * 设置用户语言偏好
   */
  app.post("/api/user/language", requireAuthWithCsrf, async (c) => {
    try {
      const body = await c.req.json<{ language?: string }>();
      const { normalizeStrategyLanguage } = await import("../config/strategyTypes");
      
      if (!body.language) {
        return c.json({ error: "Language parameter is required" }, 400);
      }
      
      const validatedLanguage = normalizeStrategyLanguage(body.language);
      const { setConfigValue } = await import("../database/init-config");
      
      await setConfigValue("UI_LANGUAGE", validatedLanguage);
      logger.info(`User language preference updated to: ${validatedLanguage}`);
      
      return c.json({ success: true, language: validatedLanguage });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      logger.error("Failed to set user language preference:", error);
      return c.json({ error: message }, 500);
    }
  });

  /**
   * 更新系统配置
   */
  app.put("/api/config", requireAuthWithCsrf, async (c) => {
    try {
      const body = await c.req.json<Record<string, unknown>>();
      const sanitized = sanitizeConfigPayload(body);
      if (!sanitized.ok) {
        return c.json({ error: sanitized.error }, 400);
      }
      const { updateConfig } = await import("../database/init-config");

      await updateConfig(sanitized.data);
      
      return c.json({ success: true, message: "配置已更新" });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "未知错误";
      logger.error("更新配置失败:", error);
      return c.json({ error: message }, 500);
    }
  });

  app.post("/api/reset-live-data", requireAuthWithCsrf, async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as { confirmation?: unknown };
      if (body.confirmation !== "RESET") {
        return c.json({ error: "确认口令无效" }, 400);
      }

      logger.warn("收到重置所有实盘数据请求，开始恢复默认状态...");
      const result = await resetLiveDataToDefaults();

      await reloadRiskParams();
      await initTradingSystem();
      setTradingStartTime(new Date());
      setIterationCount(0);

      return c.json({ success: true, data: result });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "未知错误";
      logger.error("重置实盘数据失败:", error);
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
      
      const okxClient = createOkxClient();
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
   * 测试 OKX API 连接
   */
  app.post("/api/test-okx", requireAuthWithCsrf, async (c) => {
    try {
      const body = await c.req.json<Record<string, unknown>>();
      const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
      const apiSecret = typeof body.apiSecret === "string" ? body.apiSecret.trim() : "";
      const passphrase = typeof body.passphrase === "string" ? body.passphrase.trim() : "";
      const usePaper = body.usePaper === true;
      const proxyUrlRaw = typeof body.proxyUrl === "string" ? body.proxyUrl.trim() : "";
      
      if (!apiKey || !apiSecret || !passphrase) {
        return c.json({ success: false, error: "缺少必需的 API 凭证" }, 400);
      }

      let proxyUrl = "";
      if (proxyUrlRaw) {
        if (!isSafeHttpUrl(proxyUrlRaw, { allowLocal: true })) {
          return c.json({ success: false, error: "代理地址不安全" }, 400);
        }
        proxyUrl = proxyUrlRaw;
      }
      
      // 创建临时客户端实例（不影响全局实例）
      const OkxClient = (await import("../services/okxClient")).OkxClient;
      const testClient = new OkxClient(
        apiKey,
        apiSecret,
        passphrase,
        usePaper === true,
        proxyUrl || undefined
      );
      
      // 尝试获取账户信息
      const account = await testClient.getFuturesAccount();
      
      return c.json({
        success: true,
        balance: account.total || "0",
        message: "API 连接成功"
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "未知错误";
      logger.error("测试 OKX API 失败:", error);
      
      // 返回友好的错误信息
      let errorMsg = message;
      if (message.includes("401") || message.includes("Unauthorized")) {
        errorMsg = "API 密钥无效或权限不足";
      } else if (message.includes("403") || message.includes("Forbidden")) {
        errorMsg = "IP 地址未加入白名单";
      } else if (message.includes("timeout") || message.includes("ETIMEDOUT")) {
        errorMsg = "连接超时，请检查网络或代理设置";
      } else if (message.includes("ECONNREFUSED")) {
        errorMsg = "连接被拒绝，请检查代理设置";
      }
      
      return c.json({ success: false, error: errorMsg }, 500);
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

  return app;
}


