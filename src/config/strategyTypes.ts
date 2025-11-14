export type TradingStrategy = "conservative" | "balanced" | "aggressive" | "ultra-short" | "swing-trend" | "dca";

export const SUPPORTED_STRATEGY_LANGUAGES = ["en", "zh", "ja"] as const;

export type StrategyLanguage = (typeof SUPPORTED_STRATEGY_LANGUAGES)[number];

export const DEFAULT_STRATEGY_LANGUAGE: StrategyLanguage = "en";

export const ALL_TRADING_STRATEGIES: TradingStrategy[] = [
	"conservative",
	"balanced",
	"aggressive",
	"ultra-short",
	"swing-trend",
	"dca",
];

const STRATEGY_LABELS: Record<StrategyLanguage, Record<TradingStrategy, string>> = {
	en: {
		conservative: "Capital Preservation",
		balanced: "Balanced Expansion",
		aggressive: "Breakout Momentum",
		"ultra-short": "Ultra-Short",
		"swing-trend": "Swing Trend",
		dca: "DCA",
	},
	zh: {
		conservative: "保守增值",
		balanced: "均衡扩张",
		aggressive: "进攻突破",
		"ultra-short": "超短线",
		"swing-trend": "波段趋势",
		dca: "DCA定投",
	},
	ja: {
		conservative: "資本保全",
		balanced: "バランス拡張",
		aggressive: "ブレイクアウトモメンタム",
		"ultra-short": "超短期",
		"swing-trend": "スイングトレンド",
		dca: "DCA積立",
	},
};

export const TRADING_STRATEGY_LABELS = STRATEGY_LABELS[DEFAULT_STRATEGY_LANGUAGE];

export function isSupportedStrategyLanguage(language: string): language is StrategyLanguage {
	return SUPPORTED_STRATEGY_LANGUAGES.includes(language as StrategyLanguage);
}

export function normalizeStrategyLanguage(language?: string | null): StrategyLanguage {
	if (typeof language !== "string") {
		return DEFAULT_STRATEGY_LANGUAGE;
	}
	const normalized = language.trim().toLowerCase();
	if (isSupportedStrategyLanguage(normalized)) {
		return normalized;
	}
	const dashIndex = normalized.indexOf("-");
	if (dashIndex > 0) {
		const primary = normalized.slice(0, dashIndex);
		if (isSupportedStrategyLanguage(primary)) {
			return primary;
		}
	}
	return DEFAULT_STRATEGY_LANGUAGE;
}

export function getStrategyLabel(strategy: TradingStrategy, language: StrategyLanguage = DEFAULT_STRATEGY_LANGUAGE): string {
	return STRATEGY_LABELS[language]?.[strategy] ?? STRATEGY_LABELS[DEFAULT_STRATEGY_LANGUAGE][strategy] ?? strategy;
}
