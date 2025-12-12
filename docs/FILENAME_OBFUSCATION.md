# 文件名混淆功能说明

## 问题背景

即使代码经过深度混淆，打包后的文件名仍然暴露了模块用途：
```
okxClient-CXERNcnA.js      # 暴露了这是 OKX 客户端
tradingAgent-CzjwoKkR.js   # 暴露了交易 Agent 逻辑
binanceClient-DVVJz0pb.js  # 暴露了 Binance 客户端
accountManagement.js       # 暴露了账户管理模块
```

攻击者可以通过文件名快速定位关键模块，降低逆向工程难度。

## 解决方案

实现文件名混淆，将所有可读文件名替换为随机哈希：

### 混淆前：
```
dist/
├── index.js                          # 入口文件（保留）
├── okxClient-CXERNcnA.js            # 可读文件名
├── tradingAgent-CzjwoKkR.js
├── binanceClient-DVVJz0pb.js
└── accountManagement-ABC123.js
```

### 混淆后：
```
dist/
├── index.js                          # 入口文件（保留）
├── _a7e09bf8a2d0.js                 # 完全随机
├── _58d56166129d.js
├── _e14f0a830446.js
└── _1d08ac39d4c6.js
```

## 实现原理

### 1. **生成文件名映射表**
```python
file_mapping = {}
for filename in os.listdir("dist"):
    if filename.endswith(".js") and filename != "index.js":
        # 生成 12 位随机哈希
        random_hash = hashlib.md5(f"{filename}{random.random()}".encode()).hexdigest()[:12]
        new_filename = f"_{random_hash}.js"
        file_mapping[filename] = new_filename
```

**示例映射：**
```python
{
  "okxClient-CXERNcnA.js": "_a7e09bf8a2d0.js",
  "tradingAgent-CzjwoKkR.js": "_58d56166129d.js",
  "binanceClient-DVVJz0pb.js": "_e14f0a830446.js"
}
```

### 2. **更新文件引用**
扫描所有 JS 文件，替换 import/require 语句中的文件名：

**原始代码：**
```javascript
import { OkxClient } from "./okxClient-CXERNcnA.js";
import { TradingAgent } from "./tradingAgent-CzjwoKkR.js";
```

**混淆后：**
```javascript
import { OkxClient } from "./_a7e09bf8a2d0.js";
import { TradingAgent } from "./_58d56166129d.js";
```

**支持的模式：**
- `import "./file.js"` 和 `import './file.js'`
- `import * as name from "./file.js"`
- `import { x } from "./file.js"`
- `require("./file.js")` 和 `require('./file.js')`

### 3. **重命名文件**
按照映射表重命名实际文件：
```python
os.rename("dist/okxClient-CXERNcnA.js", "dist/_a7e09bf8a2d0.js")
```

## 集成位置

在打包脚本 `compile/compile_exe_bytenode.sh` 中：

```bash
# 1. 删除 source map 文件
RUN find dist -type f -name "*.map" -delete

# 2. 混淆文件名（新增步骤）
RUN python3 <<'PYEOF'
# ... 文件名混淆代码 ...
PYEOF

# 3. 代码混淆
RUN javascript-obfuscator ...
```

**执行顺序很重要：**
1. ✅ 先混淆文件名（更新引用）
2. ✅ 再混淆代码内容（破坏可读性）

如果顺序反了，代码混淆后的 import 语句会变得难以识别和替换。

## 特殊处理

### 保留 `index.js`
入口文件 `index.js` 不混淆，因为：
- pkg 打包工具需要识别入口文件
- 即使混淆了也会在 package.json 或启动脚本中暴露

### 保留目录结构
仅混淆 `dist/` 根目录下的文件名，不影响：
- `dist/language/` 目录（语言包）
- 子目录中的文件（如果有）

### 哈希格式
使用 `_` 前缀 + 12 位十六进制：
- `_a7e09bf8a2d0.js`
- `_58d56166129d.js`

**为什么用下划线前缀？**
1. 避免文件名以数字开头（某些文件系统不支持）
2. 统一格式，易于识别混淆后的文件

## 安全性提升

### 攻击者视角（混淆前）
```
1. 看到 okxClient.js → 知道是 OKX 交易所客户端
2. 打开文件 → 看到 API 密钥处理逻辑
3. 定位下单函数 → 分析交易算法
```

### 攻击者视角（混淆后）
```
1. 看到 _a7e09bf8a2d0.js → 无法判断用途
2. 打开文件 → 代码已深度混淆，难以阅读
3. 需要逐个文件分析 → 逆向工程成本大幅增加
```

## 测试验证

### 本地测试
```bash
# 预览模式（不实际修改文件）
python3 test-filename-obfuscation.py

# 执行模式（实际修改 dist/ 目录）
python3 test-filename-obfuscation.py --execute
```

### Docker 打包测试
```bash
# 完整打包流程
cd compile
zsh compile_exe_bytenode.sh

# 检查 Docker 构建日志
# 应该看到：
# ============================================================
# 开始文件名混淆...
# ============================================================
# 找到 58 个需要混淆的文件
# 更新了 12 个文件的引用
# 成功重命名 58 个文件
```

### 验证混淆效果
```bash
# 解压打包后的 exe（Windows）
# 或检查 Docker 容器内的 dist 目录

# 应该看到：
ls dist/
# _a7e09bf8a2d0.js
# _58d56166129d.js
# _e14f0a830446.js
# index.js  （唯一保留的可读文件名）
```

## 已知限制

### 1. **动态导入不支持**
如果代码中使用动态 import：
```javascript
const moduleName = "okxClient-CXERNcnA.js";
import(`./${moduleName}`);  // ❌ 无法自动替换
```

**解决方法：** 避免使用动态导入，或手动维护映射表。

### 2. **外部引用问题**
如果 `node_modules/` 中的包直接引用了 dist 文件：
```javascript
// 某个第三方包的代码
require("../../dist/okxClient-CXERNcnA.js");  // ❌ 找不到
```

**解决方法：** 当前项目不存在此问题，因为 dist 文件仅内部引用。

### 3. **调试难度增加**
混淆后的错误堆栈：
```
Error: xxx
  at _a7e09bf8a2d0.js:15
  at _58d56166129d.js:42
```

**解决方法：** 保留一份未混淆的构建版本用于调试。

## 性能影响

- **编译时间**：增加约 2-3 秒（扫描和替换文件名）
- **运行时性能**：无影响（文件名只影响加载，不影响执行）
- **文件大小**：略微减小（文件名更短）

## 配置选项

如需调整混淆强度，修改脚本中的参数：

```python
# 哈希长度（默认 12 位）
random_hash = hashlib.md5(...).hexdigest()[:12]  # 改为 [:16] 可增加到 16 位

# 哈希算法（默认 MD5）
hashlib.md5(...)  # 可改为 hashlib.sha256(...) 

# 文件名前缀（默认 "_"）
new_filename = f"_{random_hash}.js"  # 可改为 f"module_{random_hash}.js"
```

## 与其他混淆技术对比

| 混淆方式 | 效果 | 难度 | 性能影响 |
|---------|------|------|---------|
| 文件名混淆 | 隐藏模块用途 | 低 | 无 |
| 代码混淆 (javascript-obfuscator) | 破坏可读性 | 中 | 略微增加 |
| 字节码编译 (bytenode) | 完全不可读 | 高 | 轻微降低 |
| 加壳保护 (UPX) | 防止静态分析 | 中 | 启动变慢 |

**推荐组合（当前方案）：**
✅ 文件名混淆 + ✅ 代码深度混淆 + ✅ 移除 source map

## 回滚方案

如果文件名混淆导致问题，可以临时禁用：

```bash
# 编辑 compile/compile_exe_bytenode.sh
# 注释掉文件名混淆部分（第 152-210 行）

# RUN python3 <<'PYEOF'
# ... 文件名混淆代码 ...
# PYEOF
```

## 安全检查清单

发布前确认：

- [ ] ✅ 文件名已混淆（仅 index.js 保留原名）
- [ ] ✅ import/require 语句已更新
- [ ] ✅ 代码已通过 javascript-obfuscator 混淆
- [ ] ✅ 所有 .map 文件已删除
- [ ] ✅ 程序能正常启动和运行
- [ ] ✅ 错误日志中仅显示混淆后的文件名

## 更新日志

### 2025-12-09
- ✅ 实现文件名混淆功能
- ✅ 支持自动更新 import/require 引用
- ✅ 集成到 Docker 打包流程
- ✅ 添加本地测试脚本
- ✅ 文档化实现原理和注意事项

## 总结

**实现难度：** 中等（需要正确处理正则替换和文件重命名）  
**安全提升：** 高（显著增加逆向工程难度）  
**副作用：** 极小（仅调试时略微不便）  
**推荐程度：** ⭐⭐⭐⭐⭐（强烈推荐）

文件名混淆是代码保护的重要一环，配合深度代码混淆和 source map 移除，可以有效保护核心业务逻辑。
