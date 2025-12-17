#!/bin/zsh
set -euo pipefail

APP_NAME="q4-ai-trading-platform"
VERSION="1.0.0"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT_DIR="$SCRIPT_DIR/output"
DOCKERFILE_NAME="Dockerfile.bytenode"
DOCKERFILE="$SCRIPT_DIR/$DOCKERFILE_NAME"
DOCKERFILE_IN_CONTEXT="compile/$DOCKERFILE_NAME"
TARGET_ARCH="amd64"

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
require_cmd "python3"
mkdir -p "$OUTPUT_DIR"

print_step "生成 NSIS 安装脚本"
cat > "$SCRIPT_DIR/installer.nsi" <<NSI
!include "MUI2.nsh"

Name "${APP_NAME}"
OutFile "${APP_NAME}_setup_${VERSION}.exe"
InstallDir "\$PROGRAMFILES64\\${APP_NAME}"
InstallDirRegKey HKCU "Software\\${APP_NAME}" ""
RequestExecutionLevel admin

; 自定义图标（如果存在）
!if /FileExists "app-icon.ico"
  !define MUI_ICON "app-icon.ico"
  !define MUI_UNICON "app-icon.ico"
!endif

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

  ; 创建数据目录（用于跨平台路径支持）
  ; 应用启动时会自动检测 exe 所在目录，并在同级创建 data/database 目录
  ; 这样 Windows、macOS、Linux 都能正确找到数据库路径
  CreateDirectory "\$INSTDIR\\data"
  CreateDirectory "\$INSTDIR\\data\\database"
  CreateDirectory "\$INSTDIR\\data\\strategies"
  
  ; 注意：NSIS AccessControl 插件需要单独安装，此处仅作为注释说明
  ; 如需启用，请安装 AccessControl 插件并取消下行注释：
  ; AccessControl::GrantOnFile "\$INSTDIR\\data" "(BU)" "FullAccess"

  ; Create shortcuts
  CreateDirectory "\$SMPROGRAMS\\${APP_NAME}"
  
  ; 优先使用独立 .ico，若不存在则使用 EXE 内嵌图标
  \${If} \${FileExists} "\$INSTDIR\\app-icon.ico"
    CreateShortcut "\$SMPROGRAMS\\${APP_NAME}\\${APP_NAME}.lnk" "\$INSTDIR\\${APP_NAME}.exe" "" "\$INSTDIR\\app-icon.ico" 0
    CreateShortcut "\$DESKTOP\\${APP_NAME}.lnk" "\$INSTDIR\\${APP_NAME}.exe" "" "\$INSTDIR\\app-icon.ico" 0
  \${Else}
    CreateShortcut "\$SMPROGRAMS\\${APP_NAME}\\${APP_NAME}.lnk" "\$INSTDIR\\${APP_NAME}.exe" "" "\$INSTDIR\\${APP_NAME}.exe" 0
    CreateShortcut "\$DESKTOP\\${APP_NAME}.lnk" "\$INSTDIR\\${APP_NAME}.exe" "" "\$INSTDIR\\${APP_NAME}.exe" 0
  \${EndIf}
  
  CreateShortcut "\$SMPROGRAMS\\${APP_NAME}\\Uninstall.lnk" "\$INSTDIR\\Uninstall.exe"

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
  
  ; 卸载时保留用户数据（避免误删交易数据）
  ; 如需完全清除，用户可手动删除 data 目录
  ; RMDir /r "\$INSTDIR\\data"

  Delete "\$SMPROGRAMS\\${APP_NAME}\\${APP_NAME}.lnk"
  Delete "\$SMPROGRAMS\\${APP_NAME}\\Uninstall.lnk"
  RMDir "\$SMPROGRAMS\\${APP_NAME}"
  Delete "\$DESKTOP\\${APP_NAME}.lnk"

  DeleteRegKey HKCU "Software\\${APP_NAME}"
  DeleteRegKey HKLM "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${APP_NAME}"
  RMDir "\$INSTDIR"
SectionEnd
NSI

print_step "生成 Bytenode 构建 Dockerfile"
cat > "$DOCKERFILE" <<'DOCKERFILE'
FROM --platform=linux/@@TARGET_ARCH@@ node:20-bullseye

WORKDIR /build

RUN apt-get update && apt-get install -y \
  curl \
  rsync \
  nsis \
  && rm -rf /var/lib/apt/lists/*

COPY . .
RUN rm -rf node_modules

RUN sed -i 's/"type": "module",//' package.json
RUN sed -i 's/outDir: "dist",/outDir: "dist", format: "cjs",/' tsdown.config.ts
RUN sed -i 's/await main();/main().catch(console.error);/' src/index.ts

# 配置 npm 以提高网络稳定性
RUN npm config set registry https://registry.npmmirror.com/ \
    && npm config set fetch-retry-maxtimeout 120000 \
    && npm config set fetch-retry-mintimeout 20000 \
    && npm config set fetch-retries 5 \
    && npm config set fetch-timeout 300000

RUN npm install
RUN npm run build

ENV NODE_VERSION=18.5.0
RUN rm -rf /usr/local/bin/node /usr/local/bin/npm /usr/local/bin/npx /usr/local/lib/node_modules \
    && curl -fsSL https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz -o /tmp/node.tar.xz \
    && tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 \
    && rm /tmp/node.tar.xz

RUN npm install -g javascript-obfuscator pkg bytenode resedit

ENV APP_ROOT=/build/exe_package
RUN mkdir -p ${APP_ROOT}/dist \
    ${APP_ROOT}/public \
    ${APP_ROOT}/data/database \
    ${APP_ROOT}/data/backup \
    ${APP_ROOT}/data/strategies

RUN cp package.json package-lock.json ${APP_ROOT}/
RUN cp -R public/* ${APP_ROOT}/public/
RUN rsync -a --exclude node_modules --exclude compile --exclude .git dist/ ${APP_ROOT}/dist/
RUN mkdir -p ${APP_ROOT}/dist/strategies && cp -R src/strategies/*.json ${APP_ROOT}/dist/strategies/
RUN mkdir -p ${APP_ROOT}/dist/config && cp src/config/strategyTypes.ts ${APP_ROOT}/dist/config/
RUN mkdir -p ${APP_ROOT}/dist/language && cp -R src/language/*.json ${APP_ROOT}/dist/language/

WORKDIR ${APP_ROOT}
RUN npm install --omit=dev
RUN npm_config_platform=win32 npm_config_arch=x64 npm_config_force=1 npm install --no-save @libsql/win32-x64-msvc
RUN npm install --no-save bytenode
RUN npm install --no-save resedit

# 删除所有 source map 文件（避免暴露源代码映射）
RUN find dist -type f -name "*.map" -delete
RUN find public -type f -name "*.map" -delete

# 混淆文件名（将可读的文件名替换为随机哈希）
RUN python3 <<'PYEOF'
import os
import re
import hashlib
import random

dist_dir = "dist"
file_mapping = {}  # 旧文件名 -> 新文件名

print("=" * 60)
print("开始文件名混淆...")
print("=" * 60)

# 1. 生成文件名映射表（排除 index.js 和语言包目录）
for filename in os.listdir(dist_dir):
    filepath = os.path.join(dist_dir, filename)
    
    # 跳过 index.js（入口文件）和目录
    if os.path.isdir(filepath) or filename == "index.js":
        continue
    
    if filename.endswith(".js"):
        # 生成随机哈希文件名（12位）
        random_hash = hashlib.md5(f"{filename}{random.random()}".encode()).hexdigest()[:12]
        new_filename = f"_{random_hash}.js"
        file_mapping[filename] = new_filename

print(f"找到 {len(file_mapping)} 个需要混淆的文件")

# 2. 更新所有 JS 文件中的 import/require 语句
print("\n更新文件引用...")
updated_files = 0

for root, dirs, files in os.walk(dist_dir):
    for file in files:
        if file.endswith(".js"):
            filepath = os.path.join(root, file)
            
            try:
                with open(filepath, "r", encoding="utf-8") as f:
                    content = f.read()
            except Exception as e:
                print(f"警告：无法读取 {filepath}: {e}")
                continue
            
            original_content = content
            
            # 替换文件内容中的引用
            for old_name, new_name in file_mapping.items():
                # 转义特殊字符
                escaped_old = re.escape(old_name)
                
                # 匹配各种 import/require 模式
                patterns = [
                    # import "./file.js" 或 import './file.js'
                    (rf'(import\s+["\'])(\.\/)({escaped_old})(["\'])', rf'\1\2{new_name}\4'),
                    # from "./file.js" 或 from './file.js'
                    (rf'(from\s+["\'])(\.\/)({escaped_old})(["\'])', rf'\1\2{new_name}\4'),
                    # require("./file.js") 或 require('./file.js')
                    (rf'(require\(["\'])(\.\/)({escaped_old})(["\'])', rf'\1\2{new_name}\4'),
                ]
                
                for pattern, replacement in patterns:
                    content = re.sub(pattern, replacement, content)
            
            # 如果有修改，写回文件
            if content != original_content:
                try:
                    with open(filepath, "w", encoding="utf-8") as f:
                        f.write(content)
                    updated_files += 1
                except Exception as e:
                    print(f"警告：无法写入 {filepath}: {e}")

print(f"更新了 {updated_files} 个文件的引用")

# 3. 重命名文件
print("\n重命名文件...")
renamed_count = 0

for old_name, new_name in file_mapping.items():
    old_path = os.path.join(dist_dir, old_name)
    new_path = os.path.join(dist_dir, new_name)
    
    if os.path.exists(old_path):
        try:
            os.rename(old_path, new_path)
            renamed_count += 1
        except Exception as e:
            print(f"警告：无法重命名 {old_name}: {e}")

print(f"成功重命名 {renamed_count} 个文件")
print("=" * 60)
print("文件名混淆完成！")
print("=" * 60)
PYEOF

# 对 dist 中的 JS 进行深度混淆（不使用 bytenode）
RUN find dist -type f -name "*.js" | while read -r js_file; do \
      tmp_dir="${js_file}_obf"; \
      rm -rf "$tmp_dir"; \
      javascript-obfuscator "$js_file" --output "$tmp_dir" \
        --compact true \
        --control-flow-flattening true \
        --control-flow-flattening-threshold 0.75 \
        --dead-code-injection true \
        --dead-code-injection-threshold 0.4 \
        --identifier-names-generator hexadecimal \
        --string-array true \
        --string-array-encoding rc4 \
        --string-array-threshold 1 \
        --transform-object-keys true \
        --unicode-escape-sequence true; \
      mv "$tmp_dir/$(basename "$js_file")" "$js_file"; \
      rm -rf "$tmp_dir"; \
    done

# 对前端 JS 资源执行混淆
RUN find public -type f -name "*.js" | while read -r js_file; do \
      tmp_dir="${js_file}_obf"; \
      rm -rf "$tmp_dir"; \
      javascript-obfuscator "$js_file" --output "$tmp_dir" \
        --compact true \
        --identifier-names-generator hexadecimal \
        --string-array-rotate true \
        --simplify true \
        --split-strings true \
        --string-array true \
        --string-array-encoding rc4 \
        --string-array-threshold 1 \
        --transform-object-keys true \
        --unicode-escape-sequence true; \
      mv "$tmp_dir/$(basename "$js_file")" "$js_file"; \
      rm -rf "$tmp_dir"; \
    done

# 对前端 HTML 文件进行压缩混淆
RUN apt-get update && apt-get install -y python3 && rm -rf /var/lib/apt/lists/*
RUN find public -type f -name "*.html" -exec python3 -c '\
import re, sys; \
content = open(sys.argv[1], "r", encoding="utf-8").read(); \
content = re.sub(r"<!--.*?-->", "", content, flags=re.DOTALL); \
content = re.sub(r"\\s+", " ", content); \
content = re.sub(r">\\s+<", "><", content); \
open(sys.argv[1], "w", encoding="utf-8").write(content.strip())' {} \;

WORKDIR ${APP_ROOT}
RUN echo '{ \
  "name": "@@APP_NAME@@", \
  "pkg": { \
    "scripts": [ \
      "node_modules/ws/**/*.js", \
      "node_modules/@libsql/**/*.js", \
      "node_modules/libsql/**/*.js", \
      "node_modules/@voltagent/**/*.js", \
      "node_modules/@modelcontextprotocol/**/*.js", \
      "node_modules/@ai-sdk/**/*.js", \
      "node_modules/@vercel/**/*.js", \
      "node_modules/ai/**/*.js", \
      "node_modules/pkce-challenge/**/*.js", \
      "node_modules/node-cron/**/*.js", \
      "node_modules/ccxt/**/*.js", \
      "node_modules/archiver/**/*.js", \
      "node_modules/unzipper/**/*.js", \
      "node_modules/pino/**/*.js", \
      "node_modules/pino-pretty/**/*.js", \
      "node_modules/@anthropic-ai/**/*.js", \
      "node_modules/zod/**/*.js", \
      "node_modules/dotenv/**/*.js", \
      "node_modules/bytenode/**/*.js", \
      "node_modules/undici/**/*.js" \
    ], \
    "assets": [ \
      "dist/**/*", \
      "public/**/*", \
      "node_modules/@libsql/**/*", \
      "node_modules/libsql/**/*", \
      "node_modules/@voltagent/**/*", \
      "node_modules/@modelcontextprotocol/**/*", \
      "node_modules/@ai-sdk/**/*", \
      "node_modules/@vercel/**/*", \
      "node_modules/ai/**/*", \
      "node_modules/pkce-challenge/**/*", \
      "node_modules/node-cron/**/*", \
      "node_modules/ccxt/**/*", \
      "node_modules/archiver/**/*", \
      "node_modules/unzipper/**/*", \
      "node_modules/pino/**/*", \
      "node_modules/pino-pretty/**/*", \
      "node_modules/@anthropic-ai/**/*", \
      "node_modules/zod/**/*", \
      "node_modules/dotenv/**/*", \
      "node_modules/bytenode/**/*", \
      "node_modules/undici/**/*" \
    ], \
    "targets": [ \
      "node18-win-x64" \
    ], \
    "outputPath": "output" \
  } \
}' > pkg-config.json

RUN pkg -c pkg-config.json --compress GZip dist/index.js -o output/@@APP_NAME@@.exe

# 如果存在自定义图标，使用 resedit 嵌入到 EXE 中
RUN if [ -f /build/compile/app-icon.ico ]; then \
      echo "=== 开始图标嵌入流程 ==="; \
      echo "图标文件路径: /build/compile/app-icon.ico"; \
      ls -lh /build/compile/app-icon.ico; \
      echo "原始 EXE 文件大小:"; \
      ls -lh output/@@APP_NAME@@.exe; \
      echo "正在将自定义图标嵌入 EXE..."; \
      node -e "(async () => { \
        const { ResEdit } = await import('resedit'); \
        const fs = require('fs'); \
        console.log('1. 读取 EXE 文件...'); \
        const exe = ResEdit.NtExecutable.from(fs.readFileSync('output/@@APP_NAME@@.exe')); \
        console.log('2. 解析 PE 资源...'); \
        const res = ResEdit.NtExecutableResource.from(exe); \
        console.log('3. 读取图标文件...'); \
        const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync('/build/compile/app-icon.ico')); \
        console.log('图标包含', iconFile.icons.length, '个尺寸'); \
        console.log('4. 替换图标资源...'); \
        ResEdit.Resource.IconGroupEntry.replaceIconsForResource( \
          res.entries, \
          1, \
          1033, \
          iconFile.icons.map((item) => item.data) \
        ); \
        console.log('5. 输出资源到 EXE...'); \
        res.outputResource(exe); \
        console.log('6. 生成新的 EXE 文件...'); \
        const newExeData = exe.generate(); \
        fs.writeFileSync('output/@@APP_NAME@@.exe', Buffer.from(newExeData)); \
        console.log('7. 完成！新 EXE 大小:', newExeData.byteLength, 'bytes'); \
      })();"; \
      echo "修改后 EXE 文件大小:"; \
      ls -lh output/@@APP_NAME@@.exe; \
      echo "=== 图标嵌入成功 ==="; \
    else \
      echo "⚠️  未找到 compile/app-icon.ico，使用默认图标"; \
      ls -la /build/compile/ || echo "compile 目录不存在"; \
    fi

RUN mkdir -p /build/nsis_input
RUN cp output/@@APP_NAME@@.exe /build/nsis_input/
RUN cp -R node_modules /build/nsis_input/
RUN cp -R public /build/nsis_input/
RUN cp -R data /build/nsis_input/
RUN cp package.json /build/nsis_input/

# 复制自定义图标（如果存在）
RUN if [ -f compile/app-icon.ico ]; then \
      cp compile/app-icon.ico /build/nsis_input/app-icon.ico; \
    fi

WORKDIR /build
RUN cp compile/installer.nsi .

# 如果有图标文件，复制到构建目录供 NSIS 使用
RUN if [ -f compile/app-icon.ico ]; then \
      cp compile/app-icon.ico .; \
    fi

RUN makensis installer.nsi
DOCKERFILE

print_step "写入 Dockerfile 变量"
APP_NAME="$APP_NAME" TARGET_ARCH="$TARGET_ARCH" DOCKERFILE="$DOCKERFILE" python3 <<'PY'
import os
from pathlib import Path
path = Path(os.environ['DOCKERFILE'])
text = path.read_text()
text = text.replace('@@APP_NAME@@', os.environ['APP_NAME'])
text = text.replace('@@TARGET_ARCH@@', os.environ['TARGET_ARCH'])
path.write_text(text)
PY

print_step "开始在 Docker 中构建 (Bytenode 模式)"
tar -c -C "$REPO_ROOT" \
    --exclude .git \
    --exclude node_modules \
    --exclude dist \
    --exclude build \
    --exclude compile/output \
    . | docker build --platform linux/${TARGET_ARCH} -t ${APP_NAME}-exe-bytenode -f "$DOCKERFILE_IN_CONTEXT" -

print_step "提取构建产物"
docker run --rm --platform linux/${TARGET_ARCH} \
  -v "$OUTPUT_DIR":/output \
  ${APP_NAME}-exe-bytenode \
  cp /build/${APP_NAME}_setup_${VERSION}.exe /output/

print_step "清理临时文件"
rm "$DOCKERFILE"
rm "$SCRIPT_DIR/installer.nsi"

print_step "构建完成"
printf "输出文件（安装包）：%s/%s_setup_%s.exe\n" "$OUTPUT_DIR" "$APP_NAME" "$VERSION"
printf "请在 Windows 上直接运行安装包完成安装，安装后通过开始菜单或桌面快捷方式启动。\n"
