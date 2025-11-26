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

# AI 加密货币自动交易系统 - 完全重置与启动脚本
# 使用方法: bash reset-and-start.sh

set -e  # 遇到错误立即退出

echo "================================================================================"
echo "🔄 AI 加密货币自动交易系统 - 完全重置与启动"
echo "================================================================================"
echo ""

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 步骤 1：环境检查
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
echo ""

# 步骤 2：停止现有进程和释放端口
echo "🛑 步骤 2/7：停止现有进程和释放端口..."
echo ""

# 停止现有交易系统进程
pkill -f "npm run trading:start" 2>/dev/null || true
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

# 步骤 3：数据库清理确认
echo "🧹 步骤 3/7：清理数据库..."
echo ""

echo -e "${YELLOW}⚠️  警告: 这将删除所有历史交易记录、持仓信息和账户历史！${NC}"
read -p "确认删除数据库文件吗？(y/N): " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    rm -rf data/database/sqlite.db 2>/dev/null || true
    rm -rf data/database/sqlite.db-shm 2>/dev/null || true
    rm -rf data/database/sqlite.db-wal 2>/dev/null || true
    echo -e "${GREEN}✓${NC} 数据库文件已删除"
else
    echo -e "${YELLOW}⚠${NC} 跳过数据库清理"
fi
echo ""

# 步骤 4：安装依赖
echo "📦 步骤 4/7：安装依赖..."
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

# 步骤 5：检查配置文件
echo "⚙️  步骤 5/7：检查配置文件..."
echo ""

if [ ! -f ".env" ]; then
    echo -e "${RED}❌ 未找到 .env 文件${NC}"
    echo "请创建 .env 文件并配置以下变量："
    echo "  - OKX_API_KEY"
    echo "  - OKX_API_SECRET"
    echo "  - OKX_API_PASSPHRASE"
    echo "  - OPENAI_API_KEY"
    echo "  - OKX_USE_PAPER=true"
    exit 1
fi

# 检查必需的环境变量
REQUIRED_VARS=("OKX_API_KEY" "OKX_API_SECRET" "OKX_API_PASSPHRASE" "OPENAI_API_KEY")
MISSING_VARS=()

for var in "${REQUIRED_VARS[@]}"; do
    if ! grep -q "^${var}=" .env || grep -q "^${var}=$" .env || grep -q "^${var}=你的" .env; then
        MISSING_VARS+=("$var")
    fi
done

if [ ${#MISSING_VARS[@]} -gt 0 ]; then
    echo -e "${RED}❌ 以下环境变量未正确配置：${NC}"
    for var in "${MISSING_VARS[@]}"; do
        echo "   - $var"
    done
    echo ""
    echo "请编辑 .env 文件并配置这些变量"
    exit 1
fi

echo -e "${GREEN}✓${NC} 配置文件检查通过"

# 检查是否使用测试网
if grep -q "OKX_USE_PAPER=true" .env; then
    echo -e "${GREEN}✓${NC} 当前配置: 模拟盘模式（推荐）"
else
    echo -e "${YELLOW}⚠${NC} 当前配置: 正式盘模式"
fi
echo ""

# 步骤 6：初始化数据库
echo "🗄️  步骤 6/8：初始化数据库..."
echo ""

npm run db:init
echo ""

# 步骤 7：同步持仓数据
echo "🔄 步骤 7/8：从 OKX 同步持仓数据..."
echo ""

npm run db:sync-positions
echo ""

# 步骤 8：启动系统
echo "🚀 步骤 8/8：启动交易系统..."
echo ""

echo "================================================================================"
echo -e "${GREEN}✨ 准备就绪！系统即将启动...${NC}"
echo "================================================================================"
echo ""
echo "监控界面: http://localhost:3100"
echo "按 Ctrl+C 可以停止系统"
echo ""
echo "================================================================================"
echo ""

# 等待 2 秒让用户看到信息
sleep 2

# 启动系统
npm run trading:start

