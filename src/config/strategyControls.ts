import type { TradingStrategy } from "./strategyTypes";

type Adjustment = {
  leverageFactor: number;
  positionFactor: number;
};

export interface VolatilityAdjustmentConfig {
  high: Adjustment;
  normal: Adjustment;
  low: Adjustment;
}

const VOLATILITY_ADJUSTMENTS: Record<TradingStrategy, VolatilityAdjustmentConfig> = {
  conservative: {
    high: { leverageFactor: 0.6, positionFactor: 0.7 },
    normal: { leverageFactor: 1, positionFactor: 1 },
    low: { leverageFactor: 1, positionFactor: 1 },
  },
  balanced: {
    high: { leverageFactor: 0.7, positionFactor: 0.8 },
    normal: { leverageFactor: 1, positionFactor: 1 },
    low: { leverageFactor: 1.1, positionFactor: 1 },
  },
  aggressive: {
    high: { leverageFactor: 0.8, positionFactor: 0.85 },
    normal: { leverageFactor: 1, positionFactor: 1 },
    low: { leverageFactor: 1.2, positionFactor: 1.1 },
  },
  "ultra-short": {
    high: { leverageFactor: 0.7, positionFactor: 0.8 },
    normal: { leverageFactor: 1, positionFactor: 1 },
    low: { leverageFactor: 1.1, positionFactor: 1.1 },
  },
  "swing-trend": {
    high: { leverageFactor: 0.5, positionFactor: 0.6 },
    normal: { leverageFactor: 1, positionFactor: 1 },
    low: { leverageFactor: 1.2, positionFactor: 1.1 },
  },
};

export function getVolatilityAdjustmentConfig(strategy: TradingStrategy): VolatilityAdjustmentConfig {
  return VOLATILITY_ADJUSTMENTS[strategy];
}

export const ULTRA_SHORT_CYCLE_LOCK_PROFIT_TRIGGER = 4;

export const SWING_TREND_STOP_LOSS_CONFIG = {
  lowRisk: {
    minLeverage: 5,
    maxLeverage: 7,
    stopLossPercent: -6,
    description: "5-7倍杠杆，亏损 -6% 时止损",
  },
  mediumRisk: {
    minLeverage: 8,
    maxLeverage: 12,
    stopLossPercent: -5,
    description: "8-12倍杠杆，亏损 -5% 时止损",
  },
  highRisk: {
    minLeverage: 13,
    maxLeverage: null,
    stopLossPercent: -4,
    description: "13倍以上杠杆，亏损 -4% 时止损",
  },
} as const;

export const SWING_TREND_TRAILING_STOP_CONFIG = {
  stage1: {
    name: "阶段1",
    minProfit: 4,
    maxProfit: 6,
    drawdownPercent: 1.5,
    description: "峰值4-6%，回退1.5%平仓（保底2.5%）",
  },
  stage2: {
    name: "阶段2",
    minProfit: 6,
    maxProfit: 10,
    drawdownPercent: 2,
    description: "峰值6-10%，回退2%平仓（保底4%）",
  },
  stage3: {
    name: "阶段3",
    minProfit: 10,
    maxProfit: 15,
    drawdownPercent: 2.5,
    description: "峰值10-15%，回退2.5%平仓（保底7.5%）",
  },
  stage4: {
    name: "阶段4",
    minProfit: 15,
    maxProfit: 25,
    drawdownPercent: 3,
    description: "峰值15-25%，回退3%平仓（保底12%）",
  },
  stage5: {
    name: "阶段5",
    minProfit: 25,
    maxProfit: null,
    drawdownPercent: 5,
    description: "峰值25%+，回退5%平仓（保底20%）",
  },
} as const;
