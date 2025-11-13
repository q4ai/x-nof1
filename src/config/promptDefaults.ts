/**
 * 默认策略提示词片段（可由前端覆盖）
 */
import { getStrategyProfile } from "../strategies";
import type { StrategyPrompts } from "../strategies/types";

function loadUltraShortPrompts(): StrategyPrompts {
	try {
		const profile = getStrategyProfile("ultra-short");
		return profile.prompts;
	} catch (error) {
		console.warn("[promptDefaults] 加载超短线策略模板失败，将使用空字符串", error);
		return {
			entryPrompt: "",
			exitPrompt: "",
			varPrompt: "",
		};
	}
}

const ULTRA_SHORT_PROMPTS = loadUltraShortPrompts();

export const DEFAULT_PROMPT_ENTRY = ULTRA_SHORT_PROMPTS.entryPrompt;

export const DEFAULT_PROMPT_EXIT = ULTRA_SHORT_PROMPTS.exitPrompt;

export const DEFAULT_PROMPT_VARIABLES = ULTRA_SHORT_PROMPTS.varPrompt;
