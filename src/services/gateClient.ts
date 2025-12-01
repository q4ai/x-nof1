/**
 * Gate.io API 客户端
 * 基于 Gate.io v4 API 实现永续合约交易功能
 * API 文档: https://www.gate.io/docs/developers/apiv4/en/#futures
 */

import { createHash, createHmac } from "node:crypto";
import { type Dispatcher, ProxyAgent } from "undici";
import { createLogger } from "../utils/loggerUtils";

const logger = createLogger({
	name: "gate-client",
	level: "info",
});

type HttpMethod = "GET" | "POST" | "DELETE";
type RequestParams = Record<string, string | number | boolean | undefined>;
type FetchOptions = RequestInit & { dispatcher?: Dispatcher };

type AccountSnapshot = {
	total: string;
	available: string;
	positionMargin: string;
	unrealisedPnl: string;
};

/**
 * Gate.io 客户端类
 * 支持正式环境和测试环境的永续合约交易
 */
export class GateClient {
	private readonly apiKey: string;
	private readonly apiSecret: string;
	private readonly testnet: boolean;
	private readonly baseUrl: string;
	private readonly dispatcher?: Dispatcher;

	constructor(
		apiKey: string,
		apiSecret: string,
		testnet: boolean,
		proxyUrl?: string,
	) {
		this.apiKey = apiKey;
		this.apiSecret = apiSecret;
		this.testnet = testnet;
		// Gate.io 支持测试网和正式网
		this.baseUrl = testnet
			? "https://fx-api-testnet.gateio.ws/api/v4"
			: "https://api.gateio.ws/api/v4";

		if (proxyUrl) {
			try {
				this.dispatcher = new ProxyAgent(proxyUrl);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				logger.warn(`HTTP 代理初始化失败，将直接访问 Gate.io API: ${message}`);
			}
		}
	}

	/**
	 * Gate.io API 签名生成
	 * 参考: https://www.gate.io/docs/developers/apiv4/en/#api-signature-string-generation
	 */
	private sign(
		method: HttpMethod,
		path: string,
		queryString: string,
		bodyString: string,
		timestamp: string,
	): string {
		// Gate.io 签名格式: METHOD\nPATH_URL\nQUERY_STRING\nBODY_HASH\nTIMESTAMP
		// BODY_HASH 是对请求体的 SHA-512 哈希(不是HMAC)
		const hashedBody = createHash("sha512")
			.update(bodyString)
			.digest("hex");
		const signatureString = `${method}\n${path}\n${queryString}\n${hashedBody}\n${timestamp}`;
		// 使用 API Secret 对签名字符串进行 HMAC-SHA512
		return createHmac("sha512", this.apiSecret)
			.update(signatureString)
			.digest("hex");
	}

	/**
	 * 合约名称转换 (BTC_USDT -> BTC_USDT)
	 * Gate.io 使用下划线格式
	 */
	private contractToSymbol(contract: string): string {
		return contract.toUpperCase();
	}

	/**
	 * 符号转换为合约 (BTC_USDT -> BTC_USDT)
	 */
	private symbolToContract(symbol: string): string {
		return symbol.toUpperCase();
	}

	private normalizeOrderText(text?: string): string {
		const raw = typeof text === "string" ? text.trim() : "";
		const base = raw.length > 0 ? raw : `order-${Date.now()}`;
		return base.startsWith("t-") ? base : `t-${base}`;
	}

	/**
	 * 通用 HTTP 请求方法
	 */
	private async request<T>(
		method: HttpMethod,
		path: string,
		params?: RequestParams,
		body?: Record<string, unknown>,
		auth = true,
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
		const url = `${this.baseUrl}${path}${queryString ? `?${queryString}` : ""}`;

		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			Accept: "application/json",
            "X-Gate-Channel-Id": "tvcbot",
		};

		const bodyString = body ? JSON.stringify(body) : "";

		if (auth) {
			// Gate.io 需要秒級時間戳，但可以包含小數點(與 Python time.time() 兼容)
			const timestamp = (Date.now() / 1000).toString();
			// 官方签名规范要求 URL 包含 /api/v4 前缀
			const signedPath = `/api/v4${path}`;
			headers["KEY"] = this.apiKey;
			headers["Timestamp"] = timestamp;
			headers["SIGN"] = this.sign(
				method,
				signedPath,
				queryString,
				bodyString,
				timestamp,
			);
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
				throw new Error(
					`Gate.io API 请求失败: ${response.status} ${response.statusText} - ${text}`,
				);
			}

			const json = JSON.parse(text);
			return json as T;
		} catch (error) {
			logger.error(`请求失败: ${method} ${url}`, error);
			throw error;
		}
	}

	/**
	 * 获取永续合约详情
	 */
	async getFuturesContract(contract: string) {
		const symbol = this.contractToSymbol(contract);
		const data = await this.request<any>(
			"GET",
			`/futures/usdt/contracts/${symbol}`,
			undefined,
			undefined,
			false,
		);

		return {
			instId: symbol,
			contract,
			tickSize: data.order_price_round,
			minSize: data.order_size_min.toString(),
			maxSize: data.order_size_max.toString(),
			lotSize: "1", // Gate.io 以张数交易，最小为1
			contractValue: data.quanto_multiplier, // 合约面值
			contractMultiplier: data.quanto_multiplier,
			quoteCcy: "USDT",
			baseCcy: symbol.split("_")[0],
			orderSizeMin: data.order_size_min.toString(),
			orderSizeMax: data.order_size_max.toString(),
		};
	}

	/**
	 * 获取期货行情 Ticker
	 */
	async getFuturesTicker(contract: string) {
		const symbol = this.contractToSymbol(contract);
		const data = await this.request<any[]>(
			"GET",
			"/futures/usdt/tickers",
			{ contract: symbol },
			undefined,
			false,
		);

		const ticker = data[0];
		if (!ticker) {
			throw new Error(`未找到合约 ${contract} 的行情数据`);
		}

		return {
			instId: symbol,
			contract,
			last: ticker.last,
			markPrice: ticker.mark_price,
			change_percentage: Number.parseFloat(ticker.change_percentage),
			volume_24h: ticker.volume_24h,
			fundingRate: ticker.funding_rate,
		};
	}

	/**
	 * 获取资金费率
	 */
	async getFundingRate(contract: string) {
		const symbol = this.contractToSymbol(contract);
		const ticker = await this.getFuturesTicker(contract);
		return {
			instId: symbol,
			fundingRate: ticker.fundingRate,
			nextFundingTime: Date.now() + 8 * 3600 * 1000, // Gate.io 每8小时收取一次
		};
	}

	/**
	 * 获取 K 线数据
	 * @param interval 周期: 10s, 1m, 5m, 15m, 30m, 1h, 4h, 8h, 1d, 7d
	 */
	/**
	 * 获取 K 线数据
	 * @param interval 周期: 10s, 1m, 5m, 15m, 30m, 1h, 4h, 8h, 1d, 7d
	 * @param limitOrOptions 兼容两种调用方式：数字（limit）或对象（{ limit, from, to }）
	 */
	async getFuturesCandles(
		contract: string,
		interval: string,
		limitOrOptions?: number | { limit?: number; from?: number; to?: number },
	) {
		const symbol = this.contractToSymbol(contract);
		const params: RequestParams = {
			contract: symbol,
			interval,
		};

		// 兼容两种参数格式：直接传 limit 数字 或 传 options 对象
		if (typeof limitOrOptions === "number") {
			params.limit = limitOrOptions;
		} else if (limitOrOptions && typeof limitOrOptions === "object") {
			if (limitOrOptions.from) params.from = limitOrOptions.from;
			if (limitOrOptions.to) params.to = limitOrOptions.to;
			if (limitOrOptions.limit) params.limit = limitOrOptions.limit;
		}

		const data = await this.request<any[]>(
			"GET",
			"/futures/usdt/candlesticks",
			params,
			undefined,
			false,
		);

		// Gate.io K线格式: [timestamp, volume, close, high, low, open, sum]
		// 转换为统一格式: [timestamp, open, high, low, close, volume]
		return data
			.map((candle) => ({
				timestamp: Number(candle.t) * 1000, // 转换为毫秒
				open: Number.parseFloat(candle.o),
				high: Number.parseFloat(candle.h),
				low: Number.parseFloat(candle.l),
				close: Number.parseFloat(candle.c),
				volume: Number(candle.v),
			}))
			.reverse(); // Gate.io 返回最新的在前，需要反转
	}

	/**
	 * 获取账户余额
	 */
	async getFuturesAccount() {
		const [unifiedResult, futuresResult] = await Promise.allSettled([
			this.tryGetUnifiedAccount(),
			this.fetchFuturesAccountSnapshot(),
		]);

		const unifiedAccount =
			unifiedResult.status === "fulfilled" ? unifiedResult.value : null;
		const futuresAccount =
			futuresResult.status === "fulfilled" ? futuresResult.value : null;

		if (unifiedAccount) {
			return this.mergeAccountSnapshots(unifiedAccount, futuresAccount);
		}

		if (futuresAccount) {
			return futuresAccount;
		}

		throw new Error("无法获取 Gate.io 合约账户余额");
	}

	private async fetchFuturesAccountSnapshot(): Promise<AccountSnapshot | null> {
		try {
			const data = await this.request<any>("GET", "/futures/usdt/accounts");
			return this.parseFuturesAccount(data);
		} catch (error) {
			logger.warn(
				`查询 Gate.io 合约账户失败: ${error instanceof Error ? error.message : String(error)}`,
			);
			return null;
		}
	}

	private mergeAccountSnapshots(
		primary: AccountSnapshot,
		fallback: AccountSnapshot | null,
	): AccountSnapshot {
		if (!fallback) {
			return primary;
		}
		return {
			...primary,
			positionMargin: fallback.positionMargin,
			unrealisedPnl: fallback.unrealisedPnl,
		};
	}

	private normalizeAmount(value: unknown): string {
		if (typeof value === "number") {
			return Number.isFinite(value) ? value.toString() : "0";
		}
		if (typeof value === "string") {
			const trimmed = value.trim();
			if (!trimmed) return "0";
			const parsed = Number.parseFloat(trimmed);
			return Number.isFinite(parsed) ? parsed.toString() : "0";
		}
		return "0";
	}

	private toIsoTimestamp(value: unknown): string | undefined {
		if (value === undefined || value === null) {
			return undefined;
		}
		let numeric: number | null = null;
		if (typeof value === "number") {
			numeric = Number.isFinite(value) ? value : null;
		} else if (typeof value === "string") {
			const trimmed = value.trim();
			if (trimmed) {
				const parsed = Number.parseFloat(trimmed);
				if (Number.isFinite(parsed)) {
					numeric = parsed;
				} else {
					const dateValue = Date.parse(trimmed);
					if (Number.isFinite(dateValue)) {
						numeric = dateValue;
					}
				}
			}
		}

		if (numeric === null) {
			return undefined;
		}

		const milliseconds = numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
		if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
			return undefined;
		}

		return new Date(milliseconds).toISOString();
	}

	private parseFuturesAccount(data: any): AccountSnapshot | null {
		if (!data || typeof data !== "object") {
			return null;
		}
		const total = this.normalizeAmount(data.total ?? data.equity);
		const available = this.normalizeAmount(
			data.available ?? data.available_margin ?? data.available_balance,
		);
		const positionMargin = this.normalizeAmount(
			data.position_margin ?? data.margin ?? data.order_margin,
		);
		const unrealised = this.normalizeAmount(
			data.unrealised_pnl ?? data.unrealized_pnl ?? data.upl,
		);
		return {
			total,
			available,
			positionMargin,
			unrealisedPnl: unrealised,
		};
	}

	private async tryGetUnifiedAccount(
		preferredCurrency = "USDT",
	): Promise<AccountSnapshot | null> {
		try {
			const data = await this.request<any>("GET", "/unified/accounts");
			return this.parseUnifiedAccount(data, preferredCurrency);
		} catch (error) {
			logger.debug?.(
				`统一账户查询失败: ${error instanceof Error ? error.message : String(error)}`,
			);
			return null;
		}
	}

	private parseUnifiedAccount(
		data: any,
		preferredCurrency = "USDT",
	): AccountSnapshot | null {
		if (!data || typeof data !== "object") {
			return null;
		}
		const balances = data.balances;
		if (!balances || typeof balances !== "object") {
			return null;
		}
		const keys = Object.keys(balances).filter(
			(key) => balances[key] && typeof balances[key] === "object",
		);
		if (!keys.length) {
			return null;
		}
		const matchedKey = keys.find(
			(key) => key.toUpperCase() === preferredCurrency.toUpperCase(),
		);
		const selected = balances[matchedKey ?? keys[0]];
		if (!selected || typeof selected !== "object") {
			return null;
		}
		const total = this.normalizeAmount(selected.equity ?? selected.total);
		const available = this.normalizeAmount(
			selected.available ?? selected.total_available_margin ?? selected.avail,
		);
		const positionMargin = this.normalizeAmount(
			selected.futures_pos_liab ?? selected.position_margin ?? selected.imr,
		);
		const unrealised = this.normalizeAmount(
			selected.unrealised_pnl ||
				selected.unrealized_pnl ||
				selected.upl,
		);
		return {
			total,
			available,
			positionMargin,
			unrealisedPnl: unrealised,
		};
	}

	private toNumber(value: string): number {
		const parsed = Number.parseFloat(value);
		return Number.isFinite(parsed) ? parsed : 0;
	}

	/**
	 * 获取当前持仓
	 */
	async getFuturesPositions(contract?: string) {
		const params: RequestParams = {};
		if (contract) {
			params.contract = this.contractToSymbol(contract);
		}

		const data = await this.request<any[]>(
			"GET",
			"/futures/usdt/positions",
			params,
		);

		return data
			.filter((pos) => Number(pos?.size ?? 0) !== 0)
			.map((pos) => {
				const normalizedSize = this.normalizeAmount(pos.size);
				const sizeValue = Number.parseFloat(normalizedSize || "0");
				const createTime =
					this.toIsoTimestamp(
						pos.create_time_ms ??
							pos.create_time ??
							pos.enter_time_ms ??
							pos.enter_time,
					);
				const updateTime =
					this.toIsoTimestamp(
						pos.update_time_ms ??
							pos.update_time ??
							pos.close_time_ms ??
							pos.close_time ??
							pos.create_time_ms ??
							pos.create_time,
					);
				const rawMode = typeof pos.mode === "string" ? pos.mode.toLowerCase() : "";
				const marginMode =
					rawMode === "isolated"
						? "isolated"
						: rawMode === "cross"
							? "cross"
							: undefined;

				return {
					contract: this.symbolToContract(pos.contract),
					size: normalizedSize,
					entryPrice: this.normalizeAmount(pos.entry_price),
					markPrice: this.normalizeAmount(
						pos.mark_price ?? pos.last_mark_price ?? pos.last,
					),
					leverage: this.normalizeAmount(pos.leverage),
					unrealisedPnl: this.normalizeAmount(
						pos.unrealised_pnl ?? pos.unrealized_pnl ?? pos.upl,
					),
					realisedPnl: this.normalizeAmount(
						pos.realised_pnl ?? pos.realized_pnl ?? "0",
					),
					margin: this.normalizeAmount(pos.margin ?? pos.position_margin ?? pos.imr),
					liqPrice: this.normalizeAmount(
						pos.liq_price ??
							pos.liquidation_price ??
							pos.liquidate_price ??
							pos.liq ??
							pos.liq_px,
					),
					posSide: sizeValue >= 0 ? "long" : "short",
					marginMode,
					createTime: createTime ?? updateTime,
					updateTime,
				};
			});
	}

	/**
	 * 获取订单簿
	 */
	async getFuturesOrderBook(contract: string, limit = 20) {
		const symbol = this.contractToSymbol(contract);
		const data = await this.request<any>(
			"GET",
			"/futures/usdt/order_book",
			{ contract: symbol, limit: Math.min(limit, 100) },
			undefined,
			false,
		);

		return {
			asks: data.asks.map((ask: any) => ({
				price: Number.parseFloat(ask.p),
				size: Number(ask.s),
			})),
			bids: data.bids.map((bid: any) => ({
				price: Number.parseFloat(bid.p),
				size: Number(bid.s),
			})),
			timestamp: Number(data.current) * 1000,
		};
	}

	/**
	 * 下单 (开仓/平仓)
	 * @param contract 合约
	 * @param size 数量 (正数=买入/开多, 负数=卖出/开空)
	 * @param price 价格 (可选，不传则为市价单)
	 * @param reduceOnly 是否只减仓
	 */
	async placeFuturesOrder(params: {
		contract: string;
		size: number;
		price?: number;
		reduceOnly?: boolean;
		text?: string;
	}) {
		const symbol = this.contractToSymbol(params.contract);
		const orderData: any = {
			contract: symbol,
			size: params.size,
			text: this.normalizeOrderText(params.text),
		};

		if (params.price) {
			// 限价单
			orderData.price = params.price.toString();
			orderData.tif = "gtc"; // Good Till Cancel
		} else {
			// 市价单
			orderData.price = "0";
			orderData.tif = "ioc"; // Immediate or Cancel
		}

		if (params.reduceOnly) {
			orderData.reduce_only = true;
		}

		const data = await this.request<any>(
			"POST",
			"/futures/usdt/orders",
			undefined,
			orderData,
		);

		return {
			orderId: data.id.toString(),
			contract: this.symbolToContract(data.contract),
			size: Number(data.size),
			price: Number.parseFloat(data.price),
			status: data.status,
			createTime: Number(data.create_time) * 1000,
		};
	}

	/**
	 * 取消订单
	 */
	async cancelFuturesOrder(orderId: string) {
		const data = await this.request<any>(
			"DELETE",
			`/futures/usdt/orders/${orderId}`,
		);

		return {
			orderId: data.id.toString(),
			status: data.status,
		};
	}

	/**
	 * 取消所有订单
	 */
	async cancelAllFuturesOrders(contract?: string) {
		const params: RequestParams = {};
		if (contract) {
			params.contract = this.contractToSymbol(contract);
		}

		const data = await this.request<any[]>(
			"DELETE",
			"/futures/usdt/orders",
			params,
		);

		return data.map((order) => ({
			orderId: order.id.toString(),
			status: order.status,
		}));
	}

	/**
	 * 获取订单列表
	 */
	async getFuturesOrders(params?: {
		contract?: string;
		status?: "open" | "finished";
		limit?: number;
	}) {
		const queryParams: RequestParams = {
			status: params?.status || "open",
		};

		if (params?.contract) {
			queryParams.contract = this.contractToSymbol(params.contract);
		}
		if (params?.limit) {
			queryParams.limit = params.limit;
		}

		const data = await this.request<any[]>(
			"GET",
			"/futures/usdt/orders",
			queryParams,
		);

		return data.map((order) => ({
			orderId: order.id.toString(),
			contract: this.symbolToContract(order.contract),
			size: Number(order.size),
			price: Number.parseFloat(order.price),
			filledSize: Number(order.size) - Number(order.left),
			status: order.status,
			createTime: Number(order.create_time) * 1000,
			updateTime: Number(order.finish_time) * 1000,
		}));
	}

	/**
	 * 获取成交历史
	 */
	async getFuturesTrades(params?: { contract?: string; limit?: number }) {
		const queryParams: RequestParams = {};

		if (params?.contract) {
			queryParams.contract = this.contractToSymbol(params.contract);
		}
		if (params?.limit) {
			queryParams.limit = params.limit;
		}

		const data = await this.request<any[]>(
			"GET",
			"/futures/usdt/my_trades",
			queryParams,
		);

		return data.map((trade) => ({
			id: trade.id.toString(),
			orderId: trade.order_id.toString(),
			contract: this.symbolToContract(trade.contract),
			size: Number(trade.size),
			price: Number.parseFloat(trade.price),
			fee: Number.parseFloat(trade.fee),
			side: Number(trade.size) > 0 ? ("buy" as const) : ("sell" as const),
			role: trade.role,
			timestamp: Number(trade.create_time) * 1000,
		}));
	}

	/**
	 * 设置杠杆
	 */
	async setLeverage(contract: string, leverage: number) {
		const symbol = this.contractToSymbol(contract);
		const data = await this.request<any>(
			"POST",
			`/futures/usdt/positions/${symbol}/leverage`,
			{ leverage: leverage.toString() },
		);

		const responseContract =
			(typeof data?.contract === "string" && data.contract.trim()) || symbol;
		const responseLeverage = Number.parseFloat(
			data?.leverage !== undefined ? String(data.leverage) : String(leverage),
		);

		return {
			contract: this.symbolToContract(responseContract),
			leverage: Number.isFinite(responseLeverage)
				? responseLeverage
				: Number.parseFloat(leverage.toString()),
		};
	}

	/**
	 * 获取合约信息列表
	 */
	async getFuturesContracts() {
		const data = await this.request<any[]>(
			"GET",
			"/futures/usdt/contracts",
			undefined,
			undefined,
			false,
		);

		return data.map((contract) => ({
			symbol: this.symbolToContract(contract.name),
			baseCcy: contract.name.split("_")[0],
			quoteCcy: "USDT",
			contractMultiplier: contract.quanto_multiplier,
			minSize: contract.order_size_min,
			maxSize: contract.order_size_max,
			tickSize: contract.order_price_round,
		}));
	}

	/**
	 * 获取当前持仓（兼容接口）
	 * 返回格式与 OKX 一致
	 */
	async getPositions() {
		return this.getFuturesPositions();
	}

	/**
	 * 获取当前挂单（兼容接口）
	 * 返回格式与 OKX 一致
	 */
	async getOpenOrders(symbol?: string) {
		const contract = symbol ? this.contractToSymbol(symbol) : undefined;
		const params: RequestParams = {
			status: "open",
			settle: "usdt",
		};
		if (contract) {
			params.contract = contract;
		}

		const data = await this.request<any[]>(
			"GET",
			"/futures/usdt/orders",
			params,
		);

		return data.map((order) => ({
			id: order.id,
			clientOrderId: order.text || "",
			status: this.mapOrderStatus(order.status),
			size: order.size.toString(),
			price: order.price,
			contract: this.symbolToContract(order.contract),
		}));
	}

	/**
	 * 获取所有永续合约的行情数据（兼容接口）
	 * 返回格式与 OKX 一致
	 */
	async getAllSwapTickers(): Promise<
		Array<{
			symbol: string;
			volume24h: number;
			price: string;
			change24h: number;
		}>
	> {
		const data = await this.request<any[]>(
			"GET",
			"/futures/usdt/tickers",
			{ settle: "usdt" },
			undefined,
			false,
		);

		return data
			.map((ticker) => {
				const contract = this.symbolToContract(ticker.contract || "");
				const symbol = contract.replace(/_USDT$/i, "");
				const price = ticker.last || ticker.mark_price || ticker.index_price || "0";
				const change24h = Number.parseFloat(
					ticker.change_percentage || ticker.change_percent || "0",
				);
				const volume24h = Number.parseFloat(
					ticker.volume_24h_quote ||
						ticker.volume_24h ||
						ticker.volume_24h_base ||
						"0",
				);
				return {
					symbol,
					volume24h,
					price,
					change24h,
				};
			})
			.filter((entry) => Boolean(entry.symbol));
	}

	/**
	 * 映射 Gate.io 订单状态到通用状态
	 */
	private mapOrderStatus(status: string): string {
		const statusMap: Record<string, string> = {
			open: "live",
			finished: "filled",
			cancelled: "canceled",
		};
		return statusMap[status] || status;
	}

	/**
	 * 获取所有合约信息（兼容接口）
	 */
	async getAllContracts() {
		return this.getFuturesContracts();
	}

	/**
	 * 获取订单簿数据
	 */
	async getOrderBook(contract: string, depth = 10) {
		const symbol = this.contractToSymbol(contract);
		const data = await this.request<any>(
			"GET",
			"/futures/usdt/order_book",
			{
				settle: "usdt",
				contract: symbol,
				limit: depth.toString(),
			},
			undefined,
			false,
		);

		return {
			asks: data.asks.map((item: any[]) => ({
				price: item[0],
				size: item[1],
			})),
			bids: data.bids.map((item: any[]) => ({
				price: item[0],
				size: item[1],
			})),
			timestamp: data.current,
		};
	}

	/**
	 * 获取合约信息
	 */
	async getContractInfo(contract: string) {
		const symbol = this.contractToSymbol(contract);
		const data = await this.request<any>(
			"GET",
			`/futures/usdt/contracts/${symbol}`,
			undefined,
			undefined,
			false,
		);

		return {
			symbol: this.symbolToContract(data.name),
			baseCcy: data.name.split("_")[0],
			quoteCcy: "USDT",
			contractMultiplier: data.quanto_multiplier,
			minSize: data.order_size_min,
			maxSize: data.order_size_max,
			tickSize: data.order_price_round,
		};
	}

	/**
	 * 下单（兼容接口）
	 */
	async placeOrder(params: {
		contract: string;
		size: string;
		side: "buy" | "sell";
		price?: string;
		orderType?: "limit" | "market";
		reduceOnly?: boolean;
		clientOrderId?: string;
	}) {
		// 转换参数类型以匹配 placeFuturesOrder
		return this.placeFuturesOrder({
			contract: params.contract,
			size: Number.parseFloat(params.size),
			price: params.price ? Number.parseFloat(params.price) : undefined,
			reduceOnly: params.reduceOnly,
			text: params.clientOrderId,
		});
	}

	/**
	 * 获取订单详情
	 */
	async getOrder(orderId: string) {
		const data = await this.request<any>(
			"GET",
			`/futures/usdt/orders/${orderId}`,
			undefined,
			{ settle: "usdt" },
		);

		return {
			id: data.id,
			clientOrderId: data.text || "",
			status: this.mapOrderStatus(data.status),
			size: data.size.toString(),
			price: data.price,
			avgPrice: data.fill_price,
			contract: this.symbolToContract(data.contract),
			left: data.left.toString(),
		};
	}

	/**
	 * 取消订单
	 */
	async cancelOrder(orderId: string) {
		const data = await this.request<any>(
			"DELETE",
			`/futures/usdt/orders/${orderId}`,
			undefined,
			{ settle: "usdt" },
		);

		return {
			id: data.id,
			status: "canceled",
		};
	}

	/**
	 * 获取成交历史
	 */
	async getMyTrades(params?: { contract?: string; limit?: number }) {
		const queryParams: RequestParams = {
			settle: "usdt",
		};
		if (params?.contract) {
			queryParams.contract = this.contractToSymbol(params.contract);
		}
		if (params?.limit) {
			queryParams.limit = params.limit.toString();
		}

		const data = await this.request<any[]>(
			"GET",
			"/futures/usdt/my_trades",
			undefined,
			queryParams,
		);

		return data.map((trade) => ({
			id: trade.id,
			orderId: trade.order_id,
			contract: this.symbolToContract(trade.contract),
			side: trade.size.startsWith("-") ? "sell" : "buy",
			size: Math.abs(Number.parseFloat(trade.size)).toString(),
			price: trade.price,
			timestamp: trade.create_time * 1000,
		}));
	}

	/**
	 * 获取持仓历史（兼容接口，Gate.io 不支持此功能）
	 */
	async getPositionHistory() {
		logger.warn("Gate.io 不支持 getPositionHistory，返回空数组");
		return [];
	}
}

/**
 * 创建 Gate.io 客户端单例
 */
let gateClientInstance: GateClient | null = null;

export function createGateClient(
	apiKey?: string,
	apiSecret?: string,
	testnet?: boolean,
	proxyUrl?: string,
): GateClient {
	if (!gateClientInstance || apiKey || apiSecret) {
		if (!apiKey || !apiSecret) {
			throw new Error("Gate.io API Key 和 Secret 不能为空");
		}
		gateClientInstance = new GateClient(
			apiKey,
			apiSecret,
			testnet || false,
			proxyUrl,
		);
	}
	return gateClientInstance;
}
