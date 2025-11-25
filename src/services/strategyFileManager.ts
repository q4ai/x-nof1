import fs from 'fs/promises';
import path from 'path';
import { getStrategiesDir } from '../utils/pathUtils';
import { createLogger } from '../utils/loggerUtils';

const logger = createLogger({
  name: "strategy-file-manager",
  level: "info",
});

export interface StrategyFileContent {
  meta: {
    name: string;
    version: string;
    updatedAt: string;
    description?: string;
  };
  prompts: {
    entryLogic: string;
    exitLogic: string;
    variables?: string;
  };
  params: {
    tradingSymbols?: string;
    intervalMinutes: number;
    leverage: number;
    maxPositions: number;
    maxHoldingHours: number;
    minHoldingMinutes: number;
    extremeStopLossPercent: number;
    accountStopLoss: number;
    accountTakeProfit: number;
    drawdownWarning: number;
    drawdownNoNew: number;
    drawdownForceClose: number;
  };
}

export class StrategyFileManager {
  static async listStrategies(): Promise<string[]> {
    try {
      const dir = getStrategiesDir();
      const files = await fs.readdir(dir);
      return files
        .filter(f => f.endsWith('.json'))
        .map(f => f.replace('.json', ''));
    } catch (error) {
      logger.error('Failed to list strategies', error);
      return [];
    }
  }

  static async loadStrategy(name: string): Promise<StrategyFileContent | null> {
    try {
      const dir = getStrategiesDir();
      const filePath = path.join(dir, `${name}.json`);
      const content = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content) as Partial<StrategyFileContent>;
      const normalized: StrategyFileContent = {
        meta: {
          name: parsed.meta?.name ?? name,
          version: parsed.meta?.version ?? "1.0",
          updatedAt: parsed.meta?.updatedAt ?? new Date().toISOString(),
          description: parsed.meta?.description,
        },
        prompts: {
          entryLogic: parsed.prompts?.entryLogic ?? "",
          exitLogic: parsed.prompts?.exitLogic ?? "",
        },
        params: {
          tradingSymbols: parsed.params?.tradingSymbols ?? "",
          intervalMinutes: parsed.params?.intervalMinutes ?? 20,
          leverage: parsed.params?.leverage ?? 1,
          maxPositions: parsed.params?.maxPositions ?? 1,
          maxHoldingHours: parsed.params?.maxHoldingHours ?? 1,
          minHoldingMinutes: parsed.params?.minHoldingMinutes ?? 0,
          extremeStopLossPercent: parsed.params?.extremeStopLossPercent ?? -30,
          accountStopLoss: parsed.params?.accountStopLoss ?? 0,
          accountTakeProfit: parsed.params?.accountTakeProfit ?? 0,
          drawdownWarning: parsed.params?.drawdownWarning ?? 0,
          drawdownNoNew: parsed.params?.drawdownNoNew ?? 0,
          drawdownForceClose: parsed.params?.drawdownForceClose ?? 0,
        },
      };
      return normalized;
    } catch (error) {
      logger.error(`Failed to load strategy: ${name}`, error);
      return null;
    }
  }

  static async saveStrategy(name: string, content: StrategyFileContent): Promise<boolean> {
    try {
      const dir = getStrategiesDir();
      const filePath = path.join(dir, `${name}.json`);
      
      // Ensure meta info is updated
      content.meta.updatedAt = new Date().toISOString();
      content.meta.name = name;

      await fs.writeFile(filePath, JSON.stringify(content, null, 2), 'utf-8');
      return true;
    } catch (error) {
      logger.error(`Failed to save strategy: ${name}`, error);
      return false;
    }
  }

  static async deleteStrategy(name: string): Promise<boolean> {
    try {
      const dir = getStrategiesDir();
      const filePath = path.join(dir, `${name}.json`);
      await fs.unlink(filePath);
      return true;
    } catch (error) {
      logger.error(`Failed to delete strategy: ${name}`, error);
      return false;
    }
  }
}
