import { cpSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const currentDir = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = dirname(currentDir);
const sourceDir = join(workspaceRoot, "src", "language");
const targetDir = join(workspaceRoot, "dist", "language");

if (!existsSync(sourceDir)) {
  console.warn(`[copy-language-assets] Source directory not found: ${sourceDir}`);
  process.exit(0);
}

if (!existsSync(targetDir)) {
  mkdirSync(targetDir, { recursive: true });
}

cpSync(sourceDir, targetDir, { recursive: true });
console.log(`[copy-language-assets] Copied language packs to ${targetDir}`);
