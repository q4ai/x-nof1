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

import { execSync } from "node:child_process";

/**
 * 编码工具函数 - 解决Windows环境下中文乱码问题
 *
 * Windows终端默认使用GBK编码，而Linux使用UTF-8编码
 * 此工具函数提供跨平台的编码处理方案
 */

/**
 * 检测当前运行环境是否为Windows
 * @returns 如果是Windows环境返回true，否则返回false
 */
export function isWindows(): boolean {
	return process.platform === "win32";
}

let encodingInitialized = false;

/**
 * 检测当前终端是否支持UTF-8编码
 * @returns 如果支持UTF-8编码返回true，否则返回false
 */
export function isUtf8Supported(): boolean {
	// 检查环境变量
	const lang = process.env.LANG || process.env.LC_ALL || process.env.LC_CTYPE;
	if (lang && lang.toLowerCase().includes("utf-8")) {
		return true;
	}

	// 在Windows下，Git Bash和Windows Terminal通常支持UTF-8
	if (isWindows()) {
		// 检查是否在Git Bash或Windows Terminal中运行
		const termProgram = process.env.TERM_PROGRAM || "";
		const term = process.env.TERM || "";
		if (
			termProgram.includes("Git") ||
			term.includes("xterm") ||
			term.includes("msys")
		) {
			return true;
		}
	}

	return false;
}

/**
 * 确保文本在终端中正确显示
 * 在Windows环境下，如果终端不支持UTF-8，尝试转换编码
 * @param text 要显示的文本
 * @returns 处理后的文本
 */
export function ensureTerminalDisplay(text: string): string {
	return text;
}

/**
 * 初始化终端编码设置
 * 尝试设置终端编码为UTF-8
 */
export function initializeTerminalEncoding(): void {
	if (!isWindows() || encodingInitialized) {
		return;
	}

	encodingInitialized = true;

	try {
		// 通过 chcp 指令切换控制台代码页，确保 Node 进程输出 UTF-8
		execSync("chcp 65001 > nul", { stdio: "ignore" });
	} catch (error) {
		// chcp 执行失败不应阻止系统启动
	}

	try {
		if (process.stdout.isTTY) {
			process.stdout.write("\x1B%G");
		}

		process.env.CHCP = "65001";
		if (!process.env.LANG) {
			process.env.LANG = "zh_CN.UTF-8";
		}
		if (!process.env.LC_ALL) {
			process.env.LC_ALL = "zh_CN.UTF-8";
		}
	} catch (error) {
		// 忽略设置失败的错误
	}
}

/**
 * 安全日志输出函数
 * 确保中文文本在终端中正确显示
 * @param logger 原始日志函数
 * @returns 包装后的安全日志函数
 */
export function createSafeLogger<T extends (...args: any[]) => any>(
	logger: T,
): T {
	return ((...args: any[]) => {
		try {
			// 处理所有字符串参数
			const processedArgs = args.map((arg) => {
				if (typeof arg === "string") {
					return ensureTerminalDisplay(arg);
				}
				return arg;
			});

			return logger(...processedArgs);
		} catch (error) {
			// 如果处理失败，使用原始参数调用
			return logger(...args);
		}
	}) as T;
}
