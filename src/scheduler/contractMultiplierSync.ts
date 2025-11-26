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
 * 合约乘数同步定时任务
 * 每天从 OKX API 获取最新的合约乘数并保存到数据库
 */

import { createLogger } from '../utils/loggerUtils';
import { createOkxClient } from '../services/okxClient';
import { createClient } from '@libsql/client';
import type { ContractMultiplier } from '../database/schema';

const logger = createLogger({
  name: 'contract-multiplier-sync',
  level: 'info',
});

const dbClient = createClient({
  url: process.env.DATABASE_URL || 'file:./data/database/sqlite.db',
});

/**
 * 从 OKX 获取合约乘数
 */
async function fetchContractMultipliers(): Promise<Map<string, { multiplier: number; contractValue: string }>> {
  const okxClient = createOkxClient();
  const multipliers = new Map<string, { multiplier: number; contractValue: string }>();

  try {
    logger.info('Fetching contract instruments from OKX...');
    
    const instruments = await okxClient.getAllContracts();

    if (!instruments || instruments.length === 0) {
      logger.error('Failed to fetch instruments from OKX');
      return multipliers;
    }

    logger.info(`Received ${instruments.length} instruments from OKX`);

    for (const inst of instruments) {
      // 只处理 USDT 合约
      if (inst.instId && inst.instId.endsWith('-USDT-SWAP')) {
        const symbol = inst.instId.replace('-USDT-SWAP', '');
        const ctVal = Number.parseFloat(inst.ctVal || '0');
        
        if (ctVal > 0) {
          multipliers.set(symbol, {
            multiplier: ctVal,
            contractValue: inst.ctVal || '0',
          });
          logger.debug(`${symbol}: multiplier = ${ctVal}`);
        }
      }
    }

    logger.info(`Successfully parsed ${multipliers.size} contract multipliers`);
    return multipliers;
  } catch (error) {
    logger.error('Error fetching contract multipliers:', error);
    return multipliers;
  }
}

/**
 * 保存合约乘数到数据库
 */
async function saveContractMultipliers(multipliers: Map<string, { multiplier: number; contractValue: string }>): Promise<void> {
  const now = new Date().toISOString();

  try {
    logger.info(`Saving ${multipliers.size} contract multipliers to database...`);

    let count = 0;
    for (const [symbol, data] of multipliers.entries()) {
      await dbClient.execute({
        sql: `
          INSERT INTO contract_multipliers (symbol, multiplier, contract_value, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(symbol) DO UPDATE SET
            multiplier = excluded.multiplier,
            contract_value = excluded.contract_value,
            updated_at = excluded.updated_at
        `,
        args: [symbol, data.multiplier, data.contractValue, now],
      });
      count++;
    }

    logger.info(`Successfully saved ${count} contract multipliers to database`);
  } catch (error) {
    logger.error('Error saving contract multipliers to database:', error);
    throw error;
  }
}

/**
 * 从数据库获取所有合约乘数
 */
export async function getContractMultipliersFromDb(): Promise<ContractMultiplier[]> {
  try {
    const result = await dbClient.execute('SELECT * FROM contract_multipliers ORDER BY symbol');
    return result.rows as unknown as ContractMultiplier[];
  } catch (error) {
    logger.error('Error fetching contract multipliers from database:', error);
    return [];
  }
}

/**
 * 执行同步任务
 */
export async function syncContractMultipliers(): Promise<void> {
  logger.info('Starting contract multiplier synchronization...');
  
  try {
    const multipliers = await fetchContractMultipliers();
    
    if (multipliers.size === 0) {
      logger.warn('No contract multipliers fetched, skipping database update');
      return;
    }

    await saveContractMultipliers(multipliers);
    logger.info('Contract multiplier synchronization completed successfully');
  } catch (error) {
    logger.error('Contract multiplier synchronization failed:', error);
    throw error;
  }
}

/**
 * 启动定时同步任务
 * @param intervalHours 同步间隔（小时），默认 24 小时
 */
export function startContractMultiplierSync(intervalHours = 24): NodeJS.Timeout {
  logger.info(`Starting contract multiplier sync scheduler (every ${intervalHours} hours)`);
  
  // 立即执行一次
  syncContractMultipliers().catch((error) => {
    logger.error('Initial contract multiplier sync failed:', error);
  });

  // 设置定时任务
  const intervalMs = intervalHours * 60 * 60 * 1000;
  const timer = setInterval(() => {
    syncContractMultipliers().catch((error) => {
      logger.error('Scheduled contract multiplier sync failed:', error);
    });
  }, intervalMs);

  logger.info(`Contract multiplier sync scheduler started, next sync in ${intervalHours} hours`);
  return timer;
}

/**
 * 停止定时同步任务
 */
export function stopContractMultiplierSync(timer: NodeJS.Timeout): void {
  clearInterval(timer);
  logger.info('Contract multiplier sync scheduler stopped');
}
