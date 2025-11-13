import { readFileSync } from "node:fs";
import path from "node:path";

import { ALL_TRADING_STRATEGIES, TRADING_STRATEGY_LABELS, type TradingStrategy } from "../config/strategyTypes";
import type { StrategyProfile, StrategyPrompts } from "./types";

interface StrategyFileRaw {
  entry_prompt: string;
  exit_prompt: string;
  var_prompt: string;
}

const STRATEGY_DIR = path.resolve(process.cwd(), "src/strategies");
const rawCache = new Map<TradingStrategy, StrategyFileRaw>();

function readStrategyFile(strategy: TradingStrategy): StrategyFileRaw {
  if (rawCache.has(strategy)) {
    return rawCache.get(strategy)!;
  }

  const filePath = path.join(STRATEGY_DIR, `${strategy}.json`);
  const raw = readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(raw) as StrategyFileRaw;
  rawCache.set(strategy, parsed);
  return parsed;
}

function buildPrompts(raw: StrategyFileRaw): StrategyPrompts {
  return {
    entryPrompt: raw.entry_prompt ?? "",
    exitPrompt: raw.exit_prompt ?? "",
    varPrompt: raw.var_prompt ?? "",
  };
}

export function getStrategyProfile(strategy: TradingStrategy): StrategyProfile {
  const raw = readStrategyFile(strategy);
  const prompts = buildPrompts(raw);
  return {
    id: strategy,
    label: TRADING_STRATEGY_LABELS[strategy],
    prompts,
  };
}

export function getAllStrategyProfiles(): StrategyProfile[] {
  return ALL_TRADING_STRATEGIES.map((strategy) => getStrategyProfile(strategy));
}

export function clearStrategyCache() {
  rawCache.clear();
}
