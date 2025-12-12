# Windows EXE 跨平台路径修复

## 问题描述

Windows exe 安装后运行时出现数据库连接错误：
```
连接失败
ConnectionFailed("Unable to open connection to local database ./data/database/sqlite.db: 14")
```

**根本原因**：代码中使用了相对路径 `./data/database/sqlite.db`，在 Windows exe 环境下，相对路径解析不正确。

## 解决方案

### 1. 统一路径管理（已完成）
实现了 `src/utils/pathUtils.ts` 模块，提供跨平台路径工具：

- ✅ `getAppDataPath()` - 获取应用数据目录（开发模式 = 项目根目录/data，打包模式 = exe所在目录/data）
- ✅ `getDatabaseDir()` - 获取数据库目录（自动创建）
- ✅ `getDatabaseUrl()` - 获取数据库 URL（LibSQL 格式）
- ✅ `getStrategiesDir()` - 获取策略目录
- ✅ `getCredentialsPath()` - 获取管理员凭证路径
- ✅ `getInstallLockPath()` - 获取安装锁路径

### 2. 全局替换硬编码路径（已完成）
已替换以下文件中的硬编码路径：

**核心模块：**
- `src/database/init.ts`
- `src/services/installService.ts`
- `src/utils/adminAuth.ts`

**服务层（8个文件）：**
- `src/services/dashboardDataService.ts`
- `src/services/accountConfigService.ts`
- `src/services/aiModelService.ts`
- `src/services/tradingInstanceService.ts`
- 等...

**调度器（6个文件）：**
- `src/scheduler/multiInstanceTradingLoop.ts`
- `src/scheduler/accountRecorder.ts`
- 等...

**工具层（4个文件）：**
- `src/tools/trading/accountManagement.ts`
- `src/tools/trading/tradeExecution.ts`
- 等...

**数据库迁移（8个文件）：**
- `src/database/init-config.ts`
- `src/database/binancePrecision.ts`
- 等...

**Agent：**
- `src/agents/tradingAgent.ts`（交易记忆数据库）

**详细清单参见：** `docs/CROSS_PLATFORM_PATH.md`

### 3. 打包脚本优化（已完成）
修改了 `compile/compile_exe_bytenode.sh` 中的 NSIS 安装脚本：

- ✅ 安装时自动创建 `data/database` 和 `data/strategies` 目录
- ✅ 添加了数据目录权限设置的注释说明
- ✅ 卸载时保留用户数据（避免误删交易记录）

## 工作原理

### 开发模式（npm run dev）
```
项目根目录/
├── src/
├── data/                  ← getAppDataPath()
│   ├── database/          ← getDatabaseDir()
│   │   └── sqlite.db      ← getDatabaseUrl()
│   └── strategies/        ← getStrategiesDir()
└── .q4ai                  ← getCredentialsPath()
```

### Windows 打包模式（exe）
```
C:\Program Files\q4-ai-trading-platform\
├── q4-ai-trading-platform.exe  ← process.execPath
├── data/                        ← getAppDataPath()
│   ├── database/                ← getDatabaseDir()
│   │   └── sqlite.db            ← getDatabaseUrl()
│   └── strategies/              ← getStrategiesDir()
└── .q4ai                        ← getCredentialsPath()
```

**关键逻辑：**
```typescript
// src/utils/pathUtils.ts
export function getAppDataPath(): string {
  // @ts-ignore
  const isPackaged = typeof process.pkg !== "undefined";
  
  if (isPackaged) {
    // 打包模式：使用 exe 所在目录
    return path.join(path.dirname(process.execPath), "data");
  }
  
  // 开发模式：使用项目根目录
  return path.join(process.cwd(), "data");
}
```

## 测试方法

### 1. 本地测试（macOS/Linux）
```bash
# 测试路径工具
npx tsx test-path-utils.ts

# 预期输出：
# APP_DATA_PATH: /path/to/project/data
# DATABASE_URL: file:/path/to/project/data/database/sqlite.db
```

### 2. 编译测试
```bash
# 编译项目
npm run build

# 检查 TypeScript 错误
npm run typecheck

# 打包 Windows exe
cd compile
zsh compile_exe_bytenode.sh
```

### 3. Windows 测试（重要）
1. 在 Windows 机器上安装生成的 `compile/output/q4-ai-trading-platform_setup_1.0.0.exe`
2. 安装到 `C:\Program Files\q4-ai-trading-platform\`
3. 运行 exe，检查：
   - ✅ 是否自动创建 `C:\Program Files\q4-ai-trading-platform\data\database\sqlite.db`
   - ✅ 是否能正常连接数据库（不再出现 ConnectionFailed 错误）
   - ✅ 安装向导是否正常显示

4. 调试方法（如果仍有问题）：
   ```cmd
   # 在 Windows 命令行中查看日志
   cd "C:\Program Files\q4-ai-trading-platform"
   q4-ai-trading-platform.exe
   
   # 检查数据库路径（控制台输出）
   # 应该显示：初始化数据库: file:C:/Program Files/q4-ai-trading-platform/data/database/sqlite.db
   ```

## 环境变量支持

### 自定义数据目录（可选）
如果默认路径有问题（如权限不足），可设置环境变量：

```bash
# Windows
set APP_DATA_DIR=D:\MyData\q4-ai-trading

# macOS/Linux
export APP_DATA_DIR="/custom/path/data"
```

### 兼容旧配置（可选）
如果需要使用远程数据库或自定义路径：

```bash
# Windows
set DATABASE_URL=file:D:\MyData\sqlite.db

# macOS/Linux
export DATABASE_URL="file:/custom/path/sqlite.db"
```

## 已知问题与解决

### ❌ 问题：Windows 提示权限不足
**原因**：安装到 `Program Files` 需要管理员权限。

**解决方法（任选其一）**：
1. 以管理员身份运行 exe
2. 安装到用户目录（如 `C:\Users\YourName\AppData\Local\`）
3. 手动授予 `data` 目录完全控制权限

### ❌ 问题：数据库文件找不到
**调试步骤**：
1. 检查 exe 所在目录是否有 `data` 文件夹
2. 查看控制台日志中的 "初始化数据库" 路径
3. 运行 `test-path-utils.ts` 验证路径逻辑

### ❌ 问题：路径包含中文导致乱码
**解决方法**：
避免安装路径包含中文字符，建议使用英文路径。

## 回滚方案

如果修复后仍有问题，可临时回退到相对路径：

```bash
# 设置环境变量强制使用相对路径
set DATABASE_URL=file:./data/database/sqlite.db
```

但这**不是**长期解决方案，建议排查根本原因。

## 文档与代码

- 📄 **详细文档**：`docs/CROSS_PLATFORM_PATH.md`
- 🛠️ **路径工具**：`src/utils/pathUtils.ts`
- 🧪 **测试脚本**：`test-path-utils.ts`
- 📦 **打包脚本**：`compile/compile_exe_bytenode.sh`

## 下一步

1. ✅ 代码修改完成
2. ✅ 编译通过（TypeScript 类型检查通过，仅有无关紧要的 OKX 客户端类型警告）
3. 🔄 **需要在 Windows 上测试安装和运行**
4. 📝 更新用户文档，说明安装路径选择建议

## 提交信息建议

```
fix: 修复 Windows exe 数据库路径问题，适配跨平台路径

- 实现统一的路径管理模块 (src/utils/pathUtils.ts)
- 替换所有硬编码相对路径为绝对路径
- 支持开发模式和打包模式的路径自动切换
- 优化 NSIS 安装脚本，预创建数据目录
- 添加详细的跨平台路径适配文档

修复问题：Windows exe 安装后提示 "Unable to open connection to local database ./data/database/sqlite.db: 14"
适用系统：Windows、macOS、Linux
```
