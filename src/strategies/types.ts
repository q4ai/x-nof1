import type {
	StrategyLanguage,
	TradingStrategy,
} from "../config/strategyTypes";

export interface StrategyPrompts {
	entryPrompt: string;
	exitPrompt: string;
	varPrompt: string;
}

export interface StrategyProfile {
	id: TradingStrategy;
	label: string;
	language: StrategyLanguage;
	prompts: StrategyPrompts;
}
