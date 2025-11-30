/**
 * Strategy Task 服务 - 多账户并行策略任务管理
 *
 * 每个 Strategy Task 代表一个独立的交易配置：
 * - 绑定一个交易所账户
 * - 绑定一个 AI 模型
 * - 绑定一个策略文件
 * - 可独立启停
 */

import { createClient } from "@libsql/client";
import { createLogger } from "../utils/loggerUtils";
import { getChinaTimeISO } from "../utils/timeUtils";

const logger = createLogger({
	name: "trading-instance-service",
	level: "info",
});

const dbClient = createClient({
	url: process.env.DATABASE_URL || "file:./data/database/sqlite.db",
});

/**
 * Strategy Task 状态
 */
export type TradingInstanceStatus = "running" | "paused" | "stopped";

/**
 * Strategy Task 数据结构
 */
export interface TradingInstance {
	id: number;
	name: string;
	account_id: number;
	ai_model_id: number;
	strategy_name: string;
	status: TradingInstanceStatus;
	interval_minutes: number;
	last_executed_at: string | null;
	last_execution_status: "success" | "error" | "skipped" | null;
	created_at: string;
	updated_at: string;
}

/**
 * 带关联信息的 Strategy Task（用于前端展示）
 */
export interface TradingInstanceWithDetails extends TradingInstance {
	account_name?: string;
	account_provider?: string;
	ai_model_name?: string;
	model_name?: string;
}

/**
 * 创建 Strategy Task 输入
 */
export interface CreateTradingInstanceInput {
	name: string;
	account_id: number;
	ai_model_id: number;
	strategy_name: string;
	interval_minutes?: number;
}

/**
 * 更新 Strategy Task 输入
 */
export interface UpdateTradingInstanceInput {
	name?: string;
	account_id?: number;
	ai_model_id?: number;
	strategy_name?: string;
	interval_minutes?: number;
	status?: TradingInstanceStatus;
}

/**
 * 确保 trading_instances 表存在
 */
export async function ensureTradingInstancesTable(): Promise<void> {
	try {
		const result = await dbClient.execute({
			sql: "SELECT name FROM sqlite_master WHERE type='table' AND name='trading_instances'",
			args: [],
		});

		if (result.rows.length > 0) {
			logger.debug("trading_instances 表已存在");
			return;
		}

		logger.info("创建 trading_instances 表...");

		await dbClient.execute(`
      CREATE TABLE IF NOT EXISTS trading_instances (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        account_id INTEGER NOT NULL,
        ai_model_id INTEGER NOT NULL,
        strategy_name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'stopped',
        interval_minutes INTEGER NOT NULL DEFAULT 20,
        last_executed_at TEXT,
        last_execution_status TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (account_id) REFERENCES account_configs(id) ON DELETE CASCADE,
        FOREIGN KEY (ai_model_id) REFERENCES ai_models(id) ON DELETE CASCADE
      )
    `);

		await dbClient.execute(`
      CREATE INDEX IF NOT EXISTS idx_trading_instances_status ON trading_instances(status)
    `);

		await dbClient.execute(`
      CREATE INDEX IF NOT EXISTS idx_trading_instances_account_id ON trading_instances(account_id)
    `);

		logger.info("✅ trading_instances 表创建成功");
	} catch (error) {
		logger.error("创建 trading_instances 表失败:", error);
		throw error;
	}
}

/**
 * 获取所有 Strategy Tasks
 */
export async function getAllTradingInstances(): Promise<
	TradingInstanceWithDetails[]
> {
	try {
		const result = await dbClient.execute(`
      SELECT 
        ti.*,
        ac.name as account_name,
        ac.provider as account_provider,
        am.name as ai_model_name,
        am.model_name as model_name
      FROM trading_instances ti
      LEFT JOIN account_configs ac ON ti.account_id = ac.id
      LEFT JOIN ai_models am ON ti.ai_model_id = am.id
      ORDER BY ti.created_at DESC
    `);

		return result.rows.map((row: any) => ({
			id: row.id,
			name: row.name,
			account_id: row.account_id,
			ai_model_id: row.ai_model_id,
			strategy_name: row.strategy_name,
			status: row.status as TradingInstanceStatus,
			interval_minutes: row.interval_minutes,
			last_executed_at: row.last_executed_at,
			last_execution_status: row.last_execution_status,
			created_at: row.created_at,
			updated_at: row.updated_at,
			account_name: row.account_name,
			account_provider: row.account_provider,
			ai_model_name: row.ai_model_name,
			model_name: row.model_name,
		}));
	} catch (error) {
		logger.error("获取 Strategy Tasks 失败:", error);
		throw error;
	}
}

/**
 * 获取所有正在运行的 Strategy Tasks
 */
export async function getRunningInstances(): Promise<
	TradingInstanceWithDetails[]
> {
	try {
		const result = await dbClient.execute(`
      SELECT 
        ti.*,
        ac.name as account_name,
        ac.provider as account_provider,
        ac.api_key,
        ac.api_secret,
        ac.api_passphrase,
        ac.use_paper,
        ac.proxy_url,
        ac.stop_loss_usdt,
        ac.take_profit_usdt,
        am.name as ai_model_name,
        am.model_name as model_name,
        am.api_key as ai_api_key,
        am.base_url as ai_base_url
      FROM trading_instances ti
      JOIN account_configs ac ON ti.account_id = ac.id
      JOIN ai_models am ON ti.ai_model_id = am.id
      WHERE ti.status = 'running'
      ORDER BY ti.id ASC
    `);

		return result.rows.map((row: any) => ({
			id: row.id,
			name: row.name,
			account_id: row.account_id,
			ai_model_id: row.ai_model_id,
			strategy_name: row.strategy_name,
			status: row.status as TradingInstanceStatus,
			interval_minutes: row.interval_minutes,
			last_executed_at: row.last_executed_at,
			last_execution_status: row.last_execution_status,
			created_at: row.created_at,
			updated_at: row.updated_at,
			account_name: row.account_name,
			account_provider: row.account_provider,
			ai_model_name: row.ai_model_name,
			model_name: row.model_name,
			// 附加完整的账户和模型信息供执行时使用
			_accountConfig: {
				id: row.account_id,
				name: row.account_name,
				provider: row.account_provider,
				api_key: row.api_key,
				api_secret: row.api_secret,
				api_passphrase: row.api_passphrase,
				use_paper: Boolean(row.use_paper),
				proxy_url: row.proxy_url,
				stop_loss_usdt: row.stop_loss_usdt,
				take_profit_usdt: row.take_profit_usdt,
			},
			_aiModelConfig: {
				id: row.ai_model_id,
				name: row.ai_model_name,
				model_name: row.model_name,
				api_key: row.ai_api_key,
				base_url: row.ai_base_url,
			},
		}));
	} catch (error) {
		logger.error("获取运行中的 Strategy Tasks 失败:", error);
		throw error;
	}
}

/**
 * 根据 ID 获取 Strategy Task
 */
export async function getTradingInstanceById(
	id: number,
): Promise<TradingInstanceWithDetails | null> {
	try {
		const result = await dbClient.execute({
			sql: `
        SELECT 
          ti.*,
          ac.name as account_name,
          ac.provider as account_provider,
          am.name as ai_model_name,
          am.model_name as model_name
        FROM trading_instances ti
        LEFT JOIN account_configs ac ON ti.account_id = ac.id
        LEFT JOIN ai_models am ON ti.ai_model_id = am.id
        WHERE ti.id = ?
      `,
			args: [id],
		});

		if (result.rows.length === 0) {
			return null;
		}

		const row: any = result.rows[0];
		return {
			id: row.id,
			name: row.name,
			account_id: row.account_id,
			ai_model_id: row.ai_model_id,
			strategy_name: row.strategy_name,
			status: row.status as TradingInstanceStatus,
			interval_minutes: row.interval_minutes,
			last_executed_at: row.last_executed_at,
			last_execution_status: row.last_execution_status,
			created_at: row.created_at,
			updated_at: row.updated_at,
			account_name: row.account_name,
			account_provider: row.account_provider,
			ai_model_name: row.ai_model_name,
			model_name: row.model_name,
		};
	} catch (error) {
		logger.error(`获取 Strategy Task ${id} 失败:`, error);
		throw error;
	}
}

/**
 * 创建 Strategy Task
 */
export async function createTradingInstance(
	input: CreateTradingInstanceInput,
): Promise<TradingInstance> {
	try {
		const now = getChinaTimeISO();
		const intervalMinutes = input.interval_minutes || 20;

		const result = await dbClient.execute({
			sql: `
        INSERT INTO trading_instances 
          (name, account_id, ai_model_id, strategy_name, status, interval_minutes, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'stopped', ?, ?, ?)
      `,
			args: [
				input.name,
				input.account_id,
				input.ai_model_id,
				input.strategy_name,
				intervalMinutes,
				now,
				now,
			],
		});

		const id = Number(result.lastInsertRowid);
		logger.info(`创建 Strategy Task: ${input.name} (ID: ${id})`);

		return {
			id,
			name: input.name,
			account_id: input.account_id,
			ai_model_id: input.ai_model_id,
			strategy_name: input.strategy_name,
			status: "stopped",
			interval_minutes: intervalMinutes,
			last_executed_at: null,
			last_execution_status: null,
			created_at: now,
			updated_at: now,
		};
	} catch (error) {
		logger.error("创建 Strategy Task 失败:", error);
		throw error;
	}
}

/**
 * 更新 Strategy Task
 */
export async function updateTradingInstance(
	id: number,
	input: UpdateTradingInstanceInput,
): Promise<TradingInstance | null> {
	try {
		const existing = await getTradingInstanceById(id);
		if (!existing) {
			return null;
		}

		const updates: string[] = [];
		const args: (string | number)[] = [];

		if (input.name !== undefined) {
			updates.push("name = ?");
			args.push(input.name);
		}
		if (input.account_id !== undefined) {
			updates.push("account_id = ?");
			args.push(input.account_id);
		}
		if (input.ai_model_id !== undefined) {
			updates.push("ai_model_id = ?");
			args.push(input.ai_model_id);
		}
		if (input.strategy_name !== undefined) {
			updates.push("strategy_name = ?");
			args.push(input.strategy_name);
		}
		if (input.interval_minutes !== undefined) {
			updates.push("interval_minutes = ?");
			args.push(input.interval_minutes);
		}
		if (input.status !== undefined) {
			updates.push("status = ?");
			args.push(input.status);
		}

		if (updates.length === 0) {
			return existing;
		}

		const now = getChinaTimeISO();
		updates.push("updated_at = ?");
		args.push(now);
		args.push(id);

		await dbClient.execute({
			sql: `UPDATE trading_instances SET ${updates.join(", ")} WHERE id = ?`,
			args,
		});

		logger.info(`更新 Strategy Task ${id}: ${updates.join(", ")}`);

		return getTradingInstanceById(id);
	} catch (error) {
		logger.error(`更新 Strategy Task ${id} 失败:`, error);
		throw error;
	}
}

/**
 * 删除 Strategy Task
 */
export async function deleteTradingInstance(id: number): Promise<boolean> {
	try {
		const result = await dbClient.execute({
			sql: "DELETE FROM trading_instances WHERE id = ?",
			args: [id],
		});

		const deleted = result.rowsAffected > 0;
		if (deleted) {
			logger.info(`删除 Strategy Task ${id}`);
		}
		return deleted;
	} catch (error) {
		logger.error(`删除 Strategy Task ${id} 失败:`, error);
		throw error;
	}
}

/**
 * 更新实例状态
 */
export async function setInstanceStatus(
	id: number,
	status: TradingInstanceStatus,
): Promise<boolean> {
	try {
		const now = getChinaTimeISO();
		const result = await dbClient.execute({
			sql: "UPDATE trading_instances SET status = ?, updated_at = ? WHERE id = ?",
			args: [status, now, id],
		});

		if (result.rowsAffected > 0) {
			logger.info(`Strategy Task ${id} 状态更新为: ${status}`);
			return true;
		}
		return false;
	} catch (error) {
		logger.error(`更新 Strategy Task ${id} 状态失败:`, error);
		throw error;
	}
}

/**
 * 更新实例执行状态
 */
export async function updateInstanceExecutionStatus(
	id: number,
	executionStatus: "success" | "error" | "skipped",
): Promise<void> {
	try {
		const now = getChinaTimeISO();
		await dbClient.execute({
			sql: `
        UPDATE trading_instances 
        SET last_executed_at = ?, last_execution_status = ?, updated_at = ?
        WHERE id = ?
      `,
			args: [now, executionStatus, now, id],
		});
	} catch (error) {
		logger.error(`更新 Strategy Task ${id} 执行状态失败:`, error);
	}
}

/**
 * 检查实例是否应该执行（基于间隔时间）
 */
export function shouldInstanceExecute(instance: TradingInstance): boolean {
	if (instance.status !== "running") {
		return false;
	}

	if (!instance.last_executed_at) {
		return true; // 从未执行过，应该执行
	}

	const lastExecution = new Date(instance.last_executed_at);
	const now = new Date();
	const elapsedMinutes =
		(now.getTime() - lastExecution.getTime()) / (1000 * 60);

	return elapsedMinutes >= instance.interval_minutes;
}

/**
 * 启动实例
 */
export async function startInstance(id: number): Promise<boolean> {
	return setInstanceStatus(id, "running");
}

/**
 * 暂停实例
 */
export async function pauseInstance(id: number): Promise<boolean> {
	return setInstanceStatus(id, "paused");
}

/**
 * 停止实例
 */
export async function stopInstance(id: number): Promise<boolean> {
	return setInstanceStatus(id, "stopped");
}

/**
 * 获取最近的一个 Strategy Task（无论状态如何）
 * 用于前端展示默认模型等
 */
export async function getLatestInstance(): Promise<TradingInstanceWithDetails | null> {
	try {
		const result = await dbClient.execute(`
      SELECT 
        ti.*,
        ac.name as account_name,
        ac.provider as account_provider,
        am.name as ai_model_name,
        am.model_name as model_name
      FROM trading_instances ti
      LEFT JOIN account_configs ac ON ti.account_id = ac.id
      LEFT JOIN ai_models am ON ti.ai_model_id = am.id
      ORDER BY ti.updated_at DESC, ti.id DESC
      LIMIT 1
    `);

		if (result.rows.length === 0) {
			return null;
		}

		const row = result.rows[0];
		return {
			id: Number(row.id),
			name: String(row.name),
			account_id: Number(row.account_id),
			ai_model_id: Number(row.ai_model_id),
			strategy_name: String(row.strategy_name),
			status: row.status as TradingInstanceStatus,
			interval_minutes: Number(row.interval_minutes),
			last_executed_at: row.last_executed_at
				? String(row.last_executed_at)
				: null,
			last_execution_status: row.last_execution_status
				? (String(row.last_execution_status) as any)
				: null,
			created_at: String(row.created_at),
			updated_at: String(row.updated_at),
			account_name: row.account_name ? String(row.account_name) : undefined,
			account_provider: row.account_provider
				? String(row.account_provider)
				: undefined,
			ai_model_name: row.ai_model_name ? String(row.ai_model_name) : undefined,
			model_name: row.model_name ? String(row.model_name) : undefined,
		};
	} catch (error) {
		logger.error("获取最新 Strategy Task 失败:", error);
		return null;
	}
}

/**
 * 获取指定账户最近的一个 Strategy Task
 */
export async function getLatestInstanceForAccount(
	accountId: number,
): Promise<TradingInstanceWithDetails | null> {
	try {
		const result = await dbClient.execute({
			sql: `
        SELECT 
          ti.*,
          ac.name as account_name,
          ac.provider as account_provider,
          am.name as ai_model_name,
          am.model_name as model_name
        FROM trading_instances ti
        LEFT JOIN account_configs ac ON ti.account_id = ac.id
        LEFT JOIN ai_models am ON ti.ai_model_id = am.id
        WHERE ti.account_id = ?
        ORDER BY ti.updated_at DESC, ti.id DESC
        LIMIT 1
      `,
			args: [accountId],
		});

		if (result.rows.length === 0) {
			return null;
		}

		const row = result.rows[0];
		return {
			id: Number(row.id),
			name: String(row.name),
			account_id: Number(row.account_id),
			ai_model_id: Number(row.ai_model_id),
			strategy_name: String(row.strategy_name),
			status: row.status as TradingInstanceStatus,
			interval_minutes: Number(row.interval_minutes),
			last_executed_at: row.last_executed_at
				? String(row.last_executed_at)
				: null,
			last_execution_status: row.last_execution_status
				? (String(row.last_execution_status) as any)
				: null,
			created_at: String(row.created_at),
			updated_at: String(row.updated_at),
			account_name: row.account_name ? String(row.account_name) : undefined,
			account_provider: row.account_provider
				? String(row.account_provider)
				: undefined,
			ai_model_name: row.ai_model_name ? String(row.ai_model_name) : undefined,
			model_name: row.model_name ? String(row.model_name) : undefined,
		};
	} catch (error) {
		logger.error(`获取账户 ${accountId} 最新 Strategy Task 失败:`, error);
		return null;
	}
}
