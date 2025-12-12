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
 * 数据库初始化脚本
 */
import "dotenv/config";
import { createClient } from "@libsql/client";
import { createLogger } from "../utils/loggerUtils";
import { getDatabaseUrl } from "../utils/pathUtils";
import { CREATE_TABLES_SQL } from "./schema";

const logger = createLogger({
	name: "database-init",
	level: "info",
});

type LibSqlClient = ReturnType<typeof createClient>;

type DbRow = Record<string, unknown>;

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

async function resolveInitialBalanceFromConfig(
	client: LibSqlClient,
	fallback: number,
): Promise<number> {
	try {
		const result = await client.execute({
			sql: "SELECT value FROM system_config WHERE key = ? LIMIT 1",
			args: ["INITIAL_BALANCE"],
		});

		if (result.rows.length > 0) {
			const row = result.rows[0] as Record<string, unknown>;
			const rawValue = row.value;
			const parsed = Number.parseFloat(
				typeof rawValue === "string" ? rawValue : String(rawValue ?? ""),
			);
			if (Number.isFinite(parsed)) {
				return parsed;
			}
		}
	} catch (error) {
		logger.warn("读取系统配置中的初始资金失败，将使用环境变量默认值:", error);
	}
	return fallback;
}

async function initDatabase() {
	const dbUrl = getDatabaseUrl();
	let initialBalance = Number.parseFloat(process.env.INITIAL_BALANCE || "1000");

	logger.info(`初始化数据库: ${dbUrl}`);

	const client = createClient({
		url: dbUrl,
	});

	try {
		// 执行建表语句
		logger.info("创建数据库表...");
		await client.executeMultiple(CREATE_TABLES_SQL);

		// 若 system_config 已由安装向导写入，优先使用其中的初始资金
		initialBalance = await resolveInitialBalanceFromConfig(
			client,
			initialBalance,
		);

		// 检查是否需要重新初始化
		const existingHistory = await client.execute(
			"SELECT COUNT(*) as count FROM account_history",
		);
		const existingHistoryRow = asDbRows(existingHistory.rows)[0];
		const count = toNumber(existingHistoryRow?.count);

		if (count > 0) {
			// 检查第一条记录的资金是否与当前设置不同，仅记录日志，不做删除操作
			const firstRecord = await client.execute(
				"SELECT total_value FROM account_history ORDER BY id ASC LIMIT 1",
			);
			const firstBalanceRow = asDbRows(firstRecord.rows)[0];
			const firstBalance = toNumber(firstBalanceRow?.total_value);

			if (firstBalance !== initialBalance) {
				logger.warn(
					`⚠️  检测到初始资金配置与数据库记录不一致: 数据库=${firstBalance} USDT, 环境变量=${initialBalance} USDT。` +
						"系统将保留现有数据，并使用数据库中的初始资金作为基准。",
				);

				// 以数据库中的初始资金为准，覆盖环境变量配置
				await client.execute({
					sql: `INSERT INTO system_config (key, value, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?`,
					args: [
						"INITIAL_BALANCE",
						firstBalance.toString(),
						new Date().toISOString(),
						firstBalance.toString(),
						new Date().toISOString(),
					],
				});
			} else {
				logger.info(`数据库已有 ${count} 条账户历史记录，跳过初始化`);
			}

			// 显示当前状态后直接返回
			const latestAccount = await client.execute(
				"SELECT * FROM account_history ORDER BY timestamp DESC LIMIT 1",
			);
			if (latestAccount.rows.length > 0) {
				const accountRow = asDbRows(latestAccount.rows)[0];
				const totalValue = toNumber(accountRow?.total_value);
				const availableCash = toNumber(accountRow?.available_cash);
				const unrealizedPnl = toNumber(accountRow?.unrealized_pnl);
				const returnPercent = toNumber(accountRow?.return_percent);
				logger.info("当前账户状态:");
				logger.info(`  总资产: ${totalValue} USDT`);
				logger.info(`  可用资金: ${availableCash} USDT`);
				logger.info(`  未实现盈亏: ${unrealizedPnl} USDT`);
				logger.info(`  总收益率: ${returnPercent}%`);
			}

			const positions = await client.execute("SELECT * FROM positions");
			if (positions.rows.length > 0) {
				logger.info(`\n当前持仓 (${positions.rows.length}):`);
				asDbRows(positions.rows).forEach((position) => {
					logger.info(
						`  ${toStringSafe(position.symbol)}: ${toStringSafe(position.quantity)} @ ${toStringSafe(position.entry_price)} (${toStringSafe(position.side)}, ${toStringSafe(position.leverage)}x)`,
					);
				});
			} else {
				logger.info("\n当前无持仓");
			}

			logger.info("\n✅ 数据库初始化完成 (保留现有数据)");
			return;
		}

		// 插入初始账户记录
		logger.info(`插入初始资金记录: ${initialBalance} USDT`);
		await client.execute({
			sql: `INSERT INTO account_history 
            (timestamp, total_value, available_cash, unrealized_pnl, realized_pnl, return_percent) 
            VALUES (?, ?, ?, ?, ?, ?)`,
			args: [new Date().toISOString(), initialBalance, initialBalance, 0, 0, 0],
		});
		logger.info("✅ 初始资金记录已创建");

		// 显示当前账户状态
		const latestAccount = await client.execute(
			"SELECT * FROM account_history ORDER BY timestamp DESC LIMIT 1",
		);

		if (latestAccount.rows.length > 0) {
			const accountRow = asDbRows(latestAccount.rows)[0];
			logger.info("当前账户状态:");
			logger.info(`  总资产: ${toNumber(accountRow?.total_value)} USDT`);
			logger.info(`  可用资金: ${toNumber(accountRow?.available_cash)} USDT`);
			logger.info(`  未实现盈亏: ${toNumber(accountRow?.unrealized_pnl)} USDT`);
			logger.info(`  总收益率: ${toNumber(accountRow?.return_percent)}%`);
		}

		// 显示当前持仓
		const positions = await client.execute("SELECT * FROM positions");

		if (positions.rows.length > 0) {
			logger.info(`\n当前持仓 (${positions.rows.length}):`);
			asDbRows(positions.rows).forEach((position) => {
				logger.info(
					`  ${toStringSafe(position.symbol)}: ${toStringSafe(position.quantity)} @ ${toStringSafe(position.entry_price)} (${toStringSafe(position.side)}, ${toStringSafe(position.leverage)}x)`,
				);
			});
		} else {
			logger.info("\n当前无持仓");
		}

		logger.info("\n✅ 数据库初始化完成");

		// 执行数据库迁移
		logger.info("检查数据库迁移...");
		const {
			ensureAgentDecisionExecutionColumn,
			ensureContractMultipliersTable,
			ensureAgentRequestLogsTable,
			ensureAccountConfigsTable,
		} = await import("./migrations");
		await ensureAgentDecisionExecutionColumn(client);
		await ensureContractMultipliersTable(client);
		await ensureAgentRequestLogsTable(client);
		await ensureAccountConfigsTable(client);
		logger.info("数据库迁移检查完成");
	} catch (error: unknown) {
		if (error instanceof Error) {
			logger.error("❌ 数据库初始化失败:", error.message);
		} else {
			logger.error("❌ 数据库初始化失败: 未知错误", error);
		}
		process.exit(1);
	} finally {
		client.close();
	}
}

export { initDatabase };
