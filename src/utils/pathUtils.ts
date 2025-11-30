import fs from "fs";
import path from "path";
import process from "process";

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
		// 数据存放在 EXE 文件同级目录下
		return path.join(path.dirname(process.execPath), "data");
	}

	// 3. === 开发模式 (npm run dev) ===
	// 数据存放在项目根目录下，避免污染 Node.js 安装目录
	return path.join(process.cwd(), "data");
}

export function getStrategiesDir(): string {
	const dir = path.join(getAppDataPath(), "strategies");
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
	return dir;
}
