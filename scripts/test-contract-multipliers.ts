/**
 * 测试合约乘数数据
 */
import { createClient } from "@libsql/client";

const dbClient = createClient({
  url: process.env.DATABASE_URL || 'file:./data/database/sqlite.db',
});

async function testContractMultipliers() {
  try {
    // 查询前 10 条记录
    const result = await dbClient.execute(
      'SELECT * FROM contract_multipliers ORDER BY symbol LIMIT 10'
    );
    
    console.log(`\n找到 ${result.rows.length} 条合约乘数记录：\n`);
    
    for (const row of result.rows) {
      console.log(`${row.symbol}: ${row.multiplier} (${row.contract_value}) - 更新时间: ${row.updated_at}`);
    }
    
    // 查询总数
    const countResult = await dbClient.execute(
      'SELECT COUNT(*) as count FROM contract_multipliers'
    );
    console.log(`\n数据库中共有 ${countResult.rows[0].count} 个合约乘数\n`);
    
  } catch (error) {
    console.error('查询失败:', error);
  } finally {
    dbClient.close();
  }
}

testContractMultipliers();
