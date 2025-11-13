import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const templateCache = new Map<string, string>();
const templatesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "");

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
