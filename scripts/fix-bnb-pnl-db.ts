/**
 * 修复数据库中BNB交易的错误盈亏记录
 */
import { createClient } from "@libsql/client";
import { createLogger } from "../src/utils/loggerUtils";

const logger = createLogger({
  name: "fix-bnb-pnl",
  level: "info",
});

const dbClient = createClient({
  url: "file:./data/database/sqlite.db",
});

async function fixBNBPnL() {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("🔧 修复BNB交易盈亏记录");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  try {
    // 1. 查询所有BNB交易记录
    const result = await dbClient.execute({
      sql: `SELECT * FROM trades WHERE symbol = ? ORDER BY timestamp ASC`,
      args: ["BNB"],
    });

    if (!result.rows || result.rows.length === 0) {
      console.log("❌ 未找到BNB交易记录\n");
      return;
    }

    console.log(`📊 找到 ${result.rows.length} 条BNB交易记录\n`);

    // 2. 分离开仓和平仓记录
    const openTrades = result.rows.filter((r: any) => r.type === "open");
    const closeTrades = result.rows.filter((r: any) => r.type === "close");

    console.log(`  开仓记录: ${openTrades.length} 条`);
    console.log(`  平仓记录: ${closeTrades.length} 条\n`);

    // 3. 修复每条平仓记录的盈亏
    const CORRECT_MULTIPLIER = 0.001; // BNB正确的合约乘数
    let fixedCount = 0;

    for (const closeTrade of closeTrades) {
      const closePrice = Number.parseFloat(closeTrade.price as string);
      const quantity = Number.parseFloat(closeTrade.quantity as string);
      const recordedPnl = Number.parseFloat(closeTrade.pnl as string || "0");
      const closeFee = Number.parseFloat(closeTrade.fee as string || "0");
      
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`平仓记录 ID: ${closeTrade.id}`);
      console.log(`时间: ${closeTrade.timestamp}`);
      console.log(`价格: ${closePrice} USDT`);
      console.log(`数量: ${quantity} 张\n`);

      // 查找对应的开仓记录
      const matchingOpen = openTrades.find((o: any) => {
        const closeTime = new Date(closeTrade.timestamp as string).getTime();
        const openTime = new Date(o.timestamp as string).getTime();
        return openTime < closeTime && Math.abs(Number(o.quantity) - quantity) < 10;
      });

      if (!matchingOpen) {
        console.log(`⚠️  未找到匹配的开仓记录，跳过\n`);
        continue;
      }

      const openPrice = Number.parseFloat(matchingOpen.price as string);
      const openFee = Number.parseFloat(matchingOpen.fee as string || "0");
      
      console.log(`匹配的开仓记录:`);
      console.log(`  时间: ${matchingOpen.timestamp}`);
      console.log(`  价格: ${openPrice} USDT`);
      console.log(`  开仓手续费: ${openFee.toFixed(4)} USDT`);
      console.log(`  平仓手续费: ${closeFee.toFixed(4)} USDT\n`);

      // 重新计算正确的盈亏
      const priceChange = closePrice - openPrice; // 做多
      const grossPnl = priceChange * quantity * CORRECT_MULTIPLIER;
      const totalFees = openFee + closeFee;
      const correctPnl = grossPnl - totalFees;

      console.log(`盈亏计算:`);
      console.log(`  价格变动: ${openPrice.toFixed(2)} → ${closePrice.toFixed(2)} (${priceChange >= 0 ? "+" : ""}${priceChange.toFixed(2)})`);
      console.log(`  毛盈亏: ${grossPnl >= 0 ? "+" : ""}${grossPnl.toFixed(2)} USDT`);
      console.log(`  总手续费: ${totalFees.toFixed(4)} USDT`);
      console.log(`  正确净盈亏: ${correctPnl >= 0 ? "+" : ""}${correctPnl.toFixed(2)} USDT`);
      console.log(`  记录的盈亏: ${recordedPnl >= 0 ? "+" : ""}${recordedPnl.toFixed(2)} USDT`);
      console.log(`  差异: ${Math.abs(correctPnl - recordedPnl).toFixed(2)} USDT\n`);

      // 如果差异超过1 USDT，进行修复
      if (Math.abs(correctPnl - recordedPnl) > 1) {
        console.log(`🔧 更新数据库记录...`);
        
        await dbClient.execute({
          sql: `UPDATE trades SET pnl = ? WHERE id = ?`,
          args: [correctPnl, closeTrade.id],
        });
        
        console.log(`✅ 已更新平仓记录 ID: ${closeTrade.id}`);
        console.log(`   ${recordedPnl.toFixed(2)} → ${correctPnl.toFixed(2)} USDT\n`);
        fixedCount++;
      } else {
        console.log(`✅ 盈亏已正确，无需修复\n`);
      }
    }

    // 4. 总结
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`\n📊 修复完成:`);
    console.log(`  检查记录: ${closeTrades.length} 条`);
    console.log(`  修复记录: ${fixedCount} 条`);
    console.log(`  跳过记录: ${closeTrades.length - fixedCount} 条\n`);

    if (fixedCount > 0) {
      console.log(`✅ 已成功修复 ${fixedCount} 条BNB交易的盈亏记录`);
    } else {
      console.log(`✅ 所有记录已正确，无需修复`);
    }

    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  } catch (error: any) {
    logger.error("修复失败:", error);
    console.log(`\n❌ 修复失败: ${error.message}\n`);
    throw error;
  } finally {
    await dbClient.close();
  }
}

// 执行修复
console.log("\n⚠️  警告: 此操作将修改数据库中的交易记录");
console.log("建议先备份数据库文件: data/database/sqlite.db\n");

fixBNBPnL().catch((error) => {
  console.error("执行失败:", error);
  process.exit(1);
});

