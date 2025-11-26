#!/bin/bash

# open-nof1.ai - AI 加密货币自动交易系统
# Copyright (C) 2025 195440
# 
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
# 
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
# GNU Affero General Public License for more details.
# 
# You should have received a copy of the GNU Affero General Public License
# along with this program. If not, see <https://www.gnu.org/licenses/>.

# =====================================================
# 数据库状态查看脚本
# =====================================================

set -e

echo "=================================================="
echo "  数据库状态"
echo "=================================================="
echo ""

# 颜色定义
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# 检查 .env 文件
if [ ! -f .env ]; then
    echo -e "${YELLOW}⚠️  未找到 .env 文件${NC}"
    exit 1
fi

source .env

DATABASE_URL=${DATABASE_URL:-"file:./data/database/sqlite.db"}

# 检查数据库文件
if [[ $DATABASE_URL == file:* ]]; then
    DB_FILE="${DATABASE_URL#file:}"
    
    if [ ! -f "$DB_FILE" ]; then
        echo -e "${YELLOW}⚠️  数据库文件不存在: $DB_FILE${NC}"
        echo ""
        echo "请运行以下命令初始化数据库："
        echo -e "  ${BLUE}npm run db:init${NC}"
        exit 0
    fi
    
    echo -e "${GREEN}✅ 数据库文件: $DB_FILE${NC}"
    
    # 显示文件大小
    FILE_SIZE=$(du -h "$DB_FILE" | cut -f1)
    echo -e "${CYAN}📁 文件大小: $FILE_SIZE${NC}"
    
    # 显示修改时间
    MODIFIED=$(stat -f "%Sm" -t "%Y-%m-%d %H:%M:%S" "$DB_FILE" 2>/dev/null || stat -c "%y" "$DB_FILE" 2>/dev/null | cut -d'.' -f1)
    echo -e "${CYAN}🕐 最后修改: $MODIFIED${NC}"
fi

echo ""
echo "=================================================="
echo "  数据库内容统计"
echo "=================================================="
echo ""

# 使用 Node.js 查询数据库
npx tsx --env-file=.env -e "
import { createClient } from '@libsql/client';

const client = createClient({
  url: process.env.DATABASE_URL || 'file:./data/database/sqlite.db'
});

async function showStatus() {
  try {
    // 账户历史记录数
    const historyCount = await client.execute('SELECT COUNT(*) as count FROM account_history');
    console.log('📊 账户历史记录:', (historyCount.rows[0] as any).count);
    
    // 最新账户状态
    const latestAccount = await client.execute('SELECT * FROM account_history ORDER BY timestamp DESC LIMIT 1');
    if (latestAccount.rows.length > 0) {
      const acc = latestAccount.rows[0] as any;
      console.log('');
      console.log('💰 最新账户状态:');
      console.log('   总资产:', acc.total_value, 'USDT');
      console.log('   可用资金:', acc.available_cash, 'USDT');
      console.log('   未实现盈亏:', acc.unrealized_pnl, 'USDT');
      console.log('   总收益率:', acc.return_percent + '%');
      console.log('   更新时间:', new Date(acc.timestamp).toLocaleString('zh-CN'));
    }
    
    // 持仓数量
    const positionsCount = await client.execute('SELECT COUNT(*) as count FROM positions');
    console.log('');
    console.log('📈 当前持仓数:', (positionsCount.rows[0] as any).count);
    
    // 持仓详情
    const positions = await client.execute('SELECT * FROM positions');
    if (positions.rows.length > 0) {
      console.log('');
      console.log('持仓详情:');
      for (const pos of positions.rows) {
        const p = pos as any;
        const pnl = parseFloat(p.unrealized_pnl) >= 0 ? '+' + p.unrealized_pnl : p.unrealized_pnl;
        console.log(\`   \${p.symbol}: \${p.quantity} 张 (\${p.side}) @ \${p.entry_price} | 盈亏: \${pnl} USDT | 杠杆: \${p.leverage}x\`);
      }
    }
    
    // 交易记录数
    const tradesCount = await client.execute('SELECT COUNT(*) as count FROM trades');
    console.log('');
    console.log('📝 交易记录数:', (tradesCount.rows[0] as any).count);
    
    // 最近交易
    const recentTrades = await client.execute('SELECT * FROM trades ORDER BY timestamp DESC LIMIT 5');
    if (recentTrades.rows.length > 0) {
      console.log('');
      console.log('最近 5 笔交易:');
      for (const trade of recentTrades.rows) {
        const t = trade as any;
        const time = new Date(t.timestamp).toLocaleString('zh-CN');
        console.log(\`   [\${time}] \${t.symbol} \${t.action} \${t.quantity} 张 @ \${t.price}\`);
      }
    }
    
    // Agent 决策记录数
    const decisionsCount = await client.execute('SELECT COUNT(*) as count FROM agent_decisions');
    console.log('');
    console.log('🤖 AI 决策记录数:', (decisionsCount.rows[0] as any).count);
    
    // 最新决策
    const latestDecision = await client.execute('SELECT * FROM agent_decisions ORDER BY timestamp DESC LIMIT 1');
    if (latestDecision.rows.length > 0) {
      const dec = latestDecision.rows[0] as any;
      console.log('');
      console.log('最新 AI 决策:');
      console.log('   时间:', new Date(dec.timestamp).toLocaleString('zh-CN'));
      console.log('   迭代次数:', dec.iteration);
      console.log('   账户价值:', dec.account_value, 'USDT');
      console.log('   持仓数:', dec.positions_count);
    }
    
    client.close();
  } catch (error) {
    console.error('❌ 查询失败:', error);
    process.exit(1);
  }
}

showStatus();
"

echo ""
echo "=================================================="
echo ""

