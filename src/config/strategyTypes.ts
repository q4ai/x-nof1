export type TradingStrategy = "conservative" | "balanced" | "aggressive" | "ultra-short" | "swing-trend";

export const ALL_TRADING_STRATEGIES: TradingStrategy[] = [
	"conservative",
	"balanced",
	"aggressive",
	"ultra-short",
	"swing-trend",
];

export const TRADING_STRATEGY_LABELS: Record<TradingStrategy, string> = {
	conservative: "保守增值",
	balanced: "均衡扩张",
	aggressive: "进攻突破",
	"ultra-short": "超短线",
	"swing-trend": "波段趋势",
};
