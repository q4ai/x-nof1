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

print_step "对 JavaScript 进行高强度混淆"
JS_COUNT=$(find "$APP_PAYLOAD_DIR/dist" -type f -name "*.js" | wc -l | tr -d ' ')
if [[ "$JS_COUNT" == "0" ]]; then
  abort "在 $APP_PAYLOAD_DIR/dist 中未找到任何 JS 文件"
fi

find "$APP_PAYLOAD_DIR/dist" -type f -name "*.js" | while read -r js_file; do
  tmp_dir="${js_file}_obf"
  rm -rf "$tmp_dir"
  npx --yes javascript-obfuscator "$js_file" --output "$tmp_dir" \
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
    --unicode-escape-sequence true
  
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
