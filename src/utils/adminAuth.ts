import { createHash, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";

export interface AdminAuthConfig {
	adminPath: string;
	username: string;
	password: string;
}

const CREDENTIALS_FILE = path.resolve(process.cwd(), ".q4ai");
const DEFAULT_USERNAME = "admin";
const FILE_PERMISSIONS = 0o600;

let cachedConfig: AdminAuthConfig | null = null;

/**
 * 从数据库读取管理员凭证
 */
async function readConfigFromDatabase(): Promise<AdminAuthConfig | null> {
	try {
		const dbClient = createClient({
			url: process.env.DATABASE_URL || "file:./data/database/sqlite.db",
		});

		const result = await dbClient.execute({
			sql: "SELECT admin_path, username, password_hash FROM admin_credentials ORDER BY id DESC LIMIT 1",
			args: [],
		});

		await dbClient.close();

		if (result.rows.length === 0) {
			return null;
		}

		const row = result.rows[0];
		return {
			adminPath: String(row.admin_path),
			username: String(row.username),
			password: String(row.password_hash), // 注意：这是哈希后的密码，用于验证
		};
	} catch (error: unknown) {
		// 数据库不存在或表不存在时返回 null
		return null;
	}
}

/**
 * 从旧的文件系统读取配置（兼容旧版本）
 */
async function readExistingConfig(): Promise<AdminAuthConfig | null> {
	try {
		const raw = await fs.readFile(CREDENTIALS_FILE, "utf-8");
		const parsed = JSON.parse(raw) as Partial<AdminAuthConfig>;
		if (!parsed.adminPath || !parsed.username || !parsed.password) {
			return null;
		}
		return {
			adminPath: parsed.adminPath,
			username: parsed.username,
			password: parsed.password,
		};
	} catch (error: unknown) {
		if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
			return null;
		}
		throw error;
	}
}

function generateAdminPath(): string {
	const hash = createHash("md5").update(randomBytes(32)).digest("hex");
	return `/${hash.slice(0, 16)}`;
}

function generatePassword(): string {
	const charset = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
	const bytes = randomBytes(16);
	let password = "";
	for (let i = 0; i < bytes.length; i += 1) {
		password += charset[bytes[i] % charset.length];
	}
	return password;
}

async function writeConfig(config: AdminAuthConfig): Promise<boolean> {
	const payload = JSON.stringify(
		{
			adminPath: config.adminPath,
			username: config.username,
			password: config.password,
			updatedAt: new Date().toISOString(),
		},
		null,
		2,
	);

	try {
		await fs.writeFile(CREDENTIALS_FILE, payload, {
			mode: FILE_PERMISSIONS,
			flag: "wx",
		});
		return true;
	} catch (error: unknown) {
		if ((error as NodeJS.ErrnoException)?.code === "EEXIST") {
			return false;
		}
		throw error;
	}
}

type LoggerLike = {
	info: (...args: unknown[]) => void;
};

export async function initializeAdminAuth(
	logger?: LoggerLike,
): Promise<AdminAuthConfig> {
	if (cachedConfig) {
		return cachedConfig;
	}

	// 优先从数据库读取凭证（新安装方式）
	const dbConfig = await readConfigFromDatabase();
	if (dbConfig) {
		cachedConfig = dbConfig;
		logger?.info(`[后台登录] 已从数据库加载后台入口: /${dbConfig.adminPath}`);
		logger?.info(`[后台登录] 账号: ${dbConfig.username}`);
		return dbConfig;
	}

	// 兼容旧版本：从文件读取
	const existing = await readExistingConfig();
	if (existing) {
		cachedConfig = existing;
		logger?.info(`[后台登录] 已加载后台入口: ${existing.adminPath}`);
		logger?.info(
			`[后台登录] 账号: ${existing.username}，密码已保存在 ./.q4ai 文件中`,
		);
		return existing;
	}

	// 如果数据库和文件都没有，抛出错误（不应该发生，因为安装时会生成）
	throw new Error("未找到管理员凭证，请先完成系统安装");
}

export function getAdminAuthConfig(): AdminAuthConfig {
	if (!cachedConfig) {
		throw new Error("Admin auth config has not been initialized");
	}
	return cachedConfig;
}
