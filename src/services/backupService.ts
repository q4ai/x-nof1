/**
 * 数据备份服务
 *
 * 功能:
 * - 创建完整备份 (数据库 + 策略文件) 打包为 zip
 * - 恢复备份
 * - 列出所有备份
 * - 删除备份
 * - 导入/导出备份
 *
 * 备份内容:
 * - data/database/sqlite.db - 数据库文件
 * - data/strategies/*.json - 自定义策略文件
 *
 * 备份存储位置: <运行目录>/data/backup/
 *
 * 注意: 使用 process.cwd() 获取当前工作目录，
 * 以支持打包成可执行文件 (.exe, .dmg, .deb) 后的正确运行
 */

import {
	copyFileSync,
	createReadStream,
	createWriteStream,
	existsSync,
	mkdirSync,
	readdirSync,
	statSync,
	unlinkSync,
} from "node:fs";
import { writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { pipeline } from "node:stream/promises";
import archiver from "archiver";
import unzipper from "unzipper";
import { createLogger } from "../utils/loggerUtils";
import { getChinaTimeISO } from "../utils/timeUtils";

const logger = createLogger({
	name: "backup-service",
	level: "info",
});

/** 备份信息接口 */
export interface BackupInfo {
	/** 备份文件名 */
	name: string;
	/** 创建时间 (ISO 格式) */
	createdAt: string;
	/** 文件大小 (字节) */
	size: number;
	/** 格式化后的文件大小 */
	sizeFormatted: string;
}

/**
 * 获取应用运行目录
 * 使用 process.cwd() 确保打包后的应用也能正确定位数据目录
 */
function getAppDir(): string {
	return process.cwd();
}

/**
 * 获取数据库文件路径
 */
function getDbPath(): string {
	return join(getAppDir(), "data", "database", "sqlite.db");
}

/**
 * 获取策略目录路径
 */
function getStrategiesDir(): string {
	return join(getAppDir(), "data", "strategies");
}

/**
 * 获取备份目录路径
 */
function getBackupDir(): string {
	return join(getAppDir(), "data", "backup");
}

/**
 * 确保备份目录存在
 */
function ensureBackupDir(): void {
	const backupDir = getBackupDir();
	if (!existsSync(backupDir)) {
		mkdirSync(backupDir, { recursive: true });
		logger.info(`创建备份目录: ${backupDir}`);
	}
}

/**
 * 格式化文件大小
 * @param bytes - 字节数
 * @returns 格式化后的大小字符串
 */
function formatFileSize(bytes: number): string {
	if (bytes === 0) return "0 B";

	const units = ["B", "KB", "MB", "GB"];
	const k = 1024;
	const i = Math.floor(Math.log(bytes) / Math.log(k));

	return `${(bytes / Math.pow(k, i)).toFixed(2)} ${units[i]}`;
}

/**
 * 生成备份文件名
 * 格式: backup_YYYYMMDD_HHMMSS.zip
 */
function generateBackupName(): string {
	const now = new Date();
	const year = now.getFullYear();
	const month = String(now.getMonth() + 1).padStart(2, "0");
	const day = String(now.getDate()).padStart(2, "0");
	const hours = String(now.getHours()).padStart(2, "0");
	const minutes = String(now.getMinutes()).padStart(2, "0");
	const seconds = String(now.getSeconds()).padStart(2, "0");

	return `backup_${year}${month}${day}_${hours}${minutes}${seconds}.zip`;
}

/**
 * 从备份文件名解析创建时间
 * @param filename - 备份文件名
 * @returns ISO 格式的时间字符串
 */
function parseBackupTime(filename: string): string {
	// 尝试从文件名解析时间: backup_YYYYMMDD_HHMMSS.zip 或 backup_YYYYMMDD_HHMMSS.db
	const match = filename.match(
		/backup_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/,
	);

	if (match) {
		const [, year, month, day, hours, minutes, seconds] = match;
		return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
	}

	// 如果无法解析，返回当前时间
	return getChinaTimeISO();
}

/**
 * 获取备份文件的完整路径
 * @param name - 备份文件名
 * @returns 完整路径
 */
export async function getBackupPath(name: string): Promise<string> {
	ensureBackupDir();

	// 安全检查: 防止路径遍历攻击
	const safeName = basename(name);
	return join(getBackupDir(), safeName);
}

/**
 * 获取所有备份列表
 * @returns 备份信息数组，按创建时间倒序排列
 */
export async function listBackups(): Promise<BackupInfo[]> {
	ensureBackupDir();
	const backupDir = getBackupDir();

	try {
		const files = readdirSync(backupDir);

		// 支持 .zip (新格式) 和 .db (旧格式) 备份文件
		const backups: BackupInfo[] = files
			.filter(
				(file) =>
					file.endsWith(".zip") ||
					file.endsWith(".db") ||
					file.endsWith(".sqlite") ||
					file.endsWith(".backup"),
			)
			.map((name) => {
				const filePath = join(backupDir, name);
				const stat = statSync(filePath);

				return {
					name,
					createdAt: parseBackupTime(name),
					size: stat.size,
					sizeFormatted: formatFileSize(stat.size),
				};
			})
			.sort((a, b) => b.createdAt.localeCompare(a.createdAt)); // 按时间倒序

		logger.info(`获取备份列表成功，共 ${backups.length} 个备份`);
		return backups;
	} catch (error) {
		logger.error("获取备份列表失败:", error);
		throw error;
	}
}

/**
 * 创建新备份 (zip 格式，包含数据库和策略文件)
 * @returns 创建的备份信息
 */
export async function createBackup(): Promise<BackupInfo> {
	ensureBackupDir();
	const dbPath = getDbPath();
	const strategiesDir = getStrategiesDir();
	const backupDir = getBackupDir();

	// 检查数据库文件是否存在
	if (!existsSync(dbPath)) {
		throw new Error(`数据库文件不存在，无法创建备份: ${dbPath}`);
	}

	const backupName = generateBackupName();
	const backupPath = join(backupDir, backupName);

	try {
		// 创建 zip 文件
		await new Promise<void>((resolve, reject) => {
			const output = createWriteStream(backupPath);
			const archive = archiver("zip", {
				zlib: { level: 9 }, // 最高压缩级别
			});

			output.on("close", () => {
				logger.info(
					`备份压缩完成，总大小: ${formatFileSize(archive.pointer())}`,
				);
				resolve();
			});

			archive.on("error", (err) => {
				reject(err);
			});

			archive.on("warning", (err) => {
				if (err.code === "ENOENT") {
					logger.warn("备份警告:", err.message);
				} else {
					reject(err);
				}
			});

			archive.pipe(output);

			// 添加数据库文件
			archive.file(dbPath, { name: "data/database/sqlite.db" });
			logger.info("已添加数据库文件到备份");

			// 添加策略文件夹 (如果存在)
			if (existsSync(strategiesDir)) {
				const strategyFiles = readdirSync(strategiesDir).filter((f) =>
					f.endsWith(".json"),
				);
				for (const file of strategyFiles) {
					const filePath = join(strategiesDir, file);
					archive.file(filePath, { name: `data/strategies/${file}` });
				}
				logger.info(`已添加 ${strategyFiles.length} 个策略文件到备份`);
			}

			archive.finalize();
		});

		const stat = statSync(backupPath);

		const backup: BackupInfo = {
			name: backupName,
			createdAt: getChinaTimeISO(),
			size: stat.size,
			sizeFormatted: formatFileSize(stat.size),
		};

		logger.info(`创建备份成功: ${backupName} (${backup.sizeFormatted})`);
		return backup;
	} catch (error) {
		// 清理失败的备份文件
		if (existsSync(backupPath)) {
			unlinkSync(backupPath);
		}
		logger.error("创建备份失败:", error);
		throw error;
	}
}

/**
 * 恢复备份
 * @param name - 备份文件名
 */
export async function restoreBackup(name: string): Promise<void> {
	ensureBackupDir();
	const appDir = getAppDir();
	const dbPath = getDbPath();
	const backupDir = getBackupDir();

	const safeName = basename(name);
	const backupPath = join(backupDir, safeName);

	// 检查备份文件是否存在
	if (!existsSync(backupPath)) {
		throw new Error(`备份文件不存在: ${safeName}`);
	}

	try {
		// 在恢复之前，先创建自动备份
		const autoBackupName = `auto_before_restore_${generateBackupName()}`;
		logger.info(`正在创建自动备份: ${autoBackupName}`);

		const autoBackupPath = join(backupDir, autoBackupName);
		if (existsSync(dbPath)) {
			// 创建简单的自动备份 zip
			await new Promise<void>((resolve, reject) => {
				const output = createWriteStream(autoBackupPath);
				const archive = archiver("zip", { zlib: { level: 9 } });

				output.on("close", resolve);
				archive.on("error", reject);
				archive.pipe(output);

				archive.file(dbPath, { name: "data/database/sqlite.db" });

				const strategiesDir = getStrategiesDir();
				if (existsSync(strategiesDir)) {
					const strategyFiles = readdirSync(strategiesDir).filter((f) =>
						f.endsWith(".json"),
					);
					for (const file of strategyFiles) {
						archive.file(join(strategiesDir, file), {
							name: `data/strategies/${file}`,
						});
					}
				}

				archive.finalize();
			});
			logger.info(`自动备份完成: ${autoBackupName}`);
		}

		// 判断备份文件类型
		if (safeName.endsWith(".zip")) {
			// 新格式: zip 文件，解压恢复
			logger.info("正在解压备份文件...");

			// 使用 unzipper 解压
			await pipeline(
				createReadStream(backupPath),
				unzipper.Extract({ path: appDir }),
			);

			logger.info(`恢复备份成功 (zip): ${safeName}`);
		} else {
			// 旧格式: 单个 db 文件，直接复制
			copyFileSync(backupPath, dbPath);
			logger.info(`恢复备份成功 (db): ${safeName}`);
		}
	} catch (error) {
		logger.error(`恢复备份失败: ${safeName}`, error);
		throw error;
	}
}

/**
 * 删除备份
 * @param name - 备份文件名
 */
export async function deleteBackup(name: string): Promise<void> {
	ensureBackupDir();
	const backupDir = getBackupDir();

	const safeName = basename(name);
	const backupPath = join(backupDir, safeName);

	// 检查备份文件是否存在
	if (!existsSync(backupPath)) {
		throw new Error(`备份文件不存在: ${safeName}`);
	}

	try {
		unlinkSync(backupPath);
		logger.info(`删除备份成功: ${safeName}`);
	} catch (error) {
		logger.error(`删除备份失败: ${safeName}`, error);
		throw error;
	}
}

/**
 * 导入备份文件
 * @param file - 上传的文件对象
 * @returns 导入的备份信息
 */
export async function importBackup(file: File): Promise<BackupInfo> {
	ensureBackupDir();
	const backupDir = getBackupDir();

	try {
		// 生成安全的文件名
		const originalName = basename(file.name);
		const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, "_");

		// 如果文件名已存在，添加时间戳后缀
		let finalName = safeName;
		let targetPath = join(backupDir, finalName);

		if (existsSync(targetPath)) {
			const timestamp = Date.now();
			const ext = safeName.split(".").pop() || "zip";
			const nameWithoutExt = safeName.replace(`.${ext}`, "");
			finalName = `${nameWithoutExt}_${timestamp}.${ext}`;
			targetPath = join(backupDir, finalName);
		}

		// 读取文件内容并写入
		const buffer = await file.arrayBuffer();
		await writeFile(targetPath, Buffer.from(buffer));

		const stat = statSync(targetPath);

		const backup: BackupInfo = {
			name: finalName,
			createdAt: getChinaTimeISO(),
			size: stat.size,
			sizeFormatted: formatFileSize(stat.size),
		};

		logger.info(`导入备份成功: ${finalName} (${backup.sizeFormatted})`);
		return backup;
	} catch (error) {
		logger.error("导入备份失败:", error);
		throw error;
	}
}
