/**
 * Strategy Task 执行器
 *
 * 负责执行单个 Strategy Task 的交易决策。
 * 与 tradingLoop.ts 中的 executeTradingDecision 类似，但：
 * 1. 使用传入的实例配置（账户、模型、策略）而不是全局配置
 * 2. 不影响全局状态
 * 3. 独立的执行锁机制
 * 4. 使用 AsyncLocalStorage 实例上下文，让工具调用能获取正确的客户端
 */

import { Client, createClient } from "@libsql/client";
import { createOpenAI } from "@ai-sdk/openai";
import { Agent } from "@voltagent/core";
import { z } from "zod";
import * as tradingTools from "../tools/trading";
import { RISK_PARAMS, getConfigStringValue } from "../config/riskParams.new";
import {
	DEFAULT_STRATEGY_LANGUAGE,
	type StrategyLanguage,
	normalizeStrategyLanguage,
} from "../config/strategyTypes";
import { insertAgentRequestLog } from "../database/agent-request-logs";
import { getLocalizedPromptTemplate } from "../prompts/templateLoader";
import {
	type InstanceContext,
	type SymbolMarketDataHealth,
	runWithInstanceContext,
} from "../services/instanceContext";
import {
	type StrategyFileContent,
	StrategyFileManager,
} from "../services/strategyFileManager";
import type { TradingInstanceWithDetails } from "../services/tradingInstanceService";
import { websocketService } from "../services/websocketService";
import { getQuantoMultiplier } from "../utils/contractUtils";
import { createLogger } from "../utils/loggerUtils";
import { getDatabaseUrl } from "../utils/pathUtils";
import { getChinaTimeISO } from "../utils/timeUtils";

const logger = createLogger({
	name: "instance-executor",
	level: "info",
});

const dbClient = createClient({
	url: getDatabaseUrl(),
});

const REQUIRED_OPEN_TIMEFRAMES = ["5m", "15m", "1h"] as const;

/**
 * 交易动作记录类型
 */
interface TradeActionRecord {
	timestamp: string | null;
	action: string;
	symbol: string | null;
	side: string | null;
	leverage: number | null;
	amountUsdt: number | null;
	size: number | null;
	status: string;
	message: string;
	orderId: string | null;
}

interface RecentDecisionRecord {
	timestamp: string;
	decision: string;
	accountValue: number | null;
	positionsCount: number | null;
}

interface MarketDataSnapshot {
	price: number;
	change24h: number;
	volume24h: number;
	ema20: number | null;
	ema50: number | null;
	macd: number | null;
	rsi7: number | null;
	rsi14: number | null;
	fundingRate: number;
	timeframes: Record<string, TimeframeSummary>;
	intradaySeries: IntradaySeriesSnapshot | null;
	dataHealth: SymbolMarketDataHealth;
}

const decisionActionSchema = z.discriminatedUnion("action", [
	z.object({
		action: z.literal("hold"),
		reason: z.string().min(1),
		symbol: z.string().optional(),
		confidence: z.number().min(0).max(1).optional(),
	}),
	z.object({
		action: z.literal("open"),
		symbol: z.string().min(1),
		side: z.enum(["long", "short"]),
		leverage: z.number().min(1).max(RISK_PARAMS.MAX_LEVERAGE),
		amountUsdt: z.number().positive(),
		isNotional: z.boolean().optional().default(false),
		reason: z.string().min(1),
		confidence: z.number().min(0).max(1).optional(),
	}),
	z.object({
		action: z.literal("close"),
		symbol: z.string().min(1),
		percentage: z.number().min(1).max(100).default(100),
		reason: z.string().min(1),
		confidence: z.number().min(0).max(1).optional(),
	}),
]);

const decisionPlanSchema = z.object({
	summary: z.string().default(""),
	riskSummary: z.string().optional(),
	actions: z.array(decisionActionSchema).max(5).default([]),
});

type DecisionPlan = z.infer<typeof decisionPlanSchema>;
type DecisionAction = DecisionPlan["actions"][number];
type ApprovedDecisionAction =
	| Extract<DecisionAction, { action: "open" }>
	| Extract<DecisionAction, { action: "close" }>;

interface DecisionApprovalResult {
	approvedActions: ApprovedDecisionAction[];
	rejectedReasons: string[];
	holdReasons: string[];
}

interface ExecutionSummary {
	approvedActions: number;
	executedActions: number;
	rejectedReasons: string[];
	holdReasons: string[];
}

interface DecisionConsistencyCheckResult {
	plan: DecisionPlan;
	corrections: string[];
}

interface ApprovalConstraints {
	maxPositions: number;
	activePositionsCount: number;
	currentPositionSymbols: Set<string>;
	strategyLeverageLimit: number;
}

interface ActionExecutionResult {
	success: boolean;
	message: string;
	orderId?: string;
	size?: number;
	closedSize?: number;
}

const MIN_OPEN_CONFIDENCE = 0.65;
const MIN_CLOSE_CONFIDENCE = 0.55;
const MAX_OPEN_ACTIONS_PER_CYCLE = 1;

/**
 * 安全转换为字符串
 */
function toSafeString(value: unknown): string {
	if (value === null || value === undefined) return "";
	return String(value);
}

/**
 * 安全转换为数字
 */
function toSafeNumber(value: unknown): number | null {
	if (value === null || value === undefined) return null;
	if (typeof value === "number") return Number.isFinite(value) ? value : null;
	if (typeof value === "bigint") return Number(value);
	const parsed = Number.parseFloat(String(value));
	return Number.isFinite(parsed) ? parsed : null;
}

function getStructuredDecisionInstruction(language: StrategyLanguage): string {
	if (language === "zh") {
		return [
			"【结构化决策输出要求】",
			"- 你只能使用只读工具进行补充分析，不能直接执行开仓、平仓或撤单。",
			"- 必须以当前提示词中的最新市场快照为最高优先级；历史决策记录只用于连续性参考，若与当前快照冲突，必须忽略历史记录。",
			"- 如果数据质量摘要显示某个币种为“完整 / 允许开新仓”，则禁止声称该币种“技术指标为空”“只有价格没有指标”或“市场数据缺失”。",
			"- 如果策略需要盘口深度确认，而当前快照未直接给出盘口深度，你必须先调用 getOrderBook 工具核实，不能把“尚未查询”表述成“数据缺失”。",
			"- 在 summary 和 riskSummary 中，只能描述你已在当前快照或只读工具结果中实际看到的数据，不得编造“数据为空”“指标缺失”等与当前输入矛盾的结论。",
			"- 最终必须输出单个 JSON 对象，不要输出额外解释文本。",
			"- JSON 结构如下：",
			'{"summary":"本轮简要结论","riskSummary":"风险概览","actions":[{"action":"hold","reason":"说明"},{"action":"open","symbol":"BTC","side":"long","leverage":5,"amountUsdt":100,"isNotional":false,"reason":"说明","confidence":0.72},{"action":"close","symbol":"ETH","percentage":100,"reason":"说明","confidence":0.81}]}',
			"- 如果当前没有合适交易，只输出 hold 动作。",
			"- amountUsdt 使用正数，confidence 范围为 0 到 1。",
		].join("\n");
	}

	if (language === "ja") {
		return [
			"[構造化された意思決定出力ルール]",
			"- 読み取り専用ツールのみ利用し、建玉・決済・取消を直接実行してはいけません。",
			"- 現在のプロンプトに含まれる最新マーケットスナップショットを最優先とし、履歴判断は参考のみにしてください。現在のスナップショットと矛盾する履歴は無視してください。",
			"- データ品質サマリーが『完全 / 新規建て可』を示している銘柄について、『指標が空』『価格しかない』『データ欠落』と記述してはいけません。",
			"- 板情報が必要で現在のスナップショットに直接含まれていない場合は、getOrderBook を呼んで確認してから判断してください。未照会をデータ欠落と表現してはいけません。",
			"- summary と riskSummary では、現在のスナップショットまたは読み取り専用ツールで実際に確認した内容のみを記述してください。",
			"- 最終出力は単一の JSON オブジェクトのみとし、追加説明は出力しないでください。",
			"- JSON 形式:",
			'{"summary":"結論","riskSummary":"リスク概要","actions":[{"action":"hold","reason":"理由"},{"action":"open","symbol":"BTC","side":"long","leverage":5,"amountUsdt":100,"isNotional":false,"reason":"理由","confidence":0.72},{"action":"close","symbol":"ETH","percentage":100,"reason":"理由","confidence":0.81}]}',
			"- 適切な取引がない場合は hold のみを返してください。",
			"- amountUsdt は正数、confidence は 0 から 1 の範囲です。",
		].join("\n");
	}

	return [
		"[Structured Decision Output Requirements]",
		"- Use read-only tools only. Do not directly open, close, or cancel orders.",
		"- Treat the latest market snapshot in this prompt as the highest-priority source of truth. Historical decisions are reference only and must be ignored when they conflict with current data.",
		"- If the data quality summary marks a symbol as complete / allowed for new positions, you must not claim its indicators are missing, empty, or unavailable.",
		"- If the strategy needs order book confirmation and the snapshot does not directly include it, call getOrderBook first. Do not describe an unchecked field as missing data.",
		"- In summary and riskSummary, only describe facts actually present in the current snapshot or returned by read-only tools.",
		"- Your final answer must be a single JSON object with no extra text.",
		"- JSON schema:",
		'{"summary":"brief conclusion","riskSummary":"risk overview","actions":[{"action":"hold","reason":"why"},{"action":"open","symbol":"BTC","side":"long","leverage":5,"amountUsdt":100,"isNotional":false,"reason":"why","confidence":0.72},{"action":"close","symbol":"ETH","percentage":100,"reason":"why","confidence":0.81}]}',
		"- If there is no suitable trade, return only a hold action.",
		"- amountUsdt must be positive, confidence must be between 0 and 1.",
	].join("\n");
}

function extractDecisionTextFromResponse(response: unknown): string {
	if (typeof response === "string") {
		return response;
	}

	if (response && typeof response === "object") {
		const steps = (response as { steps?: Array<{ content?: Array<{ type?: string; text?: string }>; text?: string }> }).steps || [];
		const allTexts: string[] = [];
		for (const step of steps) {
			if (step.content && Array.isArray(step.content)) {
				for (const item of step.content) {
					if (item.type === "text" && item.text) {
						allTexts.push(item.text.trim());
					}
				}
			} else if (step.text) {
				allTexts.push(step.text.trim());
			}
		}
		return allTexts.join("\n\n");
	}

	return "";
}

function extractJsonCandidates(text: string): string[] {
	const candidates: string[] = [];
	const trimmed = text.trim();
	if (!trimmed) {
		return candidates;
	}

	const fencedPattern = /```json\s*([\s\S]*?)```/gi;
	for (const match of trimmed.matchAll(fencedPattern)) {
		const candidate = match[1]?.trim();
		if (candidate) {
			candidates.push(candidate);
		}
	}

	candidates.push(trimmed);
	const firstBrace = trimmed.indexOf("{");
	const lastBrace = trimmed.lastIndexOf("}");
	if (firstBrace >= 0 && lastBrace > firstBrace) {
		candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
	}

	return Array.from(new Set(candidates));
}

function parseDecisionPlan(decisionText: string): DecisionPlan {
	for (const candidate of extractJsonCandidates(decisionText)) {
		try {
			const parsed = JSON.parse(candidate) as unknown;
			const validated = decisionPlanSchema.safeParse(parsed);
			if (validated.success) {
				return validated.data;
			}
		} catch {
			// 尝试下一个候选
		}
	}

	throw new Error("AI 未返回符合要求的结构化 JSON 决策");
}

function containsSevereDataFailureClaim(text: string): boolean {
	const normalized = text.trim();
	if (!normalized) {
		return false;
	}

	return /API返回异常|API异常|数据质量异常|数据不完整|数据不满足开仓条件|技术指标和盘口深度数据无效|技术指标为空|技术指标数据缺失|指标为空|只有价格|市场数据缺失|无法获取有效技术指标|无法获取有效的技术指标和盘口深度数据|market data.*exception|indicator.*missing|only price|incomplete data/i.test(
		normalized,
	);
}

function hasSufficientIndicatorsInSnapshot(
	marketData: Record<string, any> | undefined,
): boolean {
	if (!marketData) {
		return false;
	}

	const snapshots = Object.values(marketData) as Array<Record<string, unknown>>;
	if (snapshots.length === 0) {
		return false;
	}

	const indicatorReadyCount = snapshots.filter((snapshot) => {
		const macd = snapshot.macd;
		const rsi7 = snapshot.rsi7;
		const rsi14 = snapshot.rsi14;
		const volume24h = snapshot.volume24h;
		const hasMacd = typeof macd === "number" && Number.isFinite(macd);
		const hasRsi7 = typeof rsi7 === "number" && Number.isFinite(rsi7);
		const hasRsi14 = typeof rsi14 === "number" && Number.isFinite(rsi14);
		const hasVolume = typeof volume24h === "number" && Number.isFinite(volume24h) && volume24h > 0;
		return hasMacd && hasRsi7 && hasRsi14 && hasVolume;
	}).length;

	// 超过半数币种具备核心指标，即认为“全局数据缺失”说法不成立。
	return indicatorReadyCount >= Math.max(1, Math.ceil(snapshots.length / 2));
}

function buildConsistentHoldReason(language: StrategyLanguage): string {
	if (language === "ja") {
		return "現在のマーケットスナップショットは利用可能ですが、戦略条件を同時に満たす高確度シグナルが不足しているため、今サイクルは様子見します。";
	}
	if (language === "en") {
		return "Current market snapshot is available, but there is no high-conviction setup that satisfies the strategy conditions simultaneously in this cycle, so hold.";
	}
	return "当前市场快照与技术指标可用，但本轮尚未出现同时满足策略条件的高把握度入场信号，维持观望。";
}

function enforceDecisionConsistency(
	plan: DecisionPlan,
	marketData: Record<string, any> | undefined,
	marketDataHealth: Record<string, SymbolMarketDataHealth> | undefined,
	language: StrategyLanguage,
): DecisionConsistencyCheckResult {
	if (!marketDataHealth) {
		return { plan, corrections: [] };
	}

	const healthList = Object.values(marketDataHealth);
	if (healthList.length === 0) {
		return { plan, corrections: [] };
	}

	const allSymbolsReady = healthList.every(
		(item) => item.dataStatus === "ok" && item.allowOpen,
	);
	const indicatorsReady = hasSufficientIndicatorsInSnapshot(marketData);

	if (!allSymbolsReady && !indicatorsReady) {
		return { plan, corrections: [] };
	}

	const hasContradictionInSummary =
		containsSevereDataFailureClaim(plan.summary) ||
		containsSevereDataFailureClaim(plan.riskSummary ?? "");
	const hasContradictionInHolds = plan.actions.some(
		(action) =>
			action.action === "hold" && containsSevereDataFailureClaim(action.reason),
	);

	if (!hasContradictionInSummary && !hasContradictionInHolds) {
		return { plan, corrections: [] };
	}

	const correctedHoldReason = buildConsistentHoldReason(language);
	const correctedActions = plan.actions.map((action) => {
		if (action.action !== "hold") {
			return action;
		}
		return {
			...action,
			reason: correctedHoldReason,
		};
	});

	const correctedPlan: DecisionPlan = {
		...plan,
		summary: correctedHoldReason,
		riskSummary:
			language === "ja"
				? "アカウント残高とポジション状況は安定しています。本サイクルはデータ欠損ではなく、戦略一致度と確度が不十分なため見送りです。"
				: language === "en"
					? "Account balance and position status are stable. This cycle is a hold due to insufficient strategy alignment and conviction, not because of missing market data."
					: "账户余额与持仓状态稳定。本轮观望的原因是策略一致性与把握度不足，而不是市场数据缺失。",
		actions: correctedActions,
	};

	return {
		plan: correctedPlan,
		corrections: [
			language === "ja"
				? "一貫性ガード: データが完全な状態で『データ欠損』と矛盾する記述を自動修正しました。"
				: language === "en"
					? "Consistency guard: Auto-corrected contradictory 'data missing/API exception' claims while data health is complete."
					: "一致性守卫：在数据质量为完整时，自动修正了“数据缺失/API异常”这类矛盾描述。",
		],
	};
}

function approveDecisionPlan(
	plan: DecisionPlan,
	allowedSymbols: Set<string>,
	marketDataHealth: Record<string, SymbolMarketDataHealth> | undefined,
	constraints: ApprovalConstraints,
): DecisionApprovalResult {
	const approvedActions: ApprovedDecisionAction[] = [];
	const rejectedReasons: string[] = [];
	const holdReasons: string[] = [];
	const plannedSymbols = new Set<string>();
	const openTargets = new Set<string>();
	let approvedOpenCount = 0;

	for (const action of plan.actions) {
		if (action.action === "hold") {
			holdReasons.push(action.reason);
			continue;
		}

		const normalizedSymbol = action.symbol.trim().toUpperCase();
		if (!normalizedSymbol) {
			rejectedReasons.push("存在空白 symbol 的决策动作，已拒绝执行");
			continue;
		}

		if (plannedSymbols.has(`${action.action}:${normalizedSymbol}`)) {
			rejectedReasons.push(`拒绝重复动作 ${action.action} ${normalizedSymbol}：同一轮不允许重复提交相同指令`);
			continue;
		}
		plannedSymbols.add(`${action.action}:${normalizedSymbol}`);

		if (
			action.action === "close" &&
			openTargets.has(normalizedSymbol)
		) {
			rejectedReasons.push(`拒绝平仓 ${normalizedSymbol}：同一轮已存在该币种的开仓动作，避免自相矛盾`);
			continue;
		}

		if (action.action === "open") {
			if (!allowedSymbols.has(normalizedSymbol)) {
				rejectedReasons.push(`拒绝开仓 ${normalizedSymbol}：不在当前策略允许的交易列表中`);
				continue;
			}

			if ((action.confidence ?? 0) < MIN_OPEN_CONFIDENCE) {
				rejectedReasons.push(
					`拒绝开仓 ${normalizedSymbol}：置信度 ${(action.confidence ?? 0).toFixed(2)} 低于阈值 ${MIN_OPEN_CONFIDENCE.toFixed(2)}`,
				);
				continue;
			}

			if (action.leverage > constraints.strategyLeverageLimit) {
				rejectedReasons.push(
					`拒绝开仓 ${normalizedSymbol}：请求杠杆 ${action.leverage}x 超过策略上限 ${constraints.strategyLeverageLimit}x`,
				);
				continue;
			}

			if (openTargets.has(normalizedSymbol)) {
				rejectedReasons.push(`拒绝开仓 ${normalizedSymbol}：同一轮已存在该币种开仓动作`);
				continue;
			}

			if (approvedOpenCount >= MAX_OPEN_ACTIONS_PER_CYCLE) {
				rejectedReasons.push(
					`拒绝开仓 ${normalizedSymbol}：单轮最多只允许 ${MAX_OPEN_ACTIONS_PER_CYCLE} 个新开仓动作`,
				);
				continue;
			}

			if (
				constraints.activePositionsCount + approvedOpenCount >=
				constraints.maxPositions
			) {
				rejectedReasons.push(
					`拒绝开仓 ${normalizedSymbol}：执行后持仓数将超过策略上限 ${constraints.maxPositions}`,
				);
				continue;
			}

			const dataHealth = marketDataHealth?.[normalizedSymbol];
			if (!dataHealth || !dataHealth.allowOpen) {
				rejectedReasons.push(
					`拒绝开仓 ${normalizedSymbol}：当前市场数据状态为 ${dataHealth?.dataStatus ?? "missing"}`,
				);
				continue;
			}

			approvedActions.push({
				...action,
				symbol: normalizedSymbol,
			});
			openTargets.add(normalizedSymbol);
			approvedOpenCount += 1;
			continue;
		}

		if ((action.confidence ?? 0) < MIN_CLOSE_CONFIDENCE) {
			rejectedReasons.push(
				`拒绝平仓 ${normalizedSymbol}：置信度 ${(action.confidence ?? 0).toFixed(2)} 低于阈值 ${MIN_CLOSE_CONFIDENCE.toFixed(2)}`,
			);
			continue;
		}

		if (!constraints.currentPositionSymbols.has(normalizedSymbol)) {
			rejectedReasons.push(`拒绝平仓 ${normalizedSymbol}：当前没有该币种持仓`);
			continue;
		}

		approvedActions.push({
			...action,
			symbol: normalizedSymbol,
		});
	}

	return {
		approvedActions,
		rejectedReasons,
		holdReasons,
	};
}

async function executeApprovedDecisionPlan(
	approval: DecisionApprovalResult,
): Promise<ExecutionSummary> {
	let executedActions = 0;

	for (const action of approval.approvedActions) {
		let result: ActionExecutionResult;
		if (action.action === "open") {
			result = (await tradingTools.executeOpenPosition({
				symbol: action.symbol,
				side: action.side,
				leverage: action.leverage,
				amountUsdt: action.amountUsdt,
				isNotional: action.isNotional,
			})) as ActionExecutionResult;
		} else {
			result = (await tradingTools.executeClosePosition({
				symbol: action.symbol,
				percentage: action.percentage,
				skipGuards: false,
				enforceWhitelist: false,
			})) as ActionExecutionResult;
		}

		if (!result.success) {
			approval.rejectedReasons.push(
				`执行 ${action.action} ${action.symbol} 失败: ${result.message}`,
			);
			continue;
		}

		executedActions += 1;
	}

	return {
		approvedActions: approval.approvedActions.length,
		executedActions,
		rejectedReasons: approval.rejectedReasons,
		holdReasons: approval.holdReasons,
	};
}

/**
 * 获取指定时间范围内的交易动作记录
 * @param start 开始时间
 * @param end 结束时间
 * @param accountId 账户ID（可选，用于过滤特定账户的记录）
 */
async function getTradeActionsBetween(
	start: string,
	end: string,
	accountId?: number,
): Promise<TradeActionRecord[]> {
	if (!start || !end) {
		return [];
	}

	try {
		let sql = `SELECT action, symbol, side, leverage, amount_usdt, size, status, message, order_id, created_at
               FROM trade_logs
               WHERE created_at >= ? AND created_at <= ?`;
		const args: any[] = [start, end];

		// 如果提供了账户ID，添加过滤条件
		if (accountId !== undefined) {
			sql += ` AND account_id = ?`;
			args.push(accountId.toString());
		}

		sql += ` ORDER BY created_at ASC`;

		const result = await dbClient.execute({ sql, args });

		const actions: TradeActionRecord[] = [];

		for (const row of result.rows as any[]) {
			const symbolRaw = toSafeString(row.symbol);
			const sideRaw = toSafeString(row.side).toLowerCase();
			const actionName = toSafeString(row.action) || "unknown";
			const status = toSafeString(row.status) || "unknown";
			const message = toSafeString(row.message) || "";
			const orderIdRaw = toSafeString(row.order_id);
			const timestampRaw = toSafeString(row.created_at);

			actions.push({
				timestamp: timestampRaw || null,
				action: actionName,
				symbol: symbolRaw ? symbolRaw.toUpperCase() : null,
				side: sideRaw ? sideRaw : null,
				leverage: toSafeNumber(row.leverage),
				amountUsdt: toSafeNumber(row.amount_usdt),
				size: toSafeNumber(row.size),
				status,
				message,
				orderId: orderIdRaw || null,
			});
		}

		return actions;
	} catch (error) {
		logger.error("获取交易动作失败:", error as any);
		return [];
	}
}

async function getRecentAgentDecisions(
	accountId: number,
	limit = 5,
): Promise<RecentDecisionRecord[]> {
	try {
		const result = await dbClient.execute({
			sql: `SELECT timestamp, decision, account_value, positions_count
			      FROM agent_decisions
			      WHERE account_id = ?
			      ORDER BY timestamp DESC
			      LIMIT ?`,
			args: [accountId.toString(), limit],
		});

		const records: RecentDecisionRecord[] = [];
		for (const row of result.rows as any[]) {
			const timestamp = toSafeString(row.timestamp);
			const decision = toSafeString(row.decision);
			records.push({
				timestamp: timestamp || "",
				decision,
				accountValue: toSafeNumber(row.account_value),
				positionsCount: toSafeNumber(row.positions_count),
			});
		}

		return records.reverse();
	} catch (error) {
		logger.error(`获取账户 ${accountId} 历史决策失败:`, error as any);
		return [];
	}
}

/**
 * 实例执行上下文配置
 * 包含执行所需的所有配置信息
 */
interface InstanceExecutionConfig {
	instanceId: number;
	instanceName: string;
	accountId: number;
	accountConfig: {
		provider: string;
		apiKey: string;
		apiSecret: string;
		apiPassphrase?: string;
		usePaper: boolean;
		proxyUrl?: string;
		stopLossUsdt?: number;
		takeProfitUsdt?: number;
	};
	aiModelConfig: {
		modelName: string;
		apiKey: string;
		baseUrl: string;
	};
	strategyName: string;
}

interface TradingStatusContext extends Record<string, unknown> {
	accountId: number;
	instanceId: number;
	instanceName: string;
}

/**
 * 从 TradingInstanceWithDetails 提取执行配置
 */
function extractExecutionConfig(
	instance: TradingInstanceWithDetails,
): InstanceExecutionConfig | null {
	// 类型断言获取内部附加的配置信息
	const instanceAny = instance as any;

	if (!instanceAny._accountConfig || !instanceAny._aiModelConfig) {
		logger.error(`实例 ${instance.name} 缺少账户或模型配置信息`);
		return null;
	}

	return {
		instanceId: instance.id,
		instanceName: instance.name,
		accountId: instance.account_id,
		accountConfig: {
			provider: instanceAny._accountConfig.provider,
			apiKey: instanceAny._accountConfig.api_key,
			apiSecret: instanceAny._accountConfig.api_secret,
			apiPassphrase: instanceAny._accountConfig.api_passphrase,
			usePaper: instanceAny._accountConfig.use_paper,
			proxyUrl: instanceAny._accountConfig.proxy_url,
			stopLossUsdt: instanceAny._accountConfig.stop_loss_usdt,
			takeProfitUsdt: instanceAny._accountConfig.take_profit_usdt,
		},
		aiModelConfig: {
			modelName: instanceAny._aiModelConfig.model_name,
			apiKey: instanceAny._aiModelConfig.api_key,
			baseUrl: instanceAny._aiModelConfig.base_url,
		},
		strategyName: instance.strategy_name,
	};
}

/**
 * 根据实例配置创建交易所客户端
 * 注意：如果账户没有配置代理，会回退使用全局代理配置
 */
async function createExchangeClientForInstance(
	config: InstanceExecutionConfig,
): Promise<any> {
	const { accountConfig } = config;

	// 获取代理配置：优先使用账户级别代理，其次使用全局代理
	let proxyUrl = accountConfig.proxyUrl;
	if (!proxyUrl) {
		const { getExchangeProxy } = await import("../config/exchange");
		proxyUrl = getExchangeProxy() || undefined;
		if (proxyUrl) {
			logger.debug(`实例 ${config.instanceName} 使用全局代理配置: ${proxyUrl}`);
		}
	}

	switch (accountConfig.provider.toLowerCase()) {
		case "okx": {
			const { OkxClient } = await import("../services/okxClient");
			return new OkxClient(
				accountConfig.apiKey,
				accountConfig.apiSecret,
				accountConfig.apiPassphrase || "",
				accountConfig.usePaper,
				proxyUrl,
			);
		}
		case "binance": {
			const { BinanceClient } = await import("../services/binanceClient");
			return new BinanceClient(
				accountConfig.apiKey,
				accountConfig.apiSecret,
				accountConfig.usePaper,
				proxyUrl,
			);
		}
		case "bitget": {
			const { BitgetClient } = await import("../services/bitgetClient");
			return new BitgetClient(
				accountConfig.apiKey,
				accountConfig.apiSecret,
				accountConfig.apiPassphrase || "",
				accountConfig.usePaper,
				proxyUrl,
			);
		}
		case "gate": {
			const { GateClient } = await import("../services/gateClient");
			return new GateClient(
				accountConfig.apiKey,
				accountConfig.apiSecret,
				accountConfig.usePaper,
				proxyUrl,
			);
		}
		default:
			throw new Error(`不支持的交易所: ${accountConfig.provider}`);
	}
}

/**
 * 获取当前 UI 语言配置
 */
async function getPromptLanguage(): Promise<StrategyLanguage> {
	try {
		const { getConfigValue } = await import("../database/init-config");
		const language = await getConfigValue("UI_LANGUAGE");
		if (language) {
			return normalizeStrategyLanguage(language);
		}
	} catch (error) {
		// 静默失败，使用默认值
	}
	return DEFAULT_STRATEGY_LANGUAGE;
}

/**
 * 格式化数字为字符串
 */
function formatNumber(value: number, decimals = 0): string {
	if (!Number.isFinite(value)) return "0";
	return decimals === 0
		? Math.round(value).toString()
		: value.toFixed(decimals);
}

/**
 * 应用模板变量替换
 * 将模板中的 {{KEY}} 占位符替换为对应的值
 */
function applyTemplateVariables(
	template: string,
	variables: Record<string, string>,
): string {
	return template.replace(/{{\s*([A-Z0-9_]+)\s*}}/g, (match, key: string) => {
		if (Object.hasOwn(variables, key)) {
			return variables[key];
		}
		return match; // 保留未匹配的占位符
	});
}

/**
 * 根据策略参数构建模板变量映射
 * 将策略 JSON 的 params 字段映射到模板占位符
 */
function buildTemplateVariables(
	strategy: StrategyFileContent | null,
	intervalMinutes: number,
	language: StrategyLanguage,
	accountRisk?: { stopLossUsdt?: number; takeProfitUsdt?: number },
): Record<string, string> {
	const symbolSeparator = language === "zh" ? "、" : ", ";

	// 从策略获取交易币种
	let symbols: string[] = RISK_PARAMS.TRADING_SYMBOLS;
	if (strategy?.params?.tradingSymbols) {
		const parsed = strategy.params.tradingSymbols
			.split(",")
			.map((s: string) => s.trim().toUpperCase())
			.filter((s: string) => s.length > 0);
		if (parsed.length > 0) symbols = parsed;
	}

	const params = strategy?.params;

	// 基础变量（优先使用策略参数，回退到全局配置）
	const variables: Record<string, string> = {
		STRATEGY_ID: strategy?.meta?.name ?? "custom",
		TRADING_INTERVAL_MINUTES: formatNumber(
			params?.intervalMinutes ?? intervalMinutes,
			0,
		),
		MAX_HOLDING_HOURS: formatNumber(
			params?.maxHoldingHours ?? RISK_PARAMS.MAX_HOLDING_HOURS,
			0,
		),
		MIN_HOLDING_MINUTES: formatNumber(
			params?.minHoldingMinutes ?? RISK_PARAMS.MIN_HOLDING_MINUTES,
			0,
		),
		MAX_POSITIONS: formatNumber(
			params?.maxPositions ?? RISK_PARAMS.MAX_POSITIONS,
			0,
		),
		EXTREME_STOP_LOSS_PERCENT: formatNumber(
			params?.extremeStopLossPercent ?? RISK_PARAMS.EXTREME_STOP_LOSS_PERCENT,
			0,
		),
		SYMBOL_LIST: symbols.join(symbolSeparator),
	};

	// 计算最大持仓周期数
	const maxHours = params?.maxHoldingHours ?? RISK_PARAMS.MAX_HOLDING_HOURS;
	const interval = params?.intervalMinutes ?? intervalMinutes;
	variables.MAX_HOLDING_CYCLES = formatNumber(
		Math.floor((maxHours * 60) / interval),
		0,
	);

	// 账户风控参数（优先使用策略配置，其次使用账户配置，最后使用全局配置）
	const stopLoss = params?.accountStopLoss ?? accountRisk?.stopLossUsdt;
	const takeProfit = params?.accountTakeProfit ?? accountRisk?.takeProfitUsdt;
	variables.ACCOUNT_STOP_LOSS_USDT =
		stopLoss !== undefined && stopLoss > 0
			? formatNumber(stopLoss, 0)
			: "Disabled";
	variables.ACCOUNT_TAKE_PROFIT_USDT =
		takeProfit !== undefined && takeProfit > 0
			? formatNumber(takeProfit, 0)
			: "Disabled";

	// 回撤警戒参数
	variables.ACCOUNT_DRAWDOWN_WARNING_PERCENT = formatNumber(
		params?.drawdownWarning ?? RISK_PARAMS.ACCOUNT_DRAWDOWN_WARNING_PERCENT,
		0,
	);
	variables.ACCOUNT_DRAWDOWN_NO_NEW_POSITION_PERCENT = formatNumber(
		params?.drawdownNoNew ??
			RISK_PARAMS.ACCOUNT_DRAWDOWN_NO_NEW_POSITION_PERCENT,
		0,
	);
	variables.ACCOUNT_DRAWDOWN_FORCE_CLOSE_PERCENT = formatNumber(
		params?.drawdownForceClose ??
			RISK_PARAMS.ACCOUNT_DRAWDOWN_FORCE_CLOSE_PERCENT,
		0,
	);

	// 杠杆（如果策略有配置）
	if (params?.leverage !== undefined && Number.isFinite(params.leverage)) {
		variables.LEVERAGE = formatNumber(params.leverage, 0);
	}

	// 入场/出场逻辑（来自策略 prompts）
	variables.ENTRY_PROMPT = strategy?.prompts?.entryLogic ?? "";
	variables.EXIT_PROMPT = strategy?.prompts?.exitLogic ?? "";
	variables.VAR_PROMPT = strategy?.prompts?.variables ?? "";

	return variables;
}

/**
 * 根据实例配置创建 AI Agent
 *
 * 关键改进：
 * 1. 使用多语言模板文件 (instructions_*.txt) 作为提示词框架
 * 2. 将策略的 entryLogic/exitLogic 填入 {{ENTRY_PROMPT}}/{{EXIT_PROMPT}} 占位符
 * 3. 将策略的 params 参数替换到模板中的其他占位符
 */
async function createAgentForInstance(
	config: InstanceExecutionConfig,
	intervalMinutes: number,
): Promise<{
	agent: any;
	instructions: string;
	modelName: string;
}> {
	// const { createOpenAI } = await import("@ai-sdk/openai");
	// const { Agent } = await import("@voltagent/core");
	// const tradingTools = await import("../tools/trading");

	const { aiModelConfig, strategyName, accountConfig } = config;

	// 清理 Base URL
	let cleanBaseUrl = aiModelConfig.baseUrl.trim();
	cleanBaseUrl = cleanBaseUrl
		.replace(/\/chat\/completions\/?$/, "")
		.replace(/\/$/, "");

	// 创建 OpenAI 兼容客户端
	const openai = createOpenAI({
		apiKey: aiModelConfig.apiKey,
		baseURL: cleanBaseUrl,
	} as any);

	// 获取 UI 语言配置
	const language = await getPromptLanguage();

	// 加载策略文件
	let strategy: StrategyFileContent | null = null;
	try {
		strategy = await StrategyFileManager.loadStrategy(strategyName);
	} catch (error) {
		logger.warn(`加载策略 ${strategyName} 失败，使用默认配置`);
	}

	// 构建模板变量（包含策略 params 映射）
	const templateVariables = buildTemplateVariables(
		strategy,
		intervalMinutes,
		language,
		{
			stopLossUsdt: accountConfig.stopLossUsdt,
			takeProfitUsdt: accountConfig.takeProfitUsdt,
		},
	);

	// 加载多语言 instructions 模板并替换占位符
	let instructions = "";
	try {
		const template = await getLocalizedPromptTemplate("instructions", language);
		instructions = applyTemplateVariables(template, templateVariables);
		instructions = `${instructions}\n\n${getStructuredDecisionInstruction(language)}`;
		logger.debug(
			`[实例 ${config.instanceName}] 使用 instructions_${language}.txt 模板`,
		);
	} catch (error) {
		logger.warn(`加载 instructions 模板失败，使用策略原始提示词`);
		// 回退：直接拼接策略提示词
		instructions =
			[
				strategy?.prompts?.entryLogic || "",
				strategy?.prompts?.exitLogic || "",
				strategy?.prompts?.variables || "",
			]
				.filter(Boolean)
				.join("\n\n") ||
			"You are a trading AI assistant. Analyze market data and make trading decisions.";
	}

	// 创建 Agent（使用 @voltagent/core 的 Agent 类，与 tradingAgent.ts 一致）
	const agentInstance = new Agent({
		name: `instance-${config.instanceId}-agent`,
		instructions,
		model: openai.chat(aiModelConfig.modelName),
		tools: [
			tradingTools.getMarketPriceTool,
			tradingTools.getTechnicalIndicatorsTool,
			tradingTools.getFundingRateTool,
			tradingTools.getOrderBookTool,
			tradingTools.getAccountBalanceTool,
			tradingTools.getPositionsTool,
			tradingTools.getOpenOrdersTool,
			tradingTools.checkOrderStatusTool,
			tradingTools.calculateRiskTool,
		],
	});

	return {
		agent: agentInstance,
		instructions,
		modelName: aiModelConfig.modelName,
	};
}

/**
 * 收集市场数据（针对特定实例的交易所客户端）
 */
async function collectMarketDataForInstance(
	exchangeClient: any,
	symbols: string[],
	accountId: number,
): Promise<Record<string, any>> {
	const marketData: Record<string, MarketDataSnapshot> = {};
	const timeframeConfigs = [
		{ key: "1m", interval: "1m", limit: 120 },
		{ key: "3m", interval: "3m", limit: 120 },
		{ key: "5m", interval: "5m", limit: 120 },
		{ key: "15m", interval: "15m", limit: 192 },
		{ key: "30m", interval: "30m", limit: 192 },
		{ key: "1h", interval: "1h", limit: 240 },
	];

	for (const symbol of symbols) {
		try {
			const contract = `${symbol}_USDT`;
			const collectedAt = new Date().toISOString();
			const [ticker, fundingRate] = await Promise.all([
				exchangeClient.getFuturesTicker(contract),
				exchangeClient.getFundingRate(contract).catch((error: unknown) => {
					logger.warn(`获取 ${symbol} 资金费率失败: ${String(error)}`);
					return null;
				}),
			]);

			const price = Number.parseFloat(ticker.last || ticker.price || "0");
			if (price === 0 || !Number.isFinite(price)) {
				logger.warn(`${symbol} 价格无效，跳过`);
				continue;
			}

			const candleResults: Record<string, any[]> = {};
			await Promise.all(
				timeframeConfigs.map(async (cfg) => {
					try {
						const candles = await exchangeClient.getFuturesCandles(
							contract,
							cfg.interval,
							cfg.limit,
						);
						if (candles && candles.length > 0) {
							candleResults[cfg.key] = candles;
							logger.debug(
								`${symbol} 获取 ${cfg.interval} K 线成功，共 ${candles.length} 条`,
							);
						} else {
							logger.warn(
								`${symbol} ${cfg.interval} K 线数据为空`,
							);
						}
					} catch (error) {
						logger.warn(
							`${symbol} 获取 ${cfg.interval} K 线失败: ${String(error)}`,
						);
					}
				}),
			);

			// 诊断日志：检查 K 线数据获取情况
			const availableTimeframes = Object.keys(candleResults);
			const missingTimeframes = timeframeConfigs
				.map((cfg) => cfg.key)
				.filter((key) => !availableTimeframes.includes(key));
			const coreTimeframesReady = REQUIRED_OPEN_TIMEFRAMES.every((timeframe) =>
				availableTimeframes.includes(timeframe),
			);
			const dataStatus: SymbolMarketDataHealth["dataStatus"] =
				availableTimeframes.length === 0
					? "invalid"
					: coreTimeframesReady
						? "ok"
						: "partial";
			const qualityScore = Math.max(
				0,
				Math.min(
					100,
					Math.round(
						(availableTimeframes.length / timeframeConfigs.length) * 70 +
							(coreTimeframesReady ? 30 : 0),
					),
				),
			);
			const dataHealth: SymbolMarketDataHealth = {
				dataStatus,
				allowOpen: dataStatus === "ok",
				qualityScore,
				missingTimeframes,
				coreTimeframesReady,
				collectedAt,
				snapshotPrice: price,
			};
			if (availableTimeframes.length === 0) {
				logger.error(
					`${symbol} 所有时间框架的 K 线数据都获取失败！这会导致所有指标为默认值。`,
				);
			} else {
				logger.info(
					`${symbol} 成功获取 K 线数据的时间框架: ${availableTimeframes.join(", ")}`,
				);
			}

			const timeframes: Record<string, TimeframeSummary> = {};
			for (const cfg of timeframeConfigs) {
				const candles = candleResults[cfg.key];
				if (!candles || candles.length === 0) {
					logger.warn(`${symbol} ${cfg.key} K 线数据不可用，跳过`);
					continue;
				}
				const summary = summarizeTimeframe(cfg.key, candles);
				if (summary) {
					timeframes[cfg.key] = summary;
					logger.debug(
						`${symbol} ${cfg.key} 指标计算成功: EMA20=${summary.ema20.toFixed(2)}, MACD=${summary.macd.toFixed(3)}`,
					);
				} else {
					logger.warn(`${symbol} ${cfg.key} 指标计算失败`);
				}
			}

			const baseTimeframe =
				timeframes["5m"] ||
				timeframes["3m"] ||
				timeframes["1m"] ||
				Object.values(timeframes)[0];

			// 诊断日志：检查 baseTimeframe 是否有效
			if (!baseTimeframe) {
				logger.error(
					`${symbol} 没有任何有效的时间框架数据，所有指标将使用默认值！`,
				);
			} else {
				const baseInterval = baseTimeframe.interval;
				logger.info(
					`${symbol} 使用 ${baseInterval} 作为基础时间框架，EMA20=${baseTimeframe.ema20.toFixed(2)}`,
				);
			}

			const intradaySourceCandles =
				candleResults["3m"] || candleResults["5m"] || candleResults["1m"];
			const intradaySeries = intradaySourceCandles
				? buildIntradaySeriesFromCandles(intradaySourceCandles)
				: null;

			// 诊断日志：检查日内序列数据
			if (!intradaySeries) {
				logger.warn(`${symbol} 日内序列数据为空`);
			} else {
				logger.info(
					`${symbol} 日内序列数据长度: ${intradaySeries.midPrices.length}`,
				);
			}

			const fundingRateValue = (() => {
				if (!fundingRate) {
					return 0;
				}
				// 支持多种字段名：OKX (r), Binance (rate), Gate.io (fundingRate), 通用 (value)
				const valueCandidates = [
					fundingRate.r,
					fundingRate.rate,
					fundingRate.fundingRate, // Gate.io 使用此字段
					fundingRate.value,
				];
				for (const candidate of valueCandidates) {
					if (candidate !== undefined && candidate !== null) {
						const parsed = Number.parseFloat(String(candidate));
						if (Number.isFinite(parsed)) {
							logger.debug(`${symbol} 资金费率: ${parsed}`);
							return parsed;
						}
					}
				}
				logger.warn(`${symbol} 无法解析资金费率，fundingRate 对象:`, fundingRate);
				return 0;
			})();

			const ema20 = baseTimeframe?.ema20 ?? null;
			const ema50 = baseTimeframe?.ema50 ?? null;
			const macd = baseTimeframe?.macd ?? null;
			const rsi7 = baseTimeframe?.rsi7 ?? null;
			const rsi14 = baseTimeframe?.rsi14 ?? null;

			// 解析 24h 成交量（支持多种字段名）
			const volume24hRaw =
				ticker.volume_24h || // Gate.io
				ticker.volume24h || // Binance
				ticker.volume || // 通用
				"0";
			const volume24h = Number.parseFloat(String(volume24hRaw));
			if (!Number.isFinite(volume24h) || volume24h === 0) {
				logger.warn(
					`${symbol} 24h 成交量解析异常: ${volume24hRaw}，ticker 对象:`,
					ticker,
				);
			}

			marketData[symbol] = {
				price,
				change24h: Number.parseFloat(
					ticker.change_percentage || ticker.changePercentage || "0",
				),
				volume24h,
				ema20,
				ema50,
				macd,
				rsi7,
				rsi14,
				fundingRate: fundingRateValue,
				timeframes,
				intradaySeries,
				dataHealth,
			};
		} catch (error) {
			logger.error(`收集 ${symbol} 市场数据失败:`, error);
		}
	}

	return marketData;
}
// EMA 计算
function calcEMA(prices: number[], period: number): number {
	if (prices.length === 0) return 0;
	const k = 2 / (period + 1);
	let ema = prices[0];
	for (let i = 1; i < prices.length; i++) {
		ema = prices[i] * k + ema * (1 - k);
	}
	return Number.isFinite(ema) ? ema : 0;
}

// RSI 计算
function calcRSI(prices: number[], period: number): number {
	if (prices.length < period + 1) return 50;
	let gains = 0;
	let losses = 0;
	for (let i = prices.length - period; i < prices.length; i++) {
		const change = prices[i] - prices[i - 1];
		if (change > 0) gains += change;
		else losses -= change;
	}
	const avgGain = gains / period;
	const avgLoss = losses / period;
	if (avgLoss === 0) return avgGain > 0 ? 100 : 50;
	const rs = avgGain / avgLoss;
	return 100 - 100 / (1 + rs);
}

// MACD 计算
function calcMACD(prices: number[]): number {
	if (prices.length < 26) return 0;
	return calcEMA(prices, 12) - calcEMA(prices, 26);
}

const INDICATOR_HISTORY_LENGTH = 10;

interface IndicatorHistorySnapshot {
	prices: number[];
	ema20: number[];
	ema50: number[];
	macd: number[];
	rsi7: number[];
	rsi14: number[];
	volumes: number[];
}

interface TimeframeSummary {
	interval: string;
	currentPrice: number;
	ema20: number;
	ema50: number;
	macd: number;
	rsi7: number;
	rsi14: number;
	volume: number;
	avgVolume: number;
	atr3: number;
	atr14: number;
	history: IndicatorHistorySnapshot | null;
}

interface IntradaySeriesSnapshot {
	interval: string;
	midPrices: number[];
	ema20Series: number[];
	macdSeries: number[];
	rsi7Series: number[];
	rsi14Series: number[];
}

function toFiniteNumber(value: unknown, fallback = 0): number {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === "bigint") {
		return Number(value);
	}
	if (typeof value === "string" && value.trim().length > 0) {
		const parsed = Number.parseFloat(value);
		return Number.isFinite(parsed) ? parsed : fallback;
	}
	return fallback;
}

function readCandleNumber(
	candle: any,
	objectKeys: string[],
	arrayIndex?: number,
	fallback = Number.NaN,
): number {
	if (candle && typeof candle === "object") {
		for (const key of objectKeys) {
			if (key in candle) {
				return toFiniteNumber((candle as Record<string, unknown>)[key], fallback);
			}
		}
	}
	if (Array.isArray(candle) && arrayIndex !== undefined) {
		const exists = arrayIndex >= 0 && arrayIndex < candle.length;
		if (exists) {
			return toFiniteNumber(candle[arrayIndex], fallback);
		}
	}
	return fallback;
}

function extractClosesFromCandles(candles: any[]): number[] {
	return candles
		.map((c: any) => {
			return readCandleNumber(c, ["c", "close", "Close"], 4, Number.NaN);
		})
		.filter((value: number) => Number.isFinite(value));
}

function extractVolumesFromCandles(candles: any[]): number[] {
	return candles
		.map((c: any) => {
			const vol = readCandleNumber(c, ["v", "volume", "Volume"], 5, 0);
			return vol >= 0 ? vol : 0;
		})
		.filter((value: number) => value >= 0);
}

function calcATRFromCandles(candles: any[], period: number): number {
	if (!candles || candles.length < 2) {
		return 0;
	}
	const trueRanges: number[] = [];
	for (let i = 1; i < candles.length; i++) {
		const current = candles[i];
		const prev = candles[i - 1];
		const high = readCandleNumber(current, ["h", "high", "High"], 2, Number.NaN);
		const low = readCandleNumber(current, ["l", "low", "Low"], 3, Number.NaN);
		const prevClose = readCandleNumber(prev, ["c", "close", "Close"], 4, Number.NaN);
		if (
			Number.isFinite(high) &&
			Number.isFinite(low) &&
			Number.isFinite(prevClose)
		) {
			const tr = Math.max(
				high - low,
				Math.abs(high - prevClose),
				Math.abs(low - prevClose),
			);
			trueRanges.push(tr);
		}
	}
	if (trueRanges.length === 0) {
		return 0;
	}
	const slice = trueRanges.slice(-period);
	const divisor = slice.length || 1;
	return slice.reduce((acc, val) => acc + val, 0) / divisor;
}


function buildIndicatorHistoryFromCloses(
	closes: number[],
	volumes: number[],
	length: number,
): IndicatorHistorySnapshot | null {
	if (closes.length === 0) {
		return null;
	}
	const historyLength = Math.min(length, closes.length);
	const startIndex = closes.length - historyLength;
	const ema20Series: number[] = [];
	const ema50Series: number[] = [];
	const macdSeries: number[] = [];
	const rsi7Series: number[] = [];
	const rsi14Series: number[] = [];
	for (let idx = startIndex; idx < closes.length; idx++) {
		const slice = closes.slice(0, idx + 1);
		ema20Series.push(calcEMA(slice, 20));
		ema50Series.push(calcEMA(slice, 50));
		macdSeries.push(calcMACD(slice));
		rsi7Series.push(calcRSI(slice, 7));
		rsi14Series.push(calcRSI(slice, 14));
	}
	return {
		prices: closes.slice(-historyLength),
		ema20: ema20Series.slice(-historyLength),
		ema50: ema50Series.slice(-historyLength),
		macd: macdSeries.slice(-historyLength),
		rsi7: rsi7Series.slice(-historyLength),
		rsi14: rsi14Series.slice(-historyLength),
		volumes: volumes.slice(-historyLength),
	};
}

function summarizeTimeframe(
	interval: string,
	candles: any[],
): TimeframeSummary | null {
	const closes = extractClosesFromCandles(candles);
	if (closes.length === 0) {
		return null;
	}
	const volumes = extractVolumesFromCandles(candles);
	const currentPrice = closes.at(-1) ?? 0;
	const ema20 = calcEMA(closes, 20);
	const ema50 = calcEMA(closes, 50);
	const macd = calcMACD(closes);
	const rsi7 = calcRSI(closes, 7);
	const rsi14 = calcRSI(closes, 14);
	const currentVolume = volumes.at(-1) ?? 0;
	const avgVolume =
		volumes.length > 0
			? volumes.reduce((sum, value) => sum + value, 0) / volumes.length
			: 0;
	const atr3 = calcATRFromCandles(candles, 3);
	const atr14 = calcATRFromCandles(candles, 14);
	const history = buildIndicatorHistoryFromCloses(
		closes,
		volumes,
		INDICATOR_HISTORY_LENGTH,
	);
	return {
		interval,
		currentPrice,
		ema20,
		ema50,
		macd,
		rsi7,
		rsi14,
		volume: currentVolume,
		avgVolume,
		atr3,
		atr14,
		history,
	};
}

function buildIntradaySeriesFromCandles(
	candles: any[],
): IntradaySeriesSnapshot | null {
	const closes = extractClosesFromCandles(candles);
	if (closes.length === 0) {
		return null;
	}
	const volumes = extractVolumesFromCandles(candles);
	const history = buildIndicatorHistoryFromCloses(
		closes,
		volumes,
		INDICATOR_HISTORY_LENGTH,
	);
	if (!history) {
		return null;
	}
	return {
		interval: "3m",
		midPrices: history.prices,
		ema20Series: history.ema20,
		macdSeries: history.macd,
		rsi7Series: history.rsi7,
		rsi14Series: history.rsi14,
	};
}

/**
 * 获取策略配置的交易对
 */
async function getStrategySymbols(strategyName: string): Promise<string[]> {
	try {
		const strategy = await StrategyFileManager.loadStrategy(strategyName);
		if (strategy && strategy.params?.tradingSymbols) {
			// tradingSymbols 可能是逗号分隔的字符串
			const symbols = strategy.params.tradingSymbols
				.split(",")
				.map((s: string) => s.trim())
				.filter((s: string) => s.length > 0);
			if (symbols.length > 0) {
				return symbols;
			}
		}
	} catch (error) {
		logger.warn(`获取策略 ${strategyName} 交易对失败，使用默认配置`);
	}
	return RISK_PARAMS.TRADING_SYMBOLS;
}

/**
 * 执行 Strategy Task 交易决策
 * 这是多实例模式下每个实例的核心执行函数
 *
 * 使用 runWithInstanceContext 包裹执行过程，确保工具调用能获取正确的客户端
 */
export async function executeInstanceTradingDecision(
	instance: TradingInstanceWithDetails,
): Promise<void> {
	const config = extractExecutionConfig(instance);

	if (!config) {
		throw new Error(`实例 ${instance.name} 配置不完整`);
	}

	const { instanceId, instanceName, accountId, strategyName, accountConfig } =
		config;
	const statusContext = { accountId, instanceId, instanceName };

	logger.info(`[实例 ${instanceName}] 开始执行交易决策`);

	// 广播准备执行状态
	websocketService.pushTradingStatus(
		"preparing",
		`准备执行实例 ${instanceName}`,
		"scheduled",
		statusContext,
	);

	try {
		// 1. 创建交易所客户端
		const exchangeClient = await createExchangeClientForInstance(config);

		// 2. 构建实例上下文（用于工具调用）
		const instanceContext: InstanceContext = {
			instanceId,
			instanceName,
			accountId,
			exchangeClient,
			provider: accountConfig.provider.toLowerCase() as
				| "okx"
				| "binance"
				| "bitget",
			strategyName,
			stopLossUsdt: accountConfig.stopLossUsdt,
			takeProfitUsdt: accountConfig.takeProfitUsdt,
		};

		// 3. 在实例上下文中执行交易决策
		await runWithInstanceContext(instanceContext, async () => {
			await executeWithContext(
				config,
				instanceContext,
				exchangeClient,
				instance.interval_minutes,
				statusContext,
			);
		});
	} catch (error) {
		logger.error(`[实例 ${instanceName}] 执行失败:`, error);
		// 广播执行错误状态
		const errorMessage = error instanceof Error ? error.message : "未知错误";
		websocketService.pushTradingStatus(
			"error",
			`实例 ${instanceName} 执行失败: ${errorMessage}`,
			"scheduled",
			statusContext,
		);
		throw error;
	}
}

/**
 * 在实例上下文中执行交易逻辑
 * 这个函数在 runWithInstanceContext 内部调用，
 * 所有工具调用都可以通过 getCurrentInstanceContext() 获取上下文
 */
async function executeWithContext(
	config: InstanceExecutionConfig,
	instanceContext: InstanceContext,
	exchangeClient: any,
	intervalMinutes: number,
	statusContext: TradingStatusContext,
): Promise<void> {
	const { instanceId, instanceName, accountId, strategyName } = config;

	// 1. 获取交易对列表
	const symbols = await getStrategySymbols(strategyName);
	logger.info(`[实例 ${instanceName}] 交易对: ${symbols.join(", ")}`);
	const strategy = await StrategyFileManager.loadStrategy(strategyName);

	// 广播收集数据状态
	websocketService.pushTradingStatus(
		"collecting_data",
		`收集 ${symbols.length} 个交易对的市场数据`,
		"scheduled",
		statusContext,
	);

	// 2. 收集市场数据
	const marketData = await collectMarketDataForInstance(
		exchangeClient,
		symbols,
		accountId,
	);
	instanceContext.marketDataHealth = Object.fromEntries(
		Object.entries(marketData).map(([symbol, snapshot]) => [
			symbol,
			snapshot.dataHealth,
		]),
	);
	const validSymbols = Object.keys(marketData).filter(
		(s) => marketData[s].price > 0,
	);

	if (validSymbols.length === 0) {
		logger.error(`[实例 ${instanceName}] 市场数据获取失败，跳过执行`);
		return;
	}

	// 3. 获取账户信息
	const account = await exchangeClient.getFuturesAccount();
	const totalBalance = Number.parseFloat(account.total || "0");
	const availableBalance = Number.parseFloat(account.available || "0");
	const unrealisedPnl = Number.parseFloat(account.unrealisedPnl || "0");

	logger.info(
		`[实例 ${instanceName}] 账户余额: ${totalBalance.toFixed(2)} USDT`,
	);

	// 4. 获取持仓
	const positions = await exchangeClient.getPositions();
	const activePositions = positions.filter(
		(p: any) => Math.abs(Number.parseFloat(p.size || "0")) > 1e-8,
	);

	logger.info(`[实例 ${instanceName}] 当前持仓: ${activePositions.length} 个`);

	// 广播分析市场状态
	websocketService.pushTradingStatus(
		"analyzing",
		`分析 ${validSymbols.length} 个交易对的市场行情`,
		"scheduled",
		statusContext,
	);

	// 5. 创建 AI Agent
	const { agent, instructions, modelName } = await createAgentForInstance(
		config,
		intervalMinutes,
	);
	const recentDecisions = await getRecentAgentDecisions(accountId);

	// 6. 生成提示词（使用多语言模板）
	const prompt = await generateInstancePrompt({
		instanceName,
		marketData,
		accountBalance: totalBalance,
		availableBalance,
		unrealisedPnl,
		positions: activePositions,
		strategyName,
		intervalMinutes,
		recentDecisions,
	});

	logger.info(`[实例 ${instanceName}] 调用 AI 模型: ${modelName}`);

	// 广播 AI 决策中状态
	websocketService.pushTradingStatus(
		"ai_deciding",
		`AI 模型 ${modelName} 正在决策`,
		"scheduled",
		statusContext,
	);

	// 记录执行开始时间，用于捕获期间的交易动作
	const executionStartedAt = getChinaTimeISO();
	const executionStartTime = Date.now(); // 用于计算请求耗时

	// 7. 调用 AI（在实例上下文中，工具调用会自动使用正确的客户端）
	let response: any;
	let aiCallError: Error | null = null;

	try {
		response = await agent.generateText(prompt, {
			maxOutputTokens: 8192,
			maxSteps: 20,
			temperature: 0.4,
		});
	} catch (error) {
		aiCallError = error as Error;
		logger.error(`[实例 ${instanceName}] AI 调用失败:`, error);
	}

	// 计算 AI 调用耗时（毫秒）
	const outputDurationMs = Date.now() - executionStartTime;

	// 记录决策完成时间
	const decisionTimestamp = getChinaTimeISO();

	// 8. 提取决策结果
	let decisionText = "";

	// 如果 AI 调用失败，记录错误并抛出
	if (aiCallError) {
		// 记录失败的请求到 agent_request_logs
		await insertAgentRequestLog(dbClient, {
			accountId: accountId.toString(),
			modelName,
			instructions,
			prompt,
			response: null,
			status: "error",
			errorMessage: aiCallError.message,
			createdAt: decisionTimestamp,
			outputDurationMs,
		});

		logger.error(`[实例 ${instanceName}] AI 请求日志已记录（失败）`);
		throw aiCallError;
	}

	decisionText = extractDecisionTextFromResponse(response);

	logger.info(`[实例 ${instanceName}] AI 决策完成`);
	logger.debug(
		`[实例 ${instanceName}] 决策内容: ${decisionText.substring(0, 500)}...`,
	);

	const decisionPlan = parseDecisionPlan(decisionText);
	const promptLanguage = await getPromptLanguage();
	const consistencyResult = enforceDecisionConsistency(
		decisionPlan,
		marketData,
		instanceContext.marketDataHealth,
		promptLanguage,
	);
	const finalDecisionPlan = consistencyResult.plan;
	const approval = approveDecisionPlan(
		finalDecisionPlan,
		new Set(symbols.map((symbol) => symbol.toUpperCase())),
		instanceContext.marketDataHealth,
		{
			maxPositions:
				strategy?.params?.maxPositions ?? RISK_PARAMS.MAX_POSITIONS,
			activePositionsCount: activePositions.length,
			currentPositionSymbols: new Set(
				activePositions.map((position: any) =>
					String(position.contract || "").replace("_USDT", "").toUpperCase(),
				),
			),
			strategyLeverageLimit:
				strategy?.params?.leverage ?? RISK_PARAMS.MAX_LEVERAGE,
		},
	);

	if (consistencyResult.corrections.length > 0) {
		approval.rejectedReasons.push(...consistencyResult.corrections);
		logger.warn(
			`[实例 ${instanceName}] 已触发决策一致性纠偏: ${consistencyResult.corrections.join(" | ")}`,
		);
	}

	if (approval.approvedActions.length > 0) {
		websocketService.pushTradingStatus(
			"executing_trades",
			`审批通过 ${approval.approvedActions.length} 个交易动作，准备执行`,
			"scheduled",
			statusContext,
		);
	}

	const executionSummary = await executeApprovedDecisionPlan(approval);
	const actionCaptureFinishedAt = getChinaTimeISO();
	const decisionRecordText = `${JSON.stringify(finalDecisionPlan, null, 2)}\n\n[Approval]\n${JSON.stringify(executionSummary, null, 2)}`;

	// 9. 获取执行期间的交易动作
	const actionsTakenRecords = await getTradeActionsBetween(
		executionStartedAt,
		actionCaptureFinishedAt,
		accountId,
	);
	if (actionsTakenRecords.length > 0) {
		logger.info(
			`[实例 ${instanceName}] 捕获到 ${actionsTakenRecords.length} 条交易动作`,
		);
		// 广播执行交易状态
		websocketService.pushTradingStatus(
			"executing_trades",
			`执行了 ${actionsTakenRecords.length} 个交易操作`,
			"scheduled",
			statusContext,
		);
	}

	// 10. 记录到 agent_request_logs 表（决策日志 Tab 使用此表）
	await insertAgentRequestLog(dbClient, {
		accountId: accountId.toString(),
		modelName,
		instructions,
		prompt,
		response: decisionRecordText,
		status: "success",
		errorMessage: null,
		createdAt: decisionTimestamp,
		outputDurationMs,
	});

	logger.info(`[实例 ${instanceName}] AI 请求日志已记录`);

	// 11. 记录到 agent_decisions 表（AI 决策侧边栏使用此表）
	await dbClient.execute({
		sql: `INSERT INTO agent_decisions 
          (account_id, timestamp, execution_started_at, iteration, market_analysis, decision, actions_taken, account_value, positions_count)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		args: [
			accountId.toString(),
			decisionTimestamp,
			executionStartedAt,
			0, // iteration 对于实例执行不太重要
			JSON.stringify(marketData),
			decisionRecordText,
			JSON.stringify(actionsTakenRecords),
			totalBalance,
			activePositions.length,
		],
	});

	logger.info(`[实例 ${instanceName}] 决策记录已保存到两个表`);

	// 广播执行完成状态
	websocketService.pushTradingStatus(
		"completed",
		`实例 ${instanceName} 执行完成`,
		"scheduled",
		statusContext,
	);
}

/**
 * 生成实例专用提示词（使用多语言模板）
 *
 * 关键改进：
 * 1. 使用 prompts_*.txt 多语言模板作为提示词框架
 * 2. 将策略 params 和市场数据填入模板占位符
 * 3. 与 tradingAgent.ts 的 generateTradingPrompt 保持一致的风格
 */
async function generateInstancePrompt(params: {
	instanceName: string;
	marketData: Record<string, any>;
	accountBalance: number;
	availableBalance: number;
	unrealisedPnl: number;
	positions: any[];
	strategyName: string;
	iteration?: number;
	minutesElapsed?: number;
	intervalMinutes?: number;
	recentDecisions?: RecentDecisionRecord[];
}): Promise<string> {
	const {
		instanceName,
		marketData,
		accountBalance,
		availableBalance,
		unrealisedPnl,
		positions,
		strategyName,
		iteration = 0,
		minutesElapsed = 0,
		intervalMinutes = 5,
		recentDecisions = [],
	} = params;

	// 获取语言配置
	const language = await getPromptLanguage();

	// 加载策略文件
	let strategy: StrategyFileContent | null = null;
	try {
		strategy = await StrategyFileManager.loadStrategy(strategyName);
	} catch (error) {
		logger.warn(`生成提示词时加载策略 ${strategyName} 失败`);
	}

	// 构建模板变量
	const templateVariables = buildTemplateVariables(
		strategy,
		intervalMinutes,
		language,
	);

	// 添加动态变量
	templateVariables.ITERATION = formatNumber(iteration, 0);
	templateVariables.MINUTES_ELAPSED = formatNumber(minutesElapsed, 0);
	templateVariables.CURRENT_TIME = getChinaTimeISO();

	// 加载多语言 prompts 模板
	let promptHeader = "";
	try {
		const template = await getLocalizedPromptTemplate("prompts", language);
		promptHeader = applyTemplateVariables(template, templateVariables);
		logger.debug(`[实例 ${instanceName}] 使用 prompts_${language}.txt 模板`);
	} catch (error) {
		logger.warn(`加载 prompts 模板失败，使用简化版提示词`);
		// 回退：生成简化版提示词
		promptHeader = [
			`# Strategy Task: ${instanceName}`,
			`Strategy: ${strategyName}`,
			`Time: ${getChinaTimeISO()}`,
		].join("\n");
	}

	// 生成市场数据部分
	const marketSection = formatMarketDataForPrompt(marketData, language);

	// 生成账户信息部分
	const accountSection = formatAccountInfoForPrompt({
		totalBalance: accountBalance,
		availableBalance,
		unrealisedPnl,
		positions,
		language,
		intervalMinutes,
	});
	const recentDecisionSection = formatRecentDecisionsForPrompt(
		recentDecisions,
		language,
	);
	const structuredReminder = getStructuredDecisionInstruction(language);

	return [
		promptHeader,
		structuredReminder,
		marketSection,
		accountSection,
		recentDecisionSection,
	]
		.filter(Boolean)
		.join("\n\n");
}

/**
 * 格式化市场数据用于提示词
 */
function formatNumberSeries(series: number[], decimals = 2): string {
	if (!series || series.length === 0) {
		return "[]";
	}
	return `[${series.map((value) => value.toFixed(decimals)).join(", ")}]`;
}

function formatOptionalMetric(
	value: number | null | undefined,
	decimals: number,
	language: StrategyLanguage,
): string {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return language === "zh" ? "不可用" : "Unavailable";
	}
	return value.toFixed(decimals);
}

function describeDataStatus(
	status: SymbolMarketDataHealth["dataStatus"],
	language: StrategyLanguage,
): string {
	if (language === "zh") {
		if (status === "ok") return "完整";
		if (status === "partial") return "部分缺失";
		return "不可用";
	}
	if (status === "ok") return "Complete";
	if (status === "partial") return "Partial";
	return "Invalid";
}

function formatMarketDataForPrompt(
	marketData: Record<string, any>,
	language: StrategyLanguage,
): string {
	const symbols = Object.keys(marketData || {});
	if (symbols.length === 0) {
		return language === "zh" ? "暂无市场数据" : "No market data available";
	}

	const separator = "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━";
	const lines: string[] = [separator];
	const header = language === "zh" ? "【市场行情快照】" : "[Market Snapshot]";
	lines.push(header);
	lines.push("");
	const openableSymbols: string[] = [];
	const restrictedSymbols: string[] = [];
	const invalidSymbols: string[] = [];
	for (const symbol of symbols) {
		const dataHealth = marketData[symbol]?.dataHealth as
			| SymbolMarketDataHealth
			| undefined;
		if (!dataHealth) {
			restrictedSymbols.push(symbol);
			continue;
		}
		if (dataHealth.dataStatus === "ok") {
			openableSymbols.push(symbol);
		} else if (dataHealth.dataStatus === "partial") {
			restrictedSymbols.push(symbol);
		} else {
			invalidSymbols.push(symbol);
		}
	}
	lines.push(language === "zh" ? "数据质量摘要" : "Data quality summary");
	lines.push("");
	lines.push(
		language === "zh"
			? `可正常分析并允许开新仓: ${openableSymbols.length > 0 ? openableSymbols.join(", ") : "无"}`
			: `Eligible for full analysis and new positions: ${openableSymbols.length > 0 ? openableSymbols.join(", ") : "None"}`,
	);
	lines.push(
		language === "zh"
			? `仅允许减仓或观望: ${restrictedSymbols.length > 0 ? restrictedSymbols.join(", ") : "无"}`
			: `Reduce-only or observe-only: ${restrictedSymbols.length > 0 ? restrictedSymbols.join(", ") : "None"}`,
	);
	lines.push(
		language === "zh"
			? `数据不可用: ${invalidSymbols.length > 0 ? invalidSymbols.join(", ") : "无"}`
			: `Invalid market data: ${invalidSymbols.length > 0 ? invalidSymbols.join(", ") : "None"}`,
	);
	lines.push("");
	lines.push(language === "zh" ? "所有币种的当前市场状态" : "All symbols current market status");
	lines.push("");

	const timeframeLabels = [
		{ key: "1m", zh: "1分钟", en: "1m" },
		{ key: "3m", zh: "3分钟", en: "3m" },
		{ key: "5m", zh: "5分钟", en: "5m" },
		{ key: "15m", zh: "15分钟", en: "15m" },
		{ key: "30m", zh: "30分钟", en: "30m" },
		{ key: "1h", zh: "1小时", en: "1h" },
	];

	const formatPercent = (value: number) => {
		if (!Number.isFinite(value)) return language === "zh" ? "0%" : "0%";
		return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
	};

	for (const symbol of symbols) {
		const data = marketData[symbol] ?? {};
		const price = Number(data.price || 0);
		const change24h = Number(data.change24h || 0);
		const ema20 = Number(data.ema20 || 0);
		const ema50 = Number(data.ema50 || 0);
		const macd = Number(data.macd || 0);
		const rsi7 =
			typeof data.rsi7 === "number" && Number.isFinite(data.rsi7)
				? Number(data.rsi7)
				: null;
		const rsi14 =
			typeof data.rsi14 === "number" && Number.isFinite(data.rsi14)
				? Number(data.rsi14)
				: null;
		const resolvedEma20 =
			typeof data.ema20 === "number" && Number.isFinite(data.ema20)
				? Number(data.ema20)
				: null;
		const resolvedMacd =
			typeof data.macd === "number" && Number.isFinite(data.macd)
				? Number(data.macd)
				: null;
		const fundingRate = Number(data.fundingRate || 0);
		const volume24h = Number(data.volume24h || 0);
		const timeframes: Record<string, TimeframeSummary> = data.timeframes || {};
		const intradaySeries: IntradaySeriesSnapshot | null = data.intradaySeries || null;
		const dataHealth: SymbolMarketDataHealth | undefined = data.dataHealth;

		const sectionTitle =
			language === "zh" ? `所有 ${symbol} 数据` : `All ${symbol} data`;
		lines.push(sectionTitle);
		if (dataHealth) {
			lines.push(
				language === "zh"
					? `数据状态 = ${describeDataStatus(dataHealth.dataStatus, language)} | 开新仓 = ${dataHealth.allowOpen ? "允许" : "禁止"} | 完整性评分 = ${dataHealth.qualityScore}/100 | 缺失周期 = ${dataHealth.missingTimeframes.length > 0 ? dataHealth.missingTimeframes.join(", ") : "无"} | 采集时间 = ${dataHealth.collectedAt}`
					: `Data status = ${describeDataStatus(dataHealth.dataStatus, language)} | New positions = ${dataHealth.allowOpen ? "allowed" : "blocked"} | Quality score = ${dataHealth.qualityScore}/100 | Missing timeframes = ${dataHealth.missingTimeframes.length > 0 ? dataHealth.missingTimeframes.join(", ") : "none"} | Collected at = ${dataHealth.collectedAt}`,
			);
		}
		lines.push(
			language === "zh"
				? `当前价格 = ${price.toFixed(2)}, 当前EMA20 = ${formatOptionalMetric(resolvedEma20, 3, language)}, 当前MACD = ${formatOptionalMetric(resolvedMacd, 3, language)}, 当前RSI（7周期） = ${formatOptionalMetric(rsi7, 3, language)}`
				: `Current price = ${price.toFixed(2)}, Current EMA20 = ${formatOptionalMetric(resolvedEma20, 3, language)}, Current MACD = ${formatOptionalMetric(resolvedMacd, 3, language)}, Current RSI(7-period) = ${formatOptionalMetric(rsi7, 3, language)}`,
		);
		lines.push("");

		lines.push(
			language === "zh"
				? `此外，这是 ${symbol} 永续合约的最新资金费率（您交易的合约类型）：`
				: `Additionally, here is the latest funding rate for the ${symbol} perpetual contract (the contract type you trade):`,
		);
		lines.push("");
		lines.push(
			language === "zh"
				? `资金费率: ${fundingRate.toExponential(2)}`
				: `Funding rate: ${fundingRate.toExponential(2)}`,
		);
		lines.push("");

		if (intradaySeries && intradaySeries.midPrices.length > 0) {
			lines.push(
				language === "zh"
					? "日内序列（按分钟，最旧 → 最新）："
					: "Intraday sequences (per minute, oldest → latest):",
			);
			lines.push("");
			lines.push(
				(language === "zh" ? "中间价: " : "Mid prices: ") +
					formatNumberSeries(intradaySeries.midPrices.slice(-10), 1),
			);
			lines.push("");
			
			if (intradaySeries.ema20Series && intradaySeries.ema20Series.length > 0) {
				lines.push(
					(language === "zh" ? "EMA指标（20周期）: " : "EMA indicator (20-period): ") +
						formatNumberSeries(intradaySeries.ema20Series.slice(-10), 3),
				);
				lines.push("");
			}
			if (intradaySeries.macdSeries && intradaySeries.macdSeries.length > 0) {
				lines.push(
					(language === "zh" ? "MACD指标: " : "MACD indicator: ") +
						formatNumberSeries(intradaySeries.macdSeries.slice(-10), 3),
				);
				lines.push("");
			}
			if (intradaySeries.rsi7Series && intradaySeries.rsi7Series.length > 0) {
				lines.push(
					(language === "zh" ? "RSI指标（7周期）: " : "RSI indicator (7-period): ") +
						formatNumberSeries(intradaySeries.rsi7Series.slice(-10), 3),
				);
				lines.push("");
			}
			if (intradaySeries.rsi14Series && intradaySeries.rsi14Series.length > 0) {
				lines.push(
					(language === "zh" ? "RSI指标（14周期）: " : "RSI indicator (14-period): ") +
						formatNumberSeries(intradaySeries.rsi14Series.slice(-10), 3),
				);
				lines.push("");
			}
		}

		const oneHour = timeframes["1h"];
		if (oneHour) {
			lines.push(
				language === "zh"
					? "更长期上下文（1小时时间框架）："
					: "Longer-term context (1-hour timeframe):",
			);
			lines.push("");
			lines.push(
				language === "zh"
					? `20周期EMA: ${oneHour.ema20.toFixed(2)} vs. 50周期EMA: ${oneHour.ema50.toFixed(2)}`
					: `20-period EMA: ${oneHour.ema20.toFixed(2)} vs. 50-period EMA: ${oneHour.ema50.toFixed(2)}`,
			);
			lines.push("");
			lines.push(
				language === "zh"
					? `3周期ATR: ${oneHour.atr3.toFixed(2)} vs. 14周期ATR: ${oneHour.atr14.toFixed(3)}`
					: `3-period ATR: ${oneHour.atr3.toFixed(2)} vs. 14-period ATR: ${oneHour.atr14.toFixed(3)}`,
			);
			lines.push("");
			lines.push(
				language === "zh"
					? `当前成交量: ${oneHour.volume.toFixed(2)} vs. 平均成交量: ${oneHour.avgVolume.toFixed(3)}`
					: `Current volume: ${oneHour.volume.toFixed(2)} vs. average volume: ${oneHour.avgVolume.toFixed(3)}`,
			);
			lines.push("");
			
			if (oneHour.history) {
				if (oneHour.history.macd && oneHour.history.macd.length > 0) {
					lines.push(
						(language === "zh" ? "MACD指标: " : "MACD indicator: ") +
							formatNumberSeries(oneHour.history.macd.slice(-10), 3),
					);
					lines.push("");
				}
				if (oneHour.history.rsi14 && oneHour.history.rsi14.length > 0) {
					lines.push(
						(language === "zh" ? "RSI指标（14周期）: " : "RSI indicator (14-period): ") +
							formatNumberSeries(oneHour.history.rsi14.slice(-10), 3),
					);
					lines.push("");
				}
			}
		}

		lines.push(
			language === "zh" ? "多时间框架指标：" : "Multi-timeframe indicators:",
		);
		lines.push("");
		for (const tf of timeframeLabels) {
			const tfData = timeframes[tf.key];
			if (!tfData) continue;
			const label = language === "zh" ? tf.zh : tf.en;
			const baseLine =
				language === "zh"
					? `${label}: 价格=${tfData.currentPrice.toFixed(2)}, EMA20=${formatOptionalMetric(tfData.ema20, 2, language)}, EMA50=${formatOptionalMetric(tfData.ema50, 2, language)}, MACD=${formatOptionalMetric(tfData.macd, 3, language)}, RSI7=${formatOptionalMetric(tfData.rsi7, 1, language)}, RSI14=${formatOptionalMetric(tfData.rsi14, 1, language)}, 成交量=${tfData.volume.toFixed(2)}`
					: `${label}: Price=${tfData.currentPrice.toFixed(2)}, EMA20=${formatOptionalMetric(tfData.ema20, 2, language)}, EMA50=${formatOptionalMetric(tfData.ema50, 2, language)}, MACD=${formatOptionalMetric(tfData.macd, 3, language)}, RSI7=${formatOptionalMetric(tfData.rsi7, 1, language)}, RSI14=${formatOptionalMetric(tfData.rsi14, 1, language)}, Volume=${tfData.volume.toFixed(2)}`;
			lines.push(baseLine);
		}

		lines.push("");
		lines.push("");
	}

	return lines.join("\n").trimEnd();
}

/**
 * 格式化账户信息用于提示词
 */
function formatAccountInfoForPrompt(params: {
	totalBalance: number;
	availableBalance: number;
	unrealisedPnl: number;
	positions: any[];
	language: StrategyLanguage;
	intervalMinutes: number;
}): string {
	const {
		totalBalance,
		availableBalance,
		unrealisedPnl,
		positions,
		language,
		intervalMinutes,
	} = params;

	const separator = "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━";
	const lines: string[] = [separator];

	if (language === "zh") {
		lines.push("【账户概览】");
		lines.push(`账户净值: ${totalBalance.toFixed(2)} USDT`);
		lines.push(`可用余额: ${availableBalance.toFixed(2)} USDT`);
		lines.push(
			`未实现盈亏: ${unrealisedPnl >= 0 ? "+" : ""}${unrealisedPnl.toFixed(2)} USDT`,
		);

		if (positions.length === 0) {
			lines.push("");
			lines.push("当前无持仓，关注新的进场机会");
		} else {
			lines.push("");
			lines.push("【持仓详情】");
			for (const pos of positions) {
				const symbol =
					pos.contract?.replace("_USDT", "") || pos.symbol || "UNKNOWN";
				const side = pos.posSide || (Number(pos.size) > 0 ? "long" : "short");
				const sideText = side === "long" ? "做多" : "做空";
				const size = Math.abs(Number(pos.size || 0));
				const entryPrice = Number(pos.entryPrice || pos.entry_price || 0);
				const pnl = Number(pos.unrealisedPnl || pos.unrealized_pnl || 0);
				const leverage = Number(pos.leverage || 1);

				lines.push(`- ${symbol} ${sideText} ${leverage}x`);
				lines.push(`  开仓价: ${entryPrice.toFixed(4)} | 数量: ${size}`);
				lines.push(`  盈亏: ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)} USDT`);
			}
		}
	} else {
		lines.push("[Account Overview]");
		lines.push(`Net Asset Value: ${totalBalance.toFixed(2)} USDT`);
		lines.push(`Available Balance: ${availableBalance.toFixed(2)} USDT`);
		lines.push(
			`Unrealized PnL: ${unrealisedPnl >= 0 ? "+" : ""}${unrealisedPnl.toFixed(2)} USDT`,
		);

		if (positions.length === 0) {
			lines.push("");
			lines.push("No open positions; monitor for new entries.");
		} else {
			lines.push("");
			lines.push("[Positions]");
			for (const pos of positions) {
				const symbol =
					pos.contract?.replace("_USDT", "") || pos.symbol || "UNKNOWN";
				const side = pos.posSide || (Number(pos.size) > 0 ? "long" : "short");
				const sideText = side === "long" ? "Long" : "Short";
				const size = Math.abs(Number(pos.size || 0));
				const entryPrice = Number(pos.entryPrice || pos.entry_price || 0);
				const pnl = Number(pos.unrealisedPnl || pos.unrealized_pnl || 0);
				const leverage = Number(pos.leverage || 1);

				lines.push(`- ${symbol} ${sideText} ${leverage}x`);
				lines.push(`  Entry: ${entryPrice.toFixed(4)} | Size: ${size}`);
				lines.push(`  PnL: ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)} USDT`);
			}
		}
	}

	return lines.join("\n");
}

function formatRecentDecisionsForPrompt(
	records: RecentDecisionRecord[],
	language: StrategyLanguage,
): string {
	if (!records || records.length === 0) {
		return "";
	}

	const separator = "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━";
	const lines: string[] = [separator];
	
	if (language === "zh") {
		lines.push("【历史决策记录开始】");
		lines.push(separator);
		lines.push("");
		lines.push("重要提醒：以下是历史决策记录，仅作为参考，不代表当前状态！");
		lines.push("当前市场数据和持仓信息请参考上方实时数据。");
		lines.push("");
	} else {
		lines.push("[Historical Decision Records Begin]");
		lines.push(separator);
		lines.push("");
		lines.push("Important Reminder: The following are historical decision records for reference only, not current status!");
		lines.push("For current market data and position information, please refer to the real-time data above.");
		lines.push("");
	}

	records.forEach((record, index) => {
		const timeLabel = record.timestamp || (language === "zh" ? "未知时间" : "Unknown time");
		const timeAgo = record.timestamp
			? Math.round((Date.now() - new Date(record.timestamp).getTime()) / 60000)
			: null;
		const navLabel =
			record.accountValue !== null && record.accountValue !== undefined
				? record.accountValue.toFixed(2)
				: language === "zh" ? "未知" : "Unknown";
		const positionLabel =
			record.positionsCount !== null && record.positionsCount !== undefined
				? record.positionsCount.toString()
				: "-";
		const normalizedDecision = record.decision
			.replace(/\s+/g, " ")
			.trim();
		const holdCount = (normalizedDecision.match(/"action"\s*:\s*"hold"/g) || []).length;
		const openCount = (normalizedDecision.match(/"action"\s*:\s*"open"/g) || []).length;
		const closeCount = (normalizedDecision.match(/"action"\s*:\s*"close"/g) || []).length;
		const historicalOutcome = language === "zh"
			? `动作摘要: hold=${holdCount}, open=${openCount}, close=${closeCount}`
			: `Action summary: hold=${holdCount}, open=${openCount}, close=${closeCount}`;

		if (language === "zh") {
			lines.push(
				`【历史】决策 #${index} (${timeLabel}${timeAgo ? `，${timeAgo}分钟前` : ""}):`,
			);
			lines.push(`  当时账户价值: ${navLabel} USDT`);
			lines.push(`  当时持仓数量: ${positionLabel}`);
			lines.push(`  ${historicalOutcome}`);
		} else {
			lines.push(
				`[Historical] Decision #${index} (${timeLabel}${timeAgo ? `, ${timeAgo} minutes ago` : ""}):`,
			);
			lines.push(`  Account value then: ${navLabel} USDT`);
			lines.push(`  Position count then: ${positionLabel}`);
			lines.push(`  ${historicalOutcome}`);
		}
		lines.push("");
	});
	
	if (language === "zh") {
		lines.push("【历史决策记录结束】");
		lines.push("");
		lines.push("使用建议：");
		lines.push("- 仅作为决策连续性参考，不要被历史决策束缚");
		lines.push("- 市场已经变化，请基于当前最新数据独立判断");
		lines.push("- 如果市场条件改变，应该果断调整策略");
	} else {
		lines.push("[Historical Decision Records End]");
		lines.push("");
		lines.push("Usage suggestions:");
		lines.push("- Use only as reference for decision continuity, don't be constrained by historical decisions");
		lines.push("- Market has changed, make independent judgment based on current latest data");
		lines.push("- If market conditions change, adjust strategy decisively");
	}
	lines.push("");

	return lines.join("\n");
}
