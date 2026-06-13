#!/bin/zsh
set -euo pipefail

APP_NAME="q4-ai-trading-platform"
DEFAULT_PORT="3888"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILD_ROOT="$SCRIPT_DIR/build"
DMG_STAGING="$SCRIPT_DIR/dmg_staging"
OUTPUT_DIR="$SCRIPT_DIR/output"
APP_BUNDLE="$BUILD_ROOT/${APP_NAME}.app"
CONTENTS_DIR="$APP_BUNDLE/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"
RESOURCES_DIR="$CONTENTS_DIR/Resources"
APP_PAYLOAD_DIR="$RESOURCES_DIR/app"
INFO_PLIST="$CONTENTS_DIR/Info.plist"
RUNTIME_SCRIPT="$MACOS_DIR/$APP_NAME"
LOCKFILE="package-lock.json"
PACKAGE_FILE="package.json"

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
if [[ "$(uname -s)" != "Darwin" ]]; then
  abort "该脚本仅支持在 macOS 上运行"
fi

require_cmd "node"
require_cmd "npm"
require_cmd "npx"
require_cmd "hdiutil"
require_cmd "rsync"
require_cmd "find"

ARCH="$(uname -m)"
if [[ "$ARCH" != "arm64" ]]; then
  printf "⚠️ 检测到非 arm64 架构 (%s)，继续执行但生成的二进制可能不适用于 Apple Silicon\n" "$ARCH"
fi

env | grep -q ^NOF1_PORT= || export NOF1_PORT="$DEFAULT_PORT"

print_step "安装依赖并构建项目"
pushd "$REPO_ROOT" >/dev/null
npm install
npm run build
popd >/dev/null

print_step "定位构建产物"
SOURCE_JS_DIR=""
for candidate in dist build out; do
  if [[ -d "$REPO_ROOT/$candidate" ]]; then
    SOURCE_JS_DIR="$REPO_ROOT/$candidate"
    break
  fi
done

if [[ -z "$SOURCE_JS_DIR" ]]; then
  abort "未找到构建目录（dist/build/out），请确认 npm run build 生成了产物"
fi

print_step "清理旧产物"
rm -rf "$BUILD_ROOT" "$DMG_STAGING" "$OUTPUT_DIR"
mkdir -p "$APP_PAYLOAD_DIR" "$MACOS_DIR" "$RESOURCES_DIR" "$OUTPUT_DIR" "$DMG_STAGING"

print_step "复制运行时文件"
mkdir -p "$APP_PAYLOAD_DIR/dist"
rsync -a --exclude node_modules --exclude compile --exclude .git "$SOURCE_JS_DIR"/ "$APP_PAYLOAD_DIR/dist"/
cp -R "$REPO_ROOT/public" "$APP_PAYLOAD_DIR/"
mkdir -p "$APP_PAYLOAD_DIR/data/database"
mkdir -p "$APP_PAYLOAD_DIR/data/backup"
mkdir -p "$APP_PAYLOAD_DIR/data/strategies"
cp "$REPO_ROOT/$PACKAGE_FILE" "$APP_PAYLOAD_DIR/" 2>/dev/null || true
cp "$REPO_ROOT/$LOCKFILE" "$APP_PAYLOAD_DIR/" 2>/dev/null || true

print_step "第一步：删除 source map 文件（防止源码泄露）"
find "$APP_PAYLOAD_DIR/dist" -type f -name "*.map" -delete
find "$APP_PAYLOAD_DIR/public" -type f -name "*.map" -delete
printf "已删除所有 .map 文件\n"

print_step "第二步：混淆文件名（隐藏模块用途）"
# 将关键路径作为环境变量显式传递给 Python 子进程（避免 zsh 局部变量未 export 导致找不到目录）
export APP_PAYLOAD_DIR
export APP_NAME
python3 <<'PYEOF'
import os
import re
import hashlib
import random

# 优先使用环境变量，否则用脚本里 hardcoded 的 fallback（与 shell 端保持一致）
default_dir = "build/q4-ai-trading-platform.app/Contents/Resources/app"
dist_dir = os.environ.get("APP_PAYLOAD_DIR", default_dir) + "/dist"
if not os.path.isdir(dist_dir):
    raise SystemExit(f"[obfuscate] 目录不存在: {dist_dir} (APP_PAYLOAD_DIR={os.environ.get('APP_PAYLOAD_DIR')!r})")
file_mapping = {}

print("=" * 60)
print("开始文件名混淆...")
print("=" * 60)

for filename in os.listdir(dist_dir):
    filepath = os.path.join(dist_dir, filename)
    if os.path.isdir(filepath) or filename == "index.js":
        continue
    if filename.endswith(".js"):
        random_hash = hashlib.md5(f"{filename}{random.random()}".encode()).hexdigest()[:12]
        new_filename = f"_{random_hash}.js"
        file_mapping[filename] = new_filename

print(f"找到 {len(file_mapping)} 个需要混淆的文件")

if file_mapping:
    print("\n更新文件引用...")
    updated_files = 0
    for root, dirs, files in os.walk(dist_dir):
        for file in files:
            if file.endswith(".js"):
                filepath = os.path.join(root, file)
                try:
                    with open(filepath, "r", encoding="utf-8") as f:
                        content = f.read()
                except:
                    continue
                original_content = content
                for old_name, new_name in file_mapping.items():
                    escaped_old = re.escape(old_name)
                    patterns = [
                        (rf'(import\s+["\'])(\.\/)({escaped_old})(["\'])', rf'\1\2{new_name}\4'),
                        (rf'(from\s+["\'])(\.\/)({escaped_old})(["\'])', rf'\1\2{new_name}\4'),
                        (rf'(require\(["\'])(\.\/)({escaped_old})(["\'])', rf'\1\2{new_name}\4'),
                    ]
                    for pattern, replacement in patterns:
                        content = re.sub(pattern, replacement, content)
                if content != original_content:
                    with open(filepath, "w", encoding="utf-8") as f:
                        f.write(content)
                    updated_files += 1
    print(f"更新了 {updated_files} 个文件的引用")
    
    print("\n重命名文件...")
    renamed_count = 0
    for old_name, new_name in file_mapping.items():
        old_path = os.path.join(dist_dir, old_name)
        new_path = os.path.join(dist_dir, new_name)
        if os.path.exists(old_path):
            os.rename(old_path, new_path)
            renamed_count += 1
    print(f"成功重命名 {renamed_count} 个文件")

print("=" * 60)
print("文件名混淆完成！")
print("=" * 60)
PYEOF

print_step "第三步：对 JavaScript 进行高强度代码混淆"
JS_COUNT=$(find "$APP_PAYLOAD_DIR/dist" -type f -name "*.js" | wc -l | tr -d ' ')
if [[ "$JS_COUNT" == "0" ]]; then
  abort "在 $APP_PAYLOAD_DIR/dist 中未找到任何 JS 文件"
fi

find "$APP_PAYLOAD_DIR/dist" -type f -name "*.js" | while read -r js_file; do
  tmp_dir="${js_file}_obf"
  rm -rf "$tmp_dir"
  npx --yes javascript-obfuscator "$js_file" --output "$tmp_dir" \
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
    --unicode-escape-sequence true \
    --target node
  
  mv "$tmp_dir/$(basename "$js_file")" "$js_file"
  rm -rf "$tmp_dir"
done

print_step "安装生产依赖"
if [[ -f "$APP_PAYLOAD_DIR/$PACKAGE_FILE" ]]; then
  npm install --omit=dev --prefix "$APP_PAYLOAD_DIR"
fi

print_step "生成 Info.plist"
cat > "$INFO_PLIST" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>CFBundleDevelopmentRegion</key>
    <string>en</string>
    <key>CFBundleExecutable</key>
    <string>nof1.ai</string>
    <key>CFBundleIdentifier</key>
    <string>ai.nof1.launcher</string>
    <key>CFBundleInfoDictionaryVersion</key>
    <string>6.0</string>
    <key>CFBundleName</key>
    <string>nof1.ai</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0.0</string>
    <key>LSMinimumSystemVersion</key>
    <string>13.0</string>
  </dict>
</plist>
EOF

print_step "创建启动脚本"
cat > "$RUNTIME_SCRIPT" <<'EOF'
#!/bin/zsh
set -euo pipefail
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_ROOT="$APP_DIR/Resources/app"
export PORT="${NOF1_PORT:-3888}"
export NODE_ENV="production"
cd "$APP_ROOT"
if [[ ! -d node_modules ]]; then
  npm install --omit=dev
fi
if node -e "const fs=require('fs');const p='package.json';if(fs.existsSync(p)){const data=JSON.parse(fs.readFileSync(p,'utf8'));if(data.scripts && data.scripts.start){process.exit(0);} }process.exit(1);" >/dev/null 2>&1; then
  exec npm run start
fi
exec node dist/index.js
EOF

chmod +x "$RUNTIME_SCRIPT"

print_step "准备 DMG 内容"
cp -R "$APP_BUNDLE" "$DMG_STAGING/"
DMG_PATH="$OUTPUT_DIR/${APP_NAME}.dmg"

print_step "创建 DMG ($DMG_PATH)"
hdiutil create -volname "$APP_NAME" -srcfolder "$DMG_STAGING" -ov -format UDZO "$DMG_PATH"

print_step "DMG 构建完成"
printf "输出文件：%s\n" "$DMG_PATH"
printf "挂载 DMG 后运行 %s 即可启动服务，并通过 http://127.0.0.1:${NOF1_PORT}/ 或 3888 访问。\n" "$APP_NAME"
