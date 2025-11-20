# Copilot 指南

## 项目介绍
- 这是一个新一代加密货币AI智能交易平台，主要功能是通过传输给AI大模型k线数据、账户持仓、可用工具等等的数据，调用AI大模型让大模型给出开仓、平仓决策调用对应的工具进行开仓平仓；此外，平台还提供了前端监控界面，可以实时查看账户状态、交易日志、AI决策等信息，并支持手动交易功能，实现类似传统交易所的合约手动交易界面，允许用户在必要时可以进行人工干预。

## 1. 核心架构

### 启动与生命周期
- **入口**: `src/index.ts`
  - 流程: `initConfig()` (DB/Env) ➜ `loadRiskParams()` ➜ `initTradingSystem()`。
  - 启动组件: Hono API Server, WebSocket Service, Trading Loop (Cron), Account Recorder, Trailing Stop Monitor.
- **配置管理**:
  - 核心配置通过 `src/config/riskParams.new.ts` 中的 `RISK_PARAMS` Getter 访问。
  - 优先读取数据库 `system_config` 表，无记录时回落到 `.env`。
  - **禁止**直接在业务代码中使用 `process.env` 读取交易参数。
  - 更新配置需调用 `/api/reload` 并重启交易循环。

### 交易系统 (`src/scheduler/tradingLoop.ts`)
- **调度**: 基于 `node-cron` 或 `setInterval` 的循环机制。
- **流程**:
  1. 获取全局锁 (`isExecuting`)。
  2. 广播状态 (`processing`)。
  3. 生成 Prompt (`src/agents/tradingAgent.ts`)。
  4. 调用 AI Agent 获取决策。
  5. 执行工具 (`src/tools/trading/**`)。
  6. 记录结果 (`trades`, `agent_request_logs` 表)。
  7. 广播完成状态。

### AI Agent & Tools
- **Agent**: `src/agents/tradingAgent.ts` 负责构建上下文（行情、持仓、新闻）并解析 LLM 响应。
- **Tools** (`src/tools/trading/`):
  - `tradeExecution.ts`: 核心下单逻辑。
    - `executeOpenPosition`: 支持 **USDT 面值 (Notional)** 和 **币数量 (Coin Quantity)** 两种模式。
    - `executeClosePosition`: 平仓逻辑。
  - `marketData.ts`: K线、订单簿、资金费率。
  - `accountManagement.ts`: 余额、持仓查询。

### 数据服务
- **OKX 客户端**: `src/services/okxClient.ts` (单例模式，自动处理模拟盘/实盘切换)。
- **行情分析**: `src/services/multiTimeframeAnalysis.ts` (多周期聚合)。
- **WebSocket**: `src/services/websocketService.ts` (向前端广播状态、日志、价格)。

## 2. 数据库与持久化
- **引擎**: LibSQL (SQLite 模式)。
- **Schema**: `src/database/schema.ts`。
- **关键表**:
  - `system_config`: 动态配置。
  - `trades`: 交易历史。
  - `positions`: 当前持仓快照。
  - `agent_request_logs`: AI 决策日志。
  - `account_history`: 权益曲线记录。
- **迁移**: `src/database/migrations.ts` 及 `scripts/` 目录下的工具脚本。

## 3. 前端架构 (`public/`)
- **技术栈**: 原生 HTML/CSS/JS (无框架)。
- **核心文件**:
  - `monitor-script.js`: 业务逻辑、WebSocket 处理、图表渲染 (Chart.js/Lightweight Charts)。
  - `monitor-styles.css`: 样式定义。
- **权限控制**:
  - **未登录 (Guest)**: 仅展示 Dashboard (账户统计 + AI 决策 + K线)，**隐藏** 顶部导航 Tabs 和 手动交易面板。
  - **已登录 (User)**: 展示完整功能，包括 Manual Trade, Settings 等。
  - 鉴权逻辑在 `monitor-script.js` 的 `updateSidebarAuthVisibility()` 中实现。
- **手动交易 (Manual Trade)**:
  - 接口: `POST /api/trading/manual` (需 Session + CSRF)。
  - **输入模式**:
    - **Amount (USDT)**: 视为 **总面值 (Notional Value)**。后端计算: `张数 = 面值 / (乘数 * 价格)`。
    - **Quantity (Coin)**: 视为 **币的数量**。后端计算: `张数 = 数量 / 乘数`。
  - **订单类型**:
    - **Market**: 市价单，价格字段无效（后端自动获取当前价）。
    - **Limit**: 限价单，需指定 `price`。

## 4. 开发与调试
- **运行**:
  - 开发: `npm run dev` (ts-node 监控)。
  - 生产: `npm run build && npm run start`。
  - 仅交易循环: `npm run trading:start`。
- **数据库操作**:
  - 初始化: `npm run db:init`。
  - 重置: `npm run db:reset` 或 `scripts/close-reset-and-start.sh`。
- **代码质量**:
  - Lint: `npm run lint` / `npm run lint:fix` (Biome)。
  - Typecheck: `npm run typecheck` (TypeScript)。

## 5. 编码规范 (Copilot 必读)
1.  **语言**: 代码注释、提交信息、回答问题均使用 **中文**。
2.  **类型安全**: 严禁使用 `any`，必须定义清晰的 Interface/Type。
3.  **错误处理**: 所有 API 调用必须包含 `try-catch`，并使用 `logger.error` 记录堆栈。
4.  **工具使用**:
    - 修改文件优先使用 `replace_string_in_file`。
    - 涉及数据库变更必须同步更新 `schema.ts` 和迁移脚本。
5.  **OKX 交互**: 必须使用 `createOkxClient()` 获取实例，禁止手动实例化 `OkxClient` 类。
6.  **日志**: 使用 `src/utils/loggerUtils.ts`，关键路径必须打点。
7.  **设计原则**: 高内聚、低耦合。业务逻辑尽量封装在 `src/services` 或 `src/tools` 中，Controller 层保持轻量。

## 6. 最近更新
- **手动交易升级**: 支持 **市价 (Market)** 和 **限价 (Limit)** 两种订单类型。限价单支持指定价格，后端逻辑已适配（包括张数计算和下单参数）。
- **手动交易单位**: 明确区分 USDT (Notional) 和 Coin (Quantity) 两种下单模式，后端 `executeOpenPosition` 已适配。
- **访客模式**: 前端已移除遮罩层，改为通过 CSS/JS 隐藏敏感操作区域。
