# Copilot 指南

## 架构速览
- 启动入口 `src/index.ts`：依序执行 `initConfig()` ➜ `loadRiskParams()`（从数据库载入配置并回落到 `.env`）➜ `initTradingSystem()` ➜ 启动 Hono API、WebSocket、交易循环、账户记录器以及止盈/移动止盈监控器。
- 核心交易决策在 `src/scheduler/tradingLoop.ts`：负责锁机制、状态推送、提示词生成、AI Agent 调用、交易执行和结果写库。
- AI 决策管线由 `src/agents/tradingAgent.ts` 驱动，调用 `src/tools/trading/**`（open/close/account/marketData 等工具），受 `src/config/riskParams.new.ts` 的动态参数约束。
- 所有 OKX 交互透过 `src/services/okxClient.ts` 的单例客户端；行情多周期聚合集中在 `src/services/multiTimeframeAnalysis.ts`。
- 持久化使用 LibSQL（SQLite 模式），模式定义在 `src/database/schema.ts`，初始化与迁移脚本在 `src/database/**` 与 `scripts/` 下。
- Web 前端位于 `public/`：`monitor-script.js` 负责仪表盘逻辑、策略表单提交、WebSocket 状态渲染；`monitor-styles.css` 定义面板样式。

## 运行与调试
- Node 20.19+；安装依赖后可用 `npm run dev`（ts-node 监控 + API）或 `npm run trading:start`（仅交易循环）。生产构建：`npm run build && npm run start`（tsdown 输出到 `dist/`）。
- 初始化数据库：`npm run db:init`；重置：`npm run db:reset`、`scripts/close-reset-and-start.sh` 等。
- 常用质量检查：`npm run lint` / `npm run lint:fix`（Biome），`npm run typecheck`（tsc），`npm run test` 当前为空但预留。
- 配置更新流程：前端通过 `/api/config` 保存后需调用 `/api/reload`（`monitor-script.js` 已自动发起），随后必须手动重启交易循环或进程，新的调度间隔才生效。

## 关键约定
- 所有环境/策略参数通过 `RISK_PARAMS` Getter 读取，内部先读数据库缓存，无记录时回落 `.env`，不要直接访问 `process.env`（已有遗留操作需谨慎处理）。
- 需要 OKX 客户端统一使用 `createOkxClient()` / `createOkxClientWithConfig()`，避免自建实例遗漏 Proxy、Simulated 环境或密钥校验。
- 交易循环的 WebSocket 状态通过 `src/services/websocketService.ts` 广播，前端 `handleTradingStatusUpdate` 直接展示 `message` 字段；新增状态时要同步定义枚举与前端映射。
- `src/scheduler/tradingLoop.ts` 的数据库写入使用 `SQLite`，只能绑定 string/number/bigint/buffer/null，先确保序列化值（例如 `JSON.stringify`）。
- `public/monitor-script.js` 维护 `availableSymbols` 集合，`applyConfigSymbols()` 会用策略配置覆盖初始币种；新增币种来源时记得同步刷新该集合。
- 日志统一调用 `src/utils/loggerUtils.ts` 的 `createLogger`（pino 封装），并在关键流程打印输入/输出以便复盘。
- 提交代码或回答问题时，请使用中文说明思路与结论。
