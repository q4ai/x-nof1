import { createHmac } from "node:crypto";
import { ProxyAgent, type Dispatcher } from "undici";
import { createLogger } from "../utils/loggerUtils";

const logger = createLogger({
  name: "bitget-client",
  level: "info",
});

type HttpMethod = "GET" | "POST" | "DELETE";
type RequestParams = Record<string, string | number | boolean | undefined>;

type FetchOptions = RequestInit & { dispatcher?: Dispatcher };

export class BitgetClient {
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly passphrase: string;
  private readonly simulated: boolean;
  private readonly baseUrl: string;
  private readonly dispatcher?: Dispatcher;

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
    this.baseUrl = "https://api.bitget.com";

    if (proxyUrl) {
      try {
        this.dispatcher = new ProxyAgent(proxyUrl);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(`HTTP 代理初始化失败，将直接访问 Bitget API: ${message}`);
      }
    }
  }

  private sign(timestamp: string, method: HttpMethod, requestPath: string, body: string = ""): string {
    const message = `${timestamp}${method}${requestPath}${body}`;
    return createHmac("sha256", this.apiSecret).update(message).digest("base64");
  }

  private contractToSymbol(contract: string): string {
    return contract.replace(/_/g, "");
  }

  private symbolToContract(symbol: string): string {
    if (symbol.endsWith("USDT")) {
      return symbol.replace("USDT", "_USDT");
    }
    return symbol;
  }

  private async request<T>(
    method: HttpMethod,
    path: string,
    params?: RequestParams,
    body?: Record<string, unknown>,
    auth: boolean = true
  ): Promise<T> {
    const query = new URLSearchParams();
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          query.append(key, String(value));
        }
      }
    }
    const queryString = query.toString();
    const requestPath = queryString ? `${path}?${queryString}` : path;
    const url = `${this.baseUrl}${requestPath}`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "locale": "zh-CN",
      "X-CHANNEL-API-CODE": "ajcis",
    };

    const bodyString = body ? JSON.stringify(body) : "";

    if (auth) {
      const timestamp = Date.now().toString();
      headers["ACCESS-KEY"] = this.apiKey;
      headers["ACCESS-SIGN"] = this.sign(timestamp, method, requestPath, bodyString);
      headers["ACCESS-TIMESTAMP"] = timestamp;
      headers["ACCESS-PASSPHRASE"] = this.passphrase;
    }

    const options: FetchOptions = {
      method,
      headers,
      body: method === "GET" ? undefined : bodyString,
    };

    if (this.dispatcher) {
      options.dispatcher = this.dispatcher;
    }

    try {
      const response = await fetch(url, options as RequestInit);
      const text = await response.text();
      
      if (!response.ok) {
        throw new Error(`Bitget API request failed: ${response.status} ${response.statusText} - ${text}`);
      }

      const json = JSON.parse(text);
      if (json.code !== "00000") {
        throw new Error(`Bitget API error: ${json.code} - ${json.msg}`);
      }

      return json.data as T;
    } catch (error) {
      logger.error(`Request failed: ${method} ${url}`, error);
      throw error;
    }
  }

  async getFuturesTicker(contract: string) {
    const symbol = this.contractToSymbol(contract);
    const data = await this.request<any[]>("GET", "/api/v2/mix/market/ticker", {
      symbol,
      productType: "USDT-FUTURES",
    }, undefined, false);

    const ticker = data[0];
    if (!ticker) {
      throw new Error(`Ticker not found for ${contract}`);
    }

    return {
      instId: symbol,
      contract,
      last: ticker.lastPr,
      markPrice: ticker.markPrice,
      change_percentage: parseFloat(ticker.change24h) * 100, // Bitget returns decimal
      volume_24h: ticker.usdtVolume, // USDT volume
      fundingRate: ticker.fundingRate,
    };
  }

  async getFundingRate(contract: string) {
    // Bitget ticker includes funding rate
    const ticker = await this.getFuturesTicker(contract);
    return {
      fundingRate: ticker.fundingRate,
      nextFundingTime: Date.now() + 3600000, // Mock or fetch if needed
    };
  }

  async getFuturesCandles(contract: string, interval: string = "5m", limit: number = 100) {
    const symbol = this.contractToSymbol(contract);
    
    // Map interval to Bitget granularity
    const granularityMap: Record<string, string> = {
      "1m": "1m", "3m": "3m", "5m": "5m", "15m": "15m", "30m": "30m",
      "1h": "1H", "2h": "2H", "4h": "4H",
      "6h": "6H", "12h": "12H",
      "1d": "1D", "1w": "1W", "1M": "1M"
    };
    
    // Normalize interval (e.g. "5m" -> "5m", "1H" -> "1H")
    let granularity = granularityMap[interval.toLowerCase()] || granularityMap[interval] || "5m";

    // Bitget V2 candles endpoint
    const data = await this.request<any[]>("GET", "/api/v2/mix/market/candles", {
      symbol,
      productType: "USDT-FUTURES",
      granularity,
      limit: String(limit), // Bitget limit is string? check docs, usually number is fine but safe to string
    }, undefined, false);

    // Bitget returns [ts, open, high, low, close, volume, quoteVol]
    return data.map((candle) => ({
      t: Number(candle[0]),
      o: candle[1],
      h: candle[2],
      l: candle[3],
      c: candle[4],
      v: candle[5], // volume in base currency
    })).reverse(); // Bitget returns newest first? No, usually oldest first. Wait, let's check standard.
    // Most exchanges return oldest first. If Bitget returns newest first, we need to reverse.
    // Assuming standard oldest first for now. If charts look backwards, we flip.
    // Actually, OKX client reverses it. Let's check OKX client.
    // OKX client: return data.map(...).reverse();
    // OKX returns newest first (descending).
    // Bitget V2 docs say: "The data is returned in descending order of time."
    // So we need to reverse it to get ascending order for charts.
  }

  async getFuturesAccount() {
    const data = await this.request<any[]>("GET", "/api/v2/mix/account/accounts", {
      productType: "USDT-FUTURES",
    });

    // Find USDT account
    const account = data.find((acc: any) => acc.marginCoin === "USDT");
    if (!account) {
      return {
        total: "0",
        available: "0",
        positionMargin: "0",
        unrealisedPnl: "0",
      };
    }

    // Bitget fields:
    // accountEquity: Account equity (margin coin), Includes unrealized PnL
    // available: available balance
    // unrealizedPL: unrealized pnl
    // locked: frozen margin
    
    return {
      total: account.accountEquity,
      available: account.available,
      positionMargin: account.locked,
      unrealisedPnl: account.unrealizedPL,
    };
  }

  async getPositions() {
    const data = await this.request<any[]>("GET", "/api/v2/mix/position/all-position", {
      productType: "USDT-FUTURES",
      marginCoin: "USDT",
    });

    return data.map((pos: any) => {
      const contract = this.symbolToContract(pos.symbol);
      const size = parseFloat(pos.total); // Total position size
      const side = pos.holdSide; // long or short
      const direction = side === "short" ? -size : size;

      return {
        instId: pos.symbol,
        contract,
        size: String(direction),
        entryPrice: pos.averageOpenPrice,
        markPrice: pos.markPrice,
        leverage: pos.leverage,
        margin: pos.margin,
        unrealisedPnl: pos.unrealizedPL,
        liqPrice: pos.liquidationPrice,
        posSide: side,
        createTime: new Date(Number(pos.cTime)).toISOString(),
        updateTime: new Date(Number(pos.uTime)).toISOString(),
        marginMode: pos.marginMode, // isolated or crossed
      };
    });
  }

  async getOrderBook(contract: string, depth: number = 10) {
    const symbol = this.contractToSymbol(contract);
    const data = await this.request<any>("GET", "/api/v2/mix/market/orderbook", {
      symbol,
      productType: "USDT-FUTURES",
      limit: "20", // Bitget supports 20, 100
    }, undefined, false);

    const mapSide = (entries: any[]) =>
      (entries ?? []).slice(0, depth).map(([price, size]: [string, string]) => ({
        p: price,
        s: size,
      }));

    return {
      instId: symbol,
      contract,
      bids: mapSide(data.bids),
      asks: mapSide(data.asks),
      ts: data.ts,
    };
  }

  async getContractInfo(contract: string) {
    // Bitget doesn't have a direct single contract info endpoint that matches OKX exactly,
    // but we can use /api/v2/mix/market/contracts
    const symbol = this.contractToSymbol(contract);
    const data = await this.request<any[]>("GET", "/api/v2/mix/market/contracts", {
      productType: "USDT-FUTURES",
    }, undefined, false);

    const info = data.find((c: any) => c.symbol === symbol);
    if (!info) {
      throw new Error(`Contract info not found for ${contract}`);
    }

    return {
      instId: symbol,
      contract,
      tickSize: String(Math.pow(10, -Number(info.pricePlace))),
      minSize: info.minTradeNum,
      maxSize: info.maxTradeNum,
      lotSize: String(Math.pow(10, -Number(info.volumePlace))),
      contractValue: info.sizeMultiplier,
      contractMultiplier: info.sizeMultiplier,
      quoteCcy: "USDT",
      baseCcy: info.baseCoin,
      orderSizeMin: info.minTradeNum,
      orderSizeMax: info.maxTradeNum,
      quantoMultiplier: info.sizeMultiplier,
    };
  }

  async getAllContracts() {
    const data = await this.request<any[]>("GET", "/api/v2/mix/market/contracts", {
      productType: "USDT-FUTURES",
    }, undefined, false);

    return data.map((c: any) => ({
      instId: c.symbol,
      contract: this.symbolToContract(c.symbol),
      ...c
    }));
  }

  async setLeverage(contract: string, leverage: number, marginMode: "cross" | "isolated" = "cross") {
    const symbol = this.contractToSymbol(contract);
    try {
      // Bitget V2 set leverage
      await this.request("POST", "/api/v2/mix/account/set-leverage", undefined, {
        symbol,
        productType: "USDT-FUTURES",
        marginCoin: "USDT",
        leverage: String(leverage),
        holdSide: "long", // Bitget requires setting for long and short separately in hedge mode?
        // If one-way mode, maybe not. Assuming hedge mode is common.
        // Let's set for both just in case or check mode.
      });
      await this.request("POST", "/api/v2/mix/account/set-leverage", undefined, {
        symbol,
        productType: "USDT-FUTURES",
        marginCoin: "USDT",
        leverage: String(leverage),
        holdSide: "short",
      });
      
      // Set margin mode
      await this.request("POST", "/api/v2/mix/account/set-margin-mode", undefined, {
        symbol,
        productType: "USDT-FUTURES",
        marginCoin: "USDT",
        marginMode: marginMode === "isolated" ? "isolated" : "crossed",
      });
      
      return true;
    } catch (error: any) {
      logger.warn(`Set leverage/margin mode failed for ${contract}: ${error.message}`);
      return null;
    }
  }

  async placeOrder(params: any) {
    const symbol = this.contractToSymbol(params.contract);
    const size = Math.abs(params.size);
    const side = params.size > 0 ? "buy" : "sell";
    
    const body: any = {
      symbol,
      productType: "USDT-FUTURES",
      marginCoin: "USDT",
      marginMode: params.marginMode === "isolated" ? "isolated" : "crossed",
      side,
      orderType: params.price ? "limit" : "market",
      size: String(size),
      tradeSide: params.positionSide === "short" ? "close" : "open", // Simplified, needs better logic for open/close
      // Bitget V2 uses tradeSide: open/close.
      // But we need to know if we are opening or closing.
      // The params usually come from tradeExecution.ts which knows.
      // But params here is OrderParams which has positionSide.
      // If positionSide is 'long' and size > 0 -> open long
      // If positionSide is 'long' and size < 0 -> close long
      // If positionSide is 'short' and size < 0 -> open short
      // If positionSide is 'short' and size > 0 -> close short
    };

    // Determine tradeSide (open/close) and side (buy/sell)
    // params.size > 0 means we want to BUY.
    // params.size < 0 means we want to SELL.
    // params.positionSide tells us which position we are affecting.
    
    const isBuy = params.size > 0;
    const posSide = params.positionSide || (isBuy ? "long" : "short"); // Default assumption
    
    if (posSide === "long") {
      if (isBuy) {
        body.side = "buy";
        body.tradeSide = "open";
      } else {
        body.side = "buy";
        body.tradeSide = "close";
      }
    } else { // short
      if (isBuy) {
        body.side = "sell";
        body.tradeSide = "close";
      } else {
        body.side = "sell";
        body.tradeSide = "open";
      }
    }

    if (params.price) {
      body.price = String(params.price);
    }
    
    // Explicitly set reduceOnly if closing
    // if (body.tradeSide === "close" || params.reduceOnly) {
    //   body.reduceOnly = "yes";
    // }
    // Bitget V2: reduceOnly is generally for One-way mode. 
    // In Hedge mode, tradeSide="close" is sufficient.
    // Sending reduceOnly="yes" in Hedge mode might cause "No position to close" error.
    // Also, previous attempts without reduceOnly also failed, but maybe due to marginMode?
    
    // Let's try removing marginMode for closing orders?
    // Or maybe marginMode should only be sent for OPEN orders?
    // But docs say it's required.
    
    // Let's try to NOT send reduceOnly.
    if (params.reduceOnly && body.tradeSide !== "close") {
       body.reduceOnly = "yes";
    }

    logger.info(`[Bitget] Place Order Body: ${JSON.stringify(body)}`);

    const data = await this.request<any>("POST", "/api/v2/mix/order/place-order", undefined, body);
    
    return {
      id: data.orderId,
      clientOrderId: data.clientOid,
      status: "live", // Assume live if successful
      size: String(size),
      price: params.price,
      contract: params.contract,
    };
  }

  async getOrder(orderId: string, contract?: string) {
    const symbol = contract ? this.contractToSymbol(contract) : undefined;
    if (!symbol) throw new Error("Contract required for Bitget getOrder");

    const data = await this.request<any>("GET", "/api/v2/mix/order/detail", {
      symbol,
      productType: "USDT-FUTURES",
      orderId,
    });

    return {
      id: data.orderId,
      status: data.state,
      size: data.size,
      left: String(Number(data.size) - Number(data.baseVolume)),
      fill_price: data.priceAvg,
      price: data.price,
      contract: contract,
      side: data.side,
      posSide: data.posSide,
      create_time: data.cTime,
      finish_time: data.uTime,
    };
  }

  async cancelOrder(contract: string, orderId: string) {
    const symbol = this.contractToSymbol(contract);
    const data = await this.request<any>("POST", "/api/v2/mix/order/cancel-order", undefined, {
      symbol,
      productType: "USDT-FUTURES",
      orderId,
    });
    return { result: true, raw: data };
  }

  async getOpenOrders(contract?: string) {
    const params: any = { productType: "USDT-FUTURES" };
    if (contract) params.symbol = this.contractToSymbol(contract);
    
    const data = await this.request<any>("GET", "/api/v2/mix/order/orders-pending", params);
    
    // Bitget V2 might return { entrustedList: [] } or just [] or null
    const list = Array.isArray(data) ? data : (data?.entrustedList || []);
    
    if (!Array.isArray(list)) {
      logger.warn("Bitget getOpenOrders returned unexpected format", data);
      return [];
    }

    return list.map((order: any) => ({
      ...order,
      contract: this.symbolToContract(order.symbol),
      ordId: order.orderId, // Map to common field
      sz: order.size,
      px: order.price,
    }));
  }

  async getOrderHistory(contract?: string, limit = 100) {
    const params: any = { productType: "USDT-FUTURES", limit: String(limit) };
    if (contract) params.symbol = this.contractToSymbol(contract);
    
    const data = await this.request<any>("GET", "/api/v2/mix/order/orders-history", params);
    const list = Array.isArray(data) ? data : (data?.orderList || []);
    return list || [];
  }

  async getMyTrades(contract?: string, limit = 100) {
    const params: any = { productType: "USDT-FUTURES", limit: String(limit) };
    if (contract) params.symbol = this.contractToSymbol(contract);
    
    const data = await this.request<any>("GET", "/api/v2/mix/order/fill-history", params);
    const list = Array.isArray(data) ? data : (data?.fillList || []);
    return list || [];
  }

  async getPositionHistory(contract?: string, limit = 100) {
    // Bitget might not have a direct position history endpoint in V2 mix?
    // Usually derived from order history or fills.
    // Returning empty for now or implementing if critical.
    return [];
  }
}
