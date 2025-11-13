# 合约乘数自动同步系统

## 功能概述

系统现已支持每天自动从 OKX API 获取最新的合约乘数（张 → 币数量的转换比例），并保存到数据库。前端会自动从 API 获取这些数据，用于正确显示交易数量。

## 工作流程

### 1. 后端定时任务

**文件**: `src/scheduler/contractMultiplierSync.ts`

- **启动时机**: 系统启动时立即执行一次，之后每 1 小时自动执行
- **数据来源**: OKX API (`/api/v5/public/instruments`)
- **存储位置**: SQLite 数据库 `contract_multipliers` 表
- **同步范围**: 所有 USDT 永续合约（`*-USDT-SWAP`）

**主要功能**:
```typescript
// 启动定时同步（在 src/index.ts 中调用）
contractMultiplierSyncTimer = startContractMultiplierSync(1); // 1小时

// 手动触发同步
await syncContractMultipliers();

// 从数据库获取数据
const multipliers = await getContractMultipliersFromDb();
```

### 2. 数据库结构

**表名**: `contract_multipliers`

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER | 主键 |
| symbol | TEXT | 币种符号（如 BTC、ETH） |
| multiplier | REAL | 乘数（1张 = multiplier个币） |
| contract_value | TEXT | 合约价值（原始字符串） |
| updated_at | TEXT | 更新时间 |

**示例数据**:
```
BTC: 0.01
ETH: 0.1
SOL: 1
ADA: 100
DOGE: 10
```

### 3. API 接口

**端点**: `GET /api/public/contract-multipliers`

**无需认证**: 公开接口

**返回格式**:
```json
{
  "multipliers": {
    "BTC": 0.01,
    "ETH": 0.1,
    "SOL": 1,
    "XRP": 10,
    "ADA": 100,
    ...
  },
  "lastUpdated": "2025-11-13T13:57:26.468Z",
  "count": 253
}
```

### 4. 前端集成

**文件**: `public/monitor-script.js`

**加载时机**: 页面加载时（`DOMContentLoaded` 事件）

**使用方式**:
```javascript
// 自动加载（在 DOMContentLoaded 中）
await loadContractMultipliers();

// 转换合约数量为实际币数量
const quantity = convertContractsToQuantity('ADA', 1.5);
// 1.5 张 × 100 = 150 ADA
```

**备用机制**:
- 如果 API 请求失败，使用硬编码的默认值 `DEFAULT_CONTRACT_MULTIPLIERS`
- 确保即使网络异常也能正常显示

## 系统日志

启动时会看到以下日志：

```
[contract-multiplier-sync]: Starting contract multiplier sync scheduler (every 1 hours)
[contract-multiplier-sync]: Starting contract multiplier synchronization...
[contract-multiplier-sync]: Fetching contract instruments from OKX...
[contract-multiplier-sync]: Received 273 instruments from OKX
[contract-multiplier-sync]: Successfully parsed 253 contract multipliers
[contract-multiplier-sync]: Saving 253 contract multipliers to database...
[contract-multiplier-sync]: Successfully saved 253 contract multipliers to database
[contract-multiplier-sync]: Contract multiplier synchronization completed successfully
[contract-multiplier-sync]: Contract multiplier sync scheduler started, next sync in 1 hours
```

## 手动测试

### 查看数据库数据
```bash
npx tsx scripts/test-contract-multipliers.ts
```

### 测试 API 接口
```bash
curl http://localhost:3100/api/public/contract-multipliers | jq '.multipliers | to_entries | .[:10]'
```

### 手动触发同步
在 Node REPL 或脚本中：
```typescript
import { syncContractMultipliers } from './src/scheduler/contractMultiplierSync';
await syncContractMultipliers();
```

## 优雅关闭

系统关闭时会自动停止定时任务：

```
[ai-btc]: 正在停止合约乘数同步定时任务...
[contract-multiplier-sync]: Contract multiplier sync scheduler stopped
```

## 配置选项

### 调整同步间隔

在 `src/index.ts` 中修改：

```typescript
// 默认 1 小时
contractMultiplierSyncTimer = startContractMultiplierSync(1);

// 修改为 24 小时
contractMultiplierSyncTimer = startContractMultiplierSync(24);

// 修改为 30 分钟（用于测试）
contractMultiplierSyncTimer = startContractMultiplierSync(0.5);
```

### 错误处理

- **网络错误**: 记录日志，保留上次成功的数据
- **数据库错误**: 记录日志，回滚事务
- **API 失败**: 前端回退到默认值

## 注意事项

1. **首次启动**: 系统启动时立即同步一次，确保有最新数据
2. **数据持久化**: 数据永久保存在数据库，重启不会丢失
3. **自动更新**: 每 1 小时自动更新，保持数据实时性
4. **公开接口**: API 无需登录即可访问，方便前端集成
5. **备用机制**: 即使同步失败，前端也有默认值可用

## 相关文件

- `src/scheduler/contractMultiplierSync.ts` - 同步任务逻辑
- `src/database/schema.ts` - 数据库表定义
- `src/database/migrations.ts` - 数据库迁移
- `src/api/routes.ts` - API 路由定义
- `public/monitor-script.js` - 前端集成
- `scripts/test-contract-multipliers.ts` - 测试脚本
