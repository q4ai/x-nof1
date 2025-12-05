#!/bin/zsh
set -euo pipefail

APP_NAME="q4-ai-trading-platform"
VERSION="1.0.0"
DEFAULT_PORT="3888"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT_DIR="$SCRIPT_DIR/output"
DOCKERFILE="$SCRIPT_DIR/Dockerfile.deb"
TARGET_ARCH="amd64" # 默认构建 amd64 (x86_64) 架构。如果需要构建 ARM64 (如树莓派/AWS Graviton)，请改为 "arm64"
# 注意：在 M4 Mac (ARM) 上构建 amd64 包会使用 Docker 的 QEMU 模拟，速度较慢但完全支持。

# Docker 镜像源配置 (尝试使用国内加速源，如果失败请改回 "node:20-bullseye" 并配置 Docker 代理)
BASE_IMAGE="node:20-bullseye"

print_step() {
  printf "\n\033[1;34m👉 %s\033[0m\n" "$1"
}

abort() {
  printf "\n\033[1;31m✖ %s\033[0m\n" "$1"
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || abort "未找到依赖命令: $1"
}

print_step "检查运行环境"
require_cmd "docker"

mkdir -p "$OUTPUT_DIR"

print_step "生成构建用 Dockerfile"
cat > "$DOCKERFILE" <<EOF
FROM --platform=linux/${TARGET_ARCH} ${BASE_IMAGE}

WORKDIR /build

# 设置 npm 淘宝镜像加速
RUN npm config set registry https://registry.npmmirror.com

# 安装构建依赖

# 安装构建依赖
RUN apt-get update && apt-get install -y \
    rsync \
    binutils \
    && rm -rf /var/lib/apt/lists/*

# 全局安装混淆工具
RUN npm install -g javascript-obfuscator

# 复制项目文件
COPY . .

# 安装依赖并构建 (Linux 环境下编译 native 模块)
RUN npm install
RUN npm run build

# 准备 deb 包结构
ENV APP_ROOT=/opt/${APP_NAME}
ENV DEB_DIR=/build/deb_package
ENV DEBIAN_DIR=\${DEB_DIR}/DEBIAN

RUN mkdir -p \${DEB_DIR}\${APP_ROOT}/dist \
    \${DEB_DIR}\${APP_ROOT}/public \
    \${DEB_DIR}\${APP_ROOT}/data/database \
    \${DEB_DIR}\${APP_ROOT}/data/backup \
    \${DEB_DIR}\${APP_ROOT}/data/strategies \
    \${DEB_DIR}/etc/systemd/system

# 复制构建产物
RUN cp package.json package-lock.json \${DEB_DIR}\${APP_ROOT}/
RUN cp -R public/* \${DEB_DIR}\${APP_ROOT}/public/
RUN rsync -a --exclude node_modules --exclude compile --exclude .git dist/ \${DEB_DIR}\${APP_ROOT}/dist/

# 安装生产依赖 (在最终目录中)
WORKDIR \${DEB_DIR}\${APP_ROOT}
RUN npm install --omit=dev

# 混淆 JavaScript
WORKDIR \${DEB_DIR}\${APP_ROOT}/dist
RUN find . -type f -name "*.js" | while read -r js_file; do \
      tmp_dir="\${js_file}_obf"; \
      rm -rf "\$tmp_dir"; \
      javascript-obfuscator "\$js_file" --output "\$tmp_dir" \
        --compact true \
        --identifier-names-generator hexadecimal \
        --string-array-rotate true \
        --simplify true \
        --split-strings true \
        --string-array true \
        --string-array-encoding rc4 \
        --string-array-threshold 1 \
        --target node \
        --transform-object-keys true \
        --unicode-escape-sequence true; \
      mv "\$tmp_dir/\$(basename "\$js_file")" "\$js_file"; \
      rm -rf "\$tmp_dir"; \
    done

# 创建 Systemd 服务文件
RUN echo '[Unit]\n\
Description=${APP_NAME} Trading System\n\
After=network.target\n\
\n\
[Service]\n\
Type=simple\n\
User=root\n\
WorkingDirectory=\${APP_ROOT}\n\
ExecStart=/usr/bin/node \${APP_ROOT}/dist/index.js\n\
Restart=always\n\
Environment=NODE_ENV=production\n\
Environment=PORT=${DEFAULT_PORT}\n\
\n\
[Install]\n\
WantedBy=multi-user.target' > \${DEB_DIR}/etc/systemd/system/${APP_NAME}.service

# 创建 Control 文件
RUN mkdir -p \${DEBIAN_DIR}
RUN echo 'Package: ${APP_NAME}\n\
Version: ${VERSION}\n\
Section: utils\n\
Priority: optional\n\
Architecture: ${TARGET_ARCH}\n\
Maintainer: nof1.ai <support@nof1.ai>\n\
Description: AI Cryptocurrency Trading System\n\
 A sophisticated automated trading system powered by AI agents.\n\
 Provides web interface at port ${DEFAULT_PORT}.' > \${DEBIAN_DIR}/control

# 创建 postinst 脚本
RUN echo '#!/bin/sh\n\
set -e\n\
systemctl daemon-reload\n\
systemctl enable ${APP_NAME}\n\
systemctl start ${APP_NAME}\n\
echo "Service started on port ${DEFAULT_PORT}"' > \${DEBIAN_DIR}/postinst && chmod 755 \${DEBIAN_DIR}/postinst

# 创建 prerm 脚本
RUN echo '#!/bin/sh\n\
set -e\n\
systemctl stop ${APP_NAME} || true\n\
systemctl disable ${APP_NAME} || true' > \${DEBIAN_DIR}/prerm && chmod 755 \${DEBIAN_DIR}/prerm

# 构建 deb 包
WORKDIR /build
RUN dpkg-deb --build deb_package ${APP_NAME}_${VERSION}_${TARGET_ARCH}.deb

EOF

print_step "开始在 Docker 中构建 (目标架构: ${TARGET_ARCH})"
print_step "这可能需要几分钟，因为需要下载基础镜像并编译依赖..."

# 使用 tar 打包上下文，绕过 .dockerignore 限制（确保 scripts/ 被包含）
# 同时排除 node_modules 和 .git 以加快速度
tar -c -C "$REPO_ROOT" \
    --exclude .git \
    --exclude node_modules \
    --exclude dist \
    --exclude build \
    --exclude compile/output \
    . | docker build --platform linux/${TARGET_ARCH} -t ${APP_NAME}-deb-builder -f "compile/Dockerfile.deb" -

print_step "提取构建产物"
# 运行容器并将 deb 包复制出来
docker run --rm --platform linux/${TARGET_ARCH} \
  -v "$OUTPUT_DIR":/output \
  ${APP_NAME}-deb-builder \
  cp /build/${APP_NAME}_${VERSION}_${TARGET_ARCH}.deb /output/

print_step "清理临时文件"
rm "$DOCKERFILE"
# 可选：删除构建镜像
# docker rmi ${APP_NAME}-deb-builder

print_step "构建完成"
printf "输出文件：%s/%s_%s_%s.deb\n" "$OUTPUT_DIR" "$APP_NAME" "$VERSION" "$TARGET_ARCH"
printf "安装命令 (Debian/Ubuntu): sudo dpkg -i %s_%s_%s.deb\n" "$APP_NAME" "$VERSION" "$TARGET_ARCH"
