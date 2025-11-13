import { readFileSync } from "node:fs";
import path from "node:path";

import {
  ALL_TRADING_STRATEGIES,
  DEFAULT_STRATEGY_LANGUAGE,
  SUPPORTED_STRATEGY_LANGUAGES,
  getStrategyLabel,
  type StrategyLanguage,
  type TradingStrategy,
} from "../config/strategyTypes";
import type { StrategyProfile, StrategyPrompts } from "./types";

interface StrategyFileRaw {
  title?: string;
  entry_prompt: string;
  exit_prompt: string;
  var_prompt: string;
}

const STRATEGY_DIR = path.resolve(process.cwd(), "src/strategies");
const rawCache = new Map<string, StrategyFileRaw>();

function resolveFileNames(strategy: TradingStrategy, language: StrategyLanguage): string[] {
  const candidates = new Set<string>();
  const primary = `${strategy}_${language}.json`;
  candidates.add(primary);

  for (const fallback of SUPPORTED_STRATEGY_LANGUAGES) {
    if (fallback === language) {
      continue;
    }
    candidates.add(`${strategy}_${fallback}.json`);
  }

  candidates.add(`${strategy}.json`);
  return Array.from(candidates);
}

function readStrategyFile(strategy: TradingStrategy, language: StrategyLanguage): StrategyFileRaw {
  const cacheKey = `${language}:${strategy}`;
  const cached = rawCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const candidates = resolveFileNames(strategy, language);
  for (const candidate of candidates) {
    const filePath = path.join(STRATEGY_DIR, candidate);
    try {
      const raw = readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(raw) as StrategyFileRaw;
      rawCache.set(cacheKey, parsed);
      return parsed;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      // 如果文件不存在则尝试下一个候选项
    }
  }

  // 如果特定语言文件缺失，则回落到默认语言
  if (language !== DEFAULT_STRATEGY_LANGUAGE) {
    return readStrategyFile(strategy, DEFAULT_STRATEGY_LANGUAGE);
  }

  throw new Error(`Strategy template not found for ${strategy} (${language})`);
}

function buildPrompts(raw: StrategyFileRaw): StrategyPrompts {
  return {
    entryPrompt: raw.entry_prompt ?? "",
    exitPrompt: raw.exit_prompt ?? "",
    varPrompt: raw.var_prompt ?? "",
  };
}

export function getStrategyProfile(
  strategy: TradingStrategy,
  language: StrategyLanguage = DEFAULT_STRATEGY_LANGUAGE,
): StrategyProfile {
  const raw = readStrategyFile(strategy, language);
  const prompts = buildPrompts(raw);
  return {
    id: strategy,
    label: raw.title ?? getStrategyLabel(strategy, language),
    language,
    prompts,
  };
}

export function getAllStrategyProfiles(language: StrategyLanguage = DEFAULT_STRATEGY_LANGUAGE): StrategyProfile[] {
  return ALL_TRADING_STRATEGIES.map((strategy) => getStrategyProfile(strategy, language));
}

export function clearStrategyCache() {
  rawCache.clear();
}
