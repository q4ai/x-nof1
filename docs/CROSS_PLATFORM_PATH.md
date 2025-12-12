# 跨平台路径适配说明

## 问题背景

在 Windows exe 打包版本中，使用相对路径 `./data/database/sqlite.db` 会导致数据库连接失败，出现错误：
```
ConnectionFailed("Unable to open connection to local database ./data/database/sqlite.db: 14")
```

## 解决方案

已实现统一的跨平台路径管理模块 `src/utils/pathUtils.ts`，支持以下场景：

### 1. 开发模式 (npm run dev)
- 数据目录：`项目根目录/data`
- 数据库：`项目根目录/data/database/sqlite.db`

### 2. 打包模式 (Windows exe / macOS app / Linux binary)
- 数据目录：`exe文件所在目录/data`
- 数据库：`exe文件所在目录/data/database/sqlite.db`

### 3. Docker 容器模式
- 通过环境变量 `APP_DATA_DIR` 指定数据目录
- 例如：`APP_DATA_DIR=/app/data`

## 路径工具 API

### `getAppDataPath(): string`
获取应用数据根目录（绝对路径）。

**优先级：**
1. 环境变量 `APP_DATA_DIR`（适用于 Docker/特殊部署）
2. 打包模式：`exe所在目录/data`
3. 开发模式：`项目根目录/data`

### `getDatabaseDir(): string`
获取数据库目录（绝对路径），自动创建目录。

**返回示例：**
- Windows: `C:\Users\Admin\q4-ai-trading-platform\data\database`
- macOS: `/Applications/q4-ai-trading-platform.app/Contents/data/database`
- Linux: `/opt/q4-ai-trading-platform/data/database`

### `getDatabaseUrl(): string`
获取主数据库 URL（用于 @libsql/client）。

**返回示例：**
```typescript
// Windows
"file:C:/Users/Admin/q4-ai-trading-platform/data/database/sqlite.db"

// macOS
"file:/Applications/q4-ai-trading-platform.app/Contents/data/database/sqlite.db"

// Linux
"file:/opt/q4-ai-trading-platform/data/database/sqlite.db"
```

### `getStrategiesDir(): string`
获取策略文件目录（绝对路径），自动创建目录。

### `getCredentialsPath(): string`
获取管理员凭证文件路径（绝对路径）。

### `getInstallLockPath(): string`
获取安装锁文件路径（绝对路径）。

## 使用方法

### ✅ 正确做法
```typescript
import { getDatabaseUrl } from "./utils/pathUtils";

const dbClient = createClient({
  url: getDatabaseUrl(),
});
```

### ❌ 错误做法
```typescript
// 不要直接使用相对路径！
const dbClient = createClient({
  url: "file:./data/database/sqlite.db",
});

// 不要使用 process.cwd()！
const dbPath = path.join(process.cwd(), "data/database/sqlite.db");
```

## 已修改的文件

以下文件已替换为跨平台路径：

### 核心模块
- ✅ `src/database/init.ts` - 数据库初始化
- ✅ `src/services/installService.ts` - 安装服务
- ✅ `src/utils/adminAuth.ts` - 管理员认证

### 服务层
- ✅ `src/services/dashboardDataService.ts`
- ✅ `src/services/accountConfigService.ts`
- ✅ `src/services/aiModelService.ts`
- ✅ `src/services/tradingInstanceService.ts`

### 调度器
- ✅ `src/scheduler/multiInstanceTradingLoop.ts`
- ✅ `src/scheduler/accountRecorder.ts`
- ✅ `src/scheduler/contractMultiplierSync.ts`
- ✅ `src/scheduler/tradingSystemInit.ts`
- ✅ `src/scheduler/communityReporter.ts`
- ✅ `src/scheduler/instanceExecutor.ts`

### 工具层
- ✅ `src/tools/trading/accountManagement.ts`
- ✅ `src/tools/trading/tradeExecution.ts`
- ✅ `src/utils/tradeLogUtils.ts`
- ✅ `src/utils/contractUtils.ts`

### API 路由
- ✅ `src/api/routes.ts`

### 数据库迁移
- ✅ `src/database/init-config.ts`
- ✅ `src/database/binancePrecision.ts`
- ✅ `src/database/migrate-dual-position.ts`
- ✅ `src/database/migrate-add-account-id.ts`
- ✅ `src/database/migrate-add-ai-models.ts`
- ✅ `src/database/migrate-remove-provider-from-ai-models.ts`
- ✅ `src/database/migrate-add-account-id-to-signals.ts`
- ✅ `src/database/migrate-add-risk-to-accounts.ts`

### Agent
- ✅ `src/agents/tradingAgent.ts` - 交易记忆数据库

## 环境变量支持

### `DATABASE_URL`（向后兼容）
如果设置了此环境变量，将优先使用其值。适用于以下场景：
- 使用远程数据库（Turso/LibSQL Cloud）
- 自定义数据库路径

**示例：**
```bash
# 本地数据库（绝对路径）
DATABASE_URL="file:/custom/path/sqlite.db"

# 远程数据库
DATABASE_URL="libsql://my-db.turso.io"
```

### `APP_DATA_DIR`（推荐）
指定应用数据根目录，适用于 Docker 或特殊部署场景。

**示例：**
```bash
# Docker 容器
APP_DATA_DIR="/app/data"

# Windows 自定义路径
APP_DATA_DIR="D:\AppData\Q4-AI-Trading"

# Linux 系统路径
APP_DATA_DIR="/var/lib/q4-ai-trading"
```

## 测试验证

运行测试脚本验证路径：
```bash
npx tsx test-path-utils.ts
```

输出示例：
```
===== 路径工具测试 =====
运行环境: win32
执行路径: C:\Program Files\q4-ai-trading-platform\q4-ai-trading-platform.exe
工作目录: C:\Users\Admin
是否打包: true

===== 数据目录 =====
APP_DATA_PATH: C:\Program Files\q4-ai-trading-platform\data
DATABASE_DIR: C:\Program Files\q4-ai-trading-platform\data\database
DATABASE_URL: file:C:/Program Files/q4-ai-trading-platform/data/database/sqlite.db
STRATEGIES_DIR: C:\Program Files\q4-ai-trading-platform\data\strategies
CREDENTIALS_PATH: C:\Program Files\q4-ai-trading-platform\.q4ai
INSTALL_LOCK_PATH: C:\Program Files\q4-ai-trading-platform\data\install.lock
```

## Windows 安装注意事项

### 1. 目录权限
Windows exe 安装后，默认在以下位置创建数据目录：
- **安装到 Program Files**（需要管理员权限）：
  - 数据目录：`C:\Program Files\q4-ai-trading-platform\data\`
  - **问题**：普通用户可能无写入权限
  - **解决**：安装时授予 `data` 目录完全控制权限

- **安装到用户目录**（推荐）：
  - 数据目录：`C:\Users\YourName\AppData\Local\q4-ai-trading-platform\data\`
  - **优势**：无需管理员权限

### 2. NSIS 安装脚本修改
建议在 `compile/nsis-installer.nsi` 中添加：
```nsi
; 创建数据目录并设置权限
CreateDirectory "$INSTDIR\data"
CreateDirectory "$INSTDIR\data\database"
CreateDirectory "$INSTDIR\data\strategies"

; 为数据目录授予完全控制权限
AccessControl::GrantOnFile "$INSTDIR\data" "(BU)" "FullAccess"
```

### 3. 首次运行
Windows exe 首次运行时，会自动：
1. 检测安装路径（`process.execPath` 所在目录）
2. 创建 `data/database` 目录
3. 初始化 `sqlite.db` 数据库
4. 创建 `install.lock` 文件

## macOS 打包注意事项

### App Bundle 结构
```
Q4-AI-Trading.app/
├── Contents/
│   ├── MacOS/
│   │   └── q4-ai-trading-platform  (可执行文件)
│   └── data/                       (数据目录)
│       ├── database/
│       │   └── sqlite.db
│       └── strategies/
```

### 沙盒权限
如果启用 macOS 沙盒，需要在 `entitlements.plist` 中添加：
```xml
<key>com.apple.security.files.user-selected.read-write</key>
<true/>
```

## Linux 打包注意事项

### 推荐安装路径
- **系统级安装**：`/opt/q4-ai-trading-platform/`
- **用户级安装**：`~/.local/share/q4-ai-trading-platform/`

### systemd 服务配置
```ini
[Service]
Environment="APP_DATA_DIR=/var/lib/q4-ai-trading"
WorkingDirectory=/opt/q4-ai-trading-platform
ExecStart=/opt/q4-ai-trading-platform/q4-ai-trading-platform
```

## 常见问题

### Q1: Windows exe 提示 "Unable to open connection"
**原因**：数据目录权限不足或路径包含中文/特殊字符。

**解决方法**：
1. 以管理员身份运行一次程序
2. 或安装到用户目录（如 `C:\Users\YourName\AppData\Local\`）
3. 避免安装路径包含中文字符

### Q2: 数据库文件找不到
**原因**：工作目录与预期不符。

**调试方法**：
```bash
# 查看实际路径
npx tsx test-path-utils.ts
```

### Q3: Docker 容器中数据持久化
**解决方法**：
```bash
docker run -v /host/data:/app/data \
  -e APP_DATA_DIR=/app/data \
  q4-ai-trading-platform
```

## 回滚方案

如果遇到兼容性问题，可临时设置环境变量回退到旧路径：
```bash
# Windows
set DATABASE_URL=file:./data/database/sqlite.db

# macOS/Linux
export DATABASE_URL="file:./data/database/sqlite.db"
```

## 更新日志

### 2025-12-09
- ✅ 实现统一的跨平台路径管理模块
- ✅ 替换所有硬编码相对路径为绝对路径
- ✅ 支持 pkg 打包环境检测
- ✅ 向后兼容环境变量配置
- ✅ 添加路径测试工具
