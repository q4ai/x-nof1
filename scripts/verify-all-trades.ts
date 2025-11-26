/**
 * 验证所有交易记录的盈亏计算是否正确
 */
import { createClient } from "@libsql/client";
import { createLogger } from "../src/utils/loggerUtils";

const logger = createLogger({
  name: "verify-trades",
  level: "info",
});

const dbClient = createClient({
  url: "file:./data/database/sqlite.db",
});

// 合约乘数配置
const MULTIPLIERS: Record<string, number> = {
  'BTC': 0.0001,
  'ETH': 0.01,
  'SOL': 1,
  'XRP': 10,
  'BNB': 0.001,  // 已修复
  'BCH': 0.01,
  'DOGE': 100,
};

async function verifyAllTrades() {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("🔍 验证所有交易记录");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  try {
    // 1. 查询所有交易记录
    const allTrades = await dbClient.execute({
      sql: `SELECT * FROM trades ORDER BY timestamp ASC`,
    });

    if (!allTrades.rows || allTrades.rows.length === 0) {
      console.log("📊 数据库中没有交易记录\n");
      return;
    }

    console.log(`📊 找到 ${allTrades.rows.length} 条交易记录\n`);

    // 2. 按币种分组
    const tradesBySymbol = new Map<string, any[]>();
    for (const trade of allTrades.rows) {
      const symbol = trade.symbol as string;
      if (!tradesBySymbol.has(symbol)) {
        tradesBySymbol.set(symbol, []);
      }
      tradesBySymbol.get(symbol)!.push(trade);
    }

    console.log(`涉及币种: ${Array.from(tradesBySymbol.keys()).join(", ")}\n`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    // 3. 验证每个币种的交易
    let totalIssues = 0;
    
    for (const [symbol, trades] of tradesBySymbol) {
      console.log(`\n📌 ${symbol}:`);
      console.log(`   总交易: ${trades.length} 条`);
      
      const multiplier = MULTIPLIERS[symbol];
      if (!multiplier) {
        console.log(`   ⚠️  未配置合约乘数，跳过验证\n`);
        continue;
      }
      
      console.log(`   合约乘数: ${multiplier}\n`);

      const openTrades = trades.filter((t: any) => t.type === "open");
      const closeTrades = trades.filter((t: any) => t.type === "close");
      
      console.log(`   开仓: ${openTrades.length} 条`);
      console.log(`   平仓: ${closeTrades.length} 条\n`);

      // 验证每条平仓记录
      for (const closeTrade of closeTrades) {
        const closePrice = Number.parseFloat(closeTrade.price as string);
        const quantity = Number.parseFloat(closeTrade.quantity as string);
        const recordedPnl = Number.parseFloat(closeTrade.pnl as string || "0");
        const closeFee = Number.parseFloat(closeTrade.fee as string || "0");
        
        // 查找匹配的开仓记录
        const matchingOpen = openTrades.find((o: any) => {
          const closeTime = new Date(closeTrade.timestamp as string).getTime();
          const openTime = new Date(o.timestamp as string).getTime();
          return openTime < closeTime && Math.abs(Number(o.quantity) - quantity) < 10;
        });

        if (!matchingOpen) {
          console.log(`   ⚠️  平仓记录 ${closeTrade.id} 未找到匹配的开仓记录`);
          continue;
        }

        const openPrice = Number.parseFloat(matchingOpen.price as string);
        const openFee = Number.parseFloat(matchingOpen.fee as string || "0");
        
        // 计算正确的盈亏
        const side = closeTrade.side as string;
        const priceChange = side === "long" 
          ? (closePrice - openPrice)
          : (openPrice - closePrice);
        const grossPnl = priceChange * quantity * multiplier;
        const totalFees = openFee + closeFee;
        const correctPnl = grossPnl - totalFees;

        // 检查差异
        const diff = Math.abs(correctPnl - recordedPnl);
        
        if (diff > 1) {
          console.log(`   ❌ 平仓记录 ${closeTrade.id} (${closeTrade.timestamp}):`);
          console.log(`      开仓: ${openPrice.toFixed(2)} USDT`);
          console.log(`      平仓: ${closePrice.toFixed(2)} USDT`);
          console.log(`      数量: ${quantity} 张`);
          console.log(`      计算盈亏: ${correctPnl.toFixed(2)} USDT`);
          console.log(`      记录盈亏: ${recordedPnl.toFixed(2)} USDT`);
          console.log(`      差异: ${diff.toFixed(2)} USDT ❌\n`);
          totalIssues++;
        } else {
          console.log(`   ✅ 平仓记录 ${closeTrade.id} 正确 (${closeTrade.timestamp})`);
          console.log(`      盈亏: ${recordedPnl.toFixed(2)} USDT\n`);
        }
      }
    }

    // 4. 总结
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`\n📊 验证完成:`);
    console.log(`  总交易记录: ${allTrades.rows.length} 条`);
    console.log(`  涉及币种: ${tradesBySymbol.size} 个`);
    console.log(`  发现问题: ${totalIssues} 条\n`);

    if (totalIssues === 0) {
      console.log(`✅ 所有交易记录的盈亏计算均正确！`);
    } else {
      console.log(`⚠️  发现 ${totalIssues} 条记录存在问题，建议运行修复脚本`);
    }

    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  } catch (error: any) {
    logger.error("验证失败:", error);
    console.log(`\n❌ 验证失败: ${error.message}\n`);
  } finally {
    await dbClient.close();
  }
}

verifyAllTrades().catch(console.error);

