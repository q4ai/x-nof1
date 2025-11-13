/**
 * open-nof1.ai - AI 加密货币自动交易系统
 * Copyright (C) 2025 195440
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 * 
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 * 
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * 查询 OKX 支持的所有合约
 */

import "dotenv/config";
import { createOkxTradingClient } from "../src/services/okxTradingClient";
import { createLogger } from "../src/utils/loggerUtils";

const logger = createLogger({
  name: "query-contracts",
  level: "info",
});

async function queryContracts() {
  try {
    // 检查是否使用模拟盘
    const isPaper = process.env.OKX_USE_PAPER === "true";
    console.log(`\n🌐 当前环境: ${isPaper ? "模拟盘" : "正式盘"}`);
    console.log("=====================================\n");

    const okxClient = createOkxTradingClient();

    // 获取所有合约
    console.log("🔍 正在获取合约列表...\n");
    const contracts = await okxClient.getAllContracts();

    if (!contracts || contracts.length === 0) {
      console.log("⚠️  未找到任何合约");
      return;
    }

    console.log(`📊 共找到 ${contracts.length} 个合约\n`);
    console.log("=====================================\n");

    // 按币种分组
    const contractsBySymbol = new Map<string, any[]>();

    for (const contract of contracts) {
      const symbol = contract.baseCcy || contract.contract?.split("_")?.[0];
      if (symbol) {
        if (!contractsBySymbol.has(symbol)) {
          contractsBySymbol.set(symbol, []);
        }
        contractsBySymbol.get(symbol)?.push(contract);
      }
    }

    const sortedSymbols = Array.from(contractsBySymbol.keys()).sort();

    console.log("📋 支持的币种列表：\n");
    console.log("序号 | 币种 | 合约标识            | 状态   | 合约面值    | 最小/最大下单量");
    console.log("-----|------|---------------------|--------|-------------|------------------");

    sortedSymbols.forEach((symbol, index) => {
      const contractList = contractsBySymbol.get(symbol) || [];
      contractList.forEach((contract, contractIndex) => {
        const num = contractIndex === 0 ? `${index + 1}` : "";
        const symbolDisplay = contractIndex === 0 ? symbol : "";
        const status = contract.state === "live" ? "正常" : contract.state;
        const contractName = contract.contract ?? contract.instId;
        const quanto = contract.ctVal ?? contract.quantoMultiplier ?? "N/A";
        const minSz = contract.minSz ?? contract.orderSizeMin ?? contract.lotSz ?? "N/A";
        const maxSz = contract.maxMktSz ?? contract.orderSizeMax ?? "N/A";

        console.log(
          `${num.padEnd(5)}| ${symbolDisplay.padEnd(5)}| ${contractName.padEnd(21)}| ${status.padEnd(7)}| ${String(quanto).padEnd(11)}| ${minSz}-${maxSz}`
        );
      });
    });

    console.log("\n=====================================\n");
    console.log(`✅ 共有 ${sortedSymbols.length} 个不同的币种\n`);

    const activeContracts = contracts.filter((c: any) => c.state === "live");
    const inactiveContracts = contracts.filter((c: any) => c.state !== "live");

    console.log("📊 统计信息：");
    console.log(`   - 正常交易合约: ${activeContracts.length}`);
    console.log(`   - 暂停交易/下架合约: ${inactiveContracts.length}`);
    console.log(`   - 总合约数: ${contracts.length}`);

    console.log("\n🔥 热门币种详细信息：\n");
    const popularSymbols = ["BTC", "ETH", "SOL", "BNB", "XRP"];

    for (const symbol of popularSymbols) {
      const contractList = contractsBySymbol.get(symbol);
      if (contractList && contractList.length > 0) {
        const contract = contractList[0];
        console.log(`${symbol}:`);
        console.log(`   合约标识: ${contract.contract ?? contract.instId}`);
        console.log(`   合约面值: ${contract.ctVal ?? contract.quantoMultiplier ?? "N/A"}`);
        console.log(`   价格精度: ${contract.tickSz ?? "N/A"}`);
        console.log(`   下单精度: ${contract.lotSz ?? "N/A"}`);
        console.log(`   最小下单量: ${contract.minSz ?? contract.orderSizeMin ?? "N/A"}`);
        console.log(`   最大市价单量: ${contract.maxMktSz ?? contract.orderSizeMax ?? "N/A"}`);
        console.log(`   状态: ${contract.state === "live" ? "正常交易" : contract.state}`);
        console.log("");
      }
    }

  } catch (error: any) {
    console.error("❌ 查询失败:", error.message);
    if (error.response) {
      console.error("API 错误详情:", error.response.body || error.response.data);
    }
    process.exit(1);
  }
}

// 运行查询
queryContracts();

