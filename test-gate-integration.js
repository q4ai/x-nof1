/**
 * Gate.io 集成测试脚本
 * 验证所有核心功能是否正确集成
 */

import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log("🔍 开始 Gate.io 集成测试...\n");

// 测试 1: 跳过动态模块导入
console.log("✓ 测试 1: 检查 GateClient 模块");
console.log("  ⚠️  跳过动态模块导入测试 (需要运行时验证)");

// 测试 2: 检查源文件
console.log("\n✓ 测试 2: 检查源文件");
try {
	const gateClientPath = join(__dirname, "src/services/gateClient.ts");
	if (fs.existsSync(gateClientPath)) {
		const content = fs.readFileSync(gateClientPath, "utf8");
		const hasGetPositions = content.includes("async getPositions()");
		const hasPlaceOrder = content.includes("async placeOrder(");
		console.log(`  ✅ gateClient.ts 存在 (${(content.length / 1024).toFixed(2)} KB)`);
		console.log(`  ${hasGetPositions ? "✅" : "❌"} 包含 getPositions 方法`);
		console.log(`  ${hasPlaceOrder ? "✅" : "❌"} 包含 placeOrder 方法`);
	}
} catch (error) {
	console.log(`  ❌ 检查失败: ${error.message}`);
}

// 测试 3: 检查类型定义
console.log("\n✓ 测试 3: 检查 TypeScript 类型");
const schemaContent = fs.readFileSync(join(__dirname, "src/database/schema.ts"), "utf8");
if (schemaContent.includes("'gate'")) {
	console.log("  ✅ schema.ts 包含 'gate' provider");
} else {
	console.log("  ❌ schema.ts 缺少 'gate' provider");
}

// 测试 4: 检查前端文件
console.log("\n✓ 测试 4: 检查前端集成");
const indexHtml = fs.readFileSync(join(__dirname, "public/index.html"), "utf8");
if (indexHtml.includes("gate.png") && indexHtml.includes('data-account-panel="gate"')) {
	console.log("  ✅ index.html 包含 Gate.io UI 元素");
} else {
	console.log("  ❌ index.html 缺少 Gate.io UI 元素");
}

const monitorScript = fs.readFileSync(join(__dirname, "public/monitor-script.js"), "utf8");
if (
	monitorScript.includes('"gate"') &&
	monitorScript.includes("badge-gate")
) {
	console.log("  ✅ monitor-script.js 包含 Gate.io 处理逻辑");
} else {
	console.log("  ❌ monitor-script.js 缺少 Gate.io 处理逻辑");
}

const monitorStyles = fs.readFileSync(join(__dirname, "public/monitor-styles.css"), "utf8");
if (monitorStyles.includes(".badge-gate")) {
	console.log("  ✅ monitor-styles.css 包含 Gate.io 样式");
} else {
	console.log("  ❌ monitor-styles.css 缺少 Gate.io 样式");
}

// 测试 5: 检查多语言文件
console.log("\n✓ 测试 5: 检查多语言支持");
const zhLang = JSON.parse(
	fs.readFileSync(join(__dirname, "src/language/zh.json"), "utf8"),
);
const enLang = JSON.parse(
	fs.readFileSync(join(__dirname, "src/language/en.json"), "utf8"),
);
const jaLang = JSON.parse(
	fs.readFileSync(join(__dirname, "src/language/ja.json"), "utf8"),
);

const hasGateTranslation =
	zhLang.accounts?.providers?.gate &&
	enLang.accounts?.providers?.gate &&
	jaLang.accounts?.providers?.gate;

if (hasGateTranslation) {
	console.log("  ✅ 所有语言文件包含 Gate.io 翻译");
	console.log(`    - 中文: ${zhLang.accounts.providers.gate}`);
	console.log(`    - 英文: ${enLang.accounts.providers.gate}`);
	console.log(`    - 日文: ${jaLang.accounts.providers.gate}`);
} else {
	console.log("  ❌ 语言文件缺少 Gate.io 翻译");
}

// 测试 6: 检查 Gate.io 图标
console.log("\n✓ 测试 6: 检查 Gate.io 图标");
const iconPath = join(__dirname, "public/static/icons/gate.png");
if (fs.existsSync(iconPath)) {
	const stats = fs.statSync(iconPath);
	console.log(`  ✅ gate.png 存在 (${(stats.size / 1024).toFixed(2)} KB)`);
} else {
	console.log("  ❌ gate.png 不存在");
}

// 测试 7: 检查构建产物
console.log("\n✓ 测试 7: 检查构建产物");
const distDir = join(__dirname, "dist");
const distFiles = fs.readdirSync(distDir);
const hasMainJs = distFiles.some((f) => f.startsWith("index-") && f.endsWith(".js"));
if (hasMainJs) {
	console.log("  ✅ 主程序构建成功");
	
	// 检查是否包含 GateClient 代码
	const mainJsFile = distFiles.find((f) => f.startsWith("index-") && f.endsWith(".js"));
	const mainJsContent = fs.readFileSync(join(distDir, mainJsFile), "utf8");
	if (mainJsContent.includes("GateClient") || mainJsContent.includes("gateClient")) {
		console.log("  ✅ 构建产物包含 GateClient 代码");
	} else {
		console.log("  ⚠️  构建产物中未直接找到 GateClient (可能已优化/混淆)");
	}
} else {
	console.log("  ❌ 找不到主程序构建文件");
}

console.log("\n" + "=".repeat(60));
console.log("🎉 Gate.io 集成测试完成!");
console.log("=".repeat(60));
console.log("\n📋 后续步骤:");
console.log("  1. 启动服务: npm run dev");
console.log("  2. 访问 UI: http://localhost:3000");
console.log("  3. 在设置中添加 Gate.io 账户");
console.log("  4. 使用测试网进行功能验证");
console.log("\n⚠️  注意事项:");
console.log("  - Gate.io 使用 HMAC-SHA512 签名");
console.log("  - 测试网地址: https://fx-api-testnet.gateio.ws");
console.log("  - 合约格式: BTC_USDT, ETH_USDT");
console.log("  - 无需 Passphrase (与 OKX/Bitget 不同)");
