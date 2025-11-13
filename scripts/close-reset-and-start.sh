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
# 平仓、重置数据库脚本
# =====================================================
# 
# 功能：
# 1. 平仓所有当前持仓
# 2. 停止现有进程和释放端口
# 3. 清空数据库所有数据
# 4. 重新初始化数据库
# 5. 同步持仓数据
# 
# 使用方法：
#   bash scripts/close-reset-and-start.sh
#   或
#   npm run db:close-and-reset
# =====================================================

set -e  # 遇到错误立即退出

echo "================================================================================"
echo "🔄 AI 加密货币交易系统 - 平仓并重置"
echo "================================================================================"
echo ""

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# =====================================================
# 第一部分：环境检查和确认
# =====================================================

echo "📋 步骤 1/7：检查环境..."
echo ""

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ 未找到 Node.js，请先安装 Node.js 20+${NC}"
    exit 1
fi

NODE_VERSION=$(node --version)
echo -e "${GREEN}✓${NC} Node.js 版本: $NODE_VERSION"

# 检查 npm
if ! command -v npm &> /dev/null; then
    echo -e "${RED}❌ 未找到 npm${NC}"
    exit 1
fi

NPM_VERSION=$(npm --version)
echo -e "${GREEN}✓${NC} npm 版本: $NPM_VERSION"

# 检查 .env 文件
if [ ! -f .env ]; then
    echo -e "${RED}❌ 未找到 .env 文件${NC}"
    echo ""
    echo "请创建 .env 文件并配置以下变量："
    echo "  - OKX_API_KEY"
    echo "  - OKX_API_SECRET"
    echo "  - OKX_API_PASSPHRASE"
    echo "  - OPENAI_API_KEY"
    echo "  - OKX_USE_PAPER=true"
    exit 1
fi

echo -e "${GREEN}✓${NC} 找到 .env 文件"

# 读取环境变量
source .env

# 检查必需的环境变量
REQUIRED_VARS=("OKX_API_KEY" "OKX_API_SECRET" "OKX_API_PASSPHRASE" "OPENAI_API_KEY")
MISSING_VARS=()

for var in "${REQUIRED_VARS[@]}"; do
    if [ -z "${!var}" ]; then
        MISSING_VARS+=("$var")
    fi
done

if [ ${#MISSING_VARS[@]} -gt 0 ]; then
    echo -e "${RED}❌ 以下环境变量未配置：${NC}"
    for var in "${MISSING_VARS[@]}"; do
        echo "   - $var"
    done
    echo ""
    echo "请在 .env 文件中配置这些变量"
    exit 1
fi

echo -e "${GREEN}✓${NC} 环境变量检查通过"

# 检查是否使用测试网
if grep -q "OKX_USE_PAPER=true" .env; then
    echo -e "${GREEN}✓${NC} 当前配置: 模拟盘模式（推荐）"
else
    echo -e "${YELLOW}⚠${NC} 当前配置: 正式盘模式"
fi
echo ""

# 二次确认
echo -e "${YELLOW}⚠️  警告: 此操作将执行以下内容：${NC}"
echo ""
echo "  1. 平仓所有当前持仓（市价单）"
echo "  2. 停止所有运行中的交易系统"
echo "  3. 删除所有历史交易记录"
echo "  4. 删除所有持仓信息"
echo "  5. 删除所有账户历史"
echo "  6. 重新初始化数据库"
echo "  7. 从 OKX 同步持仓数据"
echo ""
echo -e "${RED}此操作不可恢复！${NC}"
echo ""

read -p "确认执行平仓并重置？(输入 yes 确认): " -r
echo ""

if [[ $REPLY != "yes" ]]; then
    echo -e "${YELLOW}❌ 已取消操作${NC}"
    exit 0
fi

echo "================================================================================"
echo -e "${BLUE}开始执行平仓并重置...${NC}"
echo "================================================================================"
echo ""

# =====================================================
# 第二部分：停止现有进程和释放端口
# =====================================================

echo "🛑 步骤 2/7：停止现有进程和释放端口..."
echo ""

# 停止现有交易系统进程
pkill -f "npm run trading:start" 2>/dev/null || true
pkill -f "tsx.*src/index" 2>/dev/null || true
echo -e "${GREEN}✓${NC} 已停止所有运行中的交易系统"

# 杀死占用 3100 端口的进程（监控界面）
if lsof -ti:3100 >/dev/null 2>&1; then
    echo "正在释放端口 3100..."
    lsof -ti:3100 | xargs kill -9 2>/dev/null || true
    echo -e "${GREEN}✓${NC} 已释放端口 3100"
else
    echo -e "${GREEN}✓${NC} 端口 3100 未被占用"
fi

# 等待端口完全释放
sleep 1
echo ""

# =====================================================
# 第三部分：平仓并重置数据库
# =====================================================

echo "💰 步骤 3/7：平仓所有持仓并重置数据库..."
echo ""

# 执行平仓并重置脚本（包含：平仓、重置数据库、同步持仓）
npx tsx --env-file=.env ./src/database/close-and-reset.ts

echo ""

# =====================================================
# 第四部分：检查依赖
# =====================================================

echo "📦 步骤 4/7：检查依赖..."
echo ""

if [ ! -d "node_modules" ]; then
    echo "正在安装依赖包..."
    npm install
    echo -e "${GREEN}✓${NC} 依赖安装完成"
else
    echo -e "${GREEN}✓${NC} 依赖已存在，跳过安装"
    echo "   (如需重新安装，请先删除 node_modules 目录)"
fi
echo ""

# =====================================================
# 第五部分：显示当前配置
# =====================================================

echo "⚙️  步骤 5/7：显示当前配置..."
echo ""

# 检查是否使用测试网
if grep -q "OKX_USE_PAPER=true" .env; then
    echo -e "${GREEN}✓${NC} 当前配置: 模拟盘模式（推荐）"
else
    echo -e "${YELLOW}⚠${NC} 当前配置: 正式盘模式"
fi

# 显示初始资金
INITIAL_BALANCE=$(grep "^INITIAL_BALANCE=" .env | cut -d '=' -f2)
if [ ! -z "$INITIAL_BALANCE" ]; then
    echo -e "${GREEN}✓${NC} 初始资金: ${INITIAL_BALANCE} USDT"
fi
echo ""

# =====================================================
# 第六部分：显示系统状态
# =====================================================

echo "📊 步骤 6/7：显示系统状态..."
echo ""

npm run db:status
echo ""

# =====================================================
# 第七部分：完成
# =====================================================

echo "✅ 步骤 7/7：完成！"
echo ""

echo "================================================================================"
echo -e "${GREEN}✨ 重置完成！${NC}"
echo "================================================================================"
echo ""
echo -e "${YELLOW}系统已完成以下操作：${NC}"
echo "  ✓ 已停止所有运行中的进程"
echo "  ✓ 已平仓所有持仓"
echo "  ✓ 已重置数据库到初始状态"
echo "  ✓ 已从 OKX 同步持仓数据"
echo ""
echo -e "${BLUE}如需启动交易系统，请运行：${NC}"
echo "  npm run trading:start"
echo ""
echo "================================================================================"
echo ""

