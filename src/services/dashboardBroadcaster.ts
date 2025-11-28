/**
 * open-nof1.ai - AI 加密货币自动交易系统
 * Copyright (C) 2025 195440
 *
 * 监控面板实时推送调度器。
 *
 * 负责定期抓取当前持仓、价格与 K 线数据，并通过 WebSocket 主动下发；
 * 同时支持客户端按需订阅/退订，以减少不必要的数据广播。
 */

import { createLogger } from "../utils/loggerUtils";
import { RISK_PARAMS } from "../config/riskParams.new";
import {
  getCandles,
  getCurrentPositions,
  getSymbolPrices,
  type CandlePoint,
  type PositionSnapshot,
  type PricePoint,
} from "./dashboardDataService";
import {
  websocketService,
  type CandlesSnapshotMessage,
  type DashboardMessage,
  type PricesUpdateMessage,
  type PositionsUpdateMessage,
  type WebSocketClient,
} from "./websocketService";
import { getActiveAccount } from "./accountConfigService";

const DEFAULT_SYMBOLS = ["BTC", "ETH", "SOL", "BNB", "XRP", "DOGE"];
const PRICE_INTERVAL_MS = Number.parseInt(process.env.DASHBOARD_PRICE_INTERVAL_MS || "10000", 10);
const POSITION_INTERVAL_MS = Number.parseInt(process.env.DASHBOARD_POSITION_INTERVAL_MS || "15000", 10);
const CANDLE_INTERVAL_MS = Number.parseInt(process.env.DASHBOARD_CANDLE_INTERVAL_MS || "20000", 10);
const CANDLE_LIMIT = Number.parseInt(process.env.DASHBOARD_CANDLE_LIMIT || "200", 10);
const MIN_CANDLE_LIMIT = 20;
const MAX_CANDLE_LIMIT = 500;

interface NormalizedInterval {
  key: string;
  api: string;
}

interface CandleTask {
  timer: NodeJS.Timeout;
  symbol: string;
  interval: string;
  limit: number;
  fetch: (targets?: Set<WebSocketClient>) => Promise<void>;
}

function normalizeSymbol(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim().toUpperCase();
  if (!trimmed) {
    return null;
  }
  if (!/^[A-Z0-9]{2,}$/u.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function normalizeInterval(value: unknown): NormalizedInterval | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const lower = trimmed.toLowerCase();
  switch (lower) {
    case "1m":
    case "5m":
    case "15m":
    case "1h":
    case "4h":
      return { key: lower, api: trimmed };
    case "1d":
      return { key: "1d", api: trimmed === "1D" ? "1D" : trimmed };
    default:
      return null;
  }
}

function normalizeLimit(limitRaw: unknown): number {
  if (typeof limitRaw === "number" && Number.isFinite(limitRaw)) {
    return Math.min(Math.max(Math.floor(limitRaw), MIN_CANDLE_LIMIT), MAX_CANDLE_LIMIT);
  }
  if (typeof limitRaw === "string" && limitRaw.trim() !== "") {
    const parsed = Number.parseInt(limitRaw, 10);
    if (Number.isFinite(parsed)) {
      return Math.min(Math.max(parsed, MIN_CANDLE_LIMIT), MAX_CANDLE_LIMIT);
    }
  }
  return CANDLE_LIMIT;
}

function clonePositions(positions: PositionSnapshot[]): Array<Record<string, unknown>> {
  return positions.map((pos) => ({ ...pos }));
}

function buildPricePayload(points: PricePoint[], baseMap: Map<string, number>) {
  return points.map(({ symbol, price }) => {
    const previous = baseMap.get(symbol);
    const delta = previous !== undefined ? price - previous : null;
    const percent = previous !== undefined && previous !== 0 ? (delta! / previous) * 100 : null;
    baseMap.set(symbol, price);
    return {
      symbol,
      price,
      delta: delta ?? null,
      percent: percent ?? null,
    };
  });
}

class DashboardBroadcaster {
  private readonly logger = createLogger({
    name: "dashboard-broadcaster",
    level: "info",
  });

  private started = false;
  private trackedSymbols = new Set<string>();
  private priceSubscribers = new Set<WebSocketClient>();
  private positionSubscribers = new Set<WebSocketClient>();
  private candleSubscribers = new Map<string, Set<WebSocketClient>>();
  private clientSubscriptions = new Map<WebSocketClient, Set<string>>();
  private candleTasks = new Map<string, CandleTask>();
  private lastPrices = new Map<string, number>();
  private latestPrices: PricesUpdateMessage | null = null;
  private latestPositions: PositionsUpdateMessage | null = null;
  private latestCandles = new Map<string, CandlesSnapshotMessage>();
  private priceFetchInFlight = false;
  private positionFetchInFlight = false;
  private pendingPositionFetch = false;
  private candleFetchInFlight = new Map<string, boolean>();
  private priceTimer: NodeJS.Timeout | null = null;
  private positionTimer: NodeJS.Timeout | null = null;
  private pendingPriceRefreshTimer: NodeJS.Timeout | null = null;

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;

    this.bootstrapTrackedSymbols();

    websocketService.onConnect((client) => {
      this.handleClientConnect(client);
    });
    websocketService.onDisconnect((client) => {
      this.handleClientDisconnect(client);
    });
    websocketService.onMessage((client, payload) => {
      this.handleClientMessage(client, payload);
    });

    void this.fetchAndBroadcastPrices();
    void this.fetchAndBroadcastPositions();

    this.priceTimer = setInterval(() => {
      void this.fetchAndBroadcastPrices();
    }, PRICE_INTERVAL_MS);

    this.positionTimer = setInterval(() => {
      void this.fetchAndBroadcastPositions();
    }, POSITION_INTERVAL_MS);
  }

  stop(): void {
    if (!this.started) {
      return;
    }
    this.started = false;

    if (this.priceTimer) {
      clearInterval(this.priceTimer);
      this.priceTimer = null;
    }

    if (this.positionTimer) {
      clearInterval(this.positionTimer);
      this.positionTimer = null;
    }

    for (const task of this.candleTasks.values()) {
      clearInterval(task.timer);
    }
    this.candleTasks.clear();
    this.candleSubscribers.clear();
    this.clientSubscriptions.clear();
    this.candleFetchInFlight.clear();

    this.priceSubscribers.clear();
    this.positionSubscribers.clear();

    if (this.pendingPriceRefreshTimer) {
      clearTimeout(this.pendingPriceRefreshTimer);
      this.pendingPriceRefreshTimer = null;
    }
  }

  private bootstrapTrackedSymbols(): void {
    DEFAULT_SYMBOLS.forEach((symbol) => this.trackedSymbols.add(symbol));
    try {
      const configSymbols = RISK_PARAMS.TRADING_SYMBOLS || [];
      configSymbols.forEach((symbol) => {
        const normalized = normalizeSymbol(symbol);
        if (normalized) {
          this.trackedSymbols.add(normalized);
        }
      });
    } catch (error) {
      this.logger.warn("读取配置中的交易币种失败", error);
    }
  }

  private handleClientConnect(client: WebSocketClient): void {
    this.logger.debug("WebSocket 客户端进入 DashBoard 通道");
    if (this.latestPrices) {
      websocketService.send(client, this.latestPrices);
    }
    if (this.latestPositions) {
      websocketService.send(client, this.latestPositions);
    }
  }

  private handleClientDisconnect(client: WebSocketClient): void {
    this.priceSubscribers.delete(client);
    this.positionSubscribers.delete(client);

    const keys = this.clientSubscriptions.get(client);
    if (keys) {
      for (const key of keys) {
        const subscribers = this.candleSubscribers.get(key);
        if (subscribers) {
          subscribers.delete(client);
          if (subscribers.size === 0) {
            this.candleSubscribers.delete(key);
            this.stopCandleTask(key);
          }
        }
      }
      this.clientSubscriptions.delete(client);
    }
  }

  private handleClientMessage(client: WebSocketClient, payload: unknown): void {
    if (!payload || typeof payload !== "object") {
      return;
    }

    const message = payload as Record<string, unknown>;
    const typeRaw = message.type;
    if (typeof typeRaw !== "string") {
      return;
    }

    switch (typeRaw) {
      case "subscribe_positions":
        this.subscribePositions(client);
        break;
      case "subscribe_prices":
        this.subscribePrices(client, message.symbols);
        break;
      case "subscribe_candles":
        this.subscribeCandles(client, message.symbol, message.interval, message.limit);
        break;
      case "unsubscribe_candles":
        this.unsubscribeCandles(client, message.symbol, message.interval);
        break;
      case "ping":
        websocketService.send(client, {
          type: "pong",
          timestamp: new Date().toISOString(),
        });
        break;
      default:
        this.logger.debug(`收到未知的 WebSocket 消息类型: ${typeRaw}`);
    }
  }

  private subscribePositions(client: WebSocketClient): void {
    if (!this.positionSubscribers.has(client)) {
      this.positionSubscribers.add(client);
    }

    if (this.latestPositions) {
      websocketService.send(client, this.latestPositions);
    } else {
      void this.fetchAndBroadcastPositions(new Set([client]));
    }
  }

  private subscribePrices(client: WebSocketClient, symbolsRaw: unknown): void {
    if (!this.priceSubscribers.has(client)) {
      this.priceSubscribers.add(client);
    }

    if (Array.isArray(symbolsRaw)) {
      const added = this.registerSymbols(symbolsRaw);
      if (added) {
        this.schedulePriceRefresh();
      }
    }

    if (this.latestPrices) {
      websocketService.send(client, this.latestPrices);
    } else {
      void this.fetchAndBroadcastPrices(new Set([client]));
    }
  }

  private subscribeCandles(
    client: WebSocketClient,
    symbolRaw: unknown,
    intervalRaw: unknown,
    limitRaw: unknown
  ): void {
    const symbol = normalizeSymbol(symbolRaw);
    const intervalNormalized = normalizeInterval(intervalRaw);
    if (!symbol || !intervalNormalized) {
      return;
    }

    const key = this.getCandleKey(symbol, intervalNormalized.key);
    const limit = normalizeLimit(limitRaw);

    let subscribers = this.candleSubscribers.get(key);
    if (!subscribers) {
      subscribers = new Set();
      this.candleSubscribers.set(key, subscribers);
    }
    if (!subscribers.has(client)) {
      subscribers.add(client);
    }

    let clientKeys = this.clientSubscriptions.get(client);
    if (!clientKeys) {
      clientKeys = new Set();
      this.clientSubscriptions.set(client, clientKeys);
    }
    clientKeys.add(key);

    const existingTask = this.candleTasks.get(key);
    if (existingTask) {
      existingTask.limit = limit;
      this.sendCachedOrFetchCandles(existingTask.fetch, key, symbol, intervalNormalized.api, limit, client);
    } else {
      const task = this.createCandleTask(key, symbol, intervalNormalized.api, limit);
      this.sendCachedOrFetchCandles(task.fetch, key, symbol, intervalNormalized.api, limit, client);
    }

    if (this.registerSymbols([symbol])) {
      this.schedulePriceRefresh();
    }
  }

  private unsubscribeCandles(client: WebSocketClient, symbolRaw: unknown, intervalRaw: unknown): void {
    const symbol = normalizeSymbol(symbolRaw);
    const intervalNormalized = normalizeInterval(intervalRaw);
    if (!symbol || !intervalNormalized) {
      return;
    }

    const key = this.getCandleKey(symbol, intervalNormalized.key);
    const subscribers = this.candleSubscribers.get(key);
    if (subscribers) {
      subscribers.delete(client);
      if (subscribers.size === 0) {
        this.candleSubscribers.delete(key);
        this.stopCandleTask(key);
      }
    }

    const clientKeys = this.clientSubscriptions.get(client);
    if (clientKeys) {
      clientKeys.delete(key);
      if (clientKeys.size === 0) {
        this.clientSubscriptions.delete(client);
      }
    }
  }

  private getCandleKey(symbol: string, intervalKey: string): string {
    return `${symbol.toUpperCase()}::${intervalKey}`;
  }

  private createCandleTask(key: string, symbol: string, interval: string, limit: number): CandleTask {
    const fetch = async (targets?: Set<WebSocketClient>) => {
      const inFlight = this.candleFetchInFlight.get(key);
      if (inFlight) {
        return;
      }
      this.candleFetchInFlight.set(key, true);
      try {
        const candles = await getCandles(symbol, interval, limit);
        const timestamp = new Date().toISOString();
        const message: CandlesSnapshotMessage = {
          type: "candles_snapshot",
          timestamp,
          symbol,
          interval,
          candles: this.cloneCandles(candles),
        };
        this.latestCandles.set(key, message);

        const recipients = targets && targets.size > 0 ? targets : this.candleSubscribers.get(key);
        if (recipients && recipients.size > 0) {
          this.sendToClients(recipients, message);
        }
      } catch (error) {
        this.logger.error(`获取 ${symbol} ${interval} K线数据失败:`, error);
      } finally {
        this.candleFetchInFlight.set(key, false);
      }
    };

    const timer = setInterval(() => {
      void fetch();
    }, CANDLE_INTERVAL_MS);

    const task: CandleTask = {
      timer,
      symbol,
      interval,
      limit,
      fetch,
    };

    this.candleTasks.set(key, task);
    return task;
  }

  private stopCandleTask(key: string): void {
    const task = this.candleTasks.get(key);
    if (!task) {
      return;
    }
    clearInterval(task.timer);
    this.candleTasks.delete(key);
    this.candleFetchInFlight.delete(key);
  }

  private sendCachedOrFetchCandles(
    fetchFn: (targets?: Set<WebSocketClient>) => Promise<void>,
    key: string,
    symbol: string,
    interval: string,
    limit: number,
    client: WebSocketClient
  ): void {
    const cached = this.latestCandles.get(key);
    if (cached) {
      websocketService.send(client, cached);
      return;
    }
    void fetchFn(new Set([client]));
  }

  private cloneCandles(candles: CandlePoint[]): CandlePoint[] {
    return candles.map((candle) => ({ ...candle }));
  }

  private async fetchAndBroadcastPrices(targets?: Set<WebSocketClient>): Promise<void> {
    if (this.priceFetchInFlight) {
      return;
    }
    this.priceFetchInFlight = true;
    try {
      const symbols = Array.from(this.trackedSymbols);
      if (!symbols.length) {
        return;
      }
      const points = await getSymbolPrices(symbols);
      const timestamp = new Date().toISOString();
      const prices = buildPricePayload(points, this.lastPrices);

      const message: PricesUpdateMessage = {
        type: "prices_update",
        timestamp,
        prices,
      };
      this.latestPrices = message;

      const recipients = targets && targets.size > 0 ? targets : this.priceSubscribers;
      if (recipients.size > 0) {
        this.sendToClients(recipients, message);
      }
    } catch (error) {
      this.logger.error("获取价格数据失败:", error);
    } finally {
      this.priceFetchInFlight = false;
    }
  }

  private async fetchAndBroadcastPositions(targets?: Set<WebSocketClient>): Promise<void> {
    if (this.positionFetchInFlight) {
      this.pendingPositionFetch = true;
      return;
    }
    this.positionFetchInFlight = true;
    this.pendingPositionFetch = false;
    try {
      const positions = await getCurrentPositions();
      const timestamp = new Date().toISOString();
      // 获取当前活跃账户ID
      const activeAccount = await getActiveAccount();
      const accountId = activeAccount?.id ?? null;

      const message: PositionsUpdateMessage = {
        type: "positions_update",
        timestamp,
        accountId, // 包含账户ID，前端可以验证是否匹配
        positions: clonePositions(positions),
      };
      this.latestPositions = message;

      this.registerSymbols(positions.map((pos) => pos.symbol));

      const recipients = targets && targets.size > 0 ? targets : this.positionSubscribers;
      if (recipients.size > 0) {
        this.sendToClients(recipients, message);
      }
    } catch (error) {
      this.logger.error("获取持仓数据失败:", error);
    } finally {
      this.positionFetchInFlight = false;
      if (this.pendingPositionFetch) {
        void this.fetchAndBroadcastPositions();
      }
    }
  }

  private registerSymbols(symbols: unknown[]): boolean {
    let added = false;
    for (const symbol of symbols) {
      const normalized = normalizeSymbol(symbol);
      if (normalized && !this.trackedSymbols.has(normalized)) {
        this.trackedSymbols.add(normalized);
        added = true;
      }
    }
    return added;
  }

  private schedulePriceRefresh(): void {
    if (this.pendingPriceRefreshTimer) {
      return;
    }
    this.pendingPriceRefreshTimer = setTimeout(() => {
      this.pendingPriceRefreshTimer = null;
      void this.fetchAndBroadcastPrices();
    }, 250);
  }

  private sendToClients(clients: Iterable<WebSocketClient>, message: DashboardMessage): void {
    for (const client of clients) {
      websocketService.send(client, message);
    }
  }

  /**
   * 强制刷新持仓数据并广播
   */
  public async refreshPositions(): Promise<void> {
    await this.fetchAndBroadcastPositions();
  }
}

const dashboardBroadcaster = new DashboardBroadcaster();

export function startDashboardBroadcaster(): void {
  dashboardBroadcaster.start();
}

export function stopDashboardBroadcaster(): void {
  dashboardBroadcaster.stop();
}

export { dashboardBroadcaster };
