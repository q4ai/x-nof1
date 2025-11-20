import { ProxyAgent, type Dispatcher } from "undici";
import { createLogger } from "../utils/loggerUtils";
import { getExchangeCredentials, getExchangeProxy } from "../config/exchange";
import { BinanceClient } from "./binanceClient";

type HttpMethod = "GET" | "POST" | "DELETE";

type RequestParams = Record<string, string | number | boolean | undefined>;

type OrderParams = {
  contract: string;
  size: number;
  price?: number;
  tif?: string;
  reduceOnly?: boolean;
  stopLoss?: number;
  takeProfit?: number;
  positionSide?: "long" | "short" | "net";
  marginMode?: "cross" | "isolated";
};

type RawPosition = {
  instId: string;
  posSide?: string;
  pos?: string;
  avgPx?: string;
  markPx?: string;
  lever?: string;
  mgn?: string;
  imr?: string;
  upl?: string;
  liqPx?: string;
  cTime?: string;
  uTime?: string;
  mgnMode?: string;
};

export type OkxPosition = {
  instId: string;
  contract: string;
  size: string;
  entryPrice: string;
  markPrice: string;
  leverage: string;
  margin: string;
  unrealisedPnl: string;
  liqPrice: string;
  posSide: string;
  createTime?: string;
  updateTime?: string;
  marginMode?: "cross" | "isolated" | string;
};

type FetchOptions = RequestInit & { dispatcher?: Dispatcher };

const logger = createLogger({
  name: "okx-client",
  level: "info",
});

async function hmacSha256Base64(secret: string, message: string): Promise<string> {
  const cryptoObj = (globalThis as any).crypto;
  const TextEncoderCtor = (globalThis as any).TextEncoder;

  if (!cryptoObj || !cryptoObj.subtle || !TextEncoderCtor) {
    throw new Error("当前运行环境不支持 HMAC-SHA256 算法");
  }

  const encoder = new TextEncoderCtor();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(message);

  const key = await cryptoObj.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await cryptoObj.subtle.sign("HMAC", key, messageData);
  return toBase64(new Uint8Array(signature));
}

function toBase64(bytes: Uint8Array): string {
  const BufferCtor = (globalThis as any).Buffer;
  if (BufferCtor) {
    return BufferCtor.from(bytes).toString("base64");
  }

  const base64Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let result = "";

  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : undefined;
    const c = i + 2 < bytes.length ? bytes[i + 2] : undefined;

    const enc1 = a >> 2;
    const enc2 = ((a & 0b11) << 4) | ((b ?? 0) >> 4);
    const enc3 = b !== undefined ? (((b & 0b1111) << 2) | ((c ?? 0) >> 6)) : 64;
    const enc4 = c !== undefined ? (c & 0b111111) : 64;

    result += base64Chars[enc1];
    result += base64Chars[enc2];
    result += b !== undefined ? base64Chars[enc3] : "=";
    result += c !== undefined ? base64Chars[enc4] : "=";
  }

  return result;
}

function toQuery(params?: RequestParams): string {
  if (!params) return "";
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    query.append(key, String(value));
  }
  const qs = query.toString();
  return qs ? `?${qs}` : "";
}

function safeNumber(value: string | number | undefined, fallback = 0): number {
  const num = typeof value === "number" ? value : Number.parseFloat(value ?? "NaN");
  return Number.isFinite(num) ? num : fallback;
}

function toIsoTimestamp(value?: string): string | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return undefined;
  const timestamp = parsed < 1_000_000_000_000 ? parsed * 1000 : parsed;
  return new Date(timestamp).toISOString();
}

function normalizeBar(interval: string): string {
  if (!interval) return interval;
  const match = /^([0-9]+)([a-zA-Z]+)$/.exec(interval.trim());
  if (!match) return interval;
  const [, amount, unit] = match;
  const lowerUnit = unit.toLowerCase();

  if (lowerUnit === "m") {
    return `${amount}m`;
  }

  if (lowerUnit.length === 1) {
    return `${amount}${unit.toUpperCase()}`;
  }

  return `${amount}${unit.toUpperCase()}`;
}

export class OkxClient {
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly passphrase: string;
  private readonly simulated: boolean;
  private readonly baseUrl: string;
  private readonly dispatcher?: Dispatcher;
  private readonly orderContractCache = new Map<string, string>();

  constructor(
    apiKey: string,
    apiSecret: string,
    passphrase: string,
    simulated: boolean,
    proxyUrl?: string
  ) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.passphrase = passphrase;
    this.simulated = simulated;
    this.baseUrl = "https://www.okx.com";

    if (proxyUrl) {
      try {
        this.dispatcher = new ProxyAgent(proxyUrl);
        logger.info("已启用 HTTP 代理访问 OKX API");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(`HTTP 代理初始化失败，将直接访问 OKX API: ${message}`);
      }
    }

    logger.info(this.simulated ? "使用 OKX 模拟交易环境" : "使用 OKX 正式交易环境");
  }

  private contractToInstrument(contract: string): string {
    const symbol = contract.replace(/_/g, "-");
    if (symbol.endsWith("-SWAP")) return symbol;
    return `${symbol}-SWAP`;
  }

  private instrumentToContract(instId: string): string {
    if (!instId) return instId;
    const cleaned = instId.replace(/-SWAP$/, "");
    return cleaned.replace(/-/g, "_");
  }

  private async sign(timestamp: string, method: HttpMethod, requestPath: string, body: string = ""): Promise<string> {
    const message = `${timestamp}${method}${requestPath}${body}`;
    return hmacSha256Base64(this.apiSecret, message);
  }

  private async request<T>(
    method: HttpMethod,
    path: string,
    params?: RequestParams,
    body?: Record<string, unknown>,
    auth?: boolean
  ): Promise<T>;

  private async request<T>(
    method: HttpMethod,
    path: string,
    params: RequestParams | undefined,
    body: Record<string, unknown> | undefined,
    auth: boolean | undefined,
    returnMeta: true
  ): Promise<{
    data: T;
    raw: any;
    request: {
      url: string;
      method: HttpMethod;
      path: string;
      params?: RequestParams;
      body?: Record<string, unknown>;
    };
  }>;

  private async request<T>(
    method: HttpMethod,
    path: string,
    params?: RequestParams,
    body?: Record<string, unknown>,
    auth: boolean = true,
    returnMeta: boolean = false
  ): Promise<
    T | {
      data: T;
      raw: any;
      request: {
        url: string;
        method: HttpMethod;
        path: string;
        params?: RequestParams;
        body?: Record<string, unknown>;
      };
    }
  > {
    const query = toQuery(params);
    const requestPath = `${path}${query}`;
    const url = `${this.baseUrl}${requestPath}`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    const payload = method === "GET" || !body ? "" : JSON.stringify(body);

    if (auth) {
      const timestamp = new Date().toISOString();
      headers["OK-ACCESS-KEY"] = this.apiKey;
      headers["OK-ACCESS-TIMESTAMP"] = timestamp;
      headers["OK-ACCESS-PASSPHRASE"] = this.passphrase;
      headers["OK-ACCESS-SIGN"] = await this.sign(timestamp, method, requestPath, payload);
      if (this.simulated) {
        headers["x-simulated-trading"] = "1";
      }
    }

    const options: FetchOptions = {
      method,
      headers,
      body: method === "GET" ? undefined : payload,
    };

    if (this.dispatcher) {
      options.dispatcher = this.dispatcher;
    }

    const requestInfo = {
      url,
      method,
      path,
      params,
      body,
    } as const;

    try {
      const response = await fetch(url, options as RequestInit);

      if (!response.ok) {
        const text = await response.text();
        const error: any = new Error(`OKX API 请求失败: ${response.status} ${response.statusText} - ${text}`);
        error.rawResponse = text;
        error.rawRequest = requestInfo;
        throw error;
      }

      const json: any = await response.json();
      if (json.code && json.code !== "0") {
        const error: any = new Error(`OKX API 错误: ${json.code} - ${json.msg || json.data?.[0]?.sMsg || "未知错误"}`);
        error.rawResponse = json;
        error.rawRequest = requestInfo;
        throw error;
      }

      const data = json.data as T;
      if (returnMeta) {
        return {
          data,
          raw: json,
          request: requestInfo,
        } as any;
      }

      return data;
    } catch (error: any) {
      if (!error.rawRequest) {
        error.rawRequest = requestInfo;
      }
      throw error;
    }
  }

  async getFuturesTicker(contract: string) {
    const instId = this.contractToInstrument(contract);
    const [ticker] = await this.request<any[]>("GET", "/api/v5/market/ticker", { instId }, undefined, false);
    if (!ticker) {
      throw new Error(`未获取到 ${instId} 行情数据`);
    }

    const last = ticker.last ?? ticker.lastPx ?? ticker.px ?? "0";
    const open24h = ticker.open24h ?? ticker.openPx ?? last;
    const changePercentage = safeNumber(last) && safeNumber(open24h)
      ? ((safeNumber(last) - safeNumber(open24h)) / Math.max(safeNumber(open24h), 1e-8)) * 100
      : 0;

    return {
      instId,
      contract,
      last: String(last),
      markPrice: ticker.markPx ?? ticker.last ?? ticker.lastPx ?? "0",
      change_percentage: changePercentage,
      volume_24h: ticker.volCcy24h ?? ticker.vol24h ?? "0",
      fundingRate: ticker.fundingRate ?? "0",
    };
  }

  async getFundingRate(contract: string) {
    const instId = this.contractToInstrument(contract);
    const [rate] = await this.request<any[]>("GET", "/api/v5/public/funding-rate", { instId }, undefined, false);
    return rate ?? null;
  }

  async getFuturesCandles(contract: string, interval: string = "5m", limit: number = 100) {
    const instId = this.contractToInstrument(contract);
    const normalizedBar = normalizeBar(interval);
    const data = await this.request<any[]>(
      "GET",
      "/api/v5/market/candles",
      { instId, bar: normalizedBar, limit },
      undefined,
      false
    );

    return data
      .map((candle) => {
        // OKX 返回 [ts, o, h, l, c, vol, volCcy, volCcyQuote, confirm]
        const [ts, o, h, l, c, vol] = candle;
        return {
          t: Number.parseInt(ts, 10),
          o,
          h,
          l,
          c,
          v: vol,
        };
      })
      .reverse();
  }

  async getFuturesAccount() {
    const data = await this.request<any[]>("GET", "/api/v5/account/balance", { ccy: "USDT" });
    const first = data?.[0];
    const detail = first?.details?.[0] ?? {};
    const totalEq = safeNumber(first?.totalEq, 0); // 账户总权益（包含未实现盈亏）
    const available = safeNumber(detail.availBal ?? first?.availEq, 0);
    const unrealised = safeNumber(detail.upl ?? first?.uPnl, 0);
    const positionMargin = Math.max(totalEq - available, 0);

    // 为了兼容 Binance 的逻辑（totalWalletBalance 不含未实现盈亏），
    // 这里我们将 OKX 的 totalEq 减去 unrealisedPnl，还原出“钱包余额”。
    // 这样前端统一执行 totalBalance + unrealisedPnl 就不会重复计算了。
    const walletBalance = totalEq - unrealised;

    return {
      total: String(walletBalance),
      available: String(available),
      positionMargin: String(positionMargin),
      unrealisedPnl: String(unrealised),
    };
  }

  async getPositions(): Promise<OkxPosition[]> {
    const positions = await this.request<RawPosition[]>("GET", "/api/v5/account/positions", {
      instType: "SWAP",
    });

    if (!positions) return [];

    return positions.map((pos) => {
      const instId = pos.instId;
      const contract = this.instrumentToContract(instId);
      const posSide = pos.posSide ?? "net";
      const size = safeNumber(pos.pos, 0);
      const direction = posSide === "short" ? -size : size;
      const createTime = toIsoTimestamp(pos.cTime);
      const updateTime = toIsoTimestamp(pos.uTime);
      const marginMode = (pos.mgnMode ?? "cross").toLowerCase() === "isolated" ? "isolated" : "cross";

      return {
        instId,
        contract,
        size: String(direction),
        entryPrice: pos.avgPx ?? "0",
        markPrice: pos.markPx ?? "0",
        leverage: pos.lever ?? "1",
        margin: pos.mgn ?? pos.imr ?? "0",
        unrealisedPnl: pos.upl ?? "0",
        liqPrice: pos.liqPx ?? "0",
        posSide,
        createTime,
        updateTime,
        marginMode,
      };
    });
  }

  async getOrderBook(contract: string, depth: number = 10) {
    const instId = this.contractToInstrument(contract);
    const [book] = await this.request<any[]>(
      "GET",
      "/api/v5/market/books",
      { instId, sz: depth },
      undefined,
      false
    );

    const mapSide = (entries: any[]) =>
      (entries ?? []).map(([price, size]: [string, string]) => ({
        p: price,
        s: size,
      }));

    return {
      instId,
      contract,
      bids: mapSide(book?.bids ?? []),
      asks: mapSide(book?.asks ?? []),
      ts: book?.ts,
    };
  }

  async getContractInfo(contract: string) {
    const instId = this.contractToInstrument(contract);
    const [instrument] = await this.request<any[]>(
      "GET",
      "/api/v5/public/instruments",
      { instType: "SWAP", instId },
      undefined,
      false
    );

    if (!instrument) {
      throw new Error(`未找到合约 ${instId} 信息`);
    }

    return {
      instId,
      contract,
      tickSize: instrument.tickSz,
      minSize: instrument.minSz,
      maxSize: instrument.maxMktSz ?? instrument.maxSz,
      lotSize: instrument.lotSz,
      contractValue: instrument.ctVal,
      contractMultiplier: instrument.ctMult,
      quoteCcy: instrument.quoteCcy,
      baseCcy: instrument.baseCcy,
      orderSizeMin: instrument.minSz,
      orderSizeMax: instrument.maxMktSz ?? instrument.maxSz,
      quantoMultiplier: instrument.ctVal,
    };
  }

  async getAllContracts() {
    const instruments = await this.request<any[]>(
      "GET",
      "/api/v5/public/instruments",
      { instType: "SWAP" },
      undefined,
      false
    );

    return instruments.map((instrument) => ({
      ...instrument,
      contract: this.instrumentToContract(instrument.instId),
    }));
  }

  async setLeverage(contract: string, leverage: number, marginMode: "cross" | "isolated" = "cross") {
    const instId = this.contractToInstrument(contract);
    try {
      const body = {
        instId,
        lever: String(leverage),
        mgnMode: marginMode === "isolated" ? "isolated" : "cross",
        posSide: "net",
      };
      await this.request("POST", "/api/v5/account/set-leverage", undefined, body);
      return true;
    } catch (error: any) {
      logger.warn(`设置 ${instId} 杠杆失败: ${error.message}`);
      return null;
    }
  }

  async placeOrder(params: OrderParams) {
    const instId = this.contractToInstrument(params.contract);
    const sizeAbs = Math.abs(params.size);
    if (sizeAbs <= 0) {
      throw new Error("订单数量必须大于0");
    }

    const isLong = params.size > 0;
    const posSide = params.positionSide ?? (isLong ? "long" : "short");
    const tdMode = params.marginMode === "isolated" ? "isolated" : "cross";
    const body: Record<string, string> = {
      instId,
      tdMode,
      side: isLong ? "buy" : "sell",
      posSide,
      ordType: params.price && params.price > 0 ? "limit" : "market",
      sz: String(sizeAbs),
      tag: "67b11c709011SUDE"
    };

    if (params.price && params.price > 0) {
      body.px = String(params.price);
    }

    if (params.reduceOnly) {
      body.reduceOnly = "true";
    }

    if (params.stopLoss && params.stopLoss > 0) {
      body.slTriggerPx = String(params.stopLoss);
      body.slOrdPx = "-1"; // 市价触发
    }

    if (params.takeProfit && params.takeProfit > 0) {
      body.tpTriggerPx = String(params.takeProfit);
      body.tpOrdPx = "-1";
    }

    const response = await this.request<any[]>(
      "POST",
      "/api/v5/trade/order",
      undefined,
      body,
      true,
      true
    );

    const [order] = response.data ?? [];

    if (!order) {
      const error: any = new Error("OKX 返回的订单数据为空");
      error.rawResponse = response.raw;
      error.rawRequest = response.request;
      throw error;
    }

    if (order?.ordId) {
      this.orderContractCache.set(order.ordId, params.contract);
    }

    const result = {
      id: order.ordId,
      clientOrderId: order.clOrdId,
      status: order.state ?? "live",
      size: String(sizeAbs),
      price: order.px ?? null,
      avgPrice: order.avgPx ?? null,
      fill_price: order.avgPx ?? null,
      left: order.accFillSz ? String(sizeAbs - safeNumber(order.accFillSz, 0)) : String(sizeAbs),
      instId,
      contract: params.contract,
    };

    return {
      ...result,
      raw: {
        request: response.request,
        response: response.raw,
      },
    };
  }

  async getOrder(orderId: string, contract?: string, _clientOrderId?: string) {
    const resolvedContract = contract || (await this.resolveContractForOrder(orderId));
    if (!resolvedContract) {
      throw new Error(`无法确定订单 ${orderId} 对应的合约`);
    }

    const instId = this.contractToInstrument(resolvedContract);
    const [order] = await this.request<any[]>("GET", "/api/v5/trade/order", {
      instId,
      ordId: orderId,
    });

    if (!order) {
      throw new Error(`未找到订单 ${orderId}`);
    }

    this.orderContractCache.set(orderId, resolvedContract);

    const size = safeNumber(order.sz, 0);
    const filled = safeNumber(order.accFillSz, 0);

    return {
      id: order.ordId,
      status: order.state,
      size: String(size),
      left: String(Math.max(size - filled, 0)),
      fill_price: order.avgPx ?? order.fillPx ?? null,
      price: order.px ?? null,
      contract: resolvedContract,
      side: order.side,
      posSide: order.posSide,
      create_time: order.cTime,
      finish_time: order.uTime,
    };
  }

  async cancelOrder(contract: string, orderId: string) {
    const instId = this.contractToInstrument(contract);
    const response = await this.request<any[]>(
      "POST",
      "/api/v5/trade/cancel-order",
      undefined,
      {
        instId,
        ordId: orderId,
      },
      true,
      true
    );
    const [result] = response.data ?? [];
    return {
      result,
      raw: {
        request: response.request,
        response: response.raw,
      },
    };
  }

  async getOpenOrders(contract?: string) {
    const params: RequestParams = {
      instType: "SWAP",
    };

    if (contract) {
      params.instId = this.contractToInstrument(contract);
    }

    const orders = await this.request<any[]>("GET", "/api/v5/trade/orders-pending", params);
    return (orders || []).map((order) => {
      const contractCode = this.instrumentToContract(order.instId);
      if (order?.ordId) {
        this.orderContractCache.set(order.ordId, contractCode);
      }
      return {
        ...order,
        contract: contractCode,
      };
    });
  }

  async getOrderHistory(contract?: string, limit = 10) {
    const params: RequestParams = {
      instType: "SWAP",
      limit,
    };
    if (contract) {
      params.instId = this.contractToInstrument(contract);
    }
    const orders = await this.request<any[]>("GET", "/api/v5/trade/orders-history-archive", params);
    (orders || []).forEach((order) => {
      if (order?.ordId) {
        this.orderContractCache.set(order.ordId, this.instrumentToContract(order.instId));
      }
    });
    return orders ?? [];
  }

  async getMyTrades(contract?: string, limit = 10) {
    const params: RequestParams = {
      instType: "SWAP",
      limit,
    };
    if (contract) {
      params.instId = this.contractToInstrument(contract);
    }
    const trades = await this.request<any[]>("GET", "/api/v5/trade/fills", params);
    (trades || []).forEach((trade) => {
      if (trade?.ordId) {
        this.orderContractCache.set(trade.ordId, this.instrumentToContract(trade.instId));
      }
    });
    return trades ?? [];
  }

  async getPositionHistory(contract?: string, limit = 100, after?: string) {
    const params: RequestParams = {
      instType: "SWAP",
      limit,
    };
    if (contract) {
      params.instId = this.contractToInstrument(contract);
    }
    if (after) {
      params.after = after;
    }
    const history = await this.request<any[]>("GET", "/api/v5/account/positions-history", params);
    return history ?? [];
  }

  async getSettlementHistory(contract?: string, limit = 100, after?: string) {
    const params: RequestParams = {
      instType: "SWAP",
      limit,
    };
    if (contract) {
      params.instId = this.contractToInstrument(contract);
    }
    if (after) {
      params.after = after;
    }
    const history = await this.request<any[]>("GET", "/api/v5/account/positions-history", params);
    return history ?? [];
  }

  private async resolveContractForOrder(orderId: string): Promise<string | undefined> {
    if (this.orderContractCache.has(orderId)) {
      return this.orderContractCache.get(orderId);
    }

    const pending = await this.getOpenOrders();
    const pendingMatch = (pending || []).find((order: any) => order?.ordId === orderId);
    if (pendingMatch?.instId) {
      const contract = this.instrumentToContract(pendingMatch.instId);
      this.orderContractCache.set(orderId, contract);
      return contract;
    }

    const history = await this.getOrderHistory(undefined, 100);
    const historyMatch = (history || []).find((order: any) => order?.ordId === orderId);
    if (historyMatch?.instId) {
      const contract = this.instrumentToContract(historyMatch.instId);
      this.orderContractCache.set(orderId, contract);
      return contract;
    }

    return undefined;
  }
}

type ExchangeHttpClient = OkxClient | BinanceClient;

let clientInstance: ExchangeHttpClient | null = null;

function buildExchangeClient(): ExchangeHttpClient {
  const credentials = getExchangeCredentials();
  const proxyUrl = getExchangeProxy() || undefined;

  if (credentials.provider === "binance") {
    if (!credentials.apiKey || !credentials.apiSecret) {
      throw new Error("请在环境变量或数据库配置中设置 BINANCE_API_KEY / BINANCE_API_SECRET");
    }
    return new BinanceClient(credentials.apiKey, credentials.apiSecret, credentials.testnet, proxyUrl);
  }

  if (!credentials.apiKey || !credentials.apiSecret || !credentials.passphrase) {
    throw new Error("请在环境变量或数据库配置中设置 OKX_API_KEY / OKX_API_SECRET / OKX_API_PASSPHRASE");
  }

  return new OkxClient(credentials.apiKey, credentials.apiSecret, credentials.passphrase, credentials.simulated, proxyUrl);
}

export function createOkxClient(): ExchangeHttpClient {
  if (clientInstance) {
    return clientInstance;
  }

  clientInstance = buildExchangeClient();
  return clientInstance;
}

/**
 * 重置客户端实例（配置更新后调用）
 */
export function resetOkxClient(): void {
  clientInstance = null;
  logger.info("合约交易客户端实例已重置");
}

/**
 * 使用指定配置创建客户端
 */
export function createOkxClientWithConfig(
  apiKey: string,
  apiSecret: string,
  passphrase: string,
  simulated: boolean,
  proxyUrl?: string
): ExchangeHttpClient {
  clientInstance = new OkxClient(apiKey, apiSecret, passphrase, simulated, proxyUrl);
  return clientInstance;
}

export function createExchangeClient() {
  return createOkxClient();
}
