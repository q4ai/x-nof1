#!/bin/zsh
set -euo pipefail

APP_NAME="q4-ai-trading-platform"
VERSION="1.0.0"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT_DIR="$SCRIPT_DIR/output"
DOCKERFILE="$SCRIPT_DIR/Dockerfile.exe"
TARGET_ARCH="amd64" # 构建 x64 架构

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

print_step "生成 NSIS 安装脚本"
cat > "$SCRIPT_DIR/installer.nsi" <<EOF
!include "MUI2.nsh"

Name "${APP_NAME}"
OutFile "${APP_NAME}_setup_${VERSION}.exe"
InstallDir "\$PROGRAMFILES64\\${APP_NAME}"
InstallDirRegKey HKCU "Software\\${APP_NAME}" ""
RequestExecutionLevel admin

!define MUI_ABORTWARNING

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_WELCOME
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH

!insertmacro MUI_LANGUAGE "SimpChinese"

Section "Install"
  SetOutPath "\$INSTDIR"
  File /r "nsis_input\\*"

  ; Create shortcuts
  CreateDirectory "\$SMPROGRAMS\\${APP_NAME}"
  CreateShortcut "\$SMPROGRAMS\\${APP_NAME}\\${APP_NAME}.lnk" "\$INSTDIR\\${APP_NAME}.exe"
  CreateShortcut "\$SMPROGRAMS\\${APP_NAME}\\Uninstall.lnk" "\$INSTDIR\\Uninstall.exe"
  CreateShortcut "\$DESKTOP\\${APP_NAME}.lnk" "\$INSTDIR\\${APP_NAME}.exe"

  ; Write uninstaller
  WriteUninstaller "\$INSTDIR\\Uninstall.exe"
  WriteRegStr HKCU "Software\\${APP_NAME}" "" \$INSTDIR
  WriteRegStr HKLM "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${APP_NAME}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKLM "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${APP_NAME}" "UninstallString" "\$INSTDIR\\Uninstall.exe"
SectionEnd

Section "Uninstall"
  Delete "\$INSTDIR\\${APP_NAME}.exe"
  Delete "\$INSTDIR\\Uninstall.exe"
  Delete "\$INSTDIR\\package.json"
  RMDir /r "\$INSTDIR\\node_modules"
  RMDir /r "\$INSTDIR\\public"
  RMDir /r "\$INSTDIR\\data"

  Delete "\$SMPROGRAMS\\${APP_NAME}\\${APP_NAME}.lnk"
  Delete "\$SMPROGRAMS\\${APP_NAME}\\Uninstall.lnk"
  RMDir "\$SMPROGRAMS\\${APP_NAME}"
  Delete "\$DESKTOP\\${APP_NAME}.lnk"

  DeleteRegKey HKCU "Software\\${APP_NAME}"
  DeleteRegKey HKLM "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${APP_NAME}"
  RMDir "\$INSTDIR"
SectionEnd
EOF

print_step "生成构建用 Dockerfile"
# 使用 node:20-bullseye 作为基础镜像，安装 pkg 和 nsis
cat > "$DOCKERFILE" <<EOF
FROM --platform=linux/${TARGET_ARCH} node:20-bullseye

WORKDIR /build

# 安装构建依赖和 NSIS
RUN apt-get update && apt-get install -y \
    rsync \
    nsis \
    && rm -rf /var/lib/apt/lists/*

# 全局安装工具
RUN npm install -g javascript-obfuscator pkg

# 复制项目文件
COPY . .

# 清理可能存在的 node_modules (来自宿主机) 以避免架构不兼容问题
RUN rm -rf node_modules

# 修改配置以构建 CJS 版本 (pkg 对 ESM 支持不佳)
# 1. 移除 package.json 中的 "type": "module"，使 .js 默认为 CJS
RUN sed -i 's/"type": "module",//' package.json
# 2. 配置 tsdown 输出 CJS
RUN sed -i 's/outDir: "dist",/outDir: "dist", format: "cjs",/' tsdown.config.ts
# 3. 替换 Top-level await (CJS 不支持)
RUN sed -i 's/await main();/main().catch(console.error);/' src/index.ts

# 安装依赖并构建
RUN npm install
RUN npm run build

# 准备打包目录
ENV APP_ROOT=/build/exe_package
RUN mkdir -p \${APP_ROOT}/dist \
    \${APP_ROOT}/public \
    \${APP_ROOT}/data/database \
    \${APP_ROOT}/data/backup \
    \${APP_ROOT}/data/strategies

# 复制构建产物
RUN cp package.json package-lock.json \${APP_ROOT}/
RUN cp -R public/* \${APP_ROOT}/public/
RUN rsync -a --exclude node_modules --exclude compile --exclude .git dist/ \${APP_ROOT}/dist/

# 安装生产依赖 (在打包目录中)
WORKDIR \${APP_ROOT}
RUN npm install --omit=dev
# 显式安装 Windows 平台的 libsql 绑定，确保它存在于 node_modules 中
RUN npm_config_platform=win32 npm_config_arch=x64 npm_config_force=1 npm install --no-save @libsql/win32-x64-msvc

# 混淆 JavaScript
WORKDIR \${APP_ROOT}
RUN find dist public -type f -name "*.js" | while read -r js_file; do \
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

# 使用 pkg 打包成 exe
WORKDIR \${APP_ROOT}
RUN echo '{ \
  "name": "${APP_NAME}", \
  "pkg": { \
    "scripts": [ \
      "node_modules/ws/**/*.js", \
      "node_modules/@libsql/**/*.js", \
      "node_modules/libsql/**/*.js", \
      "node_modules/@voltagent/**/*.js", \
      "node_modules/dotenv/**/*.js" \
    ], \
    "assets": [ \
      "dist/**/*", \
      "public/**/*", \
      "node_modules/@libsql/**/*", \
      "node_modules/libsql/**/*", \
      "node_modules/@voltagent/**/*", \
      "node_modules/dotenv/**/*" \
    ], \
    "targets": [ \
      "node18-win-x64" \
    ], \
    "outputPath": "output" \
  } \
}' > pkg-config.json

RUN pkg -c pkg-config.json dist/index.js --compress GZip -o output/${APP_NAME}.exe

# 准备最终输出结构 (供 NSIS 打包)
RUN mkdir -p /build/nsis_input
RUN cp output/${APP_NAME}.exe /build/nsis_input/
RUN cp -R node_modules /build/nsis_input/
RUN cp -R public /build/nsis_input/
RUN cp -R data /build/nsis_input/
RUN cp package.json /build/nsis_input/

# 编译 NSIS 脚本
WORKDIR /build
# 注意：installer.nsi 在 compile/installer.nsi，因为我们 COPY . .
RUN cp compile/installer.nsi .
RUN makensis installer.nsi

EOF

print_step "开始在 Docker 中构建 (目标架构: ${TARGET_ARCH})"
print_step "这可能需要几分钟..."

# 使用 tar 打包上下文
tar -c -C "$REPO_ROOT" \
    --exclude .git \
    --exclude node_modules \
    --exclude dist \
    --exclude build \
    --exclude compile/output \
    . | docker build --platform linux/${TARGET_ARCH} -t ${APP_NAME}-exe-builder -f "compile/Dockerfile.exe" -

print_step "提取构建产物"
docker run --rm --platform linux/${TARGET_ARCH} \
  -v "$OUTPUT_DIR":/output \
  ${APP_NAME}-exe-builder \
  cp /build/${APP_NAME}_setup_${VERSION}.exe /output/

print_step "清理临时文件"
rm "$DOCKERFILE"
rm "$SCRIPT_DIR/installer.nsi"

print_step "构建完成"
printf "输出文件：%s/%s_setup_%s.exe\n" "$OUTPUT_DIR" "$APP_NAME" "$VERSION"
printf "解压 zip 后，在 Windows 上运行 %s/%s.exe 即可启动。\n" "$APP_NAME" "$APP_NAME"
