# Source Map 安全隐患修复

## 问题发现

在代码审查中发现，打包后的 `dist/` 目录包含大量 `.map` 文件（Source Map），这些文件**严重危害代码安全性**。

## Source Map 的安全风险

### 1. **暴露原始代码结构**
Source map 文件包含：
- 原始文件路径和目录结构
- 变量名、函数名的映射关系
- 代码逻辑的完整映射

**示例：**
```javascript
// 混淆后的代码
function _0x3a4b() { return _0x5c2d(_0x1e3f); }

// 通过 .map 文件可还原为
function calculateProfit() { return getAccountBalance(userId); }
```

### 2. **完全破坏代码混淆**
即使使用了：
- `javascript-obfuscator` 深度混淆
- `control-flow-flattening`（控制流扁平化）
- `string-array-encoding rc4`（RC4 字符串加密）
- `dead-code-injection`（死代码注入）

**只要 .map 文件存在，攻击者可以：**
1. 使用浏览器开发工具自动加载 map 文件
2. 通过 `source-map` npm 包解析映射关系
3. 还原成可读的源代码

### 3. **泄露敏感信息**
在交易系统中，map 文件可能暴露：
- API 密钥处理逻辑
- 交易算法实现细节
- 风控参数计算方法
- 数据库查询逻辑

### 4. **降低逆向工程难度**
攻击者可以：
- 快速定位关键函数（如下单、平仓）
- 理解业务逻辑流程
- 查找漏洞和后门
- 复制核心算法

## 已修复内容

### 1. **禁用 TypeScript 编译时生成 source map**
**文件：** `tsdown.config.ts`

**修改前：**
```typescript
export default defineConfig({
  entry: ["./src/index.ts"],
  sourcemap: true,  // ❌ 生成 .map 文件
  outDir: "dist",
});
```

**修改后：**
```typescript
export default defineConfig({
  entry: ["./src/index.ts"],
  sourcemap: false,  // ✅ 禁用 source map
  outDir: "dist",
});
```

### 2. **打包脚本中删除残留的 map 文件**
**文件：** `compile/compile_exe_bytenode.sh`

**添加清理步骤：**
```bash
# 删除所有 source map 文件（避免暴露源代码映射）
RUN find dist -type f -name "*.map" -delete
RUN find public -type f -name "*.map" -delete
```

**位置：** 在代码混淆步骤之前执行，确保即使有遗留的 map 文件也会被清除。

### 3. **验证效果**
```bash
# 重新编译
npm run build

# 检查 map 文件数量（应为 0）
find dist -name "*.map" | wc -l
# 输出: 0 ✅
```

## 开发环境 vs 生产环境

### 开发环境（保留 source map）
如果需要在**本地开发调试**时使用 source map：

```bash
# .env.development
GENERATE_SOURCEMAP=true
```

或在 `tsdown.config.ts` 中条件启用：
```typescript
export default defineConfig({
  entry: ["./src/index.ts"],
  sourcemap: process.env.NODE_ENV === 'development',  // 仅开发环境
  outDir: "dist",
});
```

### 生产环境（禁用 source map）
**✅ 当前配置已禁用 source map**

- 打包 Windows exe：无 map 文件
- 部署到服务器：无 map 文件
- 分发给用户：无 map 文件

## 其他安全加固建议

### 1. **代码混淆参数优化**
当前已使用的混淆选项（`compile_exe_bytenode.sh` 第 153-166 行）：

```bash
javascript-obfuscator "$js_file" --output "$tmp_dir" \
  --compact true \                          # 压缩代码
  --control-flow-flattening true \          # 控制流扁平化
  --control-flow-flattening-threshold 0.75 \
  --dead-code-injection true \              # 死代码注入
  --dead-code-injection-threshold 0.4 \
  --identifier-names-generator hexadecimal \ # 十六进制标识符
  --string-array true \                     # 字符串数组化
  --string-array-encoding rc4 \             # RC4 加密
  --string-array-threshold 1 \
  --transform-object-keys true \            # 对象键转换
  --unicode-escape-sequence true            # Unicode 转义
```

**建议保持这些参数**，已经是较高强度的混淆。

### 2. **移除开发依赖**
确保打包时不包含开发工具：

```bash
# 已在脚本中实现
npm install --omit=dev
```

### 3. **移除注释和调试信息**
混淆工具已自动删除：
- 代码注释
- `console.log` 调试语句（通过 `--remove-console-output` 可选）
- 空白字符和换行

### 4. **环境变量保护**
确保 `.env` 文件不被打包：

```bash
# 在 .gitignore 和打包排除列表中
.env
.env.local
.env.production
```

## 安全检查清单

在发布新版本前，执行以下检查：

- [ ] ✅ `tsdown.config.ts` 中 `sourcemap: false`
- [ ] ✅ 编译后 `dist/` 目录无 `.map` 文件
- [ ] ✅ 打包脚本包含 `find ... -name "*.map" -delete`
- [ ] ✅ 代码已通过 `javascript-obfuscator` 深度混淆
- [ ] ✅ HTML 文件已压缩（移除注释）
- [ ] ✅ `.env` 文件未被打包
- [ ] ✅ `node_modules/` 中仅包含生产依赖

## 验证命令

```bash
# 1. 清理旧文件
rm -rf dist compile/output

# 2. 重新编译
npm run build

# 3. 检查 map 文件（应无输出）
find dist -name "*.map"

# 4. 检查代码混淆（应不可读）
head -20 dist/index.js

# 5. 打包 exe
cd compile && zsh compile_exe_bytenode.sh

# 6. 验证 exe 内容（Windows）
# 解压 exe 后检查是否包含 .map 文件
```

## 相关工具

### 分析 source map 内容
```bash
# 安装 source-map 工具
npm install -g source-map

# 查看 map 文件内容（修复前）
source-map-explorer dist/index.js dist/index.js.map
```

### 检测混淆强度
```bash
# 使用 JSDetox 或 de4js 尝试反混淆
# 如果能轻易还原，说明混淆强度不够
```

## 更新日志

### 2025-12-09
- ✅ 发现并修复 source map 安全隐患
- ✅ 禁用 `tsdown.config.ts` 中的 sourcemap 生成
- ✅ 在打包脚本中添加 `.map` 文件清理步骤
- ✅ 验证编译后无 map 文件残留
- ✅ 文档化安全检查流程

## 总结

**修复前：** 代码混淆形同虚设，攻击者可通过 .map 文件完全还原源代码  
**修复后：** 彻底移除 source map，配合深度混淆保护核心逻辑

**重要性：** 🔴 高危漏洞，必须修复  
**影响范围：** 所有打包版本（Windows exe、macOS app、Linux binary）  
**建议操作：** 立即重新编译并发布修复版本
