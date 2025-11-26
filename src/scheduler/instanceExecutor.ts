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

import { createClient, Client } from "@libsql/client";
import { createLogger } from "../utils/loggerUtils";
import { getChinaTimeISO } from "../utils/timeUtils";
import { getQuantoMultiplier } from "../utils/contractUtils";
import { RISK_PARAMS, getConfigStringValue } from "../config/riskParams.new";
import { StrategyFileManager, type StrategyFileContent } from "../services/strategyFileManager";
import { runWithInstanceContext, type InstanceContext } from "../services/instanceContext";
import type { TradingInstanceWithDetails } from "../services/tradingInstanceService";
import { insertAgentRequestLog } from "../database/agent-request-logs";
import { getLocalizedPromptTemplate } from "../prompts/templateLoader";
import { normalizeStrategyLanguage, DEFAULT_STRATEGY_LANGUAGE, type StrategyLanguage } from "../config/strategyTypes";

const logger = createLogger({
  name: "instance-executor",
  level: "info",
});

const dbClient = createClient({
  url: process.env.DATABASE_URL || "file:./db/sqlite.db",
});

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

/**
 * 获取指定时间范围内的交易动作记录
 * @param start 开始时间
 * @param end 结束时间
 * @param accountId 账户ID（可选，用于过滤特定账户的记录）
 */
async function getTradeActionsBetween(start: string, end: string, accountId?: number): Promise<TradeActionRecord[]> {
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

/**
 * 从 TradingInstanceWithDetails 提取执行配置
 */
function extractExecutionConfig(instance: TradingInstanceWithDetails): InstanceExecutionConfig | null {
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
async function createExchangeClientForInstance(config: InstanceExecutionConfig): Promise<any> {
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
        proxyUrl
      );
    }
    case "binance": {
      const { BinanceClient } = await import("../services/binanceClient");
      return new BinanceClient(
        accountConfig.apiKey,
        accountConfig.apiSecret,
        accountConfig.usePaper,
        proxyUrl
      );
    }
    case "bitget": {
      const { BitgetClient } = await import("../services/bitgetClient");
      return new BitgetClient(
        accountConfig.apiKey,
        accountConfig.apiSecret,
        accountConfig.apiPassphrase || "",
        accountConfig.usePaper,
        proxyUrl
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
  return decimals === 0 ? Math.round(value).toString() : value.toFixed(decimals);
}

/**
 * 应用模板变量替换
 * 将模板中的 {{KEY}} 占位符替换为对应的值
 */
function applyTemplateVariables(template: string, variables: Record<string, string>): string {
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
  accountRisk?: { stopLossUsdt?: number; takeProfitUsdt?: number }
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
    TRADING_INTERVAL_MINUTES: formatNumber(params?.intervalMinutes ?? intervalMinutes, 0),
    MAX_HOLDING_HOURS: formatNumber(params?.maxHoldingHours ?? RISK_PARAMS.MAX_HOLDING_HOURS, 0),
    MIN_HOLDING_MINUTES: formatNumber(params?.minHoldingMinutes ?? RISK_PARAMS.MIN_HOLDING_MINUTES, 0),
    MAX_POSITIONS: formatNumber(params?.maxPositions ?? RISK_PARAMS.MAX_POSITIONS, 0),
    EXTREME_STOP_LOSS_PERCENT: formatNumber(params?.extremeStopLossPercent ?? RISK_PARAMS.EXTREME_STOP_LOSS_PERCENT, 0),
    SYMBOL_LIST: symbols.join(symbolSeparator),
  };
  
  // 计算最大持仓周期数
  const maxHours = params?.maxHoldingHours ?? RISK_PARAMS.MAX_HOLDING_HOURS;
  const interval = params?.intervalMinutes ?? intervalMinutes;
  variables.MAX_HOLDING_CYCLES = formatNumber(Math.floor((maxHours * 60) / interval), 0);
  
  // 账户风控参数（优先使用策略配置，其次使用账户配置，最后使用全局配置）
  const stopLoss = params?.accountStopLoss ?? accountRisk?.stopLossUsdt;
  const takeProfit = params?.accountTakeProfit ?? accountRisk?.takeProfitUsdt;
  variables.ACCOUNT_STOP_LOSS_USDT = stopLoss !== undefined && stopLoss > 0 ? formatNumber(stopLoss, 0) : "Disabled";
  variables.ACCOUNT_TAKE_PROFIT_USDT = takeProfit !== undefined && takeProfit > 0 ? formatNumber(takeProfit, 0) : "Disabled";
  
  // 回撤警戒参数
  variables.ACCOUNT_DRAWDOWN_WARNING_PERCENT = formatNumber(
    params?.drawdownWarning ?? RISK_PARAMS.ACCOUNT_DRAWDOWN_WARNING_PERCENT, 0
  );
  variables.ACCOUNT_DRAWDOWN_NO_NEW_POSITION_PERCENT = formatNumber(
    params?.drawdownNoNew ?? RISK_PARAMS.ACCOUNT_DRAWDOWN_NO_NEW_POSITION_PERCENT, 0
  );
  variables.ACCOUNT_DRAWDOWN_FORCE_CLOSE_PERCENT = formatNumber(
    params?.drawdownForceClose ?? RISK_PARAMS.ACCOUNT_DRAWDOWN_FORCE_CLOSE_PERCENT, 0
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
async function createAgentForInstance(config: InstanceExecutionConfig, intervalMinutes: number): Promise<{
  agent: any;
  instructions: string;
  modelName: string;
}> {
  const { createOpenAI } = await import("@ai-sdk/openai");
  const { Agent } = await import("@voltagent/core");
  const tradingTools = await import("../tools/trading");
  
  const { aiModelConfig, strategyName, accountConfig } = config;
  
  // 清理 Base URL
  let cleanBaseUrl = aiModelConfig.baseUrl.trim();
  cleanBaseUrl = cleanBaseUrl.replace(/\/chat\/completions\/?$/, "").replace(/\/$/, "");
  
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
    }
  );
  
  // 加载多语言 instructions 模板并替换占位符
  let instructions = "";
  try {
    const template = await getLocalizedPromptTemplate("instructions", language);
    instructions = applyTemplateVariables(template, templateVariables);
    logger.debug(`[实例 ${config.instanceName}] 使用 instructions_${language}.txt 模板`);
  } catch (error) {
    logger.warn(`加载 instructions 模板失败，使用策略原始提示词`);
    // 回退：直接拼接策略提示词
    instructions = [
      strategy?.prompts?.entryLogic || "",
      strategy?.prompts?.exitLogic || "",
      strategy?.prompts?.variables || "",
    ].filter(Boolean).join("\n\n") || "You are a trading AI assistant. Analyze market data and make trading decisions.";
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
  accountId: number
): Promise<Record<string, any>> {
  const marketData: Record<string, any> = {};
  
  for (const symbol of symbols) {
    try {
      const contract = `${symbol}_USDT`;
      
      // 获取价格
      const ticker = await exchangeClient.getFuturesTicker(contract);
      const price = Number.parseFloat(ticker.last || "0");
      
      if (price === 0 || !Number.isFinite(price)) {
        logger.warn(`${symbol} 价格无效，跳过`);
        continue;
      }
      
      // 获取 K 线
      const candles5m = await exchangeClient.getFuturesCandles(contract, "5m", 100);
      const candles1h = await exchangeClient.getFuturesCandles(contract, "1h", 168);
      
      // 计算基本指标
      const closes5m = candles5m.map((c: any) => Number.parseFloat(c.c || "0")).filter((n: number) => Number.isFinite(n));
      const closes1h = candles1h.map((c: any) => Number.parseFloat(c.c || "0")).filter((n: number) => Number.isFinite(n));
      
      marketData[symbol] = {
        price,
        change24h: Number.parseFloat(ticker.change_percentage || "0"),
        volume24h: Number.parseFloat(ticker.volume_24h || "0"),
        ema20: calcEMA(closes5m, 20),
        ema50: calcEMA(closes5m, 50),
        rsi14: calcRSI(closes5m, 14),
        macd: calcMACD(closes5m),
        timeframes: {
          "5m": { closes: closes5m.slice(-10) },
          "1h": { closes: closes1h.slice(-10) },
        }
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
  instance: TradingInstanceWithDetails
): Promise<void> {
  const config = extractExecutionConfig(instance);
  
  if (!config) {
    throw new Error(`实例 ${instance.name} 配置不完整`);
  }
  
  const { instanceId, instanceName, accountId, strategyName, accountConfig } = config;
  
  logger.info(`[实例 ${instanceName}] 开始执行交易决策`);
  
  try {
    // 1. 创建交易所客户端
    const exchangeClient = await createExchangeClientForInstance(config);
    
    // 2. 构建实例上下文（用于工具调用）
    const instanceContext: InstanceContext = {
      instanceId,
      instanceName,
      accountId,
      exchangeClient,
      provider: accountConfig.provider.toLowerCase() as "okx" | "binance" | "bitget",
      strategyName,
      stopLossUsdt: accountConfig.stopLossUsdt,
      takeProfitUsdt: accountConfig.takeProfitUsdt,
    };
    
    // 3. 在实例上下文中执行交易决策
    await runWithInstanceContext(instanceContext, async () => {
      await executeWithContext(config, exchangeClient, instance.interval_minutes);
    });
    
  } catch (error) {
    logger.error(`[实例 ${instanceName}] 执行失败:`, error);
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
  exchangeClient: any,
  intervalMinutes: number
): Promise<void> {
  const { instanceId, instanceName, accountId, strategyName } = config;
  
  // 1. 获取交易对列表
  const symbols = await getStrategySymbols(strategyName);
  logger.info(`[实例 ${instanceName}] 交易对: ${symbols.join(", ")}`);
  
  // 2. 收集市场数据
  const marketData = await collectMarketDataForInstance(exchangeClient, symbols, accountId);
  const validSymbols = Object.keys(marketData).filter(s => marketData[s].price > 0);
  
  if (validSymbols.length === 0) {
    logger.error(`[实例 ${instanceName}] 市场数据获取失败，跳过执行`);
    return;
  }
  
  // 3. 获取账户信息
  const account = await exchangeClient.getFuturesAccount();
  const totalBalance = Number.parseFloat(account.total || "0");
  const availableBalance = Number.parseFloat(account.available || "0");
  const unrealisedPnl = Number.parseFloat(account.unrealisedPnl || "0");
  
  logger.info(`[实例 ${instanceName}] 账户余额: ${totalBalance.toFixed(2)} USDT`);
  
  // 4. 获取持仓
  const positions = await exchangeClient.getPositions();
  const activePositions = positions.filter((p: any) => Math.abs(Number.parseFloat(p.size || "0")) > 1e-8);
  
  logger.info(`[实例 ${instanceName}] 当前持仓: ${activePositions.length} 个`);
  
  // 5. 创建 AI Agent
  const { agent, instructions, modelName } = await createAgentForInstance(config, intervalMinutes);
  
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
  });
  
  logger.info(`[实例 ${instanceName}] 调用 AI 模型: ${modelName}`);
  
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
  
  // 正常处理 AI 响应
  if (typeof response === "string") {
    decisionText = response;
  } else if (response && typeof response === "object") {
    const steps = (response as any).steps || [];
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
    decisionText = allTexts.join("\n\n");
  }
  
  logger.info(`[实例 ${instanceName}] AI 决策完成`);
  logger.debug(`[实例 ${instanceName}] 决策内容: ${decisionText.substring(0, 500)}...`);
  
  // 9. 获取执行期间的交易动作
  const actionsTakenRecords = await getTradeActionsBetween(executionStartedAt, decisionTimestamp, accountId);
  if (actionsTakenRecords.length > 0) {
    logger.info(`[实例 ${instanceName}] 捕获到 ${actionsTakenRecords.length} 条交易动作`);
  }
  
  // 10. 记录到 agent_request_logs 表（决策日志 Tab 使用此表）
  await insertAgentRequestLog(dbClient, {
    accountId: accountId.toString(),
    modelName,
    instructions,
    prompt,
    response: decisionText,
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
      decisionText,
      JSON.stringify(actionsTakenRecords),
      totalBalance,
      activePositions.length,
    ],
  });
  
  logger.info(`[实例 ${instanceName}] 决策记录已保存到两个表`);
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
  const templateVariables = buildTemplateVariables(strategy, intervalMinutes, language);
  
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
  
  return [promptHeader, marketSection, accountSection].filter(Boolean).join("\n\n");
}

/**
 * 格式化市场数据用于提示词
 */
function formatMarketDataForPrompt(marketData: Record<string, any>, language: StrategyLanguage): string {
  const symbols = Object.keys(marketData || {});
  if (symbols.length === 0) {
    return language === "zh" ? "暂无市场数据" : "No market data available";
  }
  
  const separator = "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━";
  const lines: string[] = [separator];
  
  if (language === "zh") {
    lines.push("【市场行情快照】");
    for (const [symbol, data] of Object.entries(marketData)) {
      const price = Number(data.price || 0);
      const change24h = Number(data.change24h || 0);
      const rsi14 = Number(data.rsi14 || 50);
      const ema20 = Number(data.ema20 || 0);
      const macd = Number(data.macd || 0);
      
      lines.push(`【${symbol}】价=${price.toFixed(2)} 涨跌=${change24h.toFixed(2)}% RSI14=${rsi14.toFixed(1)} EMA20=${ema20.toFixed(2)} MACD=${macd.toFixed(4)}`);
    }
  } else {
    lines.push("[Market Snapshot]");
    for (const [symbol, data] of Object.entries(marketData)) {
      const price = Number(data.price || 0);
      const change24h = Number(data.change24h || 0);
      const rsi14 = Number(data.rsi14 || 50);
      const ema20 = Number(data.ema20 || 0);
      const macd = Number(data.macd || 0);
      
      lines.push(`[${symbol}] Price=${price.toFixed(2)} Change=${change24h.toFixed(2)}% RSI14=${rsi14.toFixed(1)} EMA20=${ema20.toFixed(2)} MACD=${macd.toFixed(4)}`);
    }
  }
  
  return lines.join("\n");
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
  const { totalBalance, availableBalance, unrealisedPnl, positions, language, intervalMinutes } = params;
  
  const separator = "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━";
  const lines: string[] = [separator];
  
  if (language === "zh") {
    lines.push("【账户概览】");
    lines.push(`账户净值: ${totalBalance.toFixed(2)} USDT`);
    lines.push(`可用余额: ${availableBalance.toFixed(2)} USDT`);
    lines.push(`未实现盈亏: ${unrealisedPnl >= 0 ? "+" : ""}${unrealisedPnl.toFixed(2)} USDT`);
    
    if (positions.length === 0) {
      lines.push("");
      lines.push("当前无持仓，关注新的进场机会");
    } else {
      lines.push("");
      lines.push("【持仓详情】");
      for (const pos of positions) {
        const symbol = pos.contract?.replace("_USDT", "") || pos.symbol || "UNKNOWN";
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
    lines.push(`Unrealized PnL: ${unrealisedPnl >= 0 ? "+" : ""}${unrealisedPnl.toFixed(2)} USDT`);
    
    if (positions.length === 0) {
      lines.push("");
      lines.push("No open positions; monitor for new entries.");
    } else {
      lines.push("");
      lines.push("[Positions]");
      for (const pos of positions) {
        const symbol = pos.contract?.replace("_USDT", "") || pos.symbol || "UNKNOWN";
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
