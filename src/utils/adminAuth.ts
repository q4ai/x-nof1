import { promises as fs } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";

export interface AdminAuthConfig {
  adminPath: string;
  username: string;
  password: string;
}

const CREDENTIALS_FILE = path.resolve(process.cwd(), ".q4ai");
const DEFAULT_USERNAME = "admin";
const FILE_PERMISSIONS = 0o600;

let cachedConfig: AdminAuthConfig | null = null;

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
  const payload = JSON.stringify({
    adminPath: config.adminPath,
    username: config.username,
    password: config.password,
    updatedAt: new Date().toISOString(),
  }, null, 2);

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

export async function initializeAdminAuth(logger?: LoggerLike): Promise<AdminAuthConfig> {
  if (cachedConfig) {
    return cachedConfig;
  }

  const existing = await readExistingConfig();
  if (existing) {
    cachedConfig = existing;
    logger?.info(`[后台登录] 已加载后台入口: ${existing.adminPath}`);
    logger?.info(`[后台登录] 账号: ${existing.username}，密码已保存在 ./.q4ai 文件中`);
    return existing;
  }

  const config: AdminAuthConfig = {
    adminPath: generateAdminPath(),
    username: DEFAULT_USERNAME,
    password: generatePassword(),
  };

  const writeSucceeded = await writeConfig(config);

  if (!writeSucceeded) {
    const latest = await readExistingConfig();
    if (latest) {
      cachedConfig = latest;
      logger?.info("[后台登录] 检测到已有 ./.q4ai 凭证，沿用现有配置");
      return latest;
    }
    throw new Error("检测到 ./.q4ai 已存在但内容无效，请手动检查或删除后重试");
  }

  cachedConfig = config;

  logger?.info("[后台登录] 首次启动已生成后台入口和凭证");
  logger?.info(`[后台登录] 后台路径: ${config.adminPath}`);
  logger?.info(`[后台登录] 登录账号: ${config.username}`);
  logger?.info(`[后台登录] 登录密码: ${config.password}`);
  logger?.info("[后台登录] 凭证内容已保存至 ./.q4ai，请妥善保管");

  return config;
}

export function getAdminAuthConfig(): AdminAuthConfig {
  if (!cachedConfig) {
    throw new Error("Admin auth config has not been initialized");
  }
  return cachedConfig;
}
