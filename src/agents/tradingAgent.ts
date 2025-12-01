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

import { createOpenAI } from "@ai-sdk/openai";
/**
 * 交易 Agent 配置（仅依赖策略提示词）
 */
import { Agent, Memory } from "@voltagent/core";
import { LibSQLMemoryAdapter } from "@voltagent/libsql";
import { createPinoLogger } from "@voltagent/logger";
import {
	DEFAULT_PROMPT_ENTRY,
	DEFAULT_PROMPT_EXIT,
	DEFAULT_PROMPT_VARIABLES,
} from "../config/promptDefaults";
import { RISK_PARAMS, getConfigStringValue } from "../config/riskParams.new";
import type {
	StrategyLanguage,
	TradingStrategy,
} from "../config/strategyTypes";
import { getLocalizedPromptTemplate } from "../prompts/templateLoader";
import { StrategyFileManager } from "../services/strategyFileManager";
import { getStrategyProfile } from "../strategies";
import * as tradingTools from "../tools/trading";
import { formatChinaTime } from "../utils/timeUtils";

const logger = createPinoLogger({
	name: "trading-agent",
	level: "info",
});

const SECTION_SEPARATOR = "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━";

const instructionsTemplateCache = new Map<StrategyLanguage, string>();
const promptTemplateCache = new Map<StrategyLanguage, string>();

async function getPromptLanguage(): Promise<StrategyLanguage> {
	try {
		const { getConfigValue } = await import("../database/init-config");
		const language = await getConfigValue("UI_LANGUAGE");
		if (language) {
			const { normalizeStrategyLanguage } = await import(
				"../config/strategyTypes"
			);
			return normalizeStrategyLanguage(language);
		}
	} catch (error) {
		// Silently fail and use default
	}
	return RISK_PARAMS.PROMPT_LANGUAGE;
}

function getActiveStrategyName(): string {
	const name = getConfigStringValue("ACTIVE_STRATEGY_NAME", "custom");
	return name?.trim() || "custom";
}

async function loadInstructionsTemplate(
	language: StrategyLanguage,
): Promise<string> {
	const cached = instructionsTemplateCache.get(language);
	if (cached) {
		return cached;
	}
	const template = await getLocalizedPromptTemplate("instructions", language);
	instructionsTemplateCache.set(language, template);
	return template;
}

async function loadPromptTemplate(language: StrategyLanguage): Promise<string> {
	const cached = promptTemplateCache.get(language);
	if (cached) {
		return cached;
	}
	const template = await getLocalizedPromptTemplate("prompts", language);
	promptTemplateCache.set(language, template);
	return template;
}

export interface AccountRiskConfig {
	stopLossUsdt?: number;
	takeProfitUsdt?: number;
	syncOnStartup: boolean;
}

let accountRiskConfigCache: AccountRiskConfig | null = null;

export async function getAccountRiskConfig(
	forceReload = false,
): Promise<AccountRiskConfig> {
	if (!forceReload && accountRiskConfigCache) {
		return accountRiskConfigCache;
	}

	try {
		const { getConfigValue } = await import("../database/init-config");
		const { getActiveAccount } = await import(
			"../services/accountConfigService"
		);

		const activeAccount = await getActiveAccount();
		const syncFlag = await getConfigValue("SYNC_CONFIG_ON_STARTUP");
		const syncOnStartup =
			(syncFlag ?? process.env.SYNC_CONFIG_ON_STARTUP) === "true";

		let stopLossUsdt: number | undefined;
		let takeProfitUsdt: number | undefined;

		if (activeAccount) {
			// If active account exists, use its values. 0 or null/undefined means disabled.
			stopLossUsdt = activeAccount.stop_loss_usdt || undefined;
			takeProfitUsdt = activeAccount.take_profit_usdt || undefined;
		} else {
			// Fallback to legacy env/db config
			const stopLossStr = await getConfigValue("ACCOUNT_STOP_LOSS_USDT");
			const takeProfitStr = await getConfigValue("ACCOUNT_TAKE_PROFIT_USDT");

			const sl = Number.parseFloat(
				stopLossStr || process.env.ACCOUNT_STOP_LOSS_USDT || "50",
			);
			stopLossUsdt = Number.isFinite(sl) ? sl : 50;

			const tp = Number.parseFloat(
				takeProfitStr || process.env.ACCOUNT_TAKE_PROFIT_USDT || "20000",
			);
			takeProfitUsdt = Number.isFinite(tp) ? tp : 20000;
		}

		accountRiskConfigCache = {
			stopLossUsdt,
			takeProfitUsdt,
			syncOnStartup,
		};
	} catch (error) {
		const fallbackMessage =
			error instanceof Error ? error.message : String(error);
		logger.warn(`读取账户风控配置失败，回落使用环境变量: ${fallbackMessage}`);

		const stopLossEnv = Number.parseFloat(
			process.env.ACCOUNT_STOP_LOSS_USDT || "50",
		);
		const takeProfitEnv = Number.parseFloat(
			process.env.ACCOUNT_TAKE_PROFIT_USDT || "20000",
		);

		accountRiskConfigCache = {
			stopLossUsdt: Number.isFinite(stopLossEnv) ? stopLossEnv : 50,
			takeProfitUsdt: Number.isFinite(takeProfitEnv) ? takeProfitEnv : 20000,
			syncOnStartup: process.env.SYNC_CONFIG_ON_STARTUP === "true",
		};
	}

	return accountRiskConfigCache;
}

function getRiskConfigSnapshot(): AccountRiskConfig {
	if (accountRiskConfigCache) {
		return accountRiskConfigCache;
	}

	const stopLossEnv = Number.parseFloat(
		process.env.ACCOUNT_STOP_LOSS_USDT || "50",
	);
	const takeProfitEnv = Number.parseFloat(
		process.env.ACCOUNT_TAKE_PROFIT_USDT || "20000",
	);
	const syncFlag = process.env.SYNC_CONFIG_ON_STARTUP === "true";

	return {
		stopLossUsdt: Number.isFinite(stopLossEnv) ? stopLossEnv : 50,
		takeProfitUsdt: Number.isFinite(takeProfitEnv) ? takeProfitEnv : 20000,
		syncOnStartup: syncFlag,
	};
}

function formatNumber(value: number, decimals = 0): string {
	if (!Number.isFinite(value)) {
		return "0";
	}
	return decimals === 0
		? Math.round(value).toString()
		: value.toFixed(decimals);
}

function normalizeTemplateInput(value: string): string {
	return value.replace(/\r\n/g, "\n").trim();
}

type PromptVariables = Record<string, string>;

export interface PromptSections {
	entry: string;
	exit: string;
	variables: string;
}

function applyTemplateVariables(
	template: string,
	variables: PromptVariables,
): string {
	return template.replace(/{{\s*([A-Z0-9_]+)\s*}}/g, (match, key: string) => {
		if (Object.hasOwn(variables, key)) {
			return variables[key];
		}
		return match;
	});
}

function buildBasePromptVariables(
	strategyIdOrObj: string | any,
	intervalMinutes: number,
	riskConfig: AccountRiskConfig,
	language: StrategyLanguage,
	tradingSymbols?: string[],
): PromptVariables {
	const symbolSeparator = language === "zh" ? "、" : ", ";
	// 优先使用策略中配置的交易币种，若无则回退到全局配置
	const symbols =
		tradingSymbols && tradingSymbols.length > 0
			? tradingSymbols
			: RISK_PARAMS.TRADING_SYMBOLS;
	const symbolList = symbols.join(symbolSeparator);

	// 支持传入 strategy 对象或仅传入 strategyId
	const strategyObj =
		typeof strategyIdOrObj === "object" && strategyIdOrObj !== null
			? strategyIdOrObj
			: null;
	const strategyParams = strategyObj?.params ?? null;

	// 基础变量（来自全局与账户风控）
	const base: PromptVariables = {
		STRATEGY_ID:
			typeof strategyIdOrObj === "string"
				? strategyIdOrObj
				: (strategyObj?.meta?.name ?? "custom"),
		TRADING_INTERVAL_MINUTES: formatNumber(intervalMinutes, 0),
		MAX_HOLDING_HOURS: formatNumber(RISK_PARAMS.MAX_HOLDING_HOURS, 0),
		MIN_HOLDING_MINUTES: formatNumber(RISK_PARAMS.MIN_HOLDING_MINUTES, 0),
		MAX_HOLDING_CYCLES: formatNumber(RISK_PARAMS.MAX_HOLDING_CYCLES, 0),
		MAX_POSITIONS: formatNumber(RISK_PARAMS.MAX_POSITIONS, 0),
		EXTREME_STOP_LOSS_PERCENT: formatNumber(
			RISK_PARAMS.EXTREME_STOP_LOSS_PERCENT,
			0,
		),
		ACCOUNT_STOP_LOSS_USDT:
			riskConfig.stopLossUsdt !== undefined
				? formatNumber(riskConfig.stopLossUsdt, 0)
				: "Disabled",
		ACCOUNT_TAKE_PROFIT_USDT:
			riskConfig.takeProfitUsdt !== undefined
				? formatNumber(riskConfig.takeProfitUsdt, 0)
				: "Disabled",
		ACCOUNT_DRAWDOWN_WARNING_PERCENT: formatNumber(
			RISK_PARAMS.ACCOUNT_DRAWDOWN_WARNING_PERCENT,
			0,
		),
		ACCOUNT_DRAWDOWN_NO_NEW_POSITION_PERCENT: formatNumber(
			RISK_PARAMS.ACCOUNT_DRAWDOWN_NO_NEW_POSITION_PERCENT,
			0,
		),
		ACCOUNT_DRAWDOWN_FORCE_CLOSE_PERCENT: formatNumber(
			RISK_PARAMS.ACCOUNT_DRAWDOWN_FORCE_CLOSE_PERCENT,
			0,
		),
		SYMBOL_LIST: symbolList,
	};

	// 如果策略文件提供了 params，则将常见字段映射为模板占位符
	if (strategyParams) {
		try {
			const p: any = strategyParams;

			// 使用策略提供的 intervalMinutes 覆盖（如果存在且为有效数值）
			if (
				p.intervalMinutes !== undefined &&
				Number.isFinite(Number(p.intervalMinutes))
			) {
				base.TRADING_INTERVAL_MINUTES = formatNumber(
					Number(p.intervalMinutes),
					0,
				);
				// 重新计算 holding cycles
				if (
					p.maxHoldingHours !== undefined &&
					Number.isFinite(Number(p.maxHoldingHours))
				) {
					const maxCycles = Math.floor(
						(Number(p.maxHoldingHours) * 60) /
							Number(p.intervalMinutes || intervalMinutes),
					);
					base.MAX_HOLDING_CYCLES = String(maxCycles);
				}
			}

			if (
				p.maxHoldingHours !== undefined &&
				Number.isFinite(Number(p.maxHoldingHours))
			) {
				base.MAX_HOLDING_HOURS = formatNumber(Number(p.maxHoldingHours), 0);
			}
			if (
				p.minHoldingMinutes !== undefined &&
				Number.isFinite(Number(p.minHoldingMinutes))
			) {
				base.MIN_HOLDING_MINUTES = formatNumber(Number(p.minHoldingMinutes), 0);
			}
			if (
				p.maxPositions !== undefined &&
				Number.isFinite(Number(p.maxPositions))
			) {
				base.MAX_POSITIONS = formatNumber(Number(p.maxPositions), 0);
			}
			if (
				p.extremeStopLossPercent !== undefined &&
				Number.isFinite(Number(p.extremeStopLossPercent))
			) {
				base.EXTREME_STOP_LOSS_PERCENT = formatNumber(
					Number(p.extremeStopLossPercent),
					0,
				);
			}
			if (
				p.accountStopLoss !== undefined &&
				Number.isFinite(Number(p.accountStopLoss))
			) {
				base.ACCOUNT_STOP_LOSS_USDT = formatNumber(
					Number(p.accountStopLoss),
					0,
				);
			}
			if (
				p.accountTakeProfit !== undefined &&
				Number.isFinite(Number(p.accountTakeProfit))
			) {
				base.ACCOUNT_TAKE_PROFIT_USDT = formatNumber(
					Number(p.accountTakeProfit),
					0,
				);
			}
			if (
				p.drawdownWarning !== undefined &&
				Number.isFinite(Number(p.drawdownWarning))
			) {
				base.ACCOUNT_DRAWDOWN_WARNING_PERCENT = formatNumber(
					Number(p.drawdownWarning),
					0,
				);
			}
			if (
				p.drawdownNoNew !== undefined &&
				Number.isFinite(Number(p.drawdownNoNew))
			) {
				base.ACCOUNT_DRAWDOWN_NO_NEW_POSITION_PERCENT = formatNumber(
					Number(p.drawdownNoNew),
					0,
				);
			}
			if (
				p.drawdownForceClose !== undefined &&
				Number.isFinite(Number(p.drawdownForceClose))
			) {
				base.ACCOUNT_DRAWDOWN_FORCE_CLOSE_PERCENT = formatNumber(
					Number(p.drawdownForceClose),
					0,
				);
			}

			// 额外映射：杠杆等常用字段
			if (p.leverage !== undefined && Number.isFinite(Number(p.leverage))) {
				base.LEVERAGE = formatNumber(Number(p.leverage), 0);
			}
		} catch (e) {
			// 不阻塞主流程，日志在外层处理
		}
	}

	return base;
}

function buildSectionsFromPrompts(
	prompts: { entryPrompt: string; exitPrompt: string; varPrompt: string },
	baseVariables: PromptVariables,
): PromptSections {
	const entry = applyTemplateVariables(
		normalizeTemplateInput(prompts.entryPrompt),
		baseVariables,
	);
	const exit = applyTemplateVariables(
		normalizeTemplateInput(prompts.exitPrompt),
		baseVariables,
	);
	const variables = applyTemplateVariables(
		normalizeTemplateInput(prompts.varPrompt),
		baseVariables,
	);
	return { entry, exit, variables };
}

function readUserPromptSections(): PromptSections {
	return {
		entry: normalizeTemplateInput(
			getConfigStringValue("PROMPT_SECTION_ENTRY", ""),
		),
		exit: normalizeTemplateInput(
			getConfigStringValue("PROMPT_SECTION_EXIT", ""),
		),
		variables: normalizeTemplateInput(
			getConfigStringValue("PROMPT_SECTION_VARIABLES", ""),
		),
	};
}

function mergeUserPromptSections(
	baseVariables: PromptVariables,
	defaultSections: PromptSections,
): PromptSections {
	const raw = readUserPromptSections();
	const variables: PromptVariables = {
		...baseVariables,
		ENTRY_PROMPT: defaultSections.entry,
		EXIT_PROMPT: defaultSections.exit,
		VAR_PROMPT: defaultSections.variables,
	};

	const entry = raw.entry
		? applyTemplateVariables(raw.entry, variables)
		: defaultSections.entry;
	const exit = raw.exit
		? applyTemplateVariables(raw.exit, variables)
		: defaultSections.exit;
	const vars = raw.variables
		? applyTemplateVariables(raw.variables, variables)
		: defaultSections.variables;

	return {
		entry,
		exit,
		variables: vars,
	};
}

function getFallbackPromptSections(
	baseVariables: PromptVariables,
): PromptSections {
	return buildSectionsFromPrompts(
		{
			entryPrompt: DEFAULT_PROMPT_ENTRY,
			exitPrompt: DEFAULT_PROMPT_EXIT,
			varPrompt: DEFAULT_PROMPT_VARIABLES,
		},
		baseVariables,
	);
}

function buildConfiguredSections(
	baseVariables: PromptVariables,
): PromptSections {
	const fallback = getFallbackPromptSections(baseVariables);
	return mergeUserPromptSections(baseVariables, fallback);
}

function withSectionVariables(
	baseVariables: PromptVariables,
	sections: PromptSections,
): PromptVariables {
	return {
		...baseVariables,
		ENTRY_PROMPT: sections.entry,
		EXIT_PROMPT: sections.exit,
		VAR_PROMPT: sections.variables,
	};
}

export async function getStrategyPromptDefaultSections(
	strategy: TradingStrategy,
	intervalMinutes: number,
	language?: StrategyLanguage,
): Promise<PromptSections> {
	const actualLanguage = language || (await getPromptLanguage());
	const profile = getStrategyProfile(strategy, actualLanguage);
	const riskConfig = await getAccountRiskConfig();
	const baseVariables = buildBasePromptVariables(
		strategy,
		intervalMinutes,
		riskConfig,
		actualLanguage,
	);
	return buildSectionsFromPrompts(profile.prompts, baseVariables);
}

interface TradingPromptInput {
	minutesElapsed: number;
	iteration: number;
	intervalMinutes: number;
	marketData: Record<string, any>;
	accountInfo: any;
	positions: any[];
	tradeHistory?: any[];
	recentDecisions?: any[];
}

function safeNumber(value: any, fallback = 0): number {
	const num = Number(value);
	return Number.isFinite(num) ? num : fallback;
}

function formatMarketDataSection(
	marketData: Record<string, any>,
	language: StrategyLanguage,
): string {
	const symbols = Object.keys(marketData || {});
	if (symbols.length === 0) {
		return language === "zh" ? "暂无市场数据" : "No market data available";
	}

	// 辅助函数：格式化数字序列
	const formatSeries = (arr: number[], decimals = 2): string => {
		if (!arr || arr.length === 0) return "[]";
		return `[${arr.map(v => safeNumber(v).toFixed(decimals)).join(", ")}]`;
	};

	if (language === "en") {
		const lines: string[] = [SECTION_SEPARATOR, "[Market Snapshot]"];
		lines.push("\nAll symbols current market status\n");
		
		for (const symbol of symbols) {
			const data = marketData[symbol] ?? {};
			const price = safeNumber(data.price);
			const ema20 = safeNumber(data.ema20);
			const macd = safeNumber(data.macd);
			const rsi7 = safeNumber(data.rsi7);
			const rsi14 = safeNumber(data.rsi14);
			const funding = safeNumber(data.fundingRate);

			lines.push(`All ${symbol} data`);
			lines.push(
				`Current price = ${price.toFixed(2)}, Current EMA20 = ${ema20.toFixed(3)}, Current MACD = ${macd.toFixed(3)}, Current RSI(7-period) = ${rsi7.toFixed(3)}`,
			);
			lines.push("");
			lines.push(
				`Additionally, here is the latest funding rate for the ${symbol} perpetual contract (the contract type you trade):`,
			);
			lines.push(`\nFunding rate: ${funding.toExponential(2)}\n`);

			// 日内序列数据 (Intraday series)
			const series = data.intradaySeries;
			if (series && Array.isArray(series.midPrices) && series.midPrices.length > 0) {
				lines.push("Intraday sequences (per minute, oldest → latest):\n");
				lines.push(`Mid prices: ${formatSeries(series.midPrices.slice(-10), 1)}\n`);
				
				if (series.ema20Series && series.ema20Series.length > 0) {
					lines.push(`EMA indicator (20-period): ${formatSeries(series.ema20Series.slice(-10), 3)}\n`);
				}
				if (series.macdSeries && series.macdSeries.length > 0) {
					lines.push(`MACD indicator: ${formatSeries(series.macdSeries.slice(-10), 3)}\n`);
				}
				if (series.rsi7Series && series.rsi7Series.length > 0) {
					lines.push(`RSI indicator (7-period): ${formatSeries(series.rsi7Series.slice(-10), 3)}\n`);
				}
				if (series.rsi14Series && series.rsi14Series.length > 0) {
					lines.push(`RSI indicator (14-period): ${formatSeries(series.rsi14Series.slice(-10), 3)}\n`);
				}
			}

			// 更长期上下文 (1小时时间框架)
			const timeframes = data.timeframes || {};
			const oneHour = timeframes["1h"];
			if (oneHour) {
				lines.push("Longer-term context (1-hour timeframe):\n");
				lines.push(
					`20-period EMA: ${oneHour.ema20.toFixed(2)} vs. 50-period EMA: ${oneHour.ema50.toFixed(2)}\n`,
				);
				lines.push(
					`3-period ATR: ${safeNumber(oneHour.atr3).toFixed(2)} vs. 14-period ATR: ${safeNumber(oneHour.atr14).toFixed(3)}\n`,
				);
				lines.push(
					`Current volume: ${safeNumber(oneHour.volume).toFixed(2)} vs. Average volume: ${safeNumber(oneHour.avgVolume).toFixed(3)}\n`,
				);
				
				// 1小时MACD和RSI序列
				if (oneHour.history) {
					if (oneHour.history.macd && oneHour.history.macd.length > 0) {
						lines.push(`MACD indicator: ${formatSeries(oneHour.history.macd.slice(-10), 3)}\n`);
					}
					if (oneHour.history.rsi14 && oneHour.history.rsi14.length > 0) {
						lines.push(`RSI indicator (14-period): ${formatSeries(oneHour.history.rsi14.slice(-10), 3)}\n`);
					}
				}
			}

			// 多时间框架指标汇总
			lines.push("Multi-timeframe indicators:\n");
			const tfOrder: Array<[string, string]> = [
				["1m", "1m"],
				["3m", "3m"],
				["5m", "5m"],
				["15m", "15m"],
				["30m", "30m"],
				["1h", "1h"],
			];
			for (const [key, label] of tfOrder) {
				const tfData = timeframes[key];
				if (tfData) {
					const priceText = safeNumber(tfData.currentPrice).toFixed(2);
					const ema20Text = safeNumber(tfData.ema20).toFixed(2);
					const ema50Text = safeNumber(tfData.ema50).toFixed(2);
					const macdText = safeNumber(tfData.macd).toFixed(3);
					const rsi7Text = safeNumber(tfData.rsi7).toFixed(1);
					const rsi14Text = safeNumber(tfData.rsi14).toFixed(1);
					const volumeText = safeNumber(tfData.volume).toFixed(2);
					lines.push(
						`${label}: Price=${priceText}, EMA20=${ema20Text}, EMA50=${ema50Text}, MACD=${macdText}, RSI7=${rsi7Text}, RSI14=${rsi14Text}, Volume=${volumeText}`,
					);
				}
			}

			lines.push("\n");
		}
		return lines.join("\n").trimEnd();
	}

	const lines: string[] = [SECTION_SEPARATOR, "【市场行情快照】"];
	lines.push("\n所有币种的当前市场状态\n");

	for (const symbol of symbols) {
		const data = marketData[symbol] ?? {};
		const price = safeNumber(data.price);
		const ema20 = safeNumber(data.ema20);
		const macd = safeNumber(data.macd);
		const rsi7 = safeNumber(data.rsi7);
		const rsi14 = safeNumber(data.rsi14);
		const funding = safeNumber(data.fundingRate);

		lines.push(`所有 ${symbol} 数据`);
		lines.push(
			`当前价格 = ${price.toFixed(2)}, 当前EMA20 = ${ema20.toFixed(3)}, 当前MACD = ${macd.toFixed(3)}, 当前RSI（7周期） = ${rsi7.toFixed(3)}`,
		);
		lines.push("");
		lines.push(
			`此外，这是 ${symbol} 永续合约的最新资金费率（您交易的合约类型）：`,
		);
		lines.push(`\n资金费率: ${funding.toExponential(2)}\n`);

		// 日内序列数据
		const series = data.intradaySeries;
		if (series && Array.isArray(series.midPrices) && series.midPrices.length > 0) {
			lines.push("日内序列（按分钟，最旧 → 最新）：\n");
			lines.push(`中间价: ${formatSeries(series.midPrices.slice(-10), 1)}\n`);
			
			if (series.ema20Series && series.ema20Series.length > 0) {
				lines.push(`EMA指标（20周期）: ${formatSeries(series.ema20Series.slice(-10), 3)}\n`);
			}
			if (series.macdSeries && series.macdSeries.length > 0) {
				lines.push(`MACD指标: ${formatSeries(series.macdSeries.slice(-10), 3)}\n`);
			}
			if (series.rsi7Series && series.rsi7Series.length > 0) {
				lines.push(`RSI指标（7周期）: ${formatSeries(series.rsi7Series.slice(-10), 3)}\n`);
			}
			if (series.rsi14Series && series.rsi14Series.length > 0) {
				lines.push(`RSI指标（14周期）: ${formatSeries(series.rsi14Series.slice(-10), 3)}\n`);
			}
		}

		// 更长期上下文（1小时时间框架）
		const timeframes = data.timeframes || {};
		const oneHour = timeframes["1h"];
		if (oneHour) {
			lines.push("更长期上下文（1小时时间框架）：\n");
			lines.push(
				`20周期EMA: ${oneHour.ema20.toFixed(2)} vs. 50周期EMA: ${oneHour.ema50.toFixed(2)}\n`,
			);
			lines.push(
				`3周期ATR: ${safeNumber(oneHour.atr3).toFixed(2)} vs. 14周期ATR: ${safeNumber(oneHour.atr14).toFixed(3)}\n`,
			);
			lines.push(
				`当前成交量: ${safeNumber(oneHour.volume).toFixed(2)} vs. 平均成交量: ${safeNumber(oneHour.avgVolume).toFixed(3)}\n`,
			);
			
			// 1小时MACD和RSI序列
			if (oneHour.history) {
				if (oneHour.history.macd && oneHour.history.macd.length > 0) {
					lines.push(`MACD指标: ${formatSeries(oneHour.history.macd.slice(-10), 3)}\n`);
				}
				if (oneHour.history.rsi14 && oneHour.history.rsi14.length > 0) {
					lines.push(`RSI指标（14周期）: ${formatSeries(oneHour.history.rsi14.slice(-10), 3)}\n`);
				}
			}
		}

		// 多时间框架指标汇总
		lines.push("多时间框架指标：\n");
		const tfOrder: Array<[string, string]> = [
			["1m", "1分钟"],
			["3m", "3分钟"],
			["5m", "5分钟"],
			["15m", "15分钟"],
			["30m", "30分钟"],
			["1h", "1小时"],
		];
		for (const [key, label] of tfOrder) {
			const tfData = timeframes[key];
			if (tfData) {
				const priceText = safeNumber(tfData.currentPrice).toFixed(2);
				const ema20Text = safeNumber(tfData.ema20).toFixed(2);
				const ema50Text = safeNumber(tfData.ema50).toFixed(2);
				const macdText = safeNumber(tfData.macd).toFixed(3);
				const rsi7Text = safeNumber(tfData.rsi7).toFixed(1);
				const rsi14Text = safeNumber(tfData.rsi14).toFixed(1);
				const volumeText = safeNumber(tfData.volume).toFixed(2);
				lines.push(
					`${label}: 价格=${priceText}, EMA20=${ema20Text}, EMA50=${ema50Text}, MACD=${macdText}, RSI7=${rsi7Text}, RSI14=${rsi14Text}, 成交量=${volumeText}`,
				);
			}
		}

		lines.push("\n");
	}

	return lines.join("\n").trimEnd();
}

function formatAccountSection(
	accountInfo: any,
	positions: any[],
	intervalMinutes: number,
	language: StrategyLanguage,
): string {
	if (!accountInfo) {
		return language === "zh"
			? "账户信息缺失"
			: "Account information unavailable";
	}

	if (language === "en") {
		const lines: string[] = [SECTION_SEPARATOR, "[Account Overview]"];
		if (Number.isFinite(accountInfo.totalBalance)) {
			lines.push(
				`Net asset value: ${accountInfo.totalBalance.toFixed(2)} USDT`,
			);
		}
		if (Number.isFinite(accountInfo.availableBalance)) {
			lines.push(
				`Available balance: ${accountInfo.availableBalance.toFixed(2)} USDT`,
			);
		}
		if (Number.isFinite(accountInfo.returnPercent)) {
			lines.push(`Total return: ${accountInfo.returnPercent.toFixed(2)}%`);
		}
		if (
			Number.isFinite(accountInfo.initialBalance) &&
			Number.isFinite(accountInfo.totalBalance)
		) {
			const drawdownFromInitial =
				((accountInfo.initialBalance - accountInfo.totalBalance) /
					accountInfo.initialBalance) *
				100;
			lines.push(
				`Drawdown from initial balance: ${drawdownFromInitial.toFixed(2)}%`,
			);
		}
		if (
			Number.isFinite(accountInfo.peakBalance) &&
			Number.isFinite(accountInfo.totalBalance)
		) {
			const drawdownFromPeak =
				((accountInfo.peakBalance - accountInfo.totalBalance) /
					accountInfo.peakBalance) *
				100;
			lines.push(`Drawdown from peak equity: ${drawdownFromPeak.toFixed(2)}%`);
		}
		if (Number.isFinite(accountInfo.sharpeRatio)) {
			lines.push(`Sharpe ratio: ${accountInfo.sharpeRatio.toFixed(2)}`);
		}

		const totalUnrealized = positions.reduce(
			(sum, pos) =>
				sum + (Number.isFinite(pos.unrealized_pnl) ? pos.unrealized_pnl : 0),
			0,
		);
		lines.push(
			`Unrealized PnL: ${totalUnrealized >= 0 ? "+" : ""}${totalUnrealized.toFixed(2)} USDT`,
		);

		if (positions.length === 0) {
			lines.push("");
			lines.push("No open positions; monitor for new entries.");
			return lines.join("\n");
		}

		lines.push("\n[Positions]");
		for (const pos of positions) {
			const entryPrice = safeNumber(pos.entry_price);
			const currentPrice = safeNumber(pos.current_price, entryPrice);
			const leverage = safeNumber(pos.leverage);
			const pnl = safeNumber(pos.unrealized_pnl);
			const priceChangePercent =
				entryPrice > 0
					? ((currentPrice - entryPrice) / entryPrice) *
						100 *
						(pos.side === "long" ? 1 : -1)
					: 0;
			const pnlPercent =
				leverage > 0 ? priceChangePercent * leverage : priceChangePercent;
			const openedAt = pos.opened_at
				? formatChinaTime(pos.opened_at)
				: "Unknown";
			const holdingMinutes = pos.opened_at
				? Math.max(
						0,
						Math.floor(
							(Date.now() - new Date(pos.opened_at).getTime()) / 60000,
						),
					)
				: 0;
			const holdingHours = holdingMinutes / 60;
			const holdingCycles =
				intervalMinutes > 0
					? Math.floor(holdingMinutes / intervalMinutes)
					: holdingMinutes;
			const maxCycles =
				intervalMinutes > 0
					? Math.floor((RISK_PARAMS.MAX_HOLDING_HOURS * 60) / intervalMinutes)
					: 0;
			const remainingCycles = Math.max(0, maxCycles - holdingCycles);
			const peakPnlPercent = safeNumber(pos.peak_pnl_percent);
			const drawdownFromPeak =
				peakPnlPercent > 0 ? peakPnlPercent - pnlPercent : 0;

			lines.push(
				`- ${pos.symbol} ${pos.side === "long" ? "Long" : "Short"} ${leverage}x`,
			);
			lines.push(
				`  PnL: ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)} USDT (${pnlPercent >= 0 ? "+" : ""}${pnlPercent.toFixed(2)}%)`,
			);
			lines.push(
				`  Entry ${entryPrice.toFixed(2)} → Mark ${currentPrice.toFixed(2)}`,
			);
			lines.push(`  Opened: ${openedAt}, holding ${holdingHours.toFixed(1)} h`);
			lines.push(
				`  Cycle stats: completed ${holdingCycles} / ${maxCycles}, remaining ${remainingCycles}`,
			);
			if (peakPnlPercent > 0) {
				lines.push(
					`  Peak profit: +${peakPnlPercent.toFixed(2)}% | Drawdown ${drawdownFromPeak.toFixed(2)}%`,
				);
			}
			lines.push("");
		}

		return lines.join("\n").trimEnd();
	}

	const lines: string[] = [SECTION_SEPARATOR, "【账户概览】"];

	if (Number.isFinite(accountInfo.totalBalance)) {
		lines.push(`账户净值: ${accountInfo.totalBalance.toFixed(2)} USDT`);
	}
	if (Number.isFinite(accountInfo.availableBalance)) {
		lines.push(`可用余额: ${accountInfo.availableBalance.toFixed(2)} USDT`);
	}
	if (Number.isFinite(accountInfo.returnPercent)) {
		lines.push(`总体收益率: ${accountInfo.returnPercent.toFixed(2)}%`);
	}
	if (
		Number.isFinite(accountInfo.initialBalance) &&
		Number.isFinite(accountInfo.totalBalance)
	) {
		const drawdownFromInitial =
			((accountInfo.initialBalance - accountInfo.totalBalance) /
				accountInfo.initialBalance) *
			100;
		lines.push(`相对初始回撤: ${drawdownFromInitial.toFixed(2)}%`);
	}
	if (
		Number.isFinite(accountInfo.peakBalance) &&
		Number.isFinite(accountInfo.totalBalance)
	) {
		const drawdownFromPeak =
			((accountInfo.peakBalance - accountInfo.totalBalance) /
				accountInfo.peakBalance) *
			100;
		lines.push(`相对峰值回撤: ${drawdownFromPeak.toFixed(2)}%`);
	}
	if (Number.isFinite(accountInfo.sharpeRatio)) {
		lines.push(`夏普比率: ${accountInfo.sharpeRatio.toFixed(2)}`);
	}

	const totalUnrealized = positions.reduce(
		(sum, pos) =>
			sum + (Number.isFinite(pos.unrealized_pnl) ? pos.unrealized_pnl : 0),
		0,
	);
	lines.push(
		`未实现盈亏: ${totalUnrealized >= 0 ? "+" : ""}${totalUnrealized.toFixed(2)} USDT`,
	);

	if (positions.length === 0) {
		lines.push("");
		lines.push("当前无持仓，关注新的进场机会");
		return lines.join("\n");
	}

	lines.push("\n【持仓详情】");
	for (const pos of positions) {
		const entryPrice = safeNumber(pos.entry_price);
		const currentPrice = safeNumber(pos.current_price, entryPrice);
		const leverage = safeNumber(pos.leverage);
		const pnl = safeNumber(pos.unrealized_pnl);
		const priceChangePercent =
			entryPrice > 0
				? ((currentPrice - entryPrice) / entryPrice) *
					100 *
					(pos.side === "long" ? 1 : -1)
				: 0;
		const pnlPercent =
			leverage > 0 ? priceChangePercent * leverage : priceChangePercent;
		const openedAt = pos.opened_at ? formatChinaTime(pos.opened_at) : "未知";
		const holdingMinutes = pos.opened_at
			? Math.max(
					0,
					Math.floor((Date.now() - new Date(pos.opened_at).getTime()) / 60000),
				)
			: 0;
		const holdingHours = holdingMinutes / 60;
		const holdingCycles =
			intervalMinutes > 0
				? Math.floor(holdingMinutes / intervalMinutes)
				: holdingMinutes;
		const maxCycles =
			intervalMinutes > 0
				? Math.floor((RISK_PARAMS.MAX_HOLDING_HOURS * 60) / intervalMinutes)
				: 0;
		const remainingCycles = Math.max(0, maxCycles - holdingCycles);
		const peakPnlPercent = safeNumber(pos.peak_pnl_percent);
		const drawdownFromPeak =
			peakPnlPercent > 0 ? peakPnlPercent - pnlPercent : 0;

		lines.push(
			`- ${pos.symbol} ${pos.side === "long" ? "做多" : "做空"} ${leverage}x`,
		);
		lines.push(
			`  盈亏: ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)} USDT (${pnlPercent >= 0 ? "+" : ""}${pnlPercent.toFixed(2)}%)`,
		);
		lines.push(
			`  开仓价 ${entryPrice.toFixed(2)} → 现价 ${currentPrice.toFixed(2)}`,
		);
		lines.push(
			`  开仓时间: ${openedAt}，已持仓 ${holdingHours.toFixed(1)} 小时`,
		);
		lines.push(
			`  周期统计: 已完成 ${holdingCycles} / ${maxCycles} 个周期，剩余 ${remainingCycles}`,
		);
		if (peakPnlPercent > 0) {
			lines.push(
				`  峰值盈利: +${peakPnlPercent.toFixed(2)}%，回撤 ${drawdownFromPeak.toFixed(2)}%`,
			);
		}
		lines.push("");
	}

	return lines.join("\n").trimEnd();
}

function formatTradeHistorySection(
	tradeHistory: any[] | undefined,
	language: StrategyLanguage,
): string {
	if (!tradeHistory || tradeHistory.length === 0) {
		return "";
	}

	const recentTrades = tradeHistory.slice(-10);
	let profitCount = 0;
	let lossCount = 0;
	let totalProfit = 0;

	if (language === "en") {
		const lines: string[] = [SECTION_SEPARATOR, "[Recent 10 Trades]"];
		for (const trade of recentTrades) {
			const timeText = trade.timestamp
				? formatChinaTime(trade.timestamp)
				: "Unknown time";
			const pnl = Number.isFinite(trade.pnl) ? trade.pnl : null;
			if (typeof pnl === "number") {
				totalProfit += pnl;
				if (pnl > 0) profitCount += 1;
				if (pnl < 0) lossCount += 1;
			}
			lines.push(
				`- ${trade.symbol} ${trade.side?.toUpperCase()} ${trade.type === "open" ? "Open" : "Close"}`,
			);
			lines.push(
				`  Time: ${timeText}  Price: ${Number.isFinite(trade.price) ? trade.price.toFixed(2) : "-"}  Leverage: ${trade.leverage ?? "-"}x`,
			);
			lines.push(
				`  Fee: ${Number.isFinite(trade.fee) ? trade.fee.toFixed(4) : "-"} USDT`,
			);
			if (pnl !== null) {
				lines.push(`  PnL: ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)} USDT`);
			}
			lines.push("");
		}

		const totalTrades = profitCount + lossCount;
		if (totalTrades > 0) {
			const winRate = (profitCount / totalTrades) * 100;
			lines.push(
				`Win rate: ${winRate.toFixed(1)}% | Total PnL: ${totalProfit >= 0 ? "+" : ""}${totalProfit.toFixed(2)} USDT`,
			);
		}

		return lines.join("\n").trimEnd();
	}

	const lines: string[] = [SECTION_SEPARATOR, "【最近 10 笔交易】"];
	for (const trade of recentTrades) {
		const timeText = trade.timestamp
			? formatChinaTime(trade.timestamp)
			: "未知时间";
		const pnl = Number.isFinite(trade.pnl) ? trade.pnl : null;
		if (typeof pnl === "number") {
			totalProfit += pnl;
			if (pnl > 0) profitCount += 1;
			if (pnl < 0) lossCount += 1;
		}
		lines.push(
			`- ${trade.symbol} ${trade.side?.toUpperCase()} ${trade.type === "open" ? "开仓" : "平仓"}`,
		);
		lines.push(
			`  时间: ${timeText}  价格: ${Number.isFinite(trade.price) ? trade.price.toFixed(2) : "-"}  杠杆: ${trade.leverage ?? "-"}x`,
		);
		lines.push(
			`  手续费: ${Number.isFinite(trade.fee) ? trade.fee.toFixed(4) : "-"} USDT`,
		);
		if (pnl !== null) {
			lines.push(`  盈亏: ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)} USDT`);
		}
		lines.push("");
	}

	const totalTrades = profitCount + lossCount;
	if (totalTrades > 0) {
		const winRate = (profitCount / totalTrades) * 100;
		lines.push(
			`胜率: ${winRate.toFixed(1)}% | 总盈亏: ${totalProfit >= 0 ? "+" : ""}${totalProfit.toFixed(2)} USDT`,
		);
	}

	return lines.join("\n").trimEnd();
}

function formatRecentDecisionsSection(
	recentDecisions: any[] | undefined,
	language: StrategyLanguage,
): string {
	if (!recentDecisions || recentDecisions.length === 0) {
		return "";
	}

	if (language === "en") {
		const lines: string[] = [
			SECTION_SEPARATOR,
			"[Historical Decision Records Begin]",
			SECTION_SEPARATOR,
			"",
			"Important Reminder: The following are historical decision records for reference only, not current status!",
			"For current market data and position information, please refer to the real-time data above.",
			"",
		];
		for (let i = 0; i < recentDecisions.length; i++) {
			const decision = recentDecisions[i];
			const timeText = decision.timestamp
				? formatChinaTime(decision.timestamp)
				: "Unknown time";
			const timeAgo = decision.timestamp
				? Math.round((Date.now() - new Date(decision.timestamp).getTime()) / 60000)
				: null;
			
			lines.push(`[Historical] Decision #${decision.iteration ?? i} (${timeText}${timeAgo ? `, ${timeAgo} minutes ago` : ""}):`);;
			if (Number.isFinite(decision.account_value)) {
				lines.push(`  Account value then: ${decision.account_value.toFixed(2)} USDT`);
			}
			if (Number.isFinite(decision.positions_count)) {
				lines.push(`  Position count then: ${decision.positions_count}`);
			}
			if (decision.decision) {
				// 决策内容可能很长，适当截断
				const decisionText = decision.decision.length > 500
					? decision.decision.substring(0, 500) + "..."
					: decision.decision;
				lines.push(`  Decision content then: ${decisionText}`);
			}
			lines.push("");
		}
		
		lines.push("[Historical Decision Records End]");
		lines.push("");
		lines.push("Usage suggestions:");
		lines.push("- Use only as reference for decision continuity, don't be constrained by historical decisions");
		lines.push("- Market has changed, make independent judgment based on current latest data");
		lines.push("- If market conditions change, adjust strategy decisively");
		lines.push("");
		
		return lines.join("\n").trimEnd();
	}

	const lines: string[] = [
		SECTION_SEPARATOR,
		"【历史决策记录开始】",
		SECTION_SEPARATOR,
		"",
		"重要提醒：以下是历史决策记录，仅作为参考，不代表当前状态！",
		"当前市场数据和持仓信息请参考上方实时数据。",
		"",
	];
	for (let i = 0; i < recentDecisions.length; i++) {
		const decision = recentDecisions[i];
		const timeText = decision.timestamp
			? formatChinaTime(decision.timestamp)
			: "未知时间";
		const timeAgo = decision.timestamp
			? Math.round((Date.now() - new Date(decision.timestamp).getTime()) / 60000)
			: null;
		
		lines.push(`【历史】决策 #${decision.iteration ?? i} (${timeText}${timeAgo ? `，${timeAgo}分钟前` : ""}):`);;
		if (Number.isFinite(decision.account_value)) {
			lines.push(`  当时账户价值: ${decision.account_value.toFixed(2)} USDT`);
		}
		if (Number.isFinite(decision.positions_count)) {
			lines.push(`  当时持仓数量: ${decision.positions_count}`);
		}
		if (decision.decision) {
			// 决策内容可能很长，适当截断
			const decisionText = decision.decision.length > 500
				? decision.decision.substring(0, 500) + "..."
				: decision.decision;
			lines.push(`  当时决策内容: ${decisionText}`);
		}
		lines.push("");
	}
	
	lines.push("【历史决策记录结束】");
	lines.push("");
	lines.push("使用建议：");
	lines.push("- 仅作为决策连续性参考，不要被历史决策束缚");
	lines.push("- 市场已经变化，请基于当前最新数据独立判断");
	lines.push("- 如果市场条件改变，应该果断调整策略");
	lines.push("");
	
	return lines.join("\n").trimEnd();
}

export async function generateTradingPrompt(
	input: TradingPromptInput,
): Promise<string> {
	const {
		minutesElapsed,
		iteration,
		intervalMinutes,
		marketData,
		accountInfo,
		positions,
		tradeHistory,
		recentDecisions,
	} = input;

	const language = await getPromptLanguage();
	const strategyName = getActiveStrategyName();
	const riskConfig = getRiskConfigSnapshot();

	// 加载策略文件（用于 params 替换与交易币种配置）
	let tradingSymbols: string[] | undefined;
	let strategyObj: any = null;
	if (strategyName) {
		strategyObj = await StrategyFileManager.loadStrategy(strategyName);
		if (strategyObj?.params?.tradingSymbols) {
			tradingSymbols = strategyObj.params.tradingSymbols
				.split(",")
				.map((s: string) => s.trim().toUpperCase())
				.filter((s: string) => s.length > 0);
		}
	}

	const baseVariables = buildBasePromptVariables(
		strategyObj ?? strategyName,
		intervalMinutes,
		riskConfig,
		language,
		tradingSymbols,
	);
	const sections = buildConfiguredSections(baseVariables);

	const templateVariables: PromptVariables = {
		...withSectionVariables(baseVariables, sections),
		ITERATION: formatNumber(iteration, 0),
		MINUTES_ELAPSED: formatNumber(minutesElapsed, 0),
		CURRENT_TIME: formatChinaTime(),
	};

	const template = await loadPromptTemplate(language);
	const promptHeader = applyTemplateVariables(template, templateVariables);

	const sectionsOutput: string[] = [promptHeader];
	sectionsOutput.push(formatMarketDataSection(marketData, language));
	sectionsOutput.push(
		formatAccountSection(accountInfo, positions, intervalMinutes, language),
	);
	const tradeSection = formatTradeHistorySection(tradeHistory, language);
	if (tradeSection) {
		sectionsOutput.push(tradeSection);
	}
	const decisionsSection = formatRecentDecisionsSection(
		recentDecisions,
		language,
	);
	if (decisionsSection) {
		sectionsOutput.push(decisionsSection);
	}

	return sectionsOutput.filter(Boolean).join("\n\n");
}

async function generateInstructions(intervalMinutes: number): Promise<string> {
	const language = await getPromptLanguage();
	const strategyName = getActiveStrategyName();
	const riskConfig = await getAccountRiskConfig();

	// 加载策略文件（用于 params 替换与交易币种配置）
	let tradingSymbols: string[] | undefined;
	let strategyObj: any = null;
	if (strategyName) {
		strategyObj = await StrategyFileManager.loadStrategy(strategyName);
		if (strategyObj?.params?.tradingSymbols) {
			tradingSymbols = strategyObj.params.tradingSymbols
				.split(",")
				.map((s: string) => s.trim().toUpperCase())
				.filter((s: string) => s.length > 0);
		}
	}

	const baseVariables = buildBasePromptVariables(
		strategyObj ?? strategyName,
		intervalMinutes,
		riskConfig,
		language,
		tradingSymbols,
	);
	const sections = buildConfiguredSections(baseVariables);

	const template = await loadInstructionsTemplate(language);
	const variables = withSectionVariables(baseVariables, sections);
	return applyTemplateVariables(template, variables);
}

export interface TradingAgentHandle {
	agent: Agent;
	instructions: string;
	modelName: string;
}

export async function createTradingAgent(
	intervalMinutes = 5,
): Promise<TradingAgentHandle> {
	const { getAllConfig } = await import("../database/init-config");
	const config = await getAllConfig();

	// 优先从数据库获取激活的 AI 模型配置
	const { getActiveAiModel } = await import("../services/aiModelService");
	const activeModel = await getActiveAiModel();

	let apiKey: string;
	let baseURL: string;
	let modelName: string;

	if (activeModel) {
		// 使用数据库中的激活模型
		apiKey = activeModel.api_key;
		baseURL = activeModel.base_url;
		modelName = activeModel.model_name;
		logger.info(
			`使用数据库 AI 模型配置: ${activeModel.name} (ID: ${activeModel.id})`,
		);
	} else {
		// 回退到 system_config 或 .env
		apiKey = config.OPENAI_API_KEY || process.env.OPENAI_API_KEY || "";
		baseURL =
			config.OPENAI_BASE_URL ||
			process.env.OPENAI_BASE_URL ||
			"https://openrouter.ai/api/v1";
		modelName =
			config.AI_MODEL_NAME ||
			process.env.AI_MODEL_NAME ||
			"deepseek/deepseek-v3.2-exp";
		logger.warn("未找到激活的 AI 模型配置，使用默认配置");
	}

	if (!apiKey) {
		logger.warn("OPENAI_API_KEY 未配置，AI Agent 将无法正常调用模型");
	}

	// 清理 Base URL
	let cleanBaseUrl = String(baseURL).trim();
	cleanBaseUrl = cleanBaseUrl
		.replace(/\/chat\/completions\/?$/, "")
		.replace(/\/$/, "");

	const openai = createOpenAI({
		apiKey,
		baseURL: cleanBaseUrl,
	} as any);

	const memory = new Memory({
		storage: new LibSQLMemoryAdapter({
			url: "file:./data/database/trading-memory.db",
			logger: logger.child({ component: "libsql" }),
		}),
	});

	const strategyName = getActiveStrategyName();
	logger.info(`初始化交易 Agent，策略=${strategyName}，模型=${modelName}`);

	const instructions = await generateInstructions(intervalMinutes);

	const agentInstance = new Agent({
		name: "trading-agent",
		instructions,
		model: openai.chat(modelName),
		tools: [
			tradingTools.getMarketPriceTool,
			tradingTools.getTechnicalIndicatorsTool,
			tradingTools.getFundingRateTool,
			tradingTools.getOrderBookTool,
			tradingTools.openPositionTool,
			tradingTools.closePositionTool,
			tradingTools.cancelOrderTool,
			tradingTools.getAccountBalanceTool,
			tradingTools.getPositionsTool,
			tradingTools.getOpenOrdersTool,
			tradingTools.checkOrderStatusTool,
			tradingTools.calculateRiskTool,
			tradingTools.syncPositionsTool,
			tradingTools.sendEmergencyNoticeTool,
		],
		memory,
	});

	return {
		agent: agentInstance,
		instructions,
		modelName,
	};
}
