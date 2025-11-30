import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
	DEFAULT_STRATEGY_LANGUAGE,
	SUPPORTED_STRATEGY_LANGUAGES,
	type StrategyLanguage,
} from "../config/strategyTypes";

const templateCache = new Map<string, string>();
const templatesDir = path.join(
	path.dirname(fileURLToPath(import.meta.url)),
	"",
);

async function loadTemplateFile(fileName: string): Promise<string> {
	const cached = templateCache.get(fileName);
	if (cached) {
		return cached;
	}

	const filePath = path.join(templatesDir, fileName);
	const content = await readFile(filePath, "utf-8");
	templateCache.set(fileName, content);
	return content;
}

export async function getPromptTemplate(fileName: string): Promise<string> {
	return loadTemplateFile(fileName);
}

export async function getLocalizedPromptTemplate(
	baseName: string,
	language: StrategyLanguage = DEFAULT_STRATEGY_LANGUAGE,
): Promise<string> {
	const candidates: string[] = [];
	const suffix = `_${language}`;
	candidates.push(`${baseName}${suffix}.txt`);

	for (const fallback of SUPPORTED_STRATEGY_LANGUAGES) {
		if (fallback === language) {
			continue;
		}
		candidates.push(`${baseName}_${fallback}.txt`);
	}

	candidates.push(`${baseName}.txt`);

	for (const name of candidates) {
		try {
			return await loadTemplateFile(name);
		} catch (error: unknown) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
				throw error;
			}
		}
	}

	throw new Error(
		`Prompt template ${baseName} not found for language ${language}`,
	);
}

export function clearPromptTemplateCache() {
	templateCache.clear();
}
