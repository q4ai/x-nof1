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
    }
  },
});
 * 交易执行工具
 */
import { createTool } from "@voltagent/core";
import { z } from "zod";
import { createOkxClient, createExchangeClientFromActiveAccount } from "../../services/okxClient";
import { createClient } from "@libsql/client";
import { createLogger } from "../../utils/loggerUtils";
import { getChinaTimeISO } from "../../utils/timeUtils";
import { RISK_PARAMS } from "../../config/riskParams.new";
import { getQuantoMultiplier } from "../../utils/contractUtils";
import { recordTradeLog } from "../../utils/tradeLogUtils";
import { getExchangeProvider, type ExchangeProvider } from "../../config/exchange";
import { getBinancePrecision } from "../../database/binancePrecision";
import { BinanceClient } from "../../services/binanceClient";
import { getActiveAccount } from "../../services/accountConfigService";

const logger = createLogger({
  name: "trade-execution",
  level: "info",
});

const dbClient = createClient({
  url: process.env.DATABASE_URL || "file:./db/sqlite.db",
});

type LotSizingInfo = {
  lotSize: number;
  lotSizePrecision: number;
  minSizeRaw: number;
  maxSizeRaw: number;
  normalizeToStep: (value: number, direction: "up" | "down") => number;
};

function computeLotSizePrecision(lotSizeString: string): number {
  if (!lotSizeString.includes(".")) {
    return 0;
  }
  const decimals = lotSizeString.split(".")[1]?.replace(/0+$/, "") ?? "";
  return Math.min(decimals.length, 12);
}

async function buildLotSizingInfo(
  contract: string,
  contractInfo: any,
  provider: ExchangeProvider
): Promise<LotSizingInfo> {
  const lotSizeSource = contractInfo?.lotSize ?? "1";
  let lotSizeString = typeof lotSizeSource === "string" ? lotSizeSource : String(lotSizeSource ?? "1");
  let lotSizeRaw = Number.parseFloat(lotSizeString);
  let lotSize = Number.isFinite(lotSizeRaw) && lotSizeRaw > 0 ? lotSizeRaw : 1;
  let lotSizePrecision = computeLotSizePrecision(lotSizeString);
  let minSizeRaw = Number.parseFloat(contractInfo?.orderSizeMin ?? contractInfo?.minSize ?? String(lotSize));
  let maxSizeRaw = Number.parseFloat(contractInfo?.orderSizeMax ?? contractInfo?.maxSize ?? "1000000");

  if (provider === "binance") {
    const precisionRecord = await getBinancePrecision(contract);
    if (precisionRecord) {
      if (precisionRecord.step_size) {
        lotSizeString = precisionRecord.step_size;
        lotSizeRaw = Number.parseFloat(lotSizeString);
        if (Number.isFinite(lotSizeRaw) && lotSizeRaw > 0) {
          lotSize = lotSizeRaw;
        }
        if (Number.isFinite(precisionRecord.precision)) {
          lotSizePrecision = Math.max(precisionRecord.precision, 0);
        } else {
          lotSizePrecision = computeLotSizePrecision(lotSizeString);
        }
      }

      const minCandidate = Number.parseFloat(precisionRecord.min_qty);
      if (Number.isFinite(minCandidate) && minCandidate > 0) {
        minSizeRaw = minCandidate;
      }

      const maxCandidate = Number.parseFloat(precisionRecord.max_qty);
      if (Number.isFinite(maxCandidate) && maxCandidate > 0) {
        maxSizeRaw = maxCandidate;
      }
    }
  }

  const normalizeToStep = (value: number, direction: "up" | "down") => {
    if (!Number.isFinite(value)) {
      return 0;
    }

    if (!Number.isFinite(lotSize) || lotSize <= 0) {
      const factor = 10 ** Math.max(lotSizePrecision, 0);
      if (direction === "up") {
        return Math.ceil(value * factor) / factor;
      }
      return Math.floor(value * factor) / factor;
    }

    const ratio = direction === "up"
      ? Math.ceil((value - Number.EPSILON) / lotSize)
      : Math.floor((value + Number.EPSILON) / lotSize);
    const stepped = Math.max(ratio, 0) * lotSize;
    return Number(stepped.toFixed(Math.min(lotSizePrecision, 12)));
  };

  return {
    lotSize,
    lotSizePrecision,
    minSizeRaw: Number.isFinite(minSizeRaw) && minSizeRaw > 0 ? minSizeRaw : lotSize,
    maxSizeRaw: Number.isFinite(maxSizeRaw) && maxSizeRaw > 0 ? maxSizeRaw : 1000000,
    normalizeToStep,
  };
}

async function getBinanceOrderRealizedPnl(
  client: any,
  contract: string,
  orderId: string
): Promise<number | null> {
  if (!(client instanceof BinanceClient)) {
    return null;
  }

  try {
    const trades = await client.getMyTrades(contract, 50);
    if (!Array.isArray(trades) || trades.length === 0) {
      return null;
    }

    const normalizedOrderId = orderId.toString();
    const matched = trades.filter((trade: any) => {
      const candidate = trade?.orderId ?? trade?.orderID ?? trade?.ordId;
      if (candidate === undefined || candidate === null) {
        return false;
      }
      return String(candidate) === normalizedOrderId;
    });

    if (!matched.length) {
      return null;
    }

    const total = matched.reduce((sum: number, trade: any) => {
      const raw = trade?.realizedPnl ?? trade?.realisedPnl ?? trade?.realizedPNL;
      const value = Number.parseFloat(raw ?? "NaN");
      if (!Number.isFinite(value)) {
        return sum;
      }
      return sum + value;
    }, 0);

    if (!Number.isFinite(total)) {
      return null;
    }

    return total;
  } catch (error) {
    logger.warn(`获取 Binance realizedPnl 失败(order ${orderId}): ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/**
 * 开仓执行逻辑
 */
export async function executeOpenPosition({
  symbol,
  side,
  leverage,
  amount,
  amountUsdt,
  amountUnit = "usdt",
  isNotional = false,
  marginMode = "cross",
  orderType = "market",
  price,
}: {
  symbol: string;
  side: "long" | "short";
  leverage: number;
  amount?: number;
  amountUsdt?: number;
  amountUnit?: "usdt" | "coin";
  isNotional?: boolean;
  marginMode?: "cross" | "isolated";
  orderType?: "market" | "limit";
  price?: number;
}) {
  const effectiveAmount = amount ?? amountUsdt ?? 0;
  // 开仓时不设置止盈止损，由 AI 在每个周期主动决策
  const stopLoss = undefined;
  const takeProfit = undefined;
  const client = await createExchangeClientFromActiveAccount();
  const activeAccount = await getActiveAccount();
  const accountId = activeAccount ? activeAccount.id.toString() : "default";
  // 优先使用活跃账户的 provider，否则回落到全局配置
  const exchangeProvider = activeAccount?.provider || getExchangeProvider();
  const unitLabel = exchangeProvider === "okx" ? "张" : "个";
  const normalizedSymbol = symbol.toUpperCase();
  const contract = `${normalizedSymbol}_USDT`;
  const toolInput = { symbol: normalizedSymbol, side, leverage, amount: effectiveAmount, amountUnit, isNotional, marginMode, orderType, price } as const;
  
  logger.info(`🚀 [开仓请求] ${normalizedSymbol} ${side} | 金额: ${effectiveAmount} ${amountUnit} | 杠杆: ${leverage}x | 订单类型: ${orderType} | 是否面值: ${isNotional}`);
  
  const finalize = async (result: {
    success: boolean;
    message: string;
    orderId?: string;
    size?: number;
    rawRequest?: unknown;
    rawResponse?: unknown;
    [key: string]: unknown;
  }) => {
    const { rawRequest, rawResponse, ...rest } = result;
    await recordTradeLog({
      action: "open",
      symbol: normalizedSymbol,
      side,
      leverage,
      amountUsdt: effectiveAmount || 0, // Log the raw amount
      size: typeof rest.size === "number" ? rest.size : undefined,
      status: rest.success ? "success" : "failed",
      message: rest.message || "",
      orderId: typeof rest.orderId === "string" ? rest.orderId : undefined,
      request: rawRequest ?? toolInput,
      response: rawResponse ?? rest,
    });
    return rest;
  };
  
  const fail = async (message: string, extra: Record<string, unknown> = {}) => finalize({ success: false, message, ...extra });
  
  try {
    // 0. 检查白名单
    const allowedSymbols = new Set((RISK_PARAMS.TRADING_SYMBOLS || []).map((item) => item.toUpperCase()));
    if (!allowedSymbols.has(normalizedSymbol)) {
      return fail(`该币种 ${normalizedSymbol} 不在当前交易白名单中`);
    }

    //  参数验证
    if (!Number.isFinite(effectiveAmount) || effectiveAmount <= 0) {
      return fail(`无效的开仓金额/数量: ${effectiveAmount}`);
    }
    
    if (!Number.isFinite(leverage) || leverage < 1 || leverage > RISK_PARAMS.MAX_LEVERAGE) {
      return fail(`无效的杠杆倍数: ${leverage}（必须在1-${RISK_PARAMS.MAX_LEVERAGE}之间，最大值由环境变量MAX_LEVERAGE控制）`);
    }

    // 获取当前价格和合约信息 (提前获取以便计算)
    const ticker = await client.getFuturesTicker(contract);
    const currentPrice = Number.parseFloat(ticker.last || "0");
    const contractInfo = await client.getContractInfo(contract);
    const infoMultiplier = Number.parseFloat(String(contractInfo?.quantoMultiplier ?? ""));
    const quantoMultiplier = Number.isFinite(infoMultiplier) && infoMultiplier > 0
      ? infoMultiplier
      : await getQuantoMultiplier(contract);

    if (!currentPrice || currentPrice <= 0) {
        return fail(`无法获取当前价格: ${contract}`);
    }

    // Determine execution price
    let executionPrice = currentPrice;
    if (orderType === "limit") {
        if (!price || price <= 0) {
            return fail(`限价单必须提供有效的价格`);
        }
        executionPrice = price;
    }

    // 计算 Margin 和 Notional
    let marginUsdt = 0;
    let notionalUsdt = 0;
    let quantity = 0;

    if (amountUnit === "coin") {
        // Input is Coin Quantity
        if (exchangeProvider === "okx") {
            quantity = effectiveAmount / quantoMultiplier; // Contracts
        } else {
            quantity = effectiveAmount; // Bitget/Binance: 1 coin = 1 unit
        }
        notionalUsdt = effectiveAmount * executionPrice;
        marginUsdt = notionalUsdt / leverage;
        logger.info(`💡 数量计算 (币本位): 数量=${effectiveAmount} ${symbol} ÷ 乘数=${exchangeProvider === "okx" ? quantoMultiplier : 1} = ${quantity.toFixed(4)} ${unitLabel}`);
    } else {
        // Input is USDT
        if (isNotional) {
             // Notional Value
             notionalUsdt = effectiveAmount;
             marginUsdt = notionalUsdt / leverage;
             if (exchangeProvider === "okx") {
                 quantity = notionalUsdt / (quantoMultiplier * executionPrice);
             } else {
                 quantity = notionalUsdt / executionPrice;
             }
             logger.info(`💡 数量计算 (USDT面值): 面值=${effectiveAmount} USDT ÷ (乘数=${exchangeProvider === "okx" ? quantoMultiplier : 1} × 价格=${executionPrice.toFixed(2)}) = ${quantity.toFixed(4)} ${unitLabel}`);
        } else {
             // Margin (Old behavior)
             marginUsdt = effectiveAmount;
             notionalUsdt = marginUsdt * leverage;
             if (exchangeProvider === "okx") {
                 quantity = notionalUsdt / (quantoMultiplier * executionPrice);
             } else {
                 quantity = notionalUsdt / executionPrice;
             }
             logger.info(`💡 数量计算 (USDT保证金): 保证金=${effectiveAmount} USDT × 杠杆=${leverage}x ÷ (乘数=${exchangeProvider === "okx" ? quantoMultiplier : 1} × 价格=${executionPrice.toFixed(2)}) = ${quantity.toFixed(4)} ${unitLabel}`);
        }
    }
    
    // ====== 开仓前强制风控检查 ======
    
    // 1. 检查持仓数量（最多5个）
    const allPositions = await client.getPositions();
    const activePositions = allPositions.filter((p: any) => Math.abs(Number.parseFloat(p.size || "0")) > 0);
    
    if (activePositions.length >= RISK_PARAMS.MAX_POSITIONS) {
      return fail(`已达到最大持仓数量限制（${RISK_PARAMS.MAX_POSITIONS}个），当前持仓 ${activePositions.length} 个，无法开新仓`);
    }
    
    // 2. 检查该币种是否已有持仓（禁止双向持仓）
    const existingPosition = activePositions.find((p: any) => {
      const posSymbol = p.contract.replace("_USDT", "");
      return posSymbol === normalizedSymbol;
    });
    
    if (existingPosition) {
      const existingSize = Number.parseFloat(existingPosition.size || "0");
      const existingSide = existingSize > 0 ? "long" : "short";
      
      if (existingSide !== side) {
        return fail(`${normalizedSymbol} 已有${existingSide === "long" ? "多" : "空"}单持仓，禁止同时持有双向持仓。请先平掉${existingSide === "long" ? "多" : "空"}单后再开${side === "long" ? "多" : "空"}单。`);
      }
      
      // 如果方向相同，允许加仓（但需要注意总持仓限制）
      logger.info(`${normalizedSymbol} 已有${side === "long" ? "多" : "空"}单持仓，允许加仓`);
    }
    
    // 3. 获取账户信息
    const account = await client.getFuturesAccount();
    const unrealisedPnl = Number.parseFloat(account.unrealisedPnl || "0");
    const totalBalance = Number.parseFloat(account.total || "0") - unrealisedPnl;
    const availableBalance = Number.parseFloat(account.available || "0");
    
    if (!Number.isFinite(availableBalance) || availableBalance <= 0) {
      return fail(`账户可用资金异常: ${availableBalance} USDT`);
    }
    
    // 5. 检查总敞口（不超过账户净值的15倍）
    let currentTotalExposure = 0;
    for (const pos of activePositions) {
      const posSize = Math.abs(Number.parseFloat(pos.size || "0"));
      const entryPrice = Number.parseFloat(pos.entryPrice || "0");
      // 获取合约乘数
      const posQuantoMultiplier = exchangeProvider === "okx" ? await getQuantoMultiplier(pos.contract) : 1;
      const posValue = posSize * entryPrice * posQuantoMultiplier;
      currentTotalExposure += posValue;
    }
    
    const newExposure = notionalUsdt;
    const totalExposure = currentTotalExposure + newExposure;
    const maxAllowedExposure = totalBalance * RISK_PARAMS.MAX_LEVERAGE; // 使用配置的最大杠杆
    
    if (totalExposure > maxAllowedExposure) {
      return fail(`新开仓将导致总敞口 ${totalExposure.toFixed(2)} USDT 超过限制 ${maxAllowedExposure.toFixed(2)} USDT（账户净值的${RISK_PARAMS.MAX_LEVERAGE}倍），拒绝开仓`);
    }
    
    // 6. 检查单笔仓位（建议不超过账户净值的30%）
    const maxSinglePosition = totalBalance * 0.30; // 30%
    if (marginUsdt > maxSinglePosition) {
      logger.warn(`开仓保证金 ${marginUsdt.toFixed(2)} USDT 超过建议仓位 ${maxSinglePosition.toFixed(2)} USDT（账户净值的30%）`);
    }
    
    // ====== 流动性保护检查 ======
    
    // 1. 检查交易时段（UTC时间）- 仅警告，不强制调整
    const now = new Date();
    const hourUTC = now.getUTCHours();
    const dayOfWeek = now.getUTCDay(); // 0=周日，6=周六
    
    // 低流动性时段警告（UTC 2:00-6:00，亚洲时段凌晨）
    if (hourUTC >= 2 && hourUTC <= 6) {
      logger.warn(`⚠️  当前处于低流动性时段 (UTC ${hourUTC}:00)，建议谨慎交易`);
    }
    
    // 周末流动性检查
    if ((dayOfWeek === 5 && hourUTC >= 22) || dayOfWeek === 6 || (dayOfWeek === 0 && hourUTC < 20)) {
      logger.warn(`⚠️  当前处于周末时段，流动性可能较低`);
    }
    
    // 2. 检查订单簿深度（确保有足够流动性）
    try {
      const orderBook = await client.getOrderBook(contract, 5); // 获取前5档订单
      
      if (orderBook && orderBook.bids && orderBook.bids.length > 0) {
        // 计算买单深度（前5档）
        const bidDepth = orderBook.bids.slice(0, 5).reduce((sum: number, bid: any) => {
          const price = Number.parseFloat(bid.p);
          const size = Number.parseFloat(bid.s);
          return sum + price * size;
        }, 0);
        
        // 要求订单簿深度至少是开仓金额的5倍
        const requiredDepth = notionalUsdt * 5;
        
        if (bidDepth < requiredDepth) {
          return fail(`流动性不足：订单簿深度 ${bidDepth.toFixed(2)} USDT < 所需 ${requiredDepth.toFixed(2)} USDT`);
        }
        
        logger.info(`✅ 流动性检查通过：订单簿深度 ${bidDepth.toFixed(2)} USDT >= 所需 ${requiredDepth.toFixed(2)} USDT`);
      }
    } catch (error) {
      logger.warn(`获取订单簿失败: ${error}`);
      // 如果无法获取订单簿，发出警告但继续
    }
    
    // ====== 风控检查通过，继续开仓 ======
    
    // 设置杠杆
    await client.setLeverage(contract, leverage);
    
    const { lotSize, minSizeRaw, maxSizeRaw, normalizeToStep } = await buildLotSizingInfo(
      contract,
      contractInfo,
      exchangeProvider
    );

    const minSize = normalizeToStep(
      Math.max(minSizeRaw > 0 ? minSizeRaw : lotSize, lotSize),
      "up"
    ) || lotSize;
    let maxSize = normalizeToStep(
      Number.isFinite(maxSizeRaw) && maxSizeRaw > 0 ? maxSizeRaw : 1000000,
      "down"
    );
    if (maxSize < minSize) {
      maxSize = minSize;
    }
    
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return fail(`无法计算下单数量，请检查参数（amount=${effectiveAmount}, leverage=${leverage}, price=${currentPrice})`);
    }

    // 将数量对齐到合约步长
    quantity = normalizeToStep(quantity, "down");

    if (quantity < minSize) {
      const requiredMargin = (minSize * (exchangeProvider === "okx" ? quantoMultiplier : 1) * currentPrice) / leverage;
      return fail(`计算的数量 ${quantity.toFixed(4)}${unitLabel} 低于最小下单单位 ${minSize.toFixed(4)}，至少需要 ${requiredMargin.toFixed(2)} USDT 保证金（当前${marginUsdt.toFixed(2)} USDT，杠杆${leverage}x）。`);
    }

    if (quantity > maxSize) {
      quantity = maxSize;
    }

    const size = side === "long" ? quantity : -quantity;
    
    logger.info(`开仓 ${symbol} ${side === "long" ? "做多" : "做空"} ${Math.abs(size)}${unitLabel} (杠杆${leverage}x)`);
    
    //  下单（市价单或限价单）
    const order = await client.placeOrder({
      contract,
      size,
      price: orderType === "limit" ? executionPrice : 0,
      positionSide: side,
      marginMode,
    });
    const okxRawRequest = order?.raw?.request;
    const okxRawResponse = order?.raw?.response;
    
    //  等待并验证订单状态（带重试）
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    //  检查订单状态并获取实际成交价格（最多重试3次）
    let finalOrderStatus = order.status;
    let actualFillSize = 0;
    let actualFillPrice = orderType === "limit" ? executionPrice : currentPrice; // 默认使用当前价格或限价
    
    if (order.id) {
      let retryCount = 0;
      const maxRetries = 3;
      
      while (retryCount < maxRetries) {
        try {
          const orderDetail = await client.getOrder(order.id.toString(), contract, order.clientOrderId);
          finalOrderStatus = orderDetail.status;
          const detailSize = Number.parseFloat(orderDetail.size || "0");
          const detailLeft = Number.parseFloat(orderDetail.left || "0");
          actualFillSize = Math.max(detailSize - detailLeft, 0);
          
          //  获取实际成交价格（fill_price 或 average price）
          if (orderDetail.fill_price && Number.parseFloat(orderDetail.fill_price) > 0) {
            actualFillPrice = Number.parseFloat(orderDetail.fill_price);
          } else if (orderDetail.price && Number.parseFloat(orderDetail.price) > 0) {
            // 对于限价单，如果未成交，price 可能是委托价
            // 如果已成交，price 可能是成交均价
            actualFillPrice = Number.parseFloat(orderDetail.price);
          }
          
          logger.info(`订单状态: ${finalOrderStatus}, 成交: ${actualFillSize}${unitLabel} @ ${actualFillPrice.toFixed(2)} USDT`);
          
          //  验证成交价格的合理性（滑点保护） - 仅针对市价单
          if (orderType === "market" && actualFillSize > 0) {
            const priceDeviation = Math.abs(actualFillPrice - currentPrice) / currentPrice;
            if (priceDeviation > 0.02) {
              // 滑点超过2%，拒绝此次交易（回滚）
              logger.error(`❌ 成交价偏离超过2%: ${currentPrice.toFixed(2)} → ${actualFillPrice.toFixed(2)} (偏离 ${(priceDeviation * 100).toFixed(2)}%)，拒绝交易`);
              
              // 尝试平仓回滚（如果已经成交）
              try {
                await client.placeOrder({
                  contract,
                  size: -size,
                  price: 0,
                  positionSide: side,
                });
                logger.info(`已回滚交易`);
              } catch (rollbackError: any) {
                logger.error(`回滚失败: ${rollbackError.message}，请手动处理`);
              }
              
              return fail(`开仓失败：成交价偏离超过2% (${currentPrice.toFixed(2)} → ${actualFillPrice.toFixed(2)})，已拒绝交易`, {
                orderId: order.id?.toString(),
                rawRequest: okxRawRequest,
                rawResponse: okxRawResponse,
              });
            }
          }
          
          // 如果订单被取消，返回失败
          if (finalOrderStatus === 'cancelled') {
            return fail(`开仓失败：订单被取消（订单ID: ${order.id}）`, {
              orderId: order.id?.toString(),
              orderStatus: finalOrderStatus,
              rawRequest: okxRawRequest,
              rawResponse: okxRawResponse,
            });
          }

          // 如果是市价单且未成交，返回失败
          if (orderType === "market" && actualFillSize === 0) {
             return fail(`开仓失败：市价单未成交（订单ID: ${order.id}）`, {
              orderId: order.id?.toString(),
              orderStatus: finalOrderStatus,
              rawRequest: okxRawRequest,
              rawResponse: okxRawResponse,
            });
          }
          
          // 成功获取订单信息，跳出循环
          break;
          
        } catch (error: any) {
          retryCount++;
          if (retryCount >= maxRetries) {
            logger.error(`获取订单详情失败（重试${retryCount}次）: ${error.message}`);
            // 如果无法获取订单详情，使用预估值继续
            logger.warn(`使用预估值继续: 数量=${Math.abs(size)}, 价格=${actualFillPrice}`);
            actualFillSize = Math.abs(size);
            // actualFillPrice 保持默认
          } else {
            logger.warn(`获取订单详情失败，${retryCount}/${maxRetries} 次重试...`);
            await new Promise(resolve => setTimeout(resolve, 300));
          }
        }
      }
    }
    
    //  使用实际成交数量和价格记录到数据库
    const finalQuantity = actualFillSize > 0 ? actualFillSize : Math.abs(size);
    
    // 计算手续费
    const positionValue = finalQuantity * (exchangeProvider === "okx" ? quantoMultiplier : 1) * actualFillPrice;
    const fee = positionValue * 0.0005; // 0.05%
    
    const dbStatus = finalOrderStatus === 'finished' ? 'filled' : 'pending';
    
    await dbClient.execute({
      sql: `INSERT INTO trades (account_id, order_id, symbol, side, type, price, quantity, leverage, fee, timestamp, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        accountId,
        order.id?.toString() || "",
        normalizedSymbol,
        side,            // 持仓方向（long/short）
        "open",
        actualFillPrice, // 使用实际成交价格
        finalQuantity,   // 使用实际成交数量
        leverage, // 使用实际设置的杠杆
        fee,            // 手续费
        getChinaTimeISO(),
        dbStatus,
      ],
    });
    
    // 触发持仓同步
    setTimeout(async () => {
      try {
        const { syncPositionsFromOkx } = await import("../../database/sync-positions-only");
        await syncPositionsFromOkx();
      } catch (e) {
        console.error("触发持仓同步失败", e);
      }
    }, 1000);
    
    return finalize({
      success: true,
      message: `开仓成功: ${side === "long" ? "做多" : "做空"} ${normalizedSymbol} ${finalQuantity}${unitLabel} @ ${actualFillPrice.toFixed(2)}`,
      orderId: order.id?.toString(),
      size: finalQuantity,
      rawRequest: okxRawRequest,
      rawResponse: okxRawResponse,
    });
    
  } catch (error: any) {
    logger.error(`开仓异常: ${error.message}`, error);
    return fail(`开仓异常: ${error.message}`);
  }
}

/**
 * 开仓工具
 */
export const openPositionTool = createTool({
  name: "openPosition",
  description: "开仓 - 做多或做空指定币种（使用市价单，立即以当前市场价格成交）。IMPORTANT: 开仓前必须先用getAccountBalance和getPositions工具查询可用资金和现有持仓，避免资金不足。交易手续费约0.05%，避免频繁交易。开仓时不设置止盈止损，你需要在每个周期主动决策是否平仓。",
  parameters: z.object({
    symbol: z.string().describe("币种代码"),
    side: z.enum(["long", "short"]).describe("方向：long=做多，short=做空"),
    leverage: z.number().min(1).max(RISK_PARAMS.MAX_LEVERAGE).describe(`杠杆倍数（1-${RISK_PARAMS.MAX_LEVERAGE}倍，根据环境变量MAX_LEVERAGE配置）`),
    amountUsdt: z.number().describe("开仓金额（USDT保证金）- 该金额表示保证金数量，实际仓位 = 保证金 × 杠杆，例如25 USDT保证金配合10倍杠杆开250 USDT仓位"),
    isNotional: z.boolean().optional().default(false).describe("金额类型：false=USDT保证金（默认），true=USDT面值。注意：默认使用保证金模式"),
  }),
  execute: async ({ symbol, side, leverage, amountUsdt, isNotional = false }) => 
    executeOpenPosition({ symbol, side, leverage, amountUsdt, isNotional }),
});

/**
 * 平仓工具
 */
export const closePositionTool = createTool({
  name: "closePosition",
  description: "平仓 - 关闭指定币种的持仓",
  parameters: z.object({
    symbol: z.string().describe("币种代码"),
    percentage: z.number().min(1).max(100).default(100).describe("平仓百分比（1-100）"),
    skipGuards: z.boolean().optional().describe("是否跳过最小持仓时间等保护（仅限手动平仓）"),
  }),
  execute: async ({ symbol, percentage, skipGuards = false }) =>
    executeClosePosition({ symbol, percentage, skipGuards, enforceWhitelist: true }),
});

type ClosePositionOptions = {
  symbol: string;
  percentage: number;
  skipGuards?: boolean;
  enforceWhitelist?: boolean;
};

/**
 * 平仓执行逻辑
 */
export async function executeClosePosition({
  symbol,
  percentage,
  skipGuards = false,
  enforceWhitelist = true,
}: ClosePositionOptions) {
  const normalizedSymbol = symbol.toUpperCase();
  const allowedSymbols = new Set((RISK_PARAMS.TRADING_SYMBOLS || []).map((item) => item.toUpperCase()));
  const client = await createExchangeClientFromActiveAccount();
  const activeAccount = await getActiveAccount();
  const accountId = activeAccount ? activeAccount.id.toString() : "default";
  // 优先使用活跃账户的 provider，否则回落到全局配置
  const exchangeProvider = activeAccount?.provider || getExchangeProvider();
  const unitLabel = exchangeProvider === "okx" ? "张" : "个";
  const contract = `${normalizedSymbol}_USDT`;
  let logSide: "long" | "short" | undefined;
  let logLeverage: number | undefined;
  let logSize: number | undefined;
  const buildToolInput = () => ({
    symbol: normalizedSymbol,
    percentage,
    side: logSide,
    leverage: logLeverage,
    targetSize: logSize,
  });
  const finalize = async (result: {
      success: boolean;
      message: string;
      orderId?: string;
      closedSize?: number;
      rawRequest?: unknown;
      rawResponse?: unknown;
      [key: string]: unknown;
    }) => {
      const { rawRequest, rawResponse, ...rest } = result;
      await recordTradeLog({
        action: "close",
        symbol: normalizedSymbol,
        side: logSide,
        leverage: logLeverage,
        size: typeof rest.closedSize === "number" ? rest.closedSize : logSize,
        status: rest.success ? "success" : "failed",
        message: rest.message || "",
        orderId: typeof rest.orderId === "string" ? rest.orderId : undefined,
        request: rawRequest ?? buildToolInput(),
        response: rawResponse ?? rest,
      });
      return rest;
    };
  const fail = async (message: string, extra: Record<string, unknown> = {}) => finalize({ success: false, message, ...extra });
  
  try {
    if (enforceWhitelist && !allowedSymbols.has(normalizedSymbol)) {
      return fail(`该币种 ${normalizedSymbol} 不在当前交易白名单中`);
    }

      //  参数验证
      if (!Number.isFinite(percentage) || percentage <= 0 || percentage > 100) {
        return fail(`无效的平仓百分比: ${percentage}（必须在1-100之间）`);
      }
      
      //  直接从 OKX 获取最新的持仓信息（不依赖数据库）
      const allPositions = await client.getPositions();
      const okxPosition = allPositions.find((p: any) => p.contract === contract);
      
      if (!okxPosition || Number.parseFloat(okxPosition.size || "0") === 0) {
        return fail(`没有找到 ${normalizedSymbol} 的持仓`);
      }

      const okxPosSideRaw = typeof okxPosition.posSide === "string" ? okxPosition.posSide.toLowerCase() : "";
      const normalizedPosSide = okxPosSideRaw === "long" || okxPosSideRaw === "short" ? okxPosSideRaw : "net";
      const marginModeRaw = typeof okxPosition.marginMode === "string" ? okxPosition.marginMode.toLowerCase() : "";
      const marginModeForOrder = marginModeRaw === "isolated" ? "isolated" : "cross";
      
      // 🔒 防止同周期内平仓保护：检查持仓开仓时间，防止刚开仓就立即平仓
      // 从数据库获取持仓信息以检查开仓时间
      if (!skipGuards) {
        const dbClient = createClient({
          url: process.env.DATABASE_URL || "file:./db/sqlite.db",
        });

        const dbPositionResult = await dbClient.execute({
          sql: `SELECT opened_at FROM positions WHERE symbol = ? LIMIT 1`,
          args: [normalizedSymbol],
        });

        if (dbPositionResult.rows.length > 0) {
          const openedAt = dbPositionResult.rows[0].opened_at as string;
          const openedTime = new Date(openedAt).getTime();
          const now = Date.now();
          const holdingMinutes = (now - openedTime) / (1000 * 60);

          const minHoldingMinutes = RISK_PARAMS.MIN_HOLDING_MINUTES;

          if (holdingMinutes < minHoldingMinutes) {
            return fail(`拒绝平仓 ${normalizedSymbol}：持仓时间仅 ${holdingMinutes.toFixed(1)} 分钟，少于最小持仓时间 ${minHoldingMinutes.toFixed(1)} 分钟。请等待至少半个交易周期后再评估平仓。这是为了防止在同一周期内刚开仓就立即平仓，造成不必要的手续费损失。`);
          }

          logger.info(`${normalizedSymbol} 持仓时间: ${holdingMinutes.toFixed(1)} 分钟，通过最小持仓时间检查`);
        }
      }
      
  // 从 OKX 获取实时数据
  const okxSize = Number.parseFloat(okxPosition.size || "0");
  
  // Determine side from posSide if available, otherwise fallback to size sign
  let side: "long" | "short" = "long";
  if (okxPosition.posSide === "short") {
    side = "short";
  } else if (okxPosition.posSide === "long") {
    side = "long";
  } else {
    side = okxSize >= 0 ? "long" : "short";
  }

  const rawQuantity = Math.abs(okxSize);
  let entryPrice = Number.parseFloat(okxPosition.entryPrice || "0");
  let currentPrice = Number.parseFloat(okxPosition.markPrice || "0");
  const leverage = Number.parseFloat(okxPosition.leverage || "1");
  const totalUnrealizedPnl = Number.parseFloat(okxPosition.unrealisedPnl || "0");
    logSide = side;
    logLeverage = leverage;
    logSize = rawQuantity;

      const contractInfo = await client.getContractInfo(contract);
      const { lotSize, minSizeRaw, normalizeToStep } = await buildLotSizingInfo(
        contract,
        contractInfo,
        exchangeProvider
      );

      const minTradableSize = normalizeToStep(
        Math.max(minSizeRaw > 0 ? minSizeRaw : lotSize, lotSize),
        "up"
      ) || lotSize;

      let quantity = normalizeToStep(rawQuantity, "down");
      if (quantity <= 0 && rawQuantity > 0) {
        quantity = Number(rawQuantity.toFixed(10));
      }
      logSize = quantity;
      
      //  如果价格为0，获取实时行情作为后备
      if (currentPrice === 0 || entryPrice === 0) {
        const ticker = await client.getFuturesTicker(contract);
        if (currentPrice === 0) {
          currentPrice = Number.parseFloat(ticker.markPrice || ticker.last || "0");
          logger.warn(`持仓标记价格为0，使用行情价格: ${currentPrice}`);
        }
        if (entryPrice === 0) {
          entryPrice = currentPrice; // 如果开仓价为0，使用当前价格
          logger.warn(`持仓开仓价为0，使用当前价格: ${entryPrice}`);
        }
      }
      
      // 计算平仓数量
      const targetQuantity = (quantity * percentage) / 100;
      const isFullClose = percentage >= 100 - 1e-6 || targetQuantity >= quantity - 1e-8;
      let closeSize = isFullClose ? quantity : normalizeToStep(targetQuantity, "down");

      if (!isFullClose && closeSize < minTradableSize && quantity >= minTradableSize) {
        closeSize = normalizeToStep(targetQuantity, "up");
        if (closeSize > quantity) {
          closeSize = quantity;
        }
      }

      if (closeSize > quantity) {
        closeSize = quantity;
      }

      if (!Number.isFinite(closeSize) || closeSize <= 1e-8) {
        logSize = closeSize;
        return fail(
          `无法计算有效的平仓数量，当前持仓 ${quantity.toFixed(4)}${unitLabel}，请稍后重试。`
        );
      }

      if (!isFullClose && closeSize < minTradableSize && quantity >= minTradableSize) {
        logSize = closeSize;
        return fail(
          `计算的平仓数量 ${closeSize.toFixed(4)} 低于最小下单单位 ${minTradableSize.toFixed(4)}，当前持仓 ${quantity.toFixed(4)}${unitLabel}，无法执行 ${percentage}% 平仓。`
        );
      }

      const size = side === "long" ? -closeSize : closeSize;
      logSize = closeSize;
      const positionSideForOrder = normalizedPosSide === "net" ? "net" : side;
      
      //  获取合约乘数用于计算盈亏和手续费
      const quantoMultiplier = exchangeProvider === "okx" ? await getQuantoMultiplier(contract) : 1;
      
  // 🔥 不再依赖 OKX 返回的 unrealisedPnl，始终手动计算毛盈亏
      // 手动计算盈亏公式：
      // 对于做多：(currentPrice - entryPrice) * quantity * quantoMultiplier
      // 对于做空：(entryPrice - currentPrice) * quantity * quantoMultiplier
      const priceChange = side === "long" 
        ? (currentPrice - entryPrice) 
        : (entryPrice - currentPrice);
      
      const grossPnl = priceChange * closeSize * quantoMultiplier;
      
      logger.info(`预估盈亏: ${grossPnl >= 0 ? '+' : ''}${grossPnl.toFixed(2)} USDT (价格变动: ${priceChange.toFixed(4)})`);
      
      //  计算手续费（开仓 + 平仓）
      const openFee = entryPrice * closeSize * quantoMultiplier * 0.0005;
      const closeFee = currentPrice * closeSize * quantoMultiplier * 0.0005;
      const totalFees = openFee + closeFee;
      
      // 净盈亏 = 毛盈亏 - 总手续费（此值为预估，平仓后会基于实际成交价重新计算）
      let pnl = grossPnl - totalFees;
      
      logger.info(`平仓 ${normalizedSymbol} ${side === "long" ? "做多" : "做空"} ${closeSize}${unitLabel} (入场: ${entryPrice.toFixed(2)}, 当前: ${currentPrice.toFixed(2)})`);
      
  //  市价单平仓
      // 注意：币安双向持仓模式下，通过 positionSide + 反向 side 来平仓，不需要 reduceOnly 参数
      // 单向持仓模式（net）需要 reduceOnly
      const isReduceOnly = positionSideForOrder === "net";
      
      const order = await client.placeOrder({
        contract,
        size,
        price: 0,  // 市价单必须传 price: 0
        positionSide: positionSideForOrder,
        marginMode: marginModeForOrder,
        reduceOnly: isReduceOnly,
      });
      const okxRawRequest = order?.raw?.request;
      const okxRawResponse = order?.raw?.response;
      
      //  等待并验证订单状态（带重试）
      await new Promise(resolve => setTimeout(resolve, 500));
      
      //  获取实际成交价格和数量（最多重试3次）
      let actualExitPrice = currentPrice;
      let actualCloseSize = closeSize;
      let finalOrderStatus = order.status;
      let usedExchangeRealizedPnl = false;
      
      if (order.id) {
        let retryCount = 0;
        const maxRetries = 3;
        
        while (retryCount < maxRetries) {
          try {
            const orderDetail = await client.getOrder(order.id.toString(), contract, order.clientOrderId);
            finalOrderStatus = orderDetail.status;
        const detailSize = Number.parseFloat(orderDetail.size || "0");
        const detailLeft = Number.parseFloat(orderDetail.left || "0");
        const filled = Math.max(detailSize - detailLeft, 0);
            
            if (filled > 0) {
              actualCloseSize = filled;
            }
            
            // 获取实际成交价格
            if (orderDetail.fill_price && Number.parseFloat(orderDetail.fill_price) > 0) {
              actualExitPrice = Number.parseFloat(orderDetail.fill_price);
            } else if (orderDetail.price && Number.parseFloat(orderDetail.price) > 0) {
              actualExitPrice = Number.parseFloat(orderDetail.price);
            }
            
            logger.info(`成交: ${actualCloseSize}${unitLabel} @ ${actualExitPrice.toFixed(2)} USDT`);
            
            //  验证成交价格的合理性（滑点保护）
            const priceDeviation = Math.abs(actualExitPrice - currentPrice) / currentPrice;
            if (priceDeviation > 0.03) {
              // 平仓时允许3%滑点（比开仓宽松，因为可能是紧急止损）
              logger.warn(`⚠️ 平仓成交价偏离超过3%: ${currentPrice.toFixed(2)} → ${actualExitPrice.toFixed(2)} (偏离 ${(priceDeviation * 100).toFixed(2)}%)`);
            }
            
            //  重新计算实际盈亏（基于真实成交价格）
            // 获取合约乘数
            const quantoMultiplier = exchangeProvider === "okx" ? await getQuantoMultiplier(contract) : 1;
            
            const priceChange = side === "long" 
              ? (actualExitPrice - entryPrice) 
              : (entryPrice - actualExitPrice);
            
            // 盈亏 = 价格变化 * 张数 * 合约乘数
            const grossPnl = priceChange * actualCloseSize * quantoMultiplier;
            
            //  扣除手续费（开仓 + 平仓）
            // 开仓手续费 = 开仓名义价值 * 0.05%
            const openFee = entryPrice * actualCloseSize * quantoMultiplier * 0.0005;
            // 平仓手续费 = 平仓名义价值 * 0.05%
            const closeFee = actualExitPrice * actualCloseSize * quantoMultiplier * 0.0005;
            // 总手续费
            const totalFees = openFee + closeFee;
            
            // 净盈亏 = 毛盈亏 - 总手续费
            pnl = grossPnl - totalFees;
            
            logger.info(`盈亏: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} USDT`);
            
            // 成功获取订单信息，跳出循环
            break;
            
          } catch (error: any) {
            retryCount++;
            if (retryCount >= maxRetries) {
              logger.error(`获取平仓订单详情失败（重试${retryCount}次）: ${error.message}`);
              // 如果无法获取订单详情，使用预估值
              logger.warn(`使用预估值继续: 数量=${closeSize}, 价格=${currentPrice}`);
              actualCloseSize = closeSize;
              actualExitPrice = currentPrice;
              // 重新计算盈亏（Bitget/Binance 的数量已是币数量，乘数应为1）
              const quantoMultiplier = exchangeProvider === "okx" ? await getQuantoMultiplier(contract) : 1;
              const priceChange = side === "long" 
                ? (actualExitPrice - entryPrice) 
                : (entryPrice - actualExitPrice);
              const grossPnl = priceChange * actualCloseSize * quantoMultiplier;
              // 扣除手续费
              const openFee = entryPrice * actualCloseSize * quantoMultiplier * 0.0005;
              const closeFee = actualExitPrice * actualCloseSize * quantoMultiplier * 0.0005;
              pnl = grossPnl - openFee - closeFee;
            } else {
              logger.warn(`获取平仓订单详情失败，${retryCount}/${maxRetries} 次重试...`);
              await new Promise(resolve => setTimeout(resolve, 300));
            }
          }
        }

        if (exchangeProvider === "binance" && order.id) {
          const exchangePnl = await getBinanceOrderRealizedPnl(client, contract, order.id.toString());
          if (exchangePnl !== null) {
            pnl = exchangePnl;
            usedExchangeRealizedPnl = true;
            logger.info(`采用 Binance realizedPnl: ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)} USDT`);
          }
        }
      }
      
      // 获取账户信息用于记录当前总资产
      const account = await client.getFuturesAccount();
      const totalBalance = Number.parseFloat(account.total || "0");
      
      //  计算总手续费（开仓 + 平仓）用于数据库记录
      // 需要获取合约乘数（Bitget/Binance 的数量已是币数量，乘数应为1）
      const dbQuantoMultiplier = exchangeProvider === "okx" ? await getQuantoMultiplier(contract) : 1;

      // 🚨 最终安全检查：如果平仓价格仍为0，尝试再次获取行情
      if (actualExitPrice === 0) {
        try {
          const ticker = await client.getFuturesTicker(contract);
          const tickerPrice = Number.parseFloat(ticker.last || ticker.markPrice || "0");
          if (tickerPrice > 0) {
            logger.warn(`⚠️ 平仓价格为0，紧急修正为最新行情价格: ${tickerPrice}`);
            actualExitPrice = tickerPrice;
            
            // 重新计算盈亏
            const priceChangeFix = side === "long" 
              ? (actualExitPrice - entryPrice) 
              : (entryPrice - actualExitPrice);
            
            // 估算手续费
            const fixOpenFee = entryPrice * actualCloseSize * dbQuantoMultiplier * 0.0005;
            const fixCloseFee = actualExitPrice * actualCloseSize * dbQuantoMultiplier * 0.0005;
            
            pnl = priceChangeFix * actualCloseSize * dbQuantoMultiplier - fixOpenFee - fixCloseFee;
            usedExchangeRealizedPnl = false; // 标记为非交易所真实盈亏
          }
        } catch (e) {
          logger.error(`无法修正平仓价格: ${e}`);
        }
      }
      
      // 开仓手续费 = 开仓名义价值 * 0.05%
      const dbOpenFee = entryPrice * actualCloseSize * dbQuantoMultiplier * 0.0005;
      // 平仓手续费 = 平仓名义价值 * 0.05%
      const dbCloseFee = actualExitPrice * actualCloseSize * dbQuantoMultiplier * 0.0005;
      // 总手续费
      const totalFee = dbOpenFee + dbCloseFee;
      
      // 🔥 关键验证：检查盈亏计算是否正确
      const notionalValue = actualExitPrice * actualCloseSize * dbQuantoMultiplier;
      const priceChangeCheck = side === "long" 
        ? (actualExitPrice - entryPrice) 
        : (entryPrice - actualExitPrice);
      const expectedPnl = priceChangeCheck * actualCloseSize * dbQuantoMultiplier - totalFee;
      
      // 检测盈亏是否被错误地设置为名义价值
      if (!usedExchangeRealizedPnl && Math.abs(pnl - notionalValue) < Math.abs(pnl - expectedPnl)) {
        logger.error(`🚨 检测到盈亏计算异常！`);
        logger.error(`  当前pnl: ${pnl.toFixed(2)} USDT 接近名义价值 ${notionalValue.toFixed(2)} USDT`);
        logger.error(`  预期pnl: ${expectedPnl.toFixed(2)} USDT`);
        logger.error(`  开仓价: ${entryPrice}, 平仓价: ${actualExitPrice}, 数量: ${actualCloseSize}, 合约乘数: ${dbQuantoMultiplier}`);
        logger.error(`  价格变动: ${priceChangeCheck.toFixed(4)}, 手续费: ${totalFee.toFixed(4)}`);
        
        // 强制修正为正确值
        pnl = expectedPnl;
        logger.warn(`  已自动修正pnl为: ${pnl.toFixed(2)} USDT`);
      }
      
      // 详细日志记录（用于debug）
      logger.info(`【平仓盈亏详情】${normalizedSymbol} ${side}`);
      logger.info(`  开仓价: ${entryPrice.toFixed(4)}, 平仓价: ${actualExitPrice.toFixed(4)}, 数量: ${actualCloseSize}${unitLabel}`);
      logger.info(`  价格变动: ${priceChangeCheck.toFixed(4)}, 合约乘数: ${dbQuantoMultiplier}`);
      logger.info(`  毛盈亏: ${(priceChangeCheck * actualCloseSize * dbQuantoMultiplier).toFixed(2)} USDT`);
      logger.info(`  开仓手续费: ${dbOpenFee.toFixed(4)} USDT, 平仓手续费: ${dbCloseFee.toFixed(4)} USDT`);
      logger.info(`  总手续费: ${totalFee.toFixed(4)} USDT`);
      logger.info(`  净盈亏: ${pnl.toFixed(2)} USDT`);
      
      // 记录平仓交易
      // side: 原持仓方向（便于统计某个币种的多空盈亏）
      // 实际执行方向: long平仓=卖出, short平仓=买入
      // pnl: 净盈亏（已扣除手续费）
      // fee: 总手续费（开仓+平仓）
  // 映射状态：OKX finished -> filled, open -> pending
      const dbStatus = finalOrderStatus === 'finished' ? 'filled' : 'pending';
      
      await dbClient.execute({
        sql: `INSERT INTO trades (account_id, order_id, symbol, side, type, price, quantity, leverage, pnl, fee, timestamp, status)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          accountId,
          order.id?.toString() || "",
          normalizedSymbol,
          side,             // 原持仓方向（便于统计某个币种的多空盈亏）
          "close",
          actualExitPrice,   // 使用实际成交价格
          actualCloseSize,   // 使用实际成交数量
          leverage,
          pnl,              // 净盈亏（已扣除手续费）
          totalFee,         // 总手续费（开仓+平仓）
          getChinaTimeISO(),
          dbStatus,
        ],
      });
      
      // 从数据库获取止损止盈订单ID（如果存在）
      const posResult = await dbClient.execute({
        sql: "SELECT sl_order_id, tp_order_id FROM positions WHERE symbol = ?",
        args: [normalizedSymbol],
      });
      
      // 取消止损止盈订单（先检查订单状态）
      if (posResult.rows.length > 0) {
        const dbPosition = posResult.rows[0] as any;
        
        if (dbPosition.sl_order_id) {
          try {
            // 先获取订单状态
            const orderDetail = await client.getOrder(dbPosition.sl_order_id, contract);
            // 只取消未完成的订单（open状态）
            if (orderDetail.status === 'open') {
              await client.cancelOrder(contract, dbPosition.sl_order_id);
            }
          } catch (e: any) {
            // 订单可能已经不存在或已被取消
            logger.warn(`无法取消止损订单 ${dbPosition.sl_order_id}: ${e.message}`);
          }
        }
        
        if (dbPosition.tp_order_id) {
          try {
            // 先获取订单状态
            const orderDetail = await client.getOrder(dbPosition.tp_order_id, contract);
            // 只取消未完成的订单（open状态）
            if (orderDetail.status === 'open') {
              await client.cancelOrder(contract, dbPosition.tp_order_id);
            }
          } catch (e: any) {
            // 订单可能已经不存在或已被取消
            logger.warn(`无法取消止盈订单 ${dbPosition.tp_order_id}: ${e.message}`);
          }
        }
      }
      
      // 如果全部平仓，从持仓表删除；否则不操作（交由同步任务更新）
      if (percentage === 100) {
        await dbClient.execute({
          sql: "DELETE FROM positions WHERE symbol = ?",
          args: [normalizedSymbol],
        });
      }
      logSize = actualCloseSize;

      return finalize({
        success: true,
        orderId: order.id?.toString(),
        symbol: normalizedSymbol,
        side,
        closedSize: actualCloseSize,  // 使用实际成交数量
        entryPrice,
        exitPrice: actualExitPrice,   // 使用实际成交价格
        leverage,
        pnl,                          // 净盈亏（已扣除手续费）
        fee: totalFee,                // 总手续费
        totalBalance,
        message: `成功平仓 ${normalizedSymbol} ${actualCloseSize} ${unitLabel}，入场价 ${entryPrice.toFixed(4)}，平仓价 ${actualExitPrice.toFixed(4)}，净盈亏 ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} USDT (已扣手续费 ${totalFee.toFixed(2)} USDT)，当前总资产 ${totalBalance.toFixed(2)} USDT`,
        rawRequest: okxRawRequest,
        rawResponse: okxRawResponse,
      });
    } catch (error: any) {
      logger.error(`平仓失败: ${error.message}`, error);
      return finalize({
        success: false,
        error: error.message,
        message: `平仓失败: ${error.message}`,
        rawRequest: error.rawRequest,
        rawResponse: error.rawResponse,
      });
    }
  }

/**
 * 取消订单工具
 */
export const cancelOrderTool = createTool({
  name: "cancelOrder",
  description: "取消指定的挂单",
  parameters: z.object({
    orderId: z.string().describe("订单ID"),
  }),
  execute: async ({ orderId }) => {
  const client = await createExchangeClientFromActiveAccount();
    const requestPayload = { orderId };
    const finalize = async (result: {
      success: boolean;
      message: string;
      rawRequest?: unknown;
      rawResponse?: unknown;
      [key: string]: unknown;
    }) => {
      const { rawRequest, rawResponse, ...rest } = result;
      await recordTradeLog({
        action: "cancel",
        orderId,
        status: rest.success ? "success" : "failed",
        message: rest.message || "",
        request: rawRequest ?? requestPayload,
        response: rawResponse ?? rest,
      });
      return rest;
    };
    const fail = async (message: string, extra: Record<string, unknown> = {}) => finalize({ success: false, message, ...extra });

    try {
      const existingOrder = await client.getOrder(orderId);
      const cancelResult: any = await client.cancelOrder(existingOrder.contract, orderId);
      
      return finalize({
        success: true,
        orderId,
        symbol: existingOrder.contract.replace("_USDT", ""),
        message: `订单 ${orderId} 已取消`,
        rawRequest: cancelResult?.raw?.request,
        rawResponse: cancelResult?.raw?.response,
      });
    } catch (error: any) {
      return fail(`取消订单失败: ${error.message}`, {
        error: error.message,
        rawRequest: error.rawRequest,
        rawResponse: error.rawResponse,
      });
    }
  },
});

