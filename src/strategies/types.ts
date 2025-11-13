import type { TradingStrategy } from "../config/strategyTypes";

export interface StrategyPrompts {
  entryPrompt: string;
  exitPrompt: string;
  varPrompt: string;
}

export interface StrategyProfile {
  id: TradingStrategy;
  label: string;
  prompts: StrategyPrompts;
}
