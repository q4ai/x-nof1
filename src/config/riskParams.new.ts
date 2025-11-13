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
 * 基础风险参数配置（从数据库读取，支持运行时更新）
 */

import { getAllConfig } from "../database/init-config";

let cachedConfig: Record<string, string> | null = null;

/**
 * 从数据库加载配置
 */
export async function loadRiskParams() {
  cachedConfig = await getAllConfig();
  return cachedConfig;
}

/**
 * 重新加载配置（用于运行时更新）
 */
export async function reloadRiskParams() {
  cachedConfig = null;
  const config = await loadRiskParams();
  
  // 重置 OKX 客户端实例，使其使用新配置
  try {
    const { resetOkxClient, createOkxClientWithConfig } = await import("../services/okxClient");
    resetOkxClient();
    
    // 如果数据库中有新的API密钥，重新创建客户端
    if (config && typeof config === 'object') {
      const apiKey = config.OKX_API_KEY || process.env.OKX_API_KEY;
      const apiSecret = config.OKX_API_SECRET || process.env.OKX_API_SECRET;
      const passphrase = config.OKX_API_PASSPHRASE || process.env.OKX_API_PASSPHRASE;
      const simulated = (config.OKX_USE_PAPER || process.env.OKX_USE_PAPER) === "true";
      const proxyUrl = config.HTTP_PROXY_URL || process.env.HTTP_PROXY_URL;
      
      if (apiKey && apiSecret && passphrase) {
        createOkxClientWithConfig(apiKey, apiSecret, passphrase, simulated, proxyUrl);
      }
    }
  } catch (error) {
    console.error("重置 OKX 客户端失败:", error);
  }
  
  return config;
}

/**
 * 获取配置值
 */
function getConfig(key: string, defaultValue: string): string {
  if (!cachedConfig) {
    // 如果缓存为空，返回环境变量或默认值
    return process.env[key] || defaultValue;
  }
  return cachedConfig[key] || defaultValue;
}

/**
 * 获取配置数组（用于 TRADING_SYMBOLS）
 */
function getConfigArray(key: string, defaultValue: string): string[] {
  const value = getConfig(key, defaultValue);
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/**
 * 风险参数对象（动态从缓存读取）
 */
export const RISK_PARAMS = {
  // 最大持仓数
  get MAX_POSITIONS(): number {
    return Number.parseInt(getConfig("MAX_POSITIONS", "5"), 10);
  },
  
  // 最大杠杆倍数
  get MAX_LEVERAGE(): number {
    return Number.parseInt(getConfig("MAX_LEVERAGE", "10"), 10);
  },
  
  // 交易币种列表
  get TRADING_SYMBOLS(): [string, ...string[]] {
    const symbols = getConfigArray("TRADING_SYMBOLS", "BTC,ETH,SOL,XRP,BNB,BCH");
    return symbols as [string, ...string[]];
  },
  
  // 最大持仓小时数
  get MAX_HOLDING_HOURS(): number {
    return Number.parseInt(getConfig("MAX_HOLDING_HOURS", "36"), 10);
  },
  
  // 最大持仓周期数（根据持仓小时数自动计算）
  get MAX_HOLDING_CYCLES(): number {
    return this.MAX_HOLDING_HOURS * 6;
  },
  
  // 极端止损线
  get EXTREME_STOP_LOSS_PERCENT(): number {
    return Number.parseInt(getConfig("EXTREME_STOP_LOSS_PERCENT", "-30"), 10);
  },
  
  // 账户回撤风控阈值
  get ACCOUNT_DRAWDOWN_NO_NEW_POSITION_PERCENT(): number {
    return Number.parseInt(getConfig("ACCOUNT_DRAWDOWN_NO_NEW_POSITION_PERCENT", "30"), 10);
  },
  
  get ACCOUNT_DRAWDOWN_FORCE_CLOSE_PERCENT(): number {
    return Number.parseInt(getConfig("ACCOUNT_DRAWDOWN_FORCE_CLOSE_PERCENT", "50"), 10);
  },
  
  get ACCOUNT_DRAWDOWN_WARNING_PERCENT(): number {
    return Number.parseInt(getConfig("ACCOUNT_DRAWDOWN_WARNING_PERCENT", "20"), 10);
  },
  
  // 交易策略
  get TRADING_STRATEGY(): string {
    return getConfig("TRADING_STRATEGY", "balanced");
  },
  
  // 交易间隔（分钟）
  get TRADING_INTERVAL_MINUTES(): number {
    return Number.parseInt(getConfig("TRADING_INTERVAL_MINUTES", "20"), 10);
  },
} as const;

/**
 * 获取字符串配置值（包含用户自定义提示词片段）
 */
export function getConfigStringValue(key: string, defaultValue: string): string {
  const value = getConfig(key, defaultValue);
  return typeof value === "string" ? value : defaultValue;
}
