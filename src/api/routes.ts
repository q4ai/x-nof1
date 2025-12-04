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

import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isIP } from "node:net";
import { serveStatic } from "@hono/node-server/serve-static";
import { createClient } from "@libsql/client";
/**
 * API 路由
 */
import { Hono } from "hono";
import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { getStrategyPromptDefaultSections } from "../agents/tradingAgent";
import { getExchangeProxy } from "../config/exchange";
import { RISK_PARAMS, reloadRiskParams } from "../config/riskParams.new";
import type { TradingStrategy } from "../config/strategyTypes";
import { summarizeAgentResponseText } from "../database/agent-request-logs";
import { resetLiveDataToDefaults } from "../database/reset-live-data";
import { initTradingSystem } from "../scheduler/tradingSystemInit";
import {
	getAccountById,
	getActiveAccount,
} from "../services/accountConfigService";
import { BinanceClient } from "../services/binanceClient";
import { BitgetClient } from "../services/bitgetClient";
import { dashboardBroadcaster } from "../services/dashboardBroadcaster";
import { installSystem, isSystemInstalled } from "../services/installService";
import {
	OkxClient,
	createExchangeClientFromActiveAccount,
	createOkxClient,
} from "../services/okxClient";
import { GateClient } from "../services/gateClient";
import { websocketService } from "../services/websocketService";
import { executeClosePosition, executeOpenPosition } from "../tools/trading";
import type { AdminAuthConfig } from "../utils/adminAuth";
import { totalIncludesUnrealisedPnl } from "../utils/accountBalanceUtils";
import { getQuantoMultiplier } from "../utils/contractUtils";
import { createLogger } from "../utils/loggerUtils";
import { getChinaTimeISO } from "../utils/timeUtils";

const logger = createLogger({
	name: "api-routes",
	level: "info",
});

const dbClient = createClient({
	url: process.env.DATABASE_URL || "file:./data/database/sqlite.db",
});

type DbRow = Record<string, unknown>;

const AVAILABLE_LANGUAGE_CODES = new Set(["en", "zh", "ja"]);
const LANGUAGE_DIR_CANDIDATES = [
	new URL("../language/", import.meta.url),
	new URL("../../src/language/", import.meta.url),
];

const CSRF_HEADER = "x-csrf-token";

const DISALLOWED_HOSTNAMES = new Set([
	"localhost",
	"127.0.0.1",
	"::1",
	"0.0.0.0",
]);

// 允许本地访问的白名单
const ALLOWED_LOCAL_HOSTS = new Set([
	"localhost",
	"127.0.0.1",
	"::1",
	"0.0.0.0",
]);

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

const CONFIG_BOOLEAN_KEYS = new Set([
	"OKX_USE_PAPER",
	"BINANCE_USE_TESTNET",
	"COMMUNITY_REPORT_ENABLED",
	"COMMUNITY_SHARE_PROMPTS",
]);

const CONFIG_ENUM_VALUES: Record<string, string[]> = {
	PROMPT_LANGUAGE: ["zh", "en", "ja"],
	TRADING_MARGIN_MODE: ["cross", "isolated"],
	EXCHANGE_PROVIDER: ["okx", "binance", "bitget"],
};

const CONFIG_ALLOWED_KEYS = new Set([
	"TRADING_SYMBOLS",
	"TRADING_MARGIN_MODE",
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
	const parts = hostname
		.split(".")
		.map((segment) => Number.parseInt(segment, 10));
	if (
		parts.length !== 4 ||
		parts.some(
			(segment) => Number.isNaN(segment) || segment < 0 || segment > 255,
		)
	) {
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

function isSafeHttpUrl(
	value: string,
	options: { allowLocal?: boolean } = {},
): boolean {
	const { allowLocal = false } = options;
	try {
		const url = new URL(value);
		const protocol = url.protocol.toLowerCase();
		if (protocol !== "http:" && protocol !== "https:") {
			return false;
		}
		const hostname = url.hostname.toLowerCase();
		const ipType = isIP(hostname);
		const isLoopback =
			hostname === "localhost" ||
			hostname === "::1" ||
			hostname.startsWith("127.");

		if (!hostname) {
			return false;
		}

		if (url.username || url.password) {
			return false;
		}

		if (!allowLocal) {
			// 如果明确禁止本地访问，则检查黑名单
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
		} else {
			// 如果允许本地访问，则放行 localhost 等
			if (ALLOWED_LOCAL_HOSTS.has(hostname) || hostname.startsWith("127.")) {
				return true;
			}
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

function sanitizeConfigPayload(
	raw: Record<string, unknown>,
): { ok: true; data: Record<string, string> } | { ok: false; error: string } {
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
			const numericValue =
				typeof value === "number" ? value : Number.parseFloat(String(value));
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
	provider: "okx" | "binance" | "bitget" | "gate";
	apiKey: string;
	apiSecret: string;
	apiPassphrase?: string;
	usePaper?: boolean;
	proxyUrl?: string;
};

type AccountConnectionTestResult =
	| {
			success: true;
			provider: "OKX" | "Binance" | "Bitget" | "Gate.io";
			mode: string;
			balance: string;
	  }
	| { success: false; error: string };

function normalizeProxyUrl(
	raw: string | undefined,
): { ok: true; value: string } | { ok: false; error: string } {
	const trimmed = (raw || "").trim();
	if (!trimmed) {
		return { ok: true, value: "" };
	}
	if (!isSafeHttpUrl(trimmed, { allowLocal: true })) {
		return { ok: false, error: "代理地址不安全" };
	}
	return { ok: true, value: trimmed };
}

async function performExchangeConnectionTest(
	payload: ExchangeTestPayload,
): Promise<ExchangeTestResult> {
	const exchange = (payload.exchange || "okx").toLowerCase();
	const proxyCheck = normalizeProxyUrl(
		typeof payload.proxyUrl === "string" ? payload.proxyUrl : undefined,
	);
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
			const client = new BinanceClient(
				apiKey,
				apiSecret,
				payload.testnet === true,
				proxyUrl,
			);
			const account = await client.getFuturesAccount();
			return {
				success: true,
				exchange: "binance",
				balance: account.total || "0",
			};
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
			const client = new BitgetClient(
				apiKey,
				apiSecret,
				passphrase,
				payload.testnet === true,
				proxyUrl,
			);
			const account = await client.getFuturesAccount();
			return {
				success: true,
				exchange: "bitget",
				balance: account.total || "0",
			};
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
		const client = new OkxClient(
			apiKey,
			apiSecret,
			passphrase,
			payload.usePaper === true,
			proxyUrl,
		);
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

async function runAccountConnectionTest(
	options: AccountConnectionTestOptions,
): Promise<AccountConnectionTestResult> {
	let proxyUrl = options.proxyUrl;

	// 如果没有提供代理，尝试从系统配置获取
	if (!proxyUrl) {
		const systemProxy = await getSystemConfigString("HTTP_PROXY_URL");
		if (systemProxy) {
			proxyUrl = systemProxy;
		}
	}

	const proxyCheck = normalizeProxyUrl(proxyUrl);
	if (!proxyCheck.ok) {
		return { success: false, error: proxyCheck.error };
	}

	// 安装阶段直接使用用户传入的代理（如果有），不读取系统配置
	const effectiveProxy = proxyCheck.value ? proxyCheck.value : undefined;

	try {
		if (options.provider === "binance") {
			const client = new BinanceClient(
				options.apiKey,
				options.apiSecret,
				options.usePaper === true,
				effectiveProxy,
			);
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
			const client = new BitgetClient(
				options.apiKey,
				options.apiSecret,
				options.apiPassphrase,
				options.usePaper === true,
				effectiveProxy,
			);
			const account = await client.getFuturesAccount();
			return {
				success: true,
				provider: "Bitget",
				mode: options.usePaper ? "模拟盘" : "实盘",
				balance: account.total || "0",
			};
		}

		if (options.provider === "gate") {
			const { GateClient } = await import("../services/gateClient");
			const client = new GateClient(
				options.apiKey,
				options.apiSecret,
				options.usePaper === true,
				effectiveProxy,
			);
			const account = await client.getFuturesAccount();
			return {
				success: true,
				provider: "Gate.io",
				mode: options.usePaper ? "测试网" : "主网",
				balance: account.total || "0",
			};
		}

		if (!options.apiPassphrase) {
			return { success: false, error: "OKX 账户需要 API Passphrase" };
		}

		const testClient = new OkxClient(
			options.apiKey,
			options.apiSecret,
			options.apiPassphrase,
			options.usePaper === true,
			effectiveProxy,
		);
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
	return rows.filter(
		(row): row is DbRow => Boolean(row) && typeof row === "object",
	);
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

async function recordActiveAccountSnapshot(
	snapshotTimestamp: string,
): Promise<void> {
	try {
		// 获取当前活跃账户配置，确保使用正确的账户客户端和ID
		const { getActiveAccount, getAccountById } = await import(
			"../services/accountConfigService"
		);
		const { createExchangeClientForAccount } = await import(
			"../services/okxClient"
		);
		const activeAccount = await getActiveAccount();

		if (!activeAccount) {
			logger.warn("记录账户切换快照时未找到活跃账户，已跳过");
			return;
		}

		const client = createExchangeClientForAccount(activeAccount);
		const account = await client.getFuturesAccount();

		const accountTotal = Number.parseFloat(account.total || "0");
		const availableBalance = Number.parseFloat(account.available || "0");
		const unrealisedPnl = Number.parseFloat(account.unrealisedPnl || "0");
		const totalIncludesUnrealised = totalIncludesUnrealisedPnl(
			activeAccount.provider,
		);
		const totalBalance = totalIncludesUnrealised
			? accountTotal
			: accountTotal + unrealisedPnl;

		await dbClient.execute({
			sql: `INSERT INTO account_history (timestamp, total_value, available_cash, unrealized_pnl, realized_pnl, return_percent, account_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
			args: [
				snapshotTimestamp,
				totalBalance,
				availableBalance,
				unrealisedPnl,
				0,
				0,
				activeAccount.id,
			],
		});

		logger.info(`已记录账户 ${activeAccount.id} 的切换快照，用于刷新统计数据`);
	} catch (error) {
		logger.error("记录账户切换快照失败:", error);
	}
}

async function loadLanguageResource(
	lang: string,
): Promise<Record<string, unknown>> {
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

	const INSTALL_ALLOWED_EXACT_PATHS = new Set([
		"/monitor-styles.css",
		"/csrf.js",
		"/favicon.ico",
	]);
	const INSTALL_ALLOWED_PREFIXES = [
		"/install",
		"/api/install",
		"/api/accounts/test",
		"/static/",
	];

	app.use("*", async (c, next) => {
		if (isSystemInstalled()) {
			return next();
		}

		const path = c.req.path;
		const isAllowedExact = INSTALL_ALLOWED_EXACT_PATHS.has(path);
		const isAllowedPrefix = INSTALL_ALLOWED_PREFIXES.some((prefix) =>
			path.startsWith(prefix),
		);

		if (isAllowedExact || isAllowedPrefix) {
			return next();
		}

		if (c.req.method === "GET") {
			return c.redirect("/install");
		}

		return c.json({ error: "System is not installed yet" }, 503);
	});

	app.get("/install", async (c) => {
		if (isSystemInstalled()) {
			return c.redirect("/");
		}
		const html = await loadInstallTemplate();
		return c.html(html);
	});

	app.post("/api/install", async (c) => {
		if (isSystemInstalled()) {
			return c.json({ error: "System is already installed" }, 400);
		}
		try {
			const payload = await c.req.json();
			await installSystem(payload);
			return c.json({ success: true });
		} catch (error: unknown) {
			logger.error("安装失败:", error);
			const message = error instanceof Error ? error.message : "未知错误";
			return c.json({ error: message }, 500);
		}
	});

	// Session 内存缓存（提升性能，避免每次请求都查数据库）
	const sessionCache = new Map<string, SessionRecord>();
	const SESSION_COOKIE = "q4ai_session";
	const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12小时会话

	const loginTemplatePath = new URL("../../public/login.html", import.meta.url);
	let cachedLoginTemplate: string | null = null;
	const installTemplatePath = new URL(
		"../../public/install.html",
		import.meta.url,
	);
	let cachedInstallTemplate: string | null = null;

	const loadLoginTemplate = async () => {
		if (cachedLoginTemplate) {
			return cachedLoginTemplate;
		}
		cachedLoginTemplate = await readFile(loginTemplatePath, "utf-8");
		return cachedLoginTemplate;
	};

	const loadInstallTemplate = async () => {
		if (cachedInstallTemplate) {
			return cachedInstallTemplate;
		}
		cachedInstallTemplate = await readFile(installTemplatePath, "utf-8");
		return cachedInstallTemplate;
	};

	// 从数据库加载 session
	const loadSessionFromDb = async (
		sessionId: string,
	): Promise<SessionRecord | null> => {
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
				args: [
					session.id,
					session.username,
					session.csrfToken,
					session.expiresAt,
					now,
					now,
				],
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

	const refreshSession = async (
		session: SessionRecord,
	): Promise<SessionRecord> => {
		session.expiresAt = Date.now() + SESSION_TTL_MS;
		sessionCache.set(session.id, session);
		await saveSessionToDb(session);
		return session;
	};

	const getSessionFromRequest = async (
		c: Context<ApiEnv>,
	): Promise<SessionRecord | null> => {
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

	const attachSessionCookie = async (
		c: Context<ApiEnv>,
		session: SessionRecord,
	) => {
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

			// 验证用户名
			if (body.username !== adminAuth.username) {
				return c.json({ success: false, error: "用户名或密码错误" }, 401);
			}

			// 验证密码：支持明文密码（旧版本兼容）和哈希密码（新版本）
			let passwordMatch = false;
			if (body.password === adminAuth.password) {
				// 明文匹配（旧版本 .q4ai 文件）
				passwordMatch = true;
			} else {
				// 哈希匹配（新版本数据库）
				const crypto = await import("node:crypto");
				const inputHash = crypto
					.createHash("sha256")
					.update(body.password || "")
					.digest("hex");
				passwordMatch = inputHash === adminAuth.password;
			}

			if (!passwordMatch) {
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
		return c.json({
			authenticated: true,
			username: session.username,
			csrfToken: session.csrfToken,
		});
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
	cleanupExpiredSessions().catch((error) =>
		logger.error("初始清理 session 失败:", error),
	);

	app.get("/api/public-config", async (c) => {
		try {
			const { getAllConfig } = await import("../database/init-config");
			const config = await getAllConfig();

			// 优先使用当前活跃账户的任务模型名称（使用 model_name 而非 ai_model_name，因为前者是真正的 API 模型名称）
			let aiModelName = config.AI_MODEL_NAME ?? "";
			try {
				const { getActiveAccount } = await import(
					"../services/accountConfigService"
				);
				const { getRunningInstances, getLatestInstanceForAccount } =
					await import("../services/tradingInstanceService");

				const activeAccount = await getActiveAccount();
				if (activeAccount) {
					const runningInstances = await getRunningInstances();
					const accountInstance = runningInstances.find(
						(instance) => instance.account_id === activeAccount.id,
					);

					// 优先使用 model_name（真正的 API 模型名），如果没有则回退到 ai_model_name（用户自定义标题）
					if (accountInstance?.model_name) {
						aiModelName = accountInstance.model_name;
					} else if (accountInstance?.ai_model_name) {
						aiModelName = accountInstance.ai_model_name;
					} else {
						const latestInstance = await getLatestInstanceForAccount(
							activeAccount.id,
						);
						if (latestInstance?.model_name) {
							aiModelName = latestInstance.model_name;
						} else if (latestInstance?.ai_model_name) {
							aiModelName = latestInstance.ai_model_name;
						}
					}
				}
			} catch (instanceError) {
				logger.warn("获取账户任务模型失败，使用全局配置:", instanceError);
			}

			return c.json({
				config: {
					TRADING_SYMBOLS: config.TRADING_SYMBOLS ?? "",
					AI_MODEL_NAME: aiModelName,
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
			const { getAllAccounts } = await import(
				"../services/accountConfigService"
			);
			const accounts = await getAllAccounts();

			// 隐藏敏感信息
			const safeAccounts = accounts.map((acc) => ({
				id: acc.id,
				name: acc.name,
				provider: acc.provider,
				use_paper: acc.use_paper,
				is_active: acc.is_active,
				created_at: acc.created_at,
				updated_at: acc.updated_at,
				// 部分隐藏 API Key
				api_key_preview: acc.api_key
					? `${acc.api_key.substring(0, 8)}...${acc.api_key.substring(acc.api_key.length - 4)}`
					: "",
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
			const { getActiveAccount } = await import(
				"../services/accountConfigService"
			);
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
				api_key_preview: account.api_key
					? `${account.api_key.substring(0, 8)}...${account.api_key.substring(account.api_key.length - 4)}`
					: "",
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
			const {
				name,
				provider,
				api_key,
				api_secret,
				api_passphrase,
				use_paper,
				proxy_url,
				stop_loss_usdt,
				take_profit_usdt,
			} = body;

			if (!name || !provider || !api_key || !api_secret) {
				return c.json({ error: "缺少必需参数" }, 400);
			}

			if (!["okx", "binance", "bitget", "gate"].includes(provider)) {
				return c.json({ error: "不支持的交易所" }, 400);
			}

			const { createAccount, getActiveAccount } = await import(
				"../services/accountConfigService"
			);
			const account = await createAccount({
				name: String(name),
				provider: provider as "okx" | "binance" | "bitget" | "gate",
				api_key: String(api_key),
				api_secret: String(api_secret),
				api_passphrase: api_passphrase ? String(api_passphrase) : undefined,
				use_paper: Boolean(use_paper),
				proxy_url: proxy_url ? String(proxy_url) : undefined,
				stop_loss_usdt: stop_loss_usdt ? Number(stop_loss_usdt) : undefined,
				take_profit_usdt: take_profit_usdt
					? Number(take_profit_usdt)
					: undefined,
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
							args: [
								total.toString(),
								new Date().toISOString(),
								total.toString(),
								new Date().toISOString(),
							],
						});
						logger.info(
							`[Auto-Config] 自动设置初始本金为: ${total} (Account: ${account.name})`,
						);
					}
				} catch (err) {
					logger.warn(
						`[Auto-Config] 无法自动获取初始本金: ${err instanceof Error ? err.message : String(err)}`,
					);
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
				},
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
			const {
				name,
				provider,
				api_key,
				api_secret,
				api_passphrase,
				use_paper,
				proxy_url,
				stop_loss_usdt,
				take_profit_usdt,
			} = body;

			const { updateAccount } = await import(
				"../services/accountConfigService"
			);
			const account = await updateAccount(id, {
				name: name !== undefined ? String(name) : undefined,
				provider:
					provider !== undefined
						? (provider as "okx" | "binance" | "bitget")
						: undefined,
				api_key: api_key !== undefined ? String(api_key) : undefined,
				api_secret: api_secret !== undefined ? String(api_secret) : undefined,
				api_passphrase:
					api_passphrase !== undefined ? String(api_passphrase) : undefined,
				use_paper: use_paper !== undefined ? Boolean(use_paper) : undefined,
				proxy_url: proxy_url !== undefined ? String(proxy_url) : undefined,
				stop_loss_usdt:
					stop_loss_usdt !== undefined
						? stop_loss_usdt === "" || stop_loss_usdt === null
							? 0
							: Number(stop_loss_usdt)
						: undefined,
				take_profit_usdt:
					take_profit_usdt !== undefined
						? take_profit_usdt === "" || take_profit_usdt === null
							? 0
							: Number(take_profit_usdt)
						: undefined,
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
				},
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

			const { deleteAccount } = await import(
				"../services/accountConfigService"
			);
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

			const { setActiveAccount } = await import(
				"../services/accountConfigService"
			);
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
			const { resetOkxClient, initExchangeClient } = await import(
				"../services/okxClient"
			);
			resetOkxClient();
			await initExchangeClient();
			await recordActiveAccountSnapshot(switchTimestamp);

			// 重新加载风险参数，Strategy Tasks 会在下一次调度时自动应用
			logger.info("正在重新加载风险参数以应用新账户...");
			await reloadRiskParams();

			// 切换账户后，自动更新 INITIAL_BALANCE
			try {
				const client = await createExchangeClientFromActiveAccount();
				const balance = await client.getFuturesAccount();
				const total = Number.parseFloat(balance.total || "0");
				if (Number.isFinite(total) && total > 0) {
					await dbClient.execute({
						sql: "INSERT INTO system_config (key, value, updated_at) VALUES ('INITIAL_BALANCE', ?, ?) ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?",
						args: [
							total.toString(),
							new Date().toISOString(),
							total.toString(),
							new Date().toISOString(),
						],
					});
					logger.info(`[Auto-Config] 切换账户后自动更新初始本金为: ${total}`);
				}
			} catch (err) {
				logger.warn(
					`[Auto-Config] 切换账户后无法自动更新初始本金: ${err instanceof Error ? err.message : String(err)}`,
				);
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
				message: "账户已切换，交易系统已重载",
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
	app.post("/api/accounts/test", async (c) => {
		// 已安装系统需要认证
		if (isSystemInstalled()) {
			const session = await getSessionFromRequest(c);
			if (!session) {
				return c.json({ error: "未登录" }, 401);
			}
		}
		// 安装阶段允许测试，用于验证用户输入的凭证

		try {
			const body = await c.req.json();
			const {
				provider,
				api_key,
				api_secret,
				api_passphrase,
				use_paper,
				proxy_url,
			} = body;

			if (!provider || !api_key || !api_secret) {
				return c.json({ error: "缺少必需参数" }, 400);
			}

			if (!["okx", "binance", "bitget", "gate"].includes(provider)) {
				return c.json({ error: "不支持的交易所" }, 400);
			}

			const result = await runAccountConnectionTest({
				provider: provider as "okx" | "binance" | "bitget" | "gate",
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
			return c.json(
				{
					success: false,
					error: message,
				},
				400,
			);
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

			const { getAccountById } = await import(
				"../services/accountConfigService"
			);
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

	// ========== AI 模型管理 API ==========

	/**
	 * 获取所有 AI 模型配置
	 */
	app.get("/api/ai-models", requireAuth, async (c) => {
		try {
			const { getAllAiModels } = await import("../services/aiModelService");
			const models = await getAllAiModels();

			// 隐藏敏感信息
			const safeModels = models.map((model) => ({
				id: model.id,
				name: model.name,
				base_url: model.base_url,
				model_name: model.model_name,
				is_active: model.is_active,
				created_at: model.created_at,
				updated_at: model.updated_at,
				// 部分隐藏 API Key
				api_key_preview: model.api_key
					? `${model.api_key.substring(0, 8)}...${model.api_key.substring(model.api_key.length - 4)}`
					: "",
			}));

			return c.json({ models: safeModels });
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "未知错误";
			logger.error("获取 AI 模型列表失败:", error);
			return c.json({ error: message }, 500);
		}
	});

	/**
	 * 获取当前激活的 AI 模型
	 */
	app.get("/api/ai-models/active", requireAuth, async (c) => {
		try {
			const { getActiveAiModel } = await import("../services/aiModelService");
			const model = await getActiveAiModel();

			if (!model) {
				return c.json({ model: null });
			}

			// 隐藏敏感信息
			const safeModel = {
				id: model.id,
				name: model.name,
				base_url: model.base_url,
				model_name: model.model_name,
				is_active: model.is_active,
				created_at: model.created_at,
				updated_at: model.updated_at,
				api_key_preview: model.api_key
					? `${model.api_key.substring(0, 8)}...${model.api_key.substring(model.api_key.length - 4)}`
					: "",
			};

			return c.json({ model: safeModel });
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "未知错误";
			logger.error("获取当前 AI 模型失败:", error);
			return c.json({ error: message }, 500);
		}
	});

	/**
	 * 获取单个 AI 模型的完整信息（包括完整 API Key，用于编辑）
	 */
	app.get("/api/ai-models/:id", requireAuth, async (c) => {
		try {
			const id = Number(c.req.param("id"));
			if (!Number.isFinite(id) || id <= 0) {
				return c.json({ error: "无效的模型ID" }, 400);
			}

			const { getAiModelById } = await import("../services/aiModelService");
			const model = await getAiModelById(id);

			if (!model) {
				return c.json({ error: "模型不存在" }, 404);
			}

			// 返回完整信息（包括完整 API Key）供编辑使用
			return c.json({ model });
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "未知错误";
			logger.error(`获取 AI 模型详情失败 (ID: ${c.req.param("id")}):`, error);
			return c.json({ error: message }, 500);
		}
	});

	/**
	 * 创建新的 AI 模型配置
	 */
	app.post("/api/ai-models", requireAuthWithCsrf, async (c) => {
		try {
			const body = await c.req.json();
			const { name, api_key, base_url, model_name } = body;

			if (!name || !api_key || !base_url || !model_name) {
				return c.json({ error: "缺少必需参数" }, 400);
			}

			// 清理 Base URL
			let cleanBaseUrl = String(base_url).trim();
			cleanBaseUrl = cleanBaseUrl
				.replace(/\/chat\/completions\/?$/, "")
				.replace(/\/$/, "");

			const { createAiModel } = await import("../services/aiModelService");
			const model = await createAiModel({
				name: String(name),
				api_key: String(api_key),
				base_url: cleanBaseUrl,
				model_name: String(model_name),
			});

			logger.info(`创建 AI 模型成功: ${model.name} (ID: ${model.id})`);

			return c.json({
				success: true,
				model: {
					id: model.id,
					name: model.name,
					base_url: model.base_url,
					model_name: model.model_name,
					is_active: model.is_active,
					created_at: model.created_at,
				},
			});
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "未知错误";
			logger.error("创建 AI 模型失败:", error);
			return c.json({ error: message }, 500);
		}
	});

	/**
	 * 更新 AI 模型配置
	 */
	app.put("/api/ai-models/:id", requireAuthWithCsrf, async (c) => {
		try {
			const id = Number(c.req.param("id"));
			if (!Number.isFinite(id) || id <= 0) {
				return c.json({ error: "无效的模型ID" }, 400);
			}

			const body = await c.req.json();
			const { name, api_key, base_url, model_name } = body;

			let cleanBaseUrl = base_url;
			if (base_url !== undefined) {
				cleanBaseUrl = String(base_url).trim();
				cleanBaseUrl = cleanBaseUrl
					.replace(/\/chat\/completions\/?$/, "")
					.replace(/\/$/, "");
			}

			const { updateAiModel } = await import("../services/aiModelService");
			const model = await updateAiModel(id, {
				name: name !== undefined ? String(name) : undefined,
				api_key: api_key !== undefined ? String(api_key) : undefined,
				base_url: cleanBaseUrl,
				model_name: model_name !== undefined ? String(model_name) : undefined,
			});

			logger.info(`更新 AI 模型成功: ${model.name} (ID: ${model.id})`);

			return c.json({
				success: true,
				model: {
					id: model.id,
					name: model.name,
					base_url: model.base_url,
					model_name: model.model_name,
					is_active: model.is_active,
					updated_at: model.updated_at,
				},
			});
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "未知错误";
			logger.error("更新 AI 模型失败:", error);
			return c.json({ error: message }, 500);
		}
	});

	/**
	 * 删除 AI 模型配置
	 */
	app.delete("/api/ai-models/:id", requireAuthWithCsrf, async (c) => {
		try {
			const id = Number(c.req.param("id"));
			if (!Number.isFinite(id) || id <= 0) {
				return c.json({ error: "无效的模型ID" }, 400);
			}

			const { deleteAiModel } = await import("../services/aiModelService");
			await deleteAiModel(id);

			logger.info(`删除 AI 模型成功: ID ${id}`);

			return c.json({ success: true });
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "未知错误";
			logger.error("删除 AI 模型失败:", error);
			return c.json({ error: message }, 500);
		}
	});

	/**
	 * 激活指定的 AI 模型
	 */
	app.post("/api/ai-models/:id/activate", requireAuthWithCsrf, async (c) => {
		try {
			const id = Number(c.req.param("id"));
			if (!Number.isFinite(id) || id <= 0) {
				return c.json({ error: "无效的模型ID" }, 400);
			}

			const { setActiveAiModel } = await import("../services/aiModelService");
			const model = await setActiveAiModel(id);

			logger.info(`激活 AI 模型成功: ${model.name} (ID: ${model.id})`);

			// 重新加载风险参数，Strategy Tasks 会自动在下一轮执行使用新模型
			logger.info("正在重新加载风险参数以应用新的 AI 模型...");
			await reloadRiskParams();

			return c.json({
				success: true,
				model: {
					id: model.id,
					name: model.name,
					base_url: model.base_url,
					model_name: model.model_name,
					is_active: model.is_active,
				},
			});
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "未知错误";
			logger.error("激活 AI 模型失败:", error);
			return c.json({ error: message }, 500);
		}
	});

	/**
	 * 测试 AI 模型连接
	 */
	app.post("/api/ai-models/test", requireAuthWithCsrf, async (c) => {
		try {
			const body = await c.req.json();
			const { api_key, base_url, model_name } = body;

			if (!api_key || !base_url || !model_name) {
				return c.json({ error: "缺少必需参数" }, 400);
			}

			// 清理 Base URL (移除末尾的 /chat/completions 和 /)
			let cleanBaseUrl = String(base_url).trim();
			cleanBaseUrl = cleanBaseUrl
				.replace(/\/chat\/completions\/?$/, "")
				.replace(/\/$/, "");

			// 使用 AI SDK 测试连接
			const { createOpenAI } = await import("@ai-sdk/openai");
			const { generateText } = await import("ai");

			const openai = createOpenAI({
				apiKey: String(api_key),
				baseURL: cleanBaseUrl,
			} as any);

			const startTime = Date.now();
			const result = await generateText({
				model: openai.chat(String(model_name)),
				prompt: "Hello",
			});
			const duration = Date.now() - startTime;

			logger.info(`AI 模型连接测试成功，耗时 ${duration}ms`);

			return c.json({
				success: true,
				message: "连接测试成功",
				response: result.text,
				duration: `${duration}ms`,
			});
		} catch (error: unknown) {
			let message = "未知错误";

			if (error instanceof Error) {
				message = error.message;
				// 如果是AI SDK错误，尝试提取更详细的信息
				if ("cause" in error && error.cause) {
					const cause = error.cause as any;
					if (cause.message) {
						message = `${message}: ${cause.message}`;
					}
				}
			}

			logger.error("AI 模型连接测试失败:", { error, message });
			return c.json({ success: false, error: message });
		}
	});

	/**
	 * 测试指定 ID 的 AI 模型连接
	 */
	app.post("/api/ai-models/:id/test", requireAuthWithCsrf, async (c) => {
		try {
			const id = Number(c.req.param("id"));
			if (!Number.isFinite(id) || id <= 0) {
				return c.json({ error: "无效的模型ID" }, 400);
			}

			const { getAiModelById } = await import("../services/aiModelService");
			const model = await getAiModelById(id);
			if (!model) {
				return c.json({ error: "模型不存在" }, 404);
			}

			if (!model.api_key || !model.base_url || !model.model_name) {
				return c.json({ error: "模型配置不完整" }, 400);
			}

			// 使用 AI SDK 测试连接
			const { createOpenAI } = await import("@ai-sdk/openai");
			const { generateText } = await import("ai");

			// 清理 Base URL
			let cleanBaseUrl = model.base_url.trim();
			cleanBaseUrl = cleanBaseUrl
				.replace(/\/chat\/completions\/?$/, "")
				.replace(/\/$/, "");

			const openai = createOpenAI({
				apiKey: model.api_key,
				baseURL: cleanBaseUrl,
			} as any);

			const startTime = Date.now();
			const result = await generateText({
				model: openai.chat(model.model_name),
				prompt: "Hello",
			});
			const duration = Date.now() - startTime;

			logger.info(`AI 模型(${model.name})连接测试成功，耗时 ${duration}ms`);

			return c.json({
				success: true,
				message: "连接测试成功",
				response: result.text,
				duration: `${duration}ms`,
			});
		} catch (error: unknown) {
			let message = "未知错误";

			if (error instanceof Error) {
				message = error.message;
				// 如果是AI SDK错误，尝试提取更详细的信息
				if ("cause" in error && error.cause) {
					const cause = error.cause as any;
					if (cause.message) {
						message = `${message}: ${cause.message}`;
					}
				}
			}

			logger.error("AI 模型连接测试失败:", { error, message });
			return c.json({ success: false, error: message });
		}
	});

	// ========== 数据备份 API ==========

	/**
	 * 获取备份列表
	 */
	app.get("/api/backups", requireAuth, async (c) => {
		try {
			const { listBackups } = await import("../services/backupService");
			const backups = await listBackups();
			return c.json({ backups });
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "未知错误";
			logger.error("获取备份列表失败:", error);
			return c.json({ error: message }, 500);
		}
	});

	/**
	 * 创建新备份
	 */
	app.post("/api/backups", requireAuthWithCsrf, async (c) => {
		try {
			const { createBackup } = await import("../services/backupService");
			const backup = await createBackup();
			logger.info(`创建备份成功: ${backup.name}`);
			return c.json({ backup });
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "未知错误";
			logger.error("创建备份失败:", error);
			return c.json({ error: message }, 500);
		}
	});

	/**
	 * 恢复备份
	 */
	app.post("/api/backups/:name/restore", requireAuthWithCsrf, async (c) => {
		try {
			const name = c.req.param("name");
			if (!name) {
				return c.json({ error: "缺少备份名称" }, 400);
			}

			const { restoreBackup } = await import("../services/backupService");
			await restoreBackup(name);

			logger.info(`恢复备份成功: ${name}，需要重启服务以应用更改`);

			return c.json({
				success: true,
				message: "备份恢复成功，请重启服务以应用更改",
			});
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "未知错误";
			logger.error("恢复备份失败:", error);
			return c.json({ error: message }, 500);
		}
	});

	/**
	 * 删除备份
	 */
	app.delete("/api/backups/:name", requireAuthWithCsrf, async (c) => {
		try {
			const name = c.req.param("name");
			if (!name) {
				return c.json({ error: "缺少备份名称" }, 400);
			}

			const { deleteBackup } = await import("../services/backupService");
			await deleteBackup(name);

			logger.info(`删除备份成功: ${name}`);

			return c.json({ success: true });
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "未知错误";
			logger.error("删除备份失败:", error);
			return c.json({ error: message }, 500);
		}
	});

	/**
	 * 下载备份文件
	 */
	app.get("/api/backups/:name/download", requireAuth, async (c) => {
		try {
			const name = c.req.param("name");
			if (!name) {
				return c.json({ error: "缺少备份名称" }, 400);
			}

			const { getBackupPath } = await import("../services/backupService");
			const { existsSync, createReadStream, statSync } = await import(
				"node:fs"
			);
			const backupPath = await getBackupPath(name);

			if (!existsSync(backupPath)) {
				return c.json({ error: "备份文件不存在" }, 404);
			}

			const stat = statSync(backupPath);
			const stream = createReadStream(backupPath);

			// 设置响应头
			c.header("Content-Type", "application/octet-stream");
			c.header("Content-Disposition", `attachment; filename="${name}"`);
			c.header("Content-Length", String(stat.size));

			// 返回流
			return new Response(stream as any, {
				headers: {
					"Content-Type": "application/octet-stream",
					"Content-Disposition": `attachment; filename="${name}"`,
					"Content-Length": String(stat.size),
				},
			});
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "未知错误";
			logger.error("下载备份失败:", error);
			return c.json({ error: message }, 500);
		}
	});

	/**
	 * 导入备份文件
	 */
	app.post("/api/backups/import", requireAuthWithCsrf, async (c) => {
		try {
			const formData = await c.req.formData();
			const file = formData.get("file") as File | null;

			if (!file) {
				return c.json({ error: "未提供备份文件" }, 400);
			}

			// 验证文件类型 (支持 zip 新格式和 db 旧格式)
			const fileName = file.name;
			if (
				!fileName.endsWith(".zip") &&
				!fileName.endsWith(".db") &&
				!fileName.endsWith(".sqlite") &&
				!fileName.endsWith(".backup")
			) {
				return c.json(
					{ error: "无效的备份文件格式，支持 .zip, .db, .sqlite, .backup" },
					400,
				);
			}

			const { importBackup } = await import("../services/backupService");
			const backup = await importBackup(file);

			logger.info(`导入备份成功: ${backup.name}`);

			return c.json({ backup });
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "未知错误";
			logger.error("导入备份失败:", error);
			return c.json({ error: message }, 500);
		}
	});

	// ========== Strategy Tasks 管理 API ==========

	/**
	 * 获取所有 Strategy Tasks（包含策略交易币种）
	 * 可选参数 ?accountId=xxx 过滤特定账户的任务
	 */
	app.get("/api/trading-instances", requireAuth, async (c) => {
		try {
			const { getAllTradingInstances } = await import(
				"../services/tradingInstanceService"
			);
			const { StrategyFileManager } = await import(
				"../services/strategyFileManager"
			);

			const accountIdParam = c.req.query("accountId");
			const accountId = accountIdParam ? Number(accountIdParam) : undefined;

			let instances = await getAllTradingInstances();

			// 如果指定了账户ID，过滤任务
			if (accountId && Number.isFinite(accountId)) {
				instances = instances.filter((inst) => inst.account_id === accountId);
			}

			// 为每个任务加载策略的交易币种
			const instancesWithSymbols = await Promise.all(
				instances.map(async (instance) => {
					let tradingSymbols: string[] = [];
					try {
						const strategy = await StrategyFileManager.loadStrategy(
							instance.strategy_name,
						);
						if (strategy?.params?.tradingSymbols) {
							tradingSymbols = strategy.params.tradingSymbols
								.split(",")
								.map((s) => s.trim().toUpperCase())
								.filter(Boolean);
						}
					} catch (err) {
						logger.warn(`加载策略 ${instance.strategy_name} 的交易币种失败`);
					}
					return {
						...instance,
						tradingSymbols,
					};
				}),
			);

			return c.json({ instances: instancesWithSymbols });
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "未知错误";
			logger.error("获取 Strategy Tasks 失败:", error);
			return c.json({ error: message }, 500);
		}
	});

	/**
	 * 获取单个 Strategy Task
	 */
	app.get("/api/trading-instances/:id", requireAuth, async (c) => {
		try {
			const id = Number(c.req.param("id"));
			if (!Number.isFinite(id) || id <= 0) {
				return c.json({ error: "无效的实例ID" }, 400);
			}

			const { getTradingInstanceById } = await import(
				"../services/tradingInstanceService"
			);
			const instance = await getTradingInstanceById(id);
			if (!instance) {
				return c.json({ error: "实例不存在" }, 404);
			}
			return c.json({ instance });
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "未知错误";
			logger.error("获取 Strategy Task 失败:", error);
			return c.json({ error: message }, 500);
		}
	});

	/**
	 * 创建 Strategy Task
	 */
	app.post("/api/trading-instances", requireAuthWithCsrf, async (c) => {
		try {
			const body = await c.req.json();

			// 验证必填字段
			if (!body.name || typeof body.name !== "string") {
				return c.json({ error: "名称不能为空" }, 400);
			}
			if (!body.account_id || typeof body.account_id !== "number") {
				return c.json({ error: "请选择账户" }, 400);
			}
			if (!body.ai_model_id || typeof body.ai_model_id !== "number") {
				return c.json({ error: "请选择 AI 模型" }, 400);
			}
			if (!body.strategy_name || typeof body.strategy_name !== "string") {
				return c.json({ error: "请选择策略" }, 400);
			}

			// 从策略配置中读取循环间隔
			let intervalMinutes = 20; // 默认值
			try {
				const { StrategyFileManager } = await import(
					"../services/strategyFileManager"
				);
				const strategy = await StrategyFileManager.loadStrategy(
					body.strategy_name,
				);
				if (strategy?.params?.intervalMinutes) {
					intervalMinutes = Number(strategy.params.intervalMinutes);
					if (!Number.isFinite(intervalMinutes) || intervalMinutes < 1) {
						intervalMinutes = 20;
					}
				}
				logger.info(
					`从策略 ${body.strategy_name} 读取循环间隔: ${intervalMinutes} 分钟`,
				);
			} catch (error) {
				logger.warn(
					`读取策略 ${body.strategy_name} 循环间隔失败，使用默认值 ${intervalMinutes} 分钟`,
				);
			}

			const { createTradingInstance } = await import(
				"../services/tradingInstanceService"
			);
			const instance = await createTradingInstance({
				name: body.name.trim(),
				account_id: body.account_id,
				ai_model_id: body.ai_model_id,
				strategy_name: body.strategy_name,
				interval_minutes: intervalMinutes,
			});

			logger.info(`创建 Strategy Task: ${instance.name} (ID: ${instance.id})`);
			return c.json({ success: true, instance });
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "未知错误";
			logger.error("创建 Strategy Task 失败:", error);
			return c.json({ error: message }, 500);
		}
	});

	/**
	 * 更新 Strategy Task
	 */
	app.put("/api/trading-instances/:id", requireAuthWithCsrf, async (c) => {
		try {
			const id = Number(c.req.param("id"));
			if (!Number.isFinite(id) || id <= 0) {
				return c.json({ error: "无效的实例ID" }, 400);
			}

			const body = await c.req.json();

			// 如果策略名称变更，重新从策略配置中读取循环间隔
			let intervalMinutes: number | undefined = undefined;
			if (body.strategy_name) {
				try {
					const { StrategyFileManager } = await import(
						"../services/strategyFileManager"
					);
					const strategy = await StrategyFileManager.loadStrategy(
						body.strategy_name,
					);
					if (strategy?.params?.intervalMinutes) {
						intervalMinutes = Number(strategy.params.intervalMinutes);
						if (!Number.isFinite(intervalMinutes) || intervalMinutes < 1) {
							intervalMinutes = 20;
						}
					} else {
						intervalMinutes = 20;
					}
					logger.info(
						`从策略 ${body.strategy_name} 读取循环间隔: ${intervalMinutes} 分钟`,
					);
				} catch (error) {
					logger.warn(`读取策略 ${body.strategy_name} 循环间隔失败`);
				}
			}

			const { updateTradingInstance } = await import(
				"../services/tradingInstanceService"
			);
			const instance = await updateTradingInstance(id, {
				name: body.name?.trim(),
				account_id: body.account_id,
				ai_model_id: body.ai_model_id,
				strategy_name: body.strategy_name,
				interval_minutes: intervalMinutes,
				status: body.status,
			});

			if (!instance) {
				return c.json({ error: "实例不存在" }, 404);
			}

			logger.info(`更新 Strategy Task: ${instance.name} (ID: ${instance.id})`);
			return c.json({ success: true, instance });
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "未知错误";
			logger.error("更新 Strategy Task 失败:", error);
			return c.json({ error: message }, 500);
		}
	});

	/**
	 * 删除 Strategy Task
	 */
	app.delete("/api/trading-instances/:id", requireAuthWithCsrf, async (c) => {
		try {
			const id = Number(c.req.param("id"));
			if (!Number.isFinite(id) || id <= 0) {
				return c.json({ error: "无效的实例ID" }, 400);
			}

			const { deleteTradingInstance, getTradingInstanceById } = await import(
				"../services/tradingInstanceService"
			);
			const instance = await getTradingInstanceById(id);
			if (!instance) {
				return c.json({ error: "实例不存在" }, 404);
			}

			// 不允许删除正在运行的实例
			if (instance.status === "running") {
				return c.json({ error: "请先停止实例再删除" }, 400);
			}

			await deleteTradingInstance(id);
			logger.info(`删除 Strategy Task: ${instance.name} (ID: ${id})`);
			return c.json({ success: true });
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "未知错误";
			logger.error("删除 Strategy Task 失败:", error);
			return c.json({ error: message }, 500);
		}
	});

	/**
	 * 启动 Strategy Task
	 */
	app.post(
		"/api/trading-instances/:id/start",
		requireAuthWithCsrf,
		async (c) => {
			try {
				const id = Number(c.req.param("id"));
				if (!Number.isFinite(id) || id <= 0) {
					return c.json({ error: "无效的实例ID" }, 400);
				}

				const { startInstance, getTradingInstanceById } = await import(
					"../services/tradingInstanceService"
				);
				const instance = await getTradingInstanceById(id);
				if (!instance) {
					return c.json({ error: "实例不存在" }, 404);
				}

				await startInstance(id);
				logger.info(`启动 Strategy Task: ${instance.name} (ID: ${id})`);
				return c.json({ success: true, message: "实例已启动" });
			} catch (error: unknown) {
				const message = error instanceof Error ? error.message : "未知错误";
				logger.error("启动 Strategy Task 失败:", error);
				return c.json({ error: message }, 500);
			}
		},
	);

	/**
	 * 暂停 Strategy Task
	 */
	app.post(
		"/api/trading-instances/:id/pause",
		requireAuthWithCsrf,
		async (c) => {
			try {
				const id = Number(c.req.param("id"));
				if (!Number.isFinite(id) || id <= 0) {
					return c.json({ error: "无效的实例ID" }, 400);
				}

				const { pauseInstance, getTradingInstanceById } = await import(
					"../services/tradingInstanceService"
				);
				const instance = await getTradingInstanceById(id);
				if (!instance) {
					return c.json({ error: "实例不存在" }, 404);
				}

				await pauseInstance(id);
				logger.info(`暂停 Strategy Task: ${instance.name} (ID: ${id})`);
				return c.json({ success: true, message: "实例已暂停" });
			} catch (error: unknown) {
				const message = error instanceof Error ? error.message : "未知错误";
				logger.error("暂停 Strategy Task 失败:", error);
				return c.json({ error: message }, 500);
			}
		},
	);

	/**
	 * 停止 Strategy Task
	 */
	app.post(
		"/api/trading-instances/:id/stop",
		requireAuthWithCsrf,
		async (c) => {
			try {
				const id = Number(c.req.param("id"));
				if (!Number.isFinite(id) || id <= 0) {
					return c.json({ error: "无效的实例ID" }, 400);
				}

				const { stopInstance, getTradingInstanceById } = await import(
					"../services/tradingInstanceService"
				);
				const instance = await getTradingInstanceById(id);
				if (!instance) {
					return c.json({ error: "实例不存在" }, 404);
				}

				await stopInstance(id);
				logger.info(`停止 Strategy Task: ${instance.name} (ID: ${id})`);
				return c.json({ success: true, message: "实例已停止" });
			} catch (error: unknown) {
				const message = error instanceof Error ? error.message : "未知错误";
				logger.error("停止 Strategy Task 失败:", error);
				return c.json({ error: message }, 500);
			}
		},
	);

	/**
	 * 手动触发 Strategy Task 执行
	 * 不管实例当前状态，立即触发一次交易决策
	 */
	app.post(
		"/api/trading-instances/:id/trigger",
		requireAuthWithCsrf,
		async (c) => {
			try {
				const id = Number(c.req.param("id"));
				if (!Number.isFinite(id) || id <= 0) {
					return c.json({ error: "无效的实例ID" }, 400);
				}

				const { getTradingInstanceById } = await import(
					"../services/tradingInstanceService"
				);
				const { triggerInstanceExecution } = await import(
					"../scheduler/multiInstanceTradingLoop"
				);

				const instance = await getTradingInstanceById(id);
				if (!instance) {
					return c.json({ error: "实例不存在" }, 404);
				}

				const result = await triggerInstanceExecution(id);
				logger.info(
					`手动触发 Strategy Task: ${instance.name} (ID: ${id}) - ${result.message}`,
				);

				if (result.success) {
					return c.json({ success: true, message: result.message });
				} else {
					return c.json({ error: result.message }, 400);
				}
			} catch (error: unknown) {
				const message = error instanceof Error ? error.message : "未知错误";
				logger.error("触发 Strategy Task 失败:", error);
				return c.json({ error: message }, 500);
			}
		},
	);

	/**
	 * 获取多实例调度状态
	 */
	app.get("/api/trading-instances/status", requireAuth, async (c) => {
		try {
			const { getMultiInstanceStatus } = await import(
				"../scheduler/multiInstanceTradingLoop"
			);
			const status = await getMultiInstanceStatus();
			return c.json(status);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "未知错误";
			logger.error("获取多实例状态失败:", error);
			return c.json({ error: message }, 500);
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
			// 支持通过 accountId 参数指定账户，否则使用当前活跃账户
			const accountIdParam = c.req.query("accountId");
			const { getActiveAccount, getAccountById } = await import(
				"../services/accountConfigService"
			);
			const { createExchangeClientForAccount } = await import(
				"../services/okxClient"
			);

			let activeAccount;
			if (accountIdParam) {
				const accountId = Number.parseInt(accountIdParam, 10);
				if (Number.isFinite(accountId) && accountId > 0) {
					activeAccount = await getAccountById(accountId);
				}
			}
			if (!activeAccount) {
				activeAccount = await getActiveAccount();
			}

			let okxClient;
			if (activeAccount) {
				okxClient = createExchangeClientForAccount(activeAccount);
			} else {
				okxClient = await createExchangeClientFromActiveAccount();
			}

			const account = await okxClient.getFuturesAccount();
			// const activeSince = await getActiveAccountSwitchTimestamp();

			const accountId = activeAccount ? activeAccount.id : null;

			let historySql =
				"SELECT total_value, timestamp FROM account_history WHERE ";
			const historyArgs: any[] = [];

			if (accountId) {
				historySql += "account_id = ? ";
				historyArgs.push(accountId);
			} else {
				historySql += "(account_id IS NULL OR account_id = 'default') ";
			}

			historySql += "ORDER BY timestamp ASC";

			const historyResult = await dbClient.execute({
				sql: historySql,
				args: historyArgs,
			});
			const history = historyResult.rows || [];
			const historyInitial =
				history.length > 0
					? Number.parseFloat((history[0].total_value as string) || "0")
					: undefined;
			const unrealisedPnl = Number.parseFloat(account.unrealisedPnl || "0");
			const accountTotal = Number.parseFloat(account.total || "0");

			// 不同交易所的 total 字段含义不同：
			// - Bitget: accountEquity 已包含未实现盈亏
			// - OKX/Binance: total 是余额，需要手动加上未实现盈亏
			const totalIncludesUnrealised = totalIncludesUnrealisedPnl(
				activeAccount?.provider,
			);
			const totalBalance = totalIncludesUnrealised
				? accountTotal
				: accountTotal + unrealisedPnl;

			const availableBalance = Number.parseFloat(account.available || "0");
			const initialBalance =
				historyInitial && Number.isFinite(historyInitial) && historyInitial > 0
					? historyInitial
					: Math.max(totalBalance, 1);

			// 收益率 = (总资产 - 初始资金) / 初始资金 * 100
			// totalBalance 包含未实现盈亏，以便与 account_history 对齐
			const returnPercent =
				initialBalance > 0
					? ((totalBalance - initialBalance) / initialBalance) * 100
					: 0;

			// 计算胜率 - 从已平仓交易计算
			let winRate = 0;
			try {
				let tradesSql =
					"SELECT pnl FROM trades WHERE type = 'close' AND pnl IS NOT NULL ";
				const tradesArgs: any[] = [];

				if (accountId) {
					tradesSql += "AND account_id = ? ";
					tradesArgs.push(accountId);
				} else {
					tradesSql += "AND (account_id IS NULL OR account_id = 'default') ";
				}

				const closedTradesResult = await dbClient.execute({
					sql: tradesSql,
					args: tradesArgs,
				});
				const closedTrades = closedTradesResult.rows || [];

				if (closedTrades.length > 0) {
					const winCount = closedTrades.filter((row) => {
						const pnl = Number.parseFloat((row.pnl as string) || "0");
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
						const value = Number.parseFloat((row.total_value as string) || "0");
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
				totalBalance, // 总资产（包含未实现盈亏）
				availableBalance,
				positionMargin: Number.parseFloat(account.positionMargin || "0"),
				unrealisedPnl,
				returnPercent, // 收益率（基于 totalBalance 计算）
				winRate, // 胜率
				maxDrawdown, // 最大回撤
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
			// 支持通过 accountId 参数指定账户，否则使用当前活跃账户
			const accountIdParam = c.req.query("accountId");
			const { getActiveAccount, getAccountById } = await import(
				"../services/accountConfigService"
			);
			const { createExchangeClientForAccount } = await import(
				"../services/okxClient"
			);

			let activeAccount;
			if (accountIdParam) {
				const accountId = Number.parseInt(accountIdParam, 10);
				if (Number.isFinite(accountId) && accountId > 0) {
					activeAccount = await getAccountById(accountId);
				}
			}
			if (!activeAccount) {
				activeAccount = await getActiveAccount();
			}

			let okxClient;
			if (activeAccount) {
				okxClient = createExchangeClientForAccount(activeAccount);
			} else {
				okxClient = await createExchangeClientFromActiveAccount();
			}

			const okxPositions = await okxClient.getPositions();

			const isBitget = activeAccount?.provider === "bitget";
			const isBinance = activeAccount?.provider === "binance";

			// 从数据库获取止损止盈信息
			let positionsSql =
				"SELECT symbol, stop_loss, profit_target FROM positions";
			const positionsArgs: any[] = [];

			if (activeAccount) {
				positionsSql += " WHERE account_id = ?";
				positionsArgs.push(activeAccount.id);
			} else {
				positionsSql += " WHERE account_id IS NULL OR account_id = 'default'";
			}

			const dbResult = await dbClient.execute({
				sql: positionsSql,
				args: positionsArgs,
			});
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
					.map((position) => ({
						position,
						size: Number.parseFloat(position.size || "0"),
					}))
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
								contractMultiplier = await getQuantoMultiplier(
									position.contract,
								);
							} catch (error) {
								const message =
									error instanceof Error ? error.message : String(error);
								logger.warn(
									`获取 ${position.contract} 合约乘数失败: ${message}`,
								);
							}
						}
						if (
							!Number.isFinite(contractMultiplier) ||
							contractMultiplier <= 0
						) {
							contractMultiplier = 1;
						}

						// Bitget/Binance: quantity = size (already in coins)
						// OKX: quantity = contracts * multiplier
						const quantity =
							isBitget || isBinance
								? contracts
								: contracts * contractMultiplier;
						const currentPrice = Number.parseFloat(position.markPrice || "0");
						const openValue =
							Number.isFinite(quantity) && Number.isFinite(entryPrice)
								? quantity * entryPrice
								: marginUsed;

						const profitTarget = dbPos
							? toNumber(dbPos.profit_target, Number.NaN)
							: Number.NaN;
						const stopLoss = dbPos
							? toNumber(dbPos.stop_loss, Number.NaN)
							: Number.NaN;
						const exchangeOpenedAt =
							position.createTime ?? position.updateTime ?? null;
						const dbOpenedAt = dbPos ? toStringSafe(dbPos.opened_at) : "";
						const openedAt =
							exchangeOpenedAt ?? (dbOpenedAt || new Date().toISOString());

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
					}),
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
			return c.json(
				{ success: false, error: "平仓百分比必须在 1-100 之间" },
				400,
			);
		}

		try {
			const result = await executeClosePosition({
				symbol,
				percentage,
				skipGuards: true,
				enforceWhitelist: false,
			});
			const success = Boolean(result?.success);

			if (success) {
				// 平仓成功后，立即刷新持仓数据并广播给前端
				void dashboardBroadcaster.refreshPositions();
			}

			const message =
				typeof result?.message === "string" && result.message.length > 0
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
			return c.json(
				{ success: false, error: message, message: `平仓失败: ${message}` },
				500,
			);
		}
	});

	/**
	 * 获取当前挂单
	 */
	app.get("/api/open-orders", async (c) => {
		try {
			// 支持通过 accountId 参数指定账户，否则使用当前活跃账户
			const accountIdParam = c.req.query("accountId");
			const { getActiveAccount, getAccountById } = await import(
				"../services/accountConfigService"
			);
			const { createExchangeClientForAccount } = await import(
				"../services/okxClient"
			);

			let activeAccount;
			if (accountIdParam) {
				const accountId = Number.parseInt(accountIdParam, 10);
				if (Number.isFinite(accountId) && accountId > 0) {
					activeAccount = await getAccountById(accountId);
				}
			}
			if (!activeAccount) {
				activeAccount = await getActiveAccount();
			}

			let client;
			if (activeAccount) {
				client = createExchangeClientForAccount(activeAccount);
			} else {
				client = await createExchangeClientFromActiveAccount();
			}

			const orders = await client.getOpenOrders();
			const provider = activeAccount?.provider || "okx";
			logger.debug(`获取到 ${orders.length} 个挂单`);

			// 统一格式化订单数据
			const formattedOrders = await Promise.all(
				orders.map(async (order: any) => {
					const inferredContractFromInstId =
						typeof order.instId === "string"
							? order.instId.replace(/-SWAP$/i, "").replace(/-/g, "_")
							: "";
					const rawContractCandidate =
						order.contract || inferredContractFromInstId;
					const rawContract = rawContractCandidate?.includes("_USDT")
						? rawContractCandidate
						: rawContractCandidate
							? `${rawContractCandidate}_USDT`
							: "";
					const symbol = (rawContract || String(order.symbol || ""))
						.replace("_USDT", "")
						.toUpperCase();
					const side = (order.side || order.posSide || "").toLowerCase();
					const orderType = (
						order.orderType ||
						order.ordType ||
						order.type ||
						""
					).toUpperCase();
					const price = Number.parseFloat(order.px || order.price || "0");
					const quantityContracts = Number.parseFloat(
						order.sz || order.origQty || order.size || "0",
					);
					const filledContracts = Number.parseFloat(
						order.fillSz || order.executedQty || "0",
					);
					const remainingContracts = Math.max(
						quantityContracts - filledContracts,
						0,
					);
					const createTime =
						order.cTime || order.time || order.updateTime || Date.now();

					let multiplier = 1;
					if (provider === "okx" && rawContract) {
						multiplier = await getQuantoMultiplier(rawContract).catch(
							(error: unknown) => {
								const message =
									error instanceof Error ? error.message : String(error);
								logger.warn(`获取 ${rawContract} 合约乘数失败: ${message}`);
								return 1;
							},
						);
					}

					const convertSize = (value: number) =>
						Number.isFinite(value) ? value * multiplier : value;
					const quantity = convertSize(quantityContracts);
					const filled = convertSize(filledContracts);
					const remaining = convertSize(remainingContracts);

					const formatted = {
						orderId:
							order.ordId || order.orderId?.toString() || order.clientOrderId,
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
						contracts: Number.isFinite(quantityContracts)
							? quantityContracts
							: undefined,
						filledContracts: Number.isFinite(filledContracts)
							? filledContracts
							: undefined,
						remainingContracts: Number.isFinite(remainingContracts)
							? remainingContracts
							: undefined,
					};

					logger.debug(
						`格式化挂单: ${formatted.orderId} - ${formatted.symbol} ${formatted.side} ${formatted.orderType}`,
					);
					return formatted;
				}),
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
					const inferredContractFromInstId =
						typeof order.instId === "string"
							? order.instId.replace(/-SWAP$/i, "").replace(/-/g, "_")
							: "";
					const rawContractCandidate =
						order.contract || inferredContractFromInstId;
					const rawContract = rawContractCandidate?.includes("_USDT")
						? rawContractCandidate
						: rawContractCandidate
							? `${rawContractCandidate}_USDT`
							: "";
					const symbol = (rawContract || String(order.symbol || ""))
						.replace("_USDT", "")
						.toUpperCase();
					const side = (order.side || order.posSide || "").toLowerCase();
					const orderType = (
						order.orderType ||
						order.ordType ||
						order.type ||
						""
					).toUpperCase();
					const price = Number.parseFloat(order.px || order.price || "0");
					const quantityContracts = Number.parseFloat(
						order.sz || order.origQty || order.size || "0",
					);
					const filledContracts = Number.parseFloat(
						order.fillSz || order.executedQty || "0",
					);
					const remainingContracts = Math.max(
						quantityContracts - filledContracts,
						0,
					);
					const createTime =
						order.cTime || order.time || order.updateTime || Date.now();

					let multiplier = 1;
					if (provider === "okx" && rawContract) {
						multiplier = await getQuantoMultiplier(rawContract).catch(
							(error: unknown) => {
								const message =
									error instanceof Error ? error.message : String(error);
								logger.warn(`获取 ${rawContract} 合约乘数失败: ${message}`);
								return 1;
							},
						);
					}

					const convertSize = (value: number) =>
						Number.isFinite(value) ? value * multiplier : value;
					const quantity = convertSize(quantityContracts);
					const filled = convertSize(filledContracts);
					const remaining = convertSize(remainingContracts);

					const formatted = {
						orderId:
							order.ordId || order.orderId?.toString() || order.clientOrderId,
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
						contracts: Number.isFinite(quantityContracts)
							? quantityContracts
							: undefined,
						filledContracts: Number.isFinite(filledContracts)
							? filledContracts
							: undefined,
						remainingContracts: Number.isFinite(remainingContracts)
							? remainingContracts
							: undefined,
					};

					logger.debug(
						`格式化挂单: ${formatted.orderId} - ${formatted.symbol} ${formatted.side} ${formatted.orderType}`,
					);
					return formatted;
				}),
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

			// 优先使用当前活跃账户的任务模型名称（使用 model_name 而非 ai_model_name）
			try {
				const { getActiveAccount } = await import(
					"../services/accountConfigService"
				);
				const { getRunningInstances, getLatestInstanceForAccount } =
					await import("../services/tradingInstanceService");

				const activeAccount = await getActiveAccount();
				if (activeAccount) {
					// 查找该账户的运行中实例
					const runningInstances = await getRunningInstances();
					const accountInstance = runningInstances.find(
						(instance) => instance.account_id === activeAccount.id,
					);

					// 优先使用 model_name（真正的 API 模型名），如果没有则回退到 ai_model_name（用户自定义标题）
					if (accountInstance?.model_name) {
						config.AI_MODEL_NAME = accountInstance.model_name;
					} else if (accountInstance?.ai_model_name) {
						config.AI_MODEL_NAME = accountInstance.ai_model_name;
					} else {
						// 回退到该账户最近的任务
						const latestInstance = await getLatestInstanceForAccount(
							activeAccount.id,
						);
						if (latestInstance?.model_name) {
							config.AI_MODEL_NAME = latestInstance.model_name;
						} else if (latestInstance?.ai_model_name) {
							config.AI_MODEL_NAME = latestInstance.ai_model_name;
						}
					}
				}
			} catch (instanceError) {
				logger.warn("获取账户任务模型失败，使用全局配置:", instanceError);
			}

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
			const body = (await c.req.json().catch(() => ({}))) as {
				confirmation?: unknown;
			};
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

			return c.json({
				success: true,
				message: "配置已重新加载，Strategy Tasks 将在下一轮执行使用最新参数",
			});
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "未知错误";
			logger.error("重载配置失败:", error);
			return c.json({ error: message }, 500);
		}
	});

	/**
	 * 获取多个币种的实时价格
	 */
	app.get("/api/prices", async (c) => {
		try {
			const symbolsParam = c.req.query("symbols") || "BTC,ETH,SOL,BNB,DOGE,XRP";
			const symbols = symbolsParam.split(",").map((s) => s.trim());

			const okxClient = await createExchangeClientFromActiveAccount();
			const prices: Record<string, number> = {};

			try {
				// 尝试批量获取所有 ticker，避免触发 API 频率限制
				const allTickers = await okxClient.getAllSwapTickers();
				const tickerMap = new Map<string, number>();

				for (const ticker of allTickers) {
					tickerMap.set(
						ticker.symbol.toUpperCase(),
						Number.parseFloat(ticker.price),
					);
				}

				// 填充请求的币种价格
				for (const symbol of symbols) {
					const upperSymbol = symbol.toUpperCase();
					const price = tickerMap.get(upperSymbol);
					if (price !== undefined) {
						prices[symbol] = price;
					} else {
						// 如果批量获取中没有，尝试单独获取（作为回退）
						try {
							const contract = `${symbol}_USDT`;
							const ticker = await okxClient.getFuturesTicker(contract);
							prices[symbol] = Number.parseFloat(ticker.last || "0");
						} catch (e) {
							prices[symbol] = 0;
						}
					}
				}
			} catch (error) {
				logger.warn("批量获取价格失败，降级为单独获取:", error);
				// 降级方案：并发获取所有币种价格
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
								logger.error(
									`获取 ${symbol} 价格失败: 未知错误`,
									error as Record<string, unknown>,
								);
							}
							prices[symbol] = 0;
						}
					}),
				);
			}

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
			const body = (await c.req
				.json()
				.catch(() => ({}))) as ExchangeTestPayload;
			const result = await performExchangeConnectionTest(body);
			if (!result.success) {
				const numericStatus = Number.isFinite(result.status)
					? Number(result.status)
					: 500;
				const status = Math.min(
					Math.max(numericStatus, 200),
					599,
				) as ContentfulStatusCode;
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
			const body = (await c.req
				.json()
				.catch(() => ({}))) as ExchangeTestPayload;
			const result = await performExchangeConnectionTest({
				...body,
				exchange: "okx",
			});
			if (!result.success) {
				const numericStatus = Number.isFinite(result.status)
					? Number(result.status)
					: 500;
				const status = Math.min(
					Math.max(numericStatus, 200),
					599,
				) as ContentfulStatusCode;
				return c.json({ success: false, error: result.error }, status);
			}
			return c.json({
				success: true,
				balance: result.balance || "0",
				message: "API 连接成功",
			});
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
			const baseUrl =
				typeof body.baseUrl === "string" ? body.baseUrl.trim() : "";
			const modelName =
				typeof body.modelName === "string" ? body.modelName.trim() : "";
			const proxyUrlRaw =
				typeof body.proxyUrl === "string" ? body.proxyUrl.trim() : "";

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
					Authorization: `Bearer ${apiKey}`,
				},
				body: JSON.stringify({
					model: modelName,
					messages: [
						{
							role: "user",
							content: "测试连接，请回复'OK'",
						},
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
				message: "AI API 连接成功",
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
				details:
					"这是一条测试紧急通知，用于验证配置是否正确 / This is a test emergency notice to verify configuration / これはテストの緊急通知です",
				timestamp: new Date().toISOString(),
			});

			const fullUrl = `${url}${url.includes("?") ? "&" : "?"}${testParams.toString()}`;

			// 发送测试请求
			const response = await fetch(fullUrl, {
				method: "GET",
				signal: AbortSignal.timeout(10000),
			});

			if (!response.ok) {
				const errorText = await response
					.text()
					.catch(() => response.statusText);
				return c.json(
					{
						success: false,
						error: `HTTP ${response.status}: ${errorText || response.statusText}`,
					},
					500,
				);
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
			const {
				action,
				symbol,
				leverage,
				amount,
				direction,
				marginMode,
				amountUnit,
				orderType,
				price,
			} = body;

			if (!symbol)
				return c.json({ success: false, error: "缺少币种参数" }, 400);

			const normalizedSymbol = symbol.toUpperCase();
			let result;

			if (action === "open") {
				if (!amount || !leverage) {
					return c.json(
						{ success: false, error: "开仓需要金额和杠杆参数" },
						400,
					);
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
					skipWhitelistCheck: true, // Manual trade skips whitelist check
				});
			} else if (action === "close") {
				// executeClosePosition handles the logic
				// Default to 100% close if not specified, or handle partial close if UI supports it
				// For now, the UI button says "Close Position", implying full close.
				result = await executeClosePosition({
					symbol: normalizedSymbol,
					percentage: 100,
					skipGuards: true,
					enforceWhitelist: false, // Manual close skips whitelist check
				});
			} else {
				return c.json({ success: false, error: "无效的操作类型" }, 400);
			}

			if (result.success) {
				// 交易成功后，立即刷新持仓数据并广播给前端
				void dashboardBroadcaster.refreshPositions();

				return c.json({ success: true, data: result });
			} else {
				return c.json({ success: false, error: result.message }, 400);
			}
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "执行失败";
			logger.error("手动交易执行失败", error);
			return c.json({ success: false, error: message }, 500);
		}
	});

	/**
	 * 手动触发 AI 交易决策
	 */
	app.post("/api/trading/execute-manual", requireAuthWithCsrf, async (c) => {
		try {
			logger.info("收到 Strategy Task 手动执行请求");
			const body = (await c.req.json().catch(() => ({}))) as {
				instanceId?: unknown;
			};
			const requestedId =
				body.instanceId !== undefined ? Number(body.instanceId) : undefined;
			const resolvedRequestedId =
				typeof requestedId === "number" &&
				Number.isFinite(requestedId) &&
				requestedId > 0
					? requestedId
					: undefined;

			const { getRunningInstances, getAllTradingInstances } = await import(
				"../services/tradingInstanceService"
			);
			const runningInstances = await getRunningInstances();

			let targetInstance = resolvedRequestedId
				? runningInstances.find(
						(instance) => instance.id === resolvedRequestedId,
					)
				: null;

			if (!targetInstance) {
				const activeAccount = await getActiveAccount();
				if (activeAccount) {
					targetInstance =
						runningInstances.find(
							(instance) => instance.account_id === activeAccount.id,
						) || null;
				}
			}

			if (!targetInstance && runningInstances.length > 0) {
				targetInstance = runningInstances[0];
			}

			if (!targetInstance) {
				const allInstances = await getAllTradingInstances();
				if (resolvedRequestedId) {
					targetInstance =
						allInstances.find(
							(instance) => instance.id === resolvedRequestedId,
						) || null;
				} else {
					targetInstance =
						allInstances.find((instance) => instance.status === "running") ||
						null;
				}
			}

			if (!targetInstance) {
				return c.json(
					{
						success: false,
						error: "当前没有可执行的 Strategy Task，请先在设置页创建并启动实例",
					},
					400,
				);
			}

			const { triggerInstanceExecution } = await import(
				"../scheduler/multiInstanceTradingLoop"
			);
			const result = await triggerInstanceExecution(targetInstance.id);

			if (!result.success) {
				return c.json({ success: false, error: result.message }, 400);
			}

			logger.info(
				`已手动触发实例 ${targetInstance.name} (ID: ${targetInstance.id}) 执行`,
			);
			return c.json({
				success: true,
				message: result.message,
				instanceId: targetInstance.id,
				timestamp: new Date().toISOString(),
			});
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "未知错误";
			logger.error("触发 Strategy Task 手动执行失败:", error);
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
		const limit = Number.isFinite(limitRaw)
			? Math.min(Math.max(limitRaw, 20), 500)
			: 200;

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
	 * 保存用户语言偏好
	 */
	app.post("/api/user/language", requireAuth, async (c) => {
		try {
			const body = await c.req.json();
			const requestedLang =
				typeof body?.language === "string"
					? body.language.trim().toLowerCase()
					: "";
			const validLanguages = ["en", "zh", "ja"];
			const language = validLanguages.includes(requestedLang)
				? requestedLang
				: "en";

			const { setConfigValue } = await import("../database/init-config");
			await setConfigValue("UI_LANGUAGE", language);

			return c.json({ success: true, language });
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "未知错误";
			logger.error("保存语言偏好失败:", error);
			return c.json({ error: message }, 500);
		}
	});

	/**
	 * 获取策略默认提示词（需要鉴权）
	 */
	app.get("/api/strategy/default-prompts", requireAuth, async (c) => {
		try {
			const requestedStrategy = c.req.query("strategy")?.trim().toLowerCase();
			const { normalizeStrategyLanguage, ALL_TRADING_STRATEGIES } = await import(
				"../config/strategyTypes"
			);
			const validStrategies: TradingStrategy[] = ALL_TRADING_STRATEGIES;
			const fallbackStrategy: TradingStrategy = "balanced";
			const strategy: TradingStrategy =
				requestedStrategy &&
				validStrategies.includes(requestedStrategy as TradingStrategy)
					? (requestedStrategy as TradingStrategy)
					: fallbackStrategy;

			// Get language parameter and validate
			const rawLanguage = c.req.query("language")?.trim().toLowerCase();
			const requestedLanguage = normalizeStrategyLanguage(rawLanguage);

			const intervalParam = c.req.query("interval")?.trim().toLowerCase();
			const intervalMinutes = (() => {
				if (!intervalParam) {
					return RISK_PARAMS.TRADING_INTERVAL_MINUTES;
				}
				const numericCandidate = intervalParam.endsWith("m")
					? intervalParam.slice(0, -1)
					: intervalParam;
				const parsed = Number.parseInt(numericCandidate, 10);
				if (!Number.isFinite(parsed) || parsed <= 0) {
					return RISK_PARAMS.TRADING_INTERVAL_MINUTES;
				}
				return parsed;
			})();

			const sections = await getStrategyPromptDefaultSections(
				strategy,
				intervalMinutes,
				requestedLanguage,
			);

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
	 * 获取当前 AI 模型
	 */
	app.get("/api/public/model", async (c) => {
		try {
			// 优先从最新的任务实例中获取模型信息
			const { getLatestInstance } = await import(
				"../services/tradingInstanceService"
			);
			const latestInstance = await getLatestInstance();

			if (latestInstance && latestInstance.ai_model_name) {
				return c.json({
					model: latestInstance.ai_model_name,
					aiModelName: latestInstance.ai_model_name,
				});
			}

			// 回退到全局配置（兼容旧逻辑）
			const { getConfigValue } = await import("../database/init-config");
			const model = (await getConfigValue("AI_MODEL_NAME")) || "gpt-4o";
			return c.json({ model, aiModelName: model });
		} catch (error: unknown) {
			return c.json({ model: "unknown" });
		}
	});

	/**
	 * 获取当前活跃账户运行中实例的公开状态
	 * 用于未登录用户也能看到 AI overlay 状态
	 */
	app.get("/api/public/instances-status", async (c) => {
		try {
			const { getActiveAccount } = await import(
				"../services/accountConfigService"
			);
			const { getRunningInstances, getLatestInstanceForAccount } = await import(
				"../services/tradingInstanceService"
			);

			// 1. 获取当前活跃账户
			const activeAccount = await getActiveAccount();
			if (!activeAccount) {
				return c.json({ runningInstance: null });
			}

			// 2. 获取所有运行中的实例
			const runningInstances = await getRunningInstances();

			// 3. 查找该账户关联的运行中实例
			const accountInstance = runningInstances.find(
				(instance) => instance.account_id === activeAccount.id,
			);

			if (accountInstance) {
				return c.json({
					runningInstance: {
						id: accountInstance.id,
						name: accountInstance.name,
						ai_model_name: accountInstance.ai_model_name, // 用户自定义标题
						model_name: accountInstance.model_name, // 真正的 API 模型名（用于图标判断）
						strategy_name: accountInstance.strategy_name,
						status: accountInstance.status,
					},
				});
			}

			// 4. 如果没有运行中的实例，尝试获取该账户最近的一个实例（可能是 stopped）
			// 这样可以显示该账户配置的模型，而不是回退到全局默认
			const latestInstance = await getLatestInstanceForAccount(
				activeAccount.id,
			);

			if (latestInstance) {
				return c.json({
					runningInstance: {
						id: latestInstance.id,
						name: latestInstance.name,
						ai_model_name: latestInstance.ai_model_name, // 用户自定义标题
						model_name: latestInstance.model_name, // 真正的 API 模型名（用于图标判断）
						strategy_name: latestInstance.strategy_name,
						status: latestInstance.status,
					},
				});
			}

			return c.json({ runningInstance: null });
		} catch (error: unknown) {
			logger.error("获取公开实例状态失败:", error);
			return c.json({ runningInstance: null });
		}
	});

	/**
	 * 获取最近一次的交易状态快照
	 * 解决页面刷新后等待下一次 WebSocket 推送的问题
	 */
	app.get("/api/public/trading-status/latest", async (c) => {
		try {
			const statuses = websocketService.getCachedTradingStatuses();
			return c.json({ statuses });
		} catch (error: unknown) {
			logger.error("获取交易状态快照失败:", error);
			return c.json({ statuses: [] });
		}
	});

	/**
	 * 获取合约乘数
	 */
	app.get("/api/public/contract-multipliers", async (c) => {
		try {
			const result = await dbClient.execute(
				"SELECT symbol, multiplier FROM contract_multipliers",
			);
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
	 * 获取当前账户交易所的所有 USDT 永续合约列表（按24小时成交量降序排列）
	 * 返回格式: { symbols: [{symbol: "BTC", volume24h: 1234567890, price: "95000.5", change24h: 2.5}, ...] }
	 */
	app.get("/api/exchange/symbols", async (c) => {
		try {
			const { getActiveAccount } = await import(
				"../services/accountConfigService"
			);
			const { getConfigValue } = await import("../database/init-config");

			const activeAccount = await getActiveAccount();
			const systemProxyUrl = await getConfigValue("HTTP_PROXY_URL");

			// 如果没有激活账户，尝试使用环境变量中的默认配置
			// 或者如果没有配置，使用默认的 OKX 公共访问
			const provider =
				activeAccount?.provider || process.env.EXCHANGE_PROVIDER || "okx";
			const apiKey = activeAccount?.api_key || process.env.OKX_API_KEY || "";
			const apiSecret =
				activeAccount?.api_secret || process.env.OKX_API_SECRET || "";
			const apiPassphrase =
				activeAccount?.api_passphrase || process.env.OKX_API_PASSPHRASE || "";
			const usePaper = activeAccount
				? activeAccount.use_paper
				: process.env.OKX_USE_PAPER === "true";

			// 代理优先级: 账户独立代理 > 系统全局代理 > 环境变量代理
			const proxyUrl =
				activeAccount?.proxy_url ||
				systemProxyUrl ||
				process.env.HTTP_PROXY ||
				process.env.HTTPS_PROXY ||
				undefined;

			let symbols: Array<{
				symbol: string;
				volume24h: number;
				price: string;
				change24h: number;
			}> = [];

			if (provider === "okx") {
				const { OkxClient } = await import("../services/okxClient");
				const okxClient = new OkxClient(
					apiKey,
					apiSecret,
					apiPassphrase,
					usePaper,
					proxyUrl,
				);
				symbols = await okxClient.getAllSwapTickers();
			} else if (provider === "binance") {
				const { BinanceClient } = await import("../services/binanceClient");
				const binanceClient = new BinanceClient(
					apiKey,
					apiSecret,
					usePaper,
					proxyUrl,
				);
				symbols = await binanceClient.getAllSwapTickers();
			} else if (provider === "bitget") {
				const { BitgetClient } = await import("../services/bitgetClient");
				const bitgetClient = new BitgetClient(
					apiKey,
					apiSecret,
					apiPassphrase,
					usePaper,
					proxyUrl,
				);
				symbols = await bitgetClient.getAllSwapTickers();
			} else if (provider === "gate") {
				const gateClient = new GateClient(
					apiKey,
					apiSecret,
					usePaper,
					proxyUrl,
				);
				symbols = await gateClient.getAllSwapTickers();
			}

			// 按 24 小时成交量降序排序
			symbols.sort((a, b) => b.volume24h - a.volume24h);

			return c.json({
				symbols,
				provider,
				count: symbols.length,
			});
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "未知错误";
			logger.error("获取交易所合约列表失败:", error);
			return c.json({ symbols: [], error: message }, 500);
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

			let sql =
				"SELECT timestamp, total_value, unrealized_pnl, return_percent FROM account_history";
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
			let tradesSql =
				"SELECT pnl FROM trades WHERE type = 'close' AND pnl IS NOT NULL";
			const tradesArgs: any[] = [];
			if (accountId) {
				tradesSql += " AND account_id = ?";
				tradesArgs.push(accountId);
			}
			tradesSql += " ORDER BY timestamp ASC";

			const tradesResult = await dbClient.execute({
				sql: tradesSql,
				args: tradesArgs,
			});
			const trades = tradesResult.rows || [];

			// 获取权益历史
			let historySql = "SELECT total_value, timestamp FROM account_history";
			const historyArgs: any[] = [];
			if (accountId) {
				historySql += " WHERE account_id = ?";
				historyArgs.push(accountId);
			}
			historySql += " ORDER BY timestamp ASC";

			const historyResult = await dbClient.execute({
				sql: historySql,
				args: historyArgs,
			});
			const history = historyResult.rows || [];

			// 获取初始资金
			const initialBalance =
				history.length > 0
					? Number.parseFloat(history[0].total_value as string)
					: 100;

			// 当前总资产
			const currentBalance =
				history.length > 0
					? Number.parseFloat(history[history.length - 1].total_value as string)
					: initialBalance;

			// 基础统计
			const totalTrades = trades.length;
			const winTrades = trades.filter(
				(row) => Number.parseFloat((row.pnl as string) || "0") > 0,
			);
			const lossTrades = trades.filter(
				(row) => Number.parseFloat((row.pnl as string) || "0") < 0,
			);

			const winCount = winTrades.length;
			const lossCount = lossTrades.length;
			const winRate = totalTrades > 0 ? (winCount / totalTrades) * 100 : 0;

			// 盈亏统计
			const totalProfit = winTrades.reduce(
				(sum, row) => sum + Number.parseFloat((row.pnl as string) || "0"),
				0,
			);
			const totalLoss = Math.abs(
				lossTrades.reduce(
					(sum, row) => sum + Number.parseFloat((row.pnl as string) || "0"),
					0,
				),
			);
			const netPnl = totalProfit - totalLoss;

			// 收益率
			const returnPercent =
				((currentBalance - initialBalance) / initialBalance) * 100;

			// 最大回撤
			let maxDrawdown = 0;
			let peak = 0;
			for (const row of history) {
				const value = Number.parseFloat((row.total_value as string) || "0");
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
			const maxWin =
				winTrades.length > 0
					? Math.max(
							...winTrades.map((row) =>
								Number.parseFloat((row.pnl as string) || "0"),
							),
						)
					: 0;
			const maxLoss =
				lossTrades.length > 0
					? Math.abs(
							Math.min(
								...lossTrades.map((row) =>
									Number.parseFloat((row.pnl as string) || "0"),
								),
							),
						)
					: 0;

			// 夏普比率计算（简化版：使用日收益率）
			let sharpeRatio = 0;
			if (history.length > 1) {
				const returns: number[] = [];
				for (let i = 1; i < history.length; i++) {
					const prev = Number.parseFloat(
						(history[i - 1].total_value as string) || "0",
					);
					const curr = Number.parseFloat(
						(history[i].total_value as string) || "0",
					);
					if (prev > 0) {
						returns.push((curr - prev) / prev);
					}
				}

				if (returns.length > 0) {
					const avgReturn =
						returns.reduce((sum, r) => sum + r, 0) / returns.length;
					const variance =
						returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) /
						returns.length;
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
					const prev = Number.parseFloat(
						(history[i - 1].total_value as string) || "0",
					);
					const curr = Number.parseFloat(
						(history[i].total_value as string) || "0",
					);
					if (prev > 0) {
						returns.push((curr - prev) / prev);
					}
				}

				if (returns.length > 0) {
					const avgReturn =
						returns.reduce((sum, r) => sum + r, 0) / returns.length;
					const downReturns = returns.filter((r) => r < 0);

					if (downReturns.length > 0) {
						const downVariance =
							downReturns.reduce((sum, r) => sum + Math.pow(r, 2), 0) /
							downReturns.length;
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
			const { getActiveAccount } = await import(
				"../services/accountConfigService"
			);
			const activeAccount = await getActiveAccount();
			const isBitget = activeAccount?.provider === "bitget";
			const isBinance = activeAccount?.provider === "binance";

			const rawLimit = Number.parseInt(c.req.query("limit") || "10", 10);
			const limit = Number.isFinite(rawLimit)
				? Math.min(Math.max(rawLimit, 1), 500)
				: 10;
			const rawPage = Number.parseInt(c.req.query("page") || "1", 10);
			const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
			const offset = (page - 1) * limit;
			const symbol = c.req.query("symbol"); // 可选，筛选特定币种
			const accountIdParam = c.req.query("accountId"); // 可选，筛选特定账户的交易

			// 构建 WHERE 子句条件
			const conditions: string[] = [];
			const args: Array<string | number> = [];

			if (symbol) {
				conditions.push("symbol = ?");
				args.push(symbol);
			}

			if (accountIdParam) {
				const accountId = Number.parseInt(accountIdParam, 10);
				if (Number.isFinite(accountId) && accountId > 0) {
					conditions.push("account_id = ?");
					args.push(accountId);
				}
			}

			// 组合 SQL
			const whereClause =
				conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
			const sql = `SELECT * FROM trades ${whereClause} ORDER BY timestamp DESC LIMIT ? OFFSET ?`;
			const countSql = `SELECT COUNT(*) AS total FROM trades ${whereClause}`;

			args.push(limit, offset);
			const countArgs = conditions.length > 0 ? args.slice(0, -2) : [];

			const [result, countResult] = await Promise.all([
				dbClient.execute({ sql, args }),
				dbClient.execute({ sql: countSql, args: countArgs }),
			]);

			if (!result.rows || result.rows.length === 0) {
				const totalRows = asDbRows(countResult.rows);
				const total =
					totalRows.length > 0 ? toNumber(totalRows[0].total, 0) : 0;
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
					const contracts = Number.isFinite(rawContracts)
						? Math.abs(rawContracts)
						: 0;

					let contractMultiplier = 1;
					if (!isBitget && !isBinance && symbol) {
						try {
							contractMultiplier = await getQuantoMultiplier(`${symbol}_USDT`);
						} catch (error) {
							const message =
								error instanceof Error ? error.message : String(error);
							logger.warn(`获取 ${symbol}_USDT 合约乘数失败: ${message}`);
						}
					}
					if (!Number.isFinite(contractMultiplier) || contractMultiplier <= 0) {
						contractMultiplier = 1;
					}

					const quantity =
						isBitget || isBinance ? contracts : contracts * contractMultiplier;

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
				}),
			);

			const totalRows = asDbRows(countResult.rows);
			const total =
				totalRows.length > 0
					? toNumber(totalRows[0].total, trades.length)
					: trades.length;

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
			logger.error(
				"获取历史仓位失败: 未知错误",
				error as Record<string, unknown>,
			);
			return c.json({ error: "未知错误" }, 500);
		}
	});

	/**
	 * 获取交易执行日志
	 */
	app.get("/api/trade-logs", async (c) => {
		try {
			const rawLimit = Number.parseInt(c.req.query("limit") || "50", 10);
			const limit = Number.isFinite(rawLimit)
				? Math.min(Math.max(rawLimit, 1), 200)
				: 50;
			const rawPage = Number.parseInt(c.req.query("page") || "1", 10);
			const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
			const offset = (page - 1) * limit;
			const accountIdParam = c.req.query("accountId");

			// 构建 WHERE 子句
			let whereClause = "";
			const baseArgs: any[] = [];
			if (accountIdParam) {
				const accountId = Number.parseInt(accountIdParam, 10);
				if (Number.isFinite(accountId) && accountId > 0) {
					whereClause = "WHERE account_id = ?";
					baseArgs.push(accountId);
				}
			}

			const [result, countResult] = await Promise.all([
				dbClient.execute({
					sql: `SELECT * FROM trade_logs ${whereClause} ORDER BY datetime(created_at) DESC LIMIT ? OFFSET ?`,
					args: [...baseArgs, limit, offset],
				}),
				dbClient.execute({
					sql: `SELECT COUNT(*) AS total FROM trade_logs ${whereClause}`,
					args: baseArgs,
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
					leverage:
						leverageValue === null || leverageValue === undefined
							? null
							: toNumber(leverageValue),
					amountUsdt:
						amountValue === null || amountValue === undefined
							? null
							: toNumber(amountValue),
					size:
						sizeValue === null || sizeValue === undefined
							? null
							: toNumber(sizeValue),
					status: toStringSafe(row.status, "unknown"),
					message: toStringSafe(row.message),
					orderId: toStringSafe(row.order_id) || null,
					rawRequest: toStringSafe(row.raw_request) || null,
					rawResponse: toStringSafe(row.raw_response) || null,
					createdAt: toStringSafe(row.created_at),
				};
			});

			const totalRows = asDbRows(countResult.rows);
			const total =
				totalRows.length > 0
					? toNumber(totalRows[0].total, logs.length)
					: logs.length;

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
			const limit = Number.isFinite(rawLimit)
				? Math.min(Math.max(rawLimit, 1), 200)
				: 20;
			const rawPage = Number.parseInt(c.req.query("page") || "1", 10);
			const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
			const offset = (page - 1) * limit;
			const accountIdParam = c.req.query("accountId");

			// 构建 WHERE 子句
			let whereClause = "";
			const baseArgs: any[] = [];
			if (accountIdParam) {
				const accountId = Number.parseInt(accountIdParam, 10);
				if (Number.isFinite(accountId) && accountId > 0) {
					whereClause = "WHERE account_id = ?";
					baseArgs.push(accountId);
				}
			}

			const [result, countResult] = await Promise.all([
				dbClient.execute({
					sql: `SELECT * FROM agent_decisions 
                ${whereClause}
                ORDER BY datetime(timestamp) DESC 
                LIMIT ? OFFSET ?`,
					args: [...baseArgs, limit, offset],
				}),
				dbClient.execute({
					sql: `SELECT COUNT(*) AS total FROM agent_decisions ${whereClause}`,
					args: baseArgs,
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
			const total =
				totalRows.length > 0
					? toNumber(totalRows[0].total, logs.length)
					: logs.length;

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
			const limit = Number.isFinite(rawLimit)
				? Math.min(Math.max(rawLimit, 1), 200)
				: 20;
			const rawPage = Number.parseInt(c.req.query("page") || "1", 10);
			const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
			const offset = (page - 1) * limit;
			const accountIdParam = c.req.query("accountId");

			// 构建 WHERE 子句
			let whereClause = "";
			const baseArgs: any[] = [];
			if (accountIdParam) {
				const accountId = Number.parseInt(accountIdParam, 10);
				if (Number.isFinite(accountId) && accountId > 0) {
					whereClause = "WHERE account_id = ?";
					baseArgs.push(accountId);
				}
			}

			const [result, countResult] = await Promise.all([
				dbClient.execute({
					sql: `SELECT * FROM agent_request_logs ${whereClause} ORDER BY datetime(created_at) DESC LIMIT ? OFFSET ?`,
					args: [...baseArgs, limit, offset],
				}),
				dbClient.execute({
					sql: `SELECT COUNT(*) AS total FROM agent_request_logs ${whereClause}`,
					args: baseArgs,
				}),
			]);

			const logs = asDbRows(result.rows).map((row) => {
				const outputDuration = toNumber(row.output_duration_ms);
				const legacyDuration = toNumber(
					(row as Record<string, unknown>).duration_ms,
				);
				const normalizedDuration = Number.isFinite(outputDuration)
					? outputDuration
					: legacyDuration;
				const rawStatus = toStringSafe(row.status);
				const defaultStatus = row.error_message
					? "error"
					: row.response
						? "success"
						: "unknown";
				const normalizedStatus = rawStatus || defaultStatus;

				return {
					id: toStringSafe(row.id),
					createdAt: toStringSafe(row.created_at),
					instructions: toStringSafe(row.instructions),
					prompt: toStringSafe(row.prompt),
					response: toStringSafe(row.response),
					modelName: toStringSafe(row.model_name), // 改为 modelName 以匹配前端
					model: toStringSafe(row.model_name), // 保留 model 以兼容
					durationMs: normalizedDuration,
					outputDurationMs: normalizedDuration,
					status: normalizedStatus,
					tokensInput: toNumber(row.tokens_input),
					tokensOutput: toNumber(row.tokens_output),
					errorMessage: toStringSafe(row.error_message), // 改为 errorMessage 以匹配前端
					error: toStringSafe(row.error_message), // 保留 error 以兼容
				};
			});

			const totalRows = asDbRows(countResult.rows);
			const total =
				totalRows.length > 0
					? toNumber(totalRows[0].total, logs.length)
					: logs.length;

			return c.json({
				requests: logs, // 改为 requests 以匹配前端预期
				logs, // 保留 logs 键以兼容旧代码
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
			const body = (await c.req.json().catch(() => ({}))) as {
				confirmation?: unknown;
				accountId?: unknown;
			};
			if (body.confirmation !== "RESET") {
				return c.json({ error: "确认口令无效" }, 400);
			}

			let targetAccount = null;
			const hasAccountSelection =
				body.accountId !== undefined &&
				body.accountId !== null &&
				body.accountId !== "";
			if (hasAccountSelection) {
				const parsedAccountId =
					typeof body.accountId === "number"
						? body.accountId
						: Number.parseInt(String(body.accountId).trim(), 10);
				if (!Number.isFinite(parsedAccountId) || parsedAccountId <= 0) {
					return c.json({ error: "账户ID无效" }, 400);
				}
				targetAccount = await getAccountById(parsedAccountId);
				if (!targetAccount) {
					return c.json({ error: "指定账户不存在" }, 404);
				}
			} else {
				targetAccount = await getActiveAccount();
			}

			const accountLabel = targetAccount
				? `${targetAccount.name || "account"} (#${targetAccount.id})`
				: "default";
			logger.warn(
				`收到重置实盘数据请求 (account=${accountLabel})，开始清理数据...`,
			);

			// 调用重置逻辑，仅清理指定账户数据
			const result = await resetLiveDataToDefaults(targetAccount);

			logger.info(`实盘数据重置完成 (account=${accountLabel})`);

			return c.json({
				success: true,
				data: result,
			});
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "未知错误";
			logger.error("重置实盘数据失败:", error);
			return c.json({ error: message }, 500);
		}
	});

	/**
	 * 策略文件管理 API
	 */

	// 获取策略列表
	// 注意：多任务并行架构下，不再有"激活策略"的概念，每个策略任务独立选择策略
	app.get("/api/strategies", requireAuth, async (c) => {
		try {
			const { StrategyFileManager } = await import(
				"../services/strategyFileManager"
			);
			const strategyNames = await StrategyFileManager.listStrategies();

			// 构建策略列表（多任务并行模式下移除 isActive 标志）
			const strategies = strategyNames.map((name) => ({
				name: name,
			}));

			return c.json({ strategies });
		} catch (error) {
			logger.error("获取策略列表失败:", error);
			return c.json({ error: "获取策略列表失败" }, 500);
		}
	});

	// 获取指定策略内容
	app.get("/api/strategies/:name", requireAuth, async (c) => {
		try {
			const filename = c.req.param("name");
			const name = filename.replace(/\.json$/, "");
			const { StrategyFileManager } = await import(
				"../services/strategyFileManager"
			);
			const strategy = await StrategyFileManager.loadStrategy(name);

			if (!strategy) {
				return c.json({ error: "策略不存在" }, 404);
			}

			// 将数据结构转换为前端期望的格式
			const response = {
				name: strategy.meta.name,
				meta: strategy.meta,
				prompts: strategy.prompts,
				// 直接返回完整 params，确保 tradingSymbols 等字段不丢失
				params: strategy.params,
				config: {
					MAX_LEVERAGE: strategy.params.leverage,
					MAX_POSITIONS: strategy.params.maxPositions,
					TRADING_INTERVAL_MINUTES: strategy.params.intervalMinutes,
					MIN_HOLDING_MINUTES: strategy.params.minHoldingMinutes ?? 0,
					MAX_HOLDING_HOURS: strategy.params.maxHoldingHours,
					ACCOUNT_STOP_LOSS_USDT: strategy.params.accountStopLoss,
					ACCOUNT_TAKE_PROFIT_USDT: strategy.params.accountTakeProfit,
					EXTREME_STOP_LOSS_PERCENT: strategy.params.extremeStopLossPercent,
					ACCOUNT_DRAWDOWN_WARNING_PERCENT: strategy.params.drawdownWarning,
					ACCOUNT_DRAWDOWN_NO_NEW_POSITION_PERCENT:
						strategy.params.drawdownNoNew,
					ACCOUNT_DRAWDOWN_FORCE_CLOSE_PERCENT:
						strategy.params.drawdownForceClose,
				},
			};

			return c.json(response);
		} catch (error) {
			logger.error("获取策略内容失败:", error);
			return c.json({ error: "获取策略内容失败" }, 500);
		}
	});

	// 保存/更新策略
	app.put("/api/strategies/:filename", requireAuthWithCsrf, async (c) => {
		try {
			const filename = c.req.param("filename");
			const name = filename.replace(/\.json$/, "");
			const body = await c.req.json();
			const { tradingStrategy: _deprecatedStrategy, ...rawParams } =
				body.params || {};

			// 前端直接发送 StrategyFileContent 格式
			const { StrategyFileManager } = await import(
				"../services/strategyFileManager"
			);
			
			const content = {
				meta: {
					name: body.meta?.name || name,
					version: body.meta?.version || "1.0",
					updatedAt: new Date().toISOString(),
					description: body.meta?.description,
				},
				prompts: body.prompts,
				params: rawParams,
			};
			const success = await StrategyFileManager.saveStrategy(name, content);

			if (!success) {
				return c.json({ error: "保存策略失败" }, 500);
			}

			return c.json({ success: true });
		} catch (error) {
			logger.error("保存策略失败:", error);
			return c.json({ error: "保存策略失败" }, 500);
		}
	});

	// 删除策略
	app.delete("/api/strategies/:filename", requireAuthWithCsrf, async (c) => {
		try {
			const filename = c.req.param("filename");
			const name = filename.replace(/\.json$/, "");
			const { StrategyFileManager } = await import(
				"../services/strategyFileManager"
			);
			const success = await StrategyFileManager.deleteStrategy(name);

			if (!success) {
				return c.json({ error: "删除策略失败" }, 500);
			}

			return c.json({ success: true });
		} catch (error) {
			logger.error("删除策略失败:", error);
			return c.json({ error: "删除策略失败" }, 500);
		}
	});

	// 激活策略（将策略内容应用到系统配置）
	app.post(
		"/api/strategies/:filename/activate",
		requireAuthWithCsrf,
		async (c) => {
			try {
				const filename = c.req.param("filename");
				const name = filename.replace(/\.json$/, "");
				const { StrategyFileManager } = await import(
					"../services/strategyFileManager"
				);
				const strategy = await StrategyFileManager.loadStrategy(name);

				if (!strategy) {
					return c.json({ error: "策略不存在" }, 404);
				}

				// 1. 更新数据库中的系统配置
				const { updateSystemConfig } = await import("../database/init-config");

				// 映射策略参数到系统配置键
				const configUpdates: Record<string, string> = {
					// 交易参数
					TRADING_INTERVAL_MINUTES: String(strategy.params.intervalMinutes),
					MAX_LEVERAGE: String(strategy.params.leverage),
					MAX_POSITIONS: String(strategy.params.maxPositions),
					MAX_HOLDING_HOURS: String(strategy.params.maxHoldingHours),
					MIN_HOLDING_MINUTES: String(strategy.params.minHoldingMinutes ?? 0),
					EXTREME_STOP_LOSS_PERCENT: String(
						strategy.params.extremeStopLossPercent,
					),

					// 账户风控
					ACCOUNT_STOP_LOSS_USDT: String(strategy.params.accountStopLoss),
					ACCOUNT_TAKE_PROFIT_USDT: String(strategy.params.accountTakeProfit),
					ACCOUNT_DRAWDOWN_WARNING_PERCENT: String(
						strategy.params.drawdownWarning,
					),
					ACCOUNT_DRAWDOWN_NO_NEW_POSITION_PERCENT: String(
						strategy.params.drawdownNoNew,
					),
					ACCOUNT_DRAWDOWN_FORCE_CLOSE_PERCENT: String(
						strategy.params.drawdownForceClose,
					),

					// 提示词
					PROMPT_SECTION_ENTRY: strategy.prompts.entryLogic,
					PROMPT_SECTION_EXIT: strategy.prompts.exitLogic,
					PROMPT_SECTION_VARIABLES: "",

					// 保存激活的策略名称
					ACTIVE_STRATEGY_NAME: name,
				};

				await updateSystemConfig(configUpdates);

				// 2. 重新加载配置，Strategy Tasks 会在下一轮执行时读取最新参数
				await reloadRiskParams();

				logger.info(`已激活策略: ${name}`);

				return c.json({ success: true });
			} catch (error) {
				logger.error("激活策略失败:", error);
				return c.json({ error: "激活策略失败" }, 500);
			}
		},
	);

	return app;
}
