#!/bin/bash

# Docker 停止脚本
# 用于安全停止 Docker 容器

set -e

echo "🛑 open-nof1.ai Docker 停止脚本"
echo "================================"

# 检查 Docker Compose 是否可用
if ! docker compose version &> /dev/null; then
    echo "❌ 错误: Docker Compose 未安装"
    exit 1
fi

# 检测运行中的容器
RUNNING_CONTAINERS=$(docker ps --filter "name=open-nof1" --format "{{.Names}}")

if [ -z "$RUNNING_CONTAINERS" ]; then
    echo "ℹ️  没有运行中的 open-nof1.ai 容器"
    exit 0
fi

echo "📋 发现运行中的容器:"
echo "$RUNNING_CONTAINERS"
echo ""

# 询问是否继续
read -p "是否停止这些容器? (Y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Nn]$ ]]; then
    echo "已取消"
    exit 0
fi

# 停止容器
echo "🛑 正在停止容器..."

# 尝试停止开发环境
if docker compose -f docker-compose.yml ps 2>/dev/null | grep -q "Up"; then
    echo "停止开发环境..."
    docker compose -f docker-compose.yml down
fi

# 尝试停止生产环境
if docker compose -f docker-compose.prod.yml ps 2>/dev/null | grep -q "Up"; then
    echo "停止生产环境..."
    docker compose -f docker-compose.prod.yml down
fi

# 验证容器已停止
sleep 2
STILL_RUNNING=$(docker ps --filter "name=open-nof1" --format "{{.Names}}")

if [ -z "$STILL_RUNNING" ]; then
    echo ""
    echo "✅ 所有容器已成功停止"
    echo ""
    echo "💡 提示:"
        echo "   - 重新启动: ./scripts/docker-start.sh"
        echo "   - 查看数据: ls -lh db/"
    echo "   - 查看日志: ls -lh logs/"
else
    echo ""
    echo "⚠️  警告: 以下容器仍在运行:"
    echo "$STILL_RUNNING"
    echo ""
    read -p "是否强制停止? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "$STILL_RUNNING" | xargs -r docker stop
        echo "✅ 已强制停止"
    fi
fi

