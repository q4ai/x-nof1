import fs from "fs";
import os from "os";
import path from "path";
import process from "process";

const APP_NAME = process.env.APP_NAME || "q4-ai-trading-platform";

function ensureDir(dir: string): string {
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
	return dir;
}

function getWritableHome(): string {
	return os.homedir() || process.env.HOME || "";
}

function getPackagedDataHome(): string {
	if (process.platform === "win32") {
		const winBase = process.env.LOCALAPPDATA || process.env.APPDATA || path.join(getWritableHome(), "AppData", "Local");
		return path.join(winBase, APP_NAME);
	}

	// macOS / Linux: 放到用户目录下的隐藏目录
	const home = getWritableHome();
	return path.join(home || ".", `.${APP_NAME}`);
}

/**
 * 获取应用数据目录路径（跨平台兼容）
 * 
 * 优先级:
 * 1. 环境变量 APP_DATA_DIR（适用于 Docker/特殊部署）
 * 2. 打包模式（pkg/nexe）: 使用程序安装目录
 *    - Windows: exe所在目录/data
 *    - macOS/Linux: 可执行文件所在目录/data
 * 3. 开发模式: 使用项目根目录/data
 * 
 * @returns 绝对路径字符串（例如: /path/to/app/data）
 */
export function getAppDataPath(): string {
	// 1. 优先检查环境变量（方便 Docker 或特殊部署）
	if (process.env.APP_DATA_DIR) {
		return process.env.APP_DATA_DIR;
	}

	// 2. 检测是否在打包环境中运行 (pkg / nexe 等工具会将 process.pkg 设为 true)
	// @ts-ignore
	const isPackaged = typeof process.pkg !== "undefined";

	if (isPackaged) {
		// === 打包模式 (EXE) ===
		// 数据存放在程序安装目录下的 data 文件夹
		const exeDir = path.dirname(process.execPath);
		return ensureDir(path.join(exeDir, "data"));
	}

	// 3. === 开发模式 (npm run dev) ===
	// 数据存放在项目根目录下，避免污染 Node.js 安装目录
	return path.join(process.cwd(), "data");
}

/**
 * 获取数据库目录路径（跨平台兼容）
 * 
 * @returns 数据库目录绝对路径（例如: /path/to/app/data/database）
 */
export function getDatabaseDir(): string {
	const dir = path.join(getAppDataPath(), "database");
	return ensureDir(dir);
}

/**
 * 获取主数据库文件 URL（用于 @libsql/client）
 * 
 * @returns LibSQL 兼容的 file: URL（例如: file:/path/to/app/data/database/sqlite.db）
 */
export function getDatabaseUrl(): string {
	// 优先使用环境变量（兼容旧配置）
	if (process.env.DATABASE_URL) {
		return process.env.DATABASE_URL;
	}
	
	// 使用绝对路径构建 file: URL
	const dbPath = path.join(getDatabaseDir(), "sqlite.db");
	return `file:${dbPath}`;
}

/**
 * 获取策略目录路径（跨平台兼容）
 * 
 * @returns 策略目录绝对路径（例如: /path/to/app/data/strategies）
 */
export function getStrategiesDir(): string {
	const dir = path.join(getAppDataPath(), "strategies");
	return ensureDir(dir);
}

/**
 * 获取管理员凭证文件路径（跨平台兼容）
 * 
 * @returns 凭证文件绝对路径（例如: /path/to/app/.q4ai）
 */
export function getCredentialsPath(): string {
	// 打包模式: 存放在数据目录，避免 Program Files 写入权限问题
	const dataDir = getAppDataPath();
	return path.join(dataDir, ".q4ai");
}

/**
 * 获取安装锁文件路径（跨平台兼容）
 * 
 * @returns 安装锁文件绝对路径（例如: /path/to/app/data/install.lock）
 */
export function getInstallLockPath(): string {
	return path.join(getAppDataPath(), "install.lock");
}

/**
 * 获取 public 目录路径（支持打包模式）
 * 
 * @returns public 目录绝对路径
 */
export function getPublicDir(): string {
	// @ts-ignore - pkg 打包时会设置 process.pkg
	const isPackaged = typeof process.pkg !== "undefined";

	if (isPackaged) {
		// 打包模式: 使用程序安装目录下的 public 目录
		return path.join(path.dirname(process.execPath), "public");
	}

	// 开发模式: 使用项目根目录下的 public
	return path.join(process.cwd(), "public");
}

/**
 * 获取 public 文件路径（支持打包模式）
 * 
 * @param fileName - public 目录下的文件名（例如: login.html）
 * @returns public 文件绝对路径
 */
export function getPublicFilePath(fileName: string): string {
	return path.join(getPublicDir(), fileName);
}

/**
 * 获取语言文件路径（支持打包模式）
 * 
 * @param fileName - language 目录下的文件名（例如: en.json）
 * @returns language 文件绝对路径
 */
export function getLanguageFilePath(fileName: string): string {
	// @ts-ignore - pkg 打包时会设置 process.pkg
	const isPackaged = typeof process.pkg !== "undefined";

	if (isPackaged) {
		// 打包模式: 语言文件打包在快照内的 dist/language 中
		// 注意: tsdown 编译后 pathUtils 通常位于 dist 根目录 (作为 chunk)
		// 所以 __dirname 指向 dist 目录
		return path.join(__dirname, "language", fileName);
	}

	// 开发模式: 使用 src/language
	return path.join(process.cwd(), "src", "language", fileName);
}

