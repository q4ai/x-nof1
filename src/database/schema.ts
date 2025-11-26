/**
 * open-nof1.ai - AI 加密货币自动交易系统
 * Copyright (C) 2025 195440
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 * 
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 * 
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * 数据库模式定义
 */

export interface Trade {
  id: number;
  account_id?: number;
  order_id: string;
  symbol: string;
  side: 'long' | 'short';
  type: 'open' | 'close';
  price: number;
  quantity: number;
  leverage: number;
  pnl?: number;
  fee?: number;
  timestamp: string;
  status: 'pending' | 'filled' | 'cancelled';
}

export interface TradeLog {
  id: number;
  account_id?: number;
  action: "open" | "close" | "cancel" | "adjust";
  symbol?: string;
  side?: "long" | "short";
  leverage?: number;
  amount_usdt?: number;
  size?: number;
  status: "success" | "failed" | "warning";
  message: string;
  order_id?: string;
  raw_request?: string;
  raw_response?: string;
  created_at: string;
}

export interface Position {
  id: number;
  account_id?: number;
  symbol: string;
  quantity: number;
  entry_price: number;
  current_price: number;
  liquidation_price: number;
  unrealized_pnl: number;
  leverage: number;
  side: 'long' | 'short';
  profit_target?: number;
  stop_loss?: number;
  tp_order_id?: string;
  sl_order_id?: string;
  entry_order_id: string;
  opened_at: string;
  confidence?: number;
  risk_usd?: number;
  peak_pnl_percent?: number; // 历史最高盈亏百分比（考虑杠杆）
  partial_close_percentage?: number; // 已通过分批止盈平掉的百分比 (0-100)
}

export interface AccountHistory {
  id: number;
  account_id?: number;
  timestamp: string;
  total_value: number;
  available_cash: number;
  unrealized_pnl: number;
  realized_pnl: number;
  return_percent: number;
  sharpe_ratio?: number;
}

export interface TradingSignal {
  id: number;
  symbol: string;
  timestamp: string;
  price: number;
  ema_20: number;
  ema_50?: number;
  macd: number;
  rsi_7: number;
  rsi_14: number;
  volume: number;
  open_interest?: number;
  funding_rate?: number;
  atr_3?: number;
  atr_14?: number;
}

export interface AgentDecision {
  id: number;
  timestamp: string;
  iteration: number;
  market_analysis: string;
  decision: string;
  actions_taken: string;
  account_value: number;
  positions_count: number;
  account_id?: number;
}

export interface AgentRequestLog {
  id: number;
  created_at: string;
  iteration?: number;
  model_name: string;
  instructions: string;
  prompt: string;
  response?: string;
  response_summary?: string;
  status: "success" | "error";
  error_message?: string;
  output_duration_ms?: number;
  account_id?: number;
}

export interface SystemConfig {
  id: number;
  key: string;
  value: string;
  updated_at: string;
}

export interface ContractMultiplier {
  id: number;
  symbol: string;
  multiplier: number;
  contract_value: string;
  updated_at: string;
}

export interface AccountConfig {
  id: number;
  name: string;
  provider: 'okx' | 'binance' | 'bitget';
  api_key: string;
  api_secret: string;
  api_passphrase?: string;
  use_paper: boolean;
  proxy_url?: string;
  is_active: boolean;
  stop_loss_usdt?: number;
  take_profit_usdt?: number;
  created_at: string;
  updated_at: string;
}

export interface BinanceContractPrecision {
  id: number;
  contract: string;
  symbol: string;
  step_size: string;
  min_qty: string;
  max_qty: string;
  tick_size?: string;
  min_notional?: string;
  precision: number;
  updated_at: string;
}

/**
 * 管理员凭证
 */
export interface AdminCredentials {
  id: number;
  admin_path: string;
  username: string;
  password_hash: string;
  created_at: string;
  updated_at: string;
}

/**
 * Strategy Task 状态类型
 */
export type TradingInstanceStatus = "running" | "paused" | "stopped";

/**
 * Strategy Task - 多账户并行策略任务
 * 每个实例绑定一个账户、一个AI模型和一个策略
 */
export interface TradingInstance {
  id: number;
  name: string;
  account_id: number;
  ai_model_id: number;
  strategy_name: string;
  status: TradingInstanceStatus;
  interval_minutes: number;
  last_executed_at: string | null;
  last_execution_status: "success" | "error" | "skipped" | null;
  created_at: string;
  updated_at: string;
}

/**
 * SQL 建表语句
 */
export const CREATE_TABLES_SQL = `
-- 交易记录表
CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER,
  order_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  type TEXT NOT NULL,
  price REAL NOT NULL,
  quantity REAL NOT NULL,
  leverage INTEGER NOT NULL,
  pnl REAL,
  fee REAL,
  timestamp TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
);

-- 交易日志表
CREATE TABLE IF NOT EXISTS trade_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER,
  action TEXT NOT NULL,
  symbol TEXT,
  side TEXT,
  leverage REAL,
  amount_usdt REAL,
  size REAL,
  status TEXT NOT NULL,
  message TEXT NOT NULL,
  order_id TEXT,
  raw_request TEXT,
  raw_response TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 持仓表
CREATE TABLE IF NOT EXISTS positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER,
  symbol TEXT NOT NULL,
  quantity REAL NOT NULL,
  entry_price REAL NOT NULL,
  current_price REAL NOT NULL,
  liquidation_price REAL NOT NULL,
  unrealized_pnl REAL NOT NULL,
  leverage INTEGER NOT NULL,
  side TEXT NOT NULL,
  profit_target REAL,
  stop_loss REAL,
  tp_order_id TEXT,
  sl_order_id TEXT,
  entry_order_id TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  confidence REAL,
  risk_usd REAL,
  peak_pnl_percent REAL DEFAULT 0,
  partial_close_percentage REAL DEFAULT 0,
  UNIQUE(symbol, side)
);

-- 账户历史表
CREATE TABLE IF NOT EXISTS account_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER,
  timestamp TEXT NOT NULL,
  total_value REAL NOT NULL,
  available_cash REAL NOT NULL,
  unrealized_pnl REAL NOT NULL,
  realized_pnl REAL NOT NULL,
  return_percent REAL NOT NULL,
  sharpe_ratio REAL
);

-- 技术指标表
CREATE TABLE IF NOT EXISTS trading_signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  price REAL NOT NULL,
  ema_20 REAL NOT NULL,
  ema_50 REAL,
  macd REAL NOT NULL,
  rsi_7 REAL NOT NULL,
  rsi_14 REAL NOT NULL,
  volume REAL NOT NULL,
  open_interest REAL,
  funding_rate REAL,
  atr_3 REAL,
  atr_14 REAL
);

-- Agent 决策记录表
CREATE TABLE IF NOT EXISTS agent_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  execution_started_at TEXT,
  iteration INTEGER NOT NULL,
  market_analysis TEXT NOT NULL,
  decision TEXT NOT NULL,
  actions_taken TEXT NOT NULL,
  account_value REAL NOT NULL,
  positions_count INTEGER NOT NULL,
  account_id INTEGER
);

-- Agent 请求日志表
CREATE TABLE IF NOT EXISTS agent_request_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  iteration INTEGER,
  model_name TEXT NOT NULL,
  instructions TEXT NOT NULL,
  prompt TEXT NOT NULL,
  response TEXT,
  response_summary TEXT,
  status TEXT NOT NULL DEFAULT 'success',
  error_message TEXT,
  output_duration_ms INTEGER,
  account_id INTEGER
);

-- 系统配置表
CREATE TABLE IF NOT EXISTS system_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 合约乘数表
CREATE TABLE IF NOT EXISTS contract_multipliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL UNIQUE,
  multiplier REAL NOT NULL,
  contract_value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 账户配置表
CREATE TABLE IF NOT EXISTS account_configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  api_key TEXT NOT NULL,
  api_secret TEXT NOT NULL,
  api_passphrase TEXT,
  use_paper INTEGER NOT NULL DEFAULT 0,
  proxy_url TEXT,
  is_active INTEGER NOT NULL DEFAULT 0,
  stop_loss_usdt REAL,
  take_profit_usdt REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- AI 模型配置表
CREATE TABLE IF NOT EXISTS ai_models (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  api_key TEXT NOT NULL,
  base_url TEXT NOT NULL,
  model_name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Binance 合约下单精度表
CREATE TABLE IF NOT EXISTS binance_contract_precisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contract TEXT NOT NULL UNIQUE,
  symbol TEXT NOT NULL,
  step_size TEXT NOT NULL,
  min_qty TEXT NOT NULL,
  max_qty TEXT NOT NULL,
  tick_size TEXT,
  min_notional TEXT,
  precision INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

-- 用户会话表（持久化登录状态）
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  csrf_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 管理员凭证表（存储后台访问路径和登录凭证）
CREATE TABLE IF NOT EXISTS admin_credentials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_path TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Strategy Tasks 表（多账户并行策略任务）
CREATE TABLE IF NOT EXISTS trading_instances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  account_id INTEGER NOT NULL,
  ai_model_id INTEGER NOT NULL,
  strategy_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'stopped',
  interval_minutes INTEGER NOT NULL DEFAULT 20,
  last_executed_at TEXT,
  last_execution_status TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (account_id) REFERENCES account_configs(id) ON DELETE CASCADE,
  FOREIGN KEY (ai_model_id) REFERENCES ai_models(id) ON DELETE CASCADE
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades(timestamp);
CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol);
CREATE INDEX IF NOT EXISTS idx_trade_logs_created_at ON trade_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_signals_timestamp ON trading_signals(timestamp);
CREATE INDEX IF NOT EXISTS idx_signals_symbol ON trading_signals(symbol);
CREATE INDEX IF NOT EXISTS idx_history_timestamp ON account_history(timestamp);
CREATE INDEX IF NOT EXISTS idx_decisions_timestamp ON agent_decisions(timestamp);
CREATE INDEX IF NOT EXISTS idx_agent_request_logs_created_at ON agent_request_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_binance_contract_precisions_contract ON binance_contract_precisions(contract);
CREATE INDEX IF NOT EXISTS idx_account_configs_is_active ON account_configs(is_active);
CREATE INDEX IF NOT EXISTS idx_ai_models_is_active ON ai_models(is_active);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_trading_instances_status ON trading_instances(status);
CREATE INDEX IF NOT EXISTS idx_trading_instances_account_id ON trading_instances(account_id);
`;

