import { createHash, createHmac } from "node:crypto";
import { type Dispatcher, ProxyAgent } from "undici";
import {
	computePrecisionFromStep,
	getBinancePrecision,
	normalizeBinanceQuantity,
} from "../database/binancePrecision";
import { createLogger } from "../utils/loggerUtils";

const logger = createLogger({
	name: "binance-client",
	level: "info",
});

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

type FetchOptions = RequestInit & { dispatcher?: Dispatcher };

function contractToSymbol(contract: string): string {
	return contract.replace(/_/g, "").toUpperCase();
}

function symbolToContract(symbol: string): string {
	if (!symbol) return symbol;
	const normalized = symbol.toUpperCase();
	if (normalized.endsWith("USDT")) {
		const base = normalized.slice(0, -4);
		return `${base}_USDT`;
	}
	return normalized;
}

function toFixedString(value: string | number | undefined): string {
	if (value === undefined) return "0";
	if (typeof value === "number")
		return Number.isFinite(value) ? value.toString() : "0";
	return value;
}

function toNumber(value: string | number | undefined, fallback = 0): number {
	const num =
		typeof value === "number" ? value : Number.parseFloat(value ?? "NaN");
	return Number.isFinite(num) ? num : fallback;
}

function parsePositiveNumber(value: unknown): number | null {
	if (typeof value === "number") {
		return Number.isFinite(value) && value > 0 ? value : null;
	}
	if (typeof value === "string") {
		const num = Number.parseFloat(value);
		return Number.isFinite(num) && num > 0 ? num : null;
	}
	return null;
}

function deriveStepFromPrecision(precision?: number | null): number | null {
	if (
		!Number.isFinite(precision) ||
		precision === null ||
		precision === undefined
	) {
		return null;
	}
	return precision >= 0 ? Math.pow(10, -precision) : null;
}

function trimTrailingZeros(value: string): string {
	if (!value.includes(".")) {
		return value;
	}
	return value.replace(/\.0+$/, "").replace(/(\.\d*?[1-9])0+$/, "$1");
}

function selectEffectiveStepSize(
	lotFilter?: any,
	marketFilter?: any,
	fallback?: string,
): string {
	const candidates = [
		parsePositiveNumber(marketFilter?.stepSize),
		parsePositiveNumber(lotFilter?.stepSize),
		parsePositiveNumber(fallback),
	];
	const valid = candidates.filter((value): value is number => value !== null);
	if (!valid.length) {
		return "1";
	}
	return Math.max(...valid).toString();
}

function selectEffectiveMinQty(
	lotFilter?: any,
	marketFilter?: any,
	fallback?: string,
): string {
	const candidates = [
		parsePositiveNumber(marketFilter?.minQty),
		parsePositiveNumber(lotFilter?.minQty),
		parsePositiveNumber(fallback),
	];
	const valid = candidates.filter((value): value is number => value !== null);
	if (!valid.length) {
		return "0.001";
	}
	return Math.max(...valid).toString();
}

function selectEffectiveMaxQty(
	lotFilter?: any,
	marketFilter?: any,
	fallback?: string,
): string {
	const candidates = [
		parsePositiveNumber(marketFilter?.maxQty),
		parsePositiveNumber(lotFilter?.maxQty),
		parsePositiveNumber(fallback),
	];
	const valid = candidates.filter((value): value is number => value !== null);
	if (!valid.length) {
		return "100000";
	}
	return Math.min(...valid).toString();
}

type QuantityRule = {
	step: number;
	precision: number;
	expiresAt: number;
};

type BinanceContractInfo = {
	instId: string;
	contract: string;
	tickSize: string;
	minSize: string;
	maxSize: string;
	lotSize: string;
	contractValue: string;
	contractMultiplier: string;
	quoteCcy: string;
	baseCcy: string;
	orderSizeMin: string;
	orderSizeMax: string;
	quantoMultiplier: string;
	quantityPrecision?: number;
};

function buildNewClientOrderId(symbol: string, quantity: number): string {
	const seed = `${Date.now()}-${symbol}-${quantity}`;
	const digest = createHash("md5").update(seed).digest("hex");
	return `x-SxkfhQRD-${digest.slice(0, 8)}`;
}

export class BinanceClient {
	private readonly apiKey: string;
	private readonly apiSecret: string;
	private readonly baseUrl: string;
	private readonly dispatcher?: Dispatcher;
	private readonly recvWindow = 5000;
	private readonly quantityRuleCache = new Map<string, QuantityRule>();
	private readonly contractInfoCache = new Map<
		string,
		{ info: BinanceContractInfo; expiresAt: number }
	>();

	constructor(
		apiKey: string,
		apiSecret: string,
		useTestnet: boolean,
		proxyUrl?: string,
	) {
		this.apiKey = apiKey;
		this.apiSecret = apiSecret;
		this.baseUrl = useTestnet
			? "https://testnet.binancefuture.com"
			: "https://fapi.binance.com";

		if (proxyUrl) {
			try {
				this.dispatcher = new ProxyAgent(proxyUrl);
				logger.debug("已启用 HTTP 代理访问 Binance API");
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				logger.warn(`Binance HTTP 代理初始化失败，直接访问 API: ${message}`);
			}
		}

		logger.debug(
			useTestnet ? "使用 Binance 合约测试网" : "使用 Binance 合约正式环境",
		);
	}

	private sign(payload: string): string {
		return createHmac("sha256", this.apiSecret).update(payload).digest("hex");
	}

	private buildSearch(params?: RequestParams): URLSearchParams {
		const search = new URLSearchParams();
		if (!params) return search;
		for (const [key, value] of Object.entries(params)) {
			if (value === undefined || value === null) continue;
			search.append(key, String(value));
		}
		return search;
	}

	private async resolveQuantityRule(
		contract: string,
	): Promise<QuantityRule | null> {
		const cached = this.quantityRuleCache.get(contract);
		if (cached && cached.expiresAt > Date.now()) {
			return cached;
		}

		const [precisionRecord, contractInfo] = await Promise.all([
			getBinancePrecision(contract).catch(() => null),
			this.getContractInfo(contract).catch((error: unknown) => {
				logger.warn(
					`获取 Binance 合约 ${contract} 信息失败: ${error instanceof Error ? error.message : String(error)}`,
				);
				return null;
			}),
		]);

		const stepCandidates: number[] = [];
		const pushStepCandidate = (value: number | null) => {
			if (value === null || !Number.isFinite(value) || value <= 0) {
				return;
			}
			stepCandidates.push(value);
		};

		pushStepCandidate(parsePositiveNumber(precisionRecord?.step_size));
		pushStepCandidate(parsePositiveNumber(contractInfo?.lotSize));
		pushStepCandidate(deriveStepFromPrecision(precisionRecord?.precision));
		pushStepCandidate(deriveStepFromPrecision(contractInfo?.quantityPrecision));

		if (!stepCandidates.length) {
			return null;
		}

		const step = Math.max(...stepCandidates);
		const precision = computePrecisionFromStep(step.toString(), 6);
		const rule: QuantityRule = {
			step,
			precision,
			expiresAt: Date.now() + 5 * 60 * 1000,
		};
		this.quantityRuleCache.set(contract, rule);
		return rule;
	}

	private formatQuantityByRule(quantity: number, rule: QuantityRule): string {
		const normalized = normalizeBinanceQuantity(
			quantity,
			Math.min(rule.precision, 12),
			rule.step,
		);
		const digits = Math.min(rule.precision, 8);
		const formatted =
			digits > 0 ? normalized.toFixed(digits) : normalized.toFixed(0);
		return trimTrailingZeros(formatted);
	}

	private async request<T>(
		method: HttpMethod,
		path: string,
		params?: RequestParams,
		auth = false,
	): Promise<T> {
		const search = this.buildSearch(params);

		if (auth) {
			search.set("timestamp", Date.now().toString());
			search.set("recvWindow", this.recvWindow.toString());
			const queryToSign = search.toString();
			const signature = this.sign(queryToSign);
			search.append("signature", signature);
		}

		const payload = search.toString();
		let url = `${this.baseUrl}${path}`;
		const headers: Record<string, string> = {};

		if (method === "GET" || method === "DELETE") {
			if (payload) {
				url += `?${payload}`;
			}
		} else if (payload) {
			headers["Content-Type"] = "application/x-www-form-urlencoded";
		}

		if (auth) {
			headers["X-MBX-APIKEY"] = this.apiKey;
		}

		const options: FetchOptions = {
			method,
			headers,
		};

		if (method === "POST" && payload) {
			options.body = payload;
		}

		if (this.dispatcher) {
			options.dispatcher = this.dispatcher;
		}

		const requestInfo = {
			url,
			method,
			params: params ? { ...params } : undefined,
			payload: payload || undefined,
			headers,
		};

		const response = await fetch(url, options as RequestInit);
		const text = await response.text();

		if (!response.ok) {
			const error: any = new Error(
				`Binance API 请求失败: ${response.status} ${response.statusText} - ${text}`,
			);
			error.rawResponse = text;
			error.rawRequest = requestInfo;
			throw error;
		}

		const json = text ? JSON.parse(text) : {};
		if (
			json &&
			typeof json === "object" &&
			"code" in json &&
			json.code !== 0 &&
			json.code !== undefined
		) {
			const error: any = new Error(
				`Binance API 错误: ${json.code} - ${json.msg || "未知错误"}`,
			);
			error.rawResponse = json;
			error.rawRequest = requestInfo;
			throw error;
		}

		return json as T;
	}

	async getFuturesTicker(contract: string) {
		const symbol = contractToSymbol(contract);
		const ticker = await this.request<any>(
			"GET",
			"/fapi/v1/ticker/24hr",
			{ symbol },
			false,
		);

		const lastPrice =
			ticker.lastPrice ??
			ticker.close ??
			ticker.bidPrice ??
			ticker.askPrice ??
			"0";

		return {
			instId: `${symbol}-SWAP`,
			contract,
			last: lastPrice,
			markPrice: ticker.markPrice ?? lastPrice,
			change_percentage: Number.parseFloat(ticker.priceChangePercent ?? "0"),
			volume_24h: ticker.volume ?? ticker.quoteVolume ?? "0",
			fundingRate: ticker.lastFundingRate ?? "0",
		};
	}

	async getFundingRate(contract: string) {
		const symbol = contractToSymbol(contract);
		const data = await this.request<any>(
			"GET",
			"/fapi/v1/premiumIndex",
			{ symbol },
			false,
		);
		return {
			fundingRate: data.lastFundingRate ?? data.fundingRate ?? "0",
			fundingTime: data.nextFundingTime ?? Date.now().toString(),
		};
	}

	async getFuturesCandles(contract: string, interval = "5m", limit = 100) {
		const symbol = contractToSymbol(contract);
		const candles = await this.request<any[]>(
			"GET",
			"/fapi/v1/klines",
			{ symbol, interval, limit },
			false,
		);
		return (candles || []).map((candle) => ({
			t: candle[0],
			o: candle[1],
			h: candle[2],
			l: candle[3],
			c: candle[4],
			v: candle[5],
		}));
	}

	async getFuturesAccount() {
		const account = await this.request<any>(
			"GET",
			"/fapi/v2/account",
			undefined,
			true,
		);
		const total = toFixedString(
			account.totalWalletBalance || account.totalMarginBalance,
		);
		const available = toFixedString(account.availableBalance);
		const unrealised = toFixedString(account.totalUnrealizedProfit);
		const positionMargin = toFixedString(account.totalPositionInitialMargin);

		return {
			total,
			available,
			positionMargin,
			unrealisedPnl: unrealised,
		};
	}

	async getPositions() {
		// 使用 positionRisk 接口获取更完整的持仓信息（包含 markPrice 和 liquidationPrice）
		const positions = await this.request<any[]>(
			"GET",
			"/fapi/v2/positionRisk",
			undefined,
			true,
		);

		return positions
			.filter(
				(pos) => Math.abs(Number.parseFloat(pos.positionAmt || "0")) > 1e-8,
			)
			.map((pos) => {
				const symbol = pos.symbol as string;
				const contract = symbolToContract(symbol);
				const positionAmt = Number.parseFloat(pos.positionAmt || "0");
				const marginMode =
					(pos.marginType || "cross").toLowerCase() === "isolated"
						? "isolated"
						: "cross";
				const rawPosSide = (pos.positionSide || "BOTH").toUpperCase();

				// 双向持仓模式：LONG/SHORT 由 positionSide 明确指定
				// 单向持仓模式：BOTH，方向由 positionAmt 正负判断
				let posSide: string;
				let size: string;

				if (rawPosSide === "LONG") {
					posSide = "long";
					size = Math.abs(positionAmt).toString();
				} else if (rawPosSide === "SHORT") {
					posSide = "short";
					size = Math.abs(positionAmt).toString();
				} else {
					// BOTH 模式（单向持仓）：设置为 net，数量保留正负
					posSide = "net";
					size = toFixedString(pos.positionAmt);
				}

				return {
					instId: `${symbol}-SWAP`,
					contract,
					size,
					entryPrice: toFixedString(pos.entryPrice),
					markPrice: toFixedString(pos.markPrice),
					leverage: toFixedString(pos.leverage),
					margin: toFixedString(pos.isolatedMargin),
					unrealisedPnl: toFixedString(
						pos.unRealizedProfit || pos.unrealizedProfit,
					), // positionRisk 使用 unRealizedProfit
					liqPrice: toFixedString(pos.liquidationPrice),
					posSide,
					createTime: pos.updateTime
						? new Date(Number(pos.updateTime)).toISOString()
						: undefined,
					updateTime: pos.updateTime
						? new Date(Number(pos.updateTime)).toISOString()
						: undefined,
					marginMode,
				};
			});
	}

	async getOrderBook(contract: string, depth = 10) {
		const symbol = contractToSymbol(contract);
		const book = await this.request<any>(
			"GET",
			"/fapi/v1/depth",
			{ symbol, limit: depth },
			false,
		);

		const mapSide = (entries: any[]) =>
			(entries || []).map(([price, size]) => ({
				p: price,
				s: size,
			}));

		return {
			instId: `${symbol}-SWAP`,
			contract,
			bids: mapSide(book?.bids ?? []),
			asks: mapSide(book?.asks ?? []),
			ts: book?.E ? String(book.E) : undefined,
		};
	}

	async getContractInfo(contract: string): Promise<BinanceContractInfo> {
		const cached = this.contractInfoCache.get(contract);
		if (cached && cached.expiresAt > Date.now()) {
			return cached.info;
		}

		const symbol = contractToSymbol(contract);
		const info = await this.request<any>(
			"GET",
			"/fapi/v1/exchangeInfo",
			{ symbol },
			false,
		);
		const instrument = info.symbols?.[0];
		if (!instrument) {
			throw new Error(`未找到 Binance 合约 ${symbol} 信息`);
		}

		const tickSize =
			instrument.filters?.find((f: any) => f.filterType === "PRICE_FILTER")
				?.tickSize ?? "0.1";
		const lotSizeFilter = instrument.filters?.find(
			(f: any) => f.filterType === "LOT_SIZE",
		);
		const marketLotSizeFilter = instrument.filters?.find(
			(f: any) => f.filterType === "MARKET_LOT_SIZE",
		);
		const lotSize = selectEffectiveStepSize(
			lotSizeFilter,
			marketLotSizeFilter,
			instrument.stepSize,
		);
		const minSize = selectEffectiveMinQty(
			lotSizeFilter,
			marketLotSizeFilter,
			instrument.minQty,
		);
		const maxSize = selectEffectiveMaxQty(
			lotSizeFilter,
			marketLotSizeFilter,
			instrument.maxQty,
		);
		const quantityPrecision =
			typeof instrument.quantityPrecision === "number"
				? instrument.quantityPrecision
				: undefined;

		const result: BinanceContractInfo = {
			instId: `${symbol}-SWAP`,
			contract,
			tickSize,
			minSize,
			maxSize,
			lotSize,
			contractValue: instrument.contractSize || "1",
			contractMultiplier: instrument.contractSize || "1",
			quoteCcy: instrument.quoteAsset,
			baseCcy: instrument.baseAsset,
			orderSizeMin:
				instrument.filters?.find((f: any) => f.filterType === "LOT_SIZE")
					?.minQty ?? lotSize,
			orderSizeMax:
				instrument.filters?.find((f: any) => f.filterType === "LOT_SIZE")
					?.maxQty ?? "100000",
			quantoMultiplier: instrument.contractSize || "1",
			quantityPrecision,
		};

		this.contractInfoCache.set(contract, {
			info: result,
			expiresAt: Date.now() + 5 * 60 * 1000,
		});
		return result;
	}

	async getAllContracts() {
		const info = await this.request<any>(
			"GET",
			"/fapi/v1/exchangeInfo",
			undefined,
			false,
		);
		return (info.symbols || []).map((instrument: any) => ({
			...instrument,
			contract: symbolToContract(instrument.symbol),
		}));
	}

	/**
	 * 获取所有 USDT 永续合约的 ticker 数据（包含成交量、价格、涨跌幅）
	 * 用于按成交量排序展示合约列表
	 */
	async getAllSwapTickers(): Promise<
		Array<{
			symbol: string;
			volume24h: number;
			price: string;
			change24h: number;
		}>
	> {
		const tickers = await this.request<any[]>(
			"GET",
			"/fapi/v1/ticker/24hr",
			undefined,
			false,
		);
		const result: Array<{
			symbol: string;
			volume24h: number;
			price: string;
			change24h: number;
		}> = [];

		for (const ticker of tickers || []) {
			// Binance 永续合约格式: BTCUSDT
			if (ticker.symbol && ticker.symbol.endsWith("USDT")) {
				const symbol = ticker.symbol.replace(/USDT$/, ""); // 使用正则替换，确保只替换末尾
				const volume24h = Number.parseFloat(ticker.quoteVolume || "0"); // USDT 计价的成交量
				const price = ticker.lastPrice || "0";
				const change24h = Number.parseFloat(ticker.priceChangePercent || "0");

				result.push({
					symbol,
					volume24h,
					price,
					change24h,
				});
			}
		}

		return result;
	}

	async setPositionMode(dualSidePosition: boolean) {
		try {
			await this.request(
				"POST",
				"/fapi/v1/positionSide/dual",
				{ dualSidePosition },
				true,
			);
			logger.info(
				`Binance 持仓模式已设置为: ${dualSidePosition ? "双向持仓(Hedge Mode)" : "单向持仓(One-way Mode)"}`,
			);
			return true;
		} catch (error: any) {
			const message = error?.message || "";
			if (message.includes("No need to change position side")) {
				logger.info(
					`Binance 持仓模式已经是: ${dualSidePosition ? "双向持仓" : "单向持仓"}`,
				);
				return true;
			}
			logger.error(`设置 Binance 持仓模式失败: ${message}`);
			throw error;
		}
	}

	async setLeverage(
		contract: string,
		leverage: number,
		marginMode: "cross" | "isolated" = "cross",
	) {
		const symbol = contractToSymbol(contract);
		const body: RequestParams = {
			symbol,
			leverage,
		};

		try {
			await this.request("POST", "/fapi/v1/leverage", body, true);
		} catch (error) {
			logger.warn(
				`设置 Binance 杠杆失败(${symbol}): ${String(error instanceof Error ? error.message : error)}`,
			);
		}

		if (marginMode === "isolated") {
			try {
				await this.request(
					"POST",
					"/fapi/v1/marginType",
					{ symbol, marginType: "ISOLATED" },
					true,
				);
			} catch (error: any) {
				const message = error?.message || "";
				if (!/No need to change margin type/i.test(message)) {
					logger.warn(`设置 Binance 保证金模式失败(${symbol}): ${message}`);
				}
			}
		}
		return true;
	}

	async placeOrder(params: OrderParams) {
		const symbol = contractToSymbol(params.contract);
		const side = params.size >= 0 ? "BUY" : "SELL";
		const quantity = Math.abs(params.size);
		let formattedQuantity = quantity.toString();

		if (quantity > 0) {
			try {
				const rule = await this.resolveQuantityRule(params.contract);
				if (rule) {
					formattedQuantity = this.formatQuantityByRule(quantity, rule);
				}
			} catch (error) {
				logger.warn(
					`计算 ${params.contract} 下单精度失败，使用原始数量: ${String(error)}`,
				);
			}
		}
		const clientOrderId = buildNewClientOrderId(symbol, quantity);

		const body: RequestParams = {
			symbol,
			side,
			type: params.price && params.price > 0 ? "LIMIT" : "MARKET",
			quantity: formattedQuantity,
			newClientOrderId: clientOrderId,
		};

		// 双向持仓模式：必须指定 positionSide
		if (params.positionSide) {
			const binancePosSide =
				params.positionSide === "long"
					? "LONG"
					: params.positionSide === "short"
						? "SHORT"
						: "BOTH";
			body.positionSide = binancePosSide;
		}

		if (params.price && params.price > 0) {
			body.price = params.price;
			body.timeInForce = params.tif?.toUpperCase() || "GTC";
		}

		// 双向持仓模式下不使用 reduceOnly，通过 positionSide 控制平仓
		// 单向持仓模式才需要 reduceOnly
		if (
			params.reduceOnly &&
			(params.positionSide === "net" || !params.positionSide)
		) {
			body.reduceOnly = "true";
		}

		logger.info(`Binance Order Request: ${JSON.stringify(body)}`); // Add this log

		const order = await this.request<any>("POST", "/fapi/v1/order", body, true);
		return {
			id: order.orderId?.toString() ?? "",
			status: order.status ?? "NEW",
			size: order.origQty ?? formattedQuantity,
			price: order.price ?? (params.price ? params.price.toString() : null),
			avgPrice: order.avgPrice ?? null,
			fill_price: order.avgPrice ?? null,
			left: order.executedQty
				? (
						Number.parseFloat(formattedQuantity) -
						Number.parseFloat(order.executedQty)
					).toString()
				: formattedQuantity,
			instId: `${symbol}-SWAP`,
			contract: params.contract,
			clientOrderId,
			raw: {
				request: { path: "/fapi/v1/order", body: { ...body } },
				response: order,
			},
		};
	}

	async getOrder(orderId: string, contract?: string, clientOrderId?: string) {
		const symbol = contract ? contractToSymbol(contract) : undefined;
		const baseParams: RequestParams = {
			symbol,
			orderId,
		};

		const invoke = async (params: RequestParams) =>
			this.request<any>("GET", "/fapi/v1/order", params, true);

		try {
			const response = await invoke(baseParams);

			// 解析 avgPrice，币安可能返回 "0" 或 "0.00000000"
			const avgPriceNum = response.avgPrice
				? Number.parseFloat(response.avgPrice)
				: 0;
			const avgPriceValue = avgPriceNum > 0 ? response.avgPrice : null;

			// 解析 price
			const priceNum = response.price ? Number.parseFloat(response.price) : 0;
			const priceValue = priceNum > 0 ? response.price : null;

			return {
				id: response.orderId?.toString() ?? orderId,
				status: response.status ?? "NEW",
				size: response.origQty ?? "0",
				left: response.executedQty
					? (
							Number.parseFloat(response.origQty ?? "0") -
							Number.parseFloat(response.executedQty)
						).toString()
					: (response.origQty ?? "0"),
				fill_price: avgPriceValue,
				price: priceValue,
				contract: contract ?? symbolToContract(response.symbol),
				side: response.side,
				posSide: response.positionSide,
				create_time: response.updateTime?.toString(),
				finish_time: response.updateTime?.toString(),
			};
		} catch (error: any) {
			const message = typeof error?.message === "string" ? error.message : "";
			const shouldRetryWithClientId =
				clientOrderId && message.includes("-2013");

			if (!shouldRetryWithClientId) {
				throw error;
			}

			const retryParams: RequestParams = {
				symbol,
				origClientOrderId: clientOrderId,
			};

			const response = await invoke(retryParams);

			// 解析 avgPrice
			const avgPriceNum = response.avgPrice
				? Number.parseFloat(response.avgPrice)
				: 0;
			const avgPriceValue = avgPriceNum > 0 ? response.avgPrice : null;

			// 解析 price
			const priceNum = response.price ? Number.parseFloat(response.price) : 0;
			const priceValue = priceNum > 0 ? response.price : null;

			return {
				id: response.orderId?.toString() ?? orderId ?? clientOrderId,
				status: response.status ?? "NEW",
				size: response.origQty ?? "0",
				left: response.executedQty
					? (
							Number.parseFloat(response.origQty ?? "0") -
							Number.parseFloat(response.executedQty)
						).toString()
					: (response.origQty ?? "0"),
				fill_price: avgPriceValue,
				price: priceValue,
				contract: contract ?? symbolToContract(response.symbol),
				side: response.side,
				posSide: response.positionSide,
				create_time: response.updateTime?.toString(),
				finish_time: response.updateTime?.toString(),
			};
		}
	}

	async cancelOrder(contract: string, orderId: string) {
		const symbol = contractToSymbol(contract);
		return this.request("DELETE", "/fapi/v1/order", { symbol, orderId }, true);
	}

	async getOpenOrders(contract?: string) {
		const params: RequestParams = {};
		if (contract) {
			params.symbol = contractToSymbol(contract);
		}
		const orders = await this.request<any[]>(
			"GET",
			"/fapi/v1/openOrders",
			params,
			true,
		);
		return (orders || []).map((order) => ({
			...order,
			ordId: order.orderId?.toString(),
			instId: `${order.symbol}-SWAP`,
			contract: symbolToContract(order.symbol),
		}));
	}

	async getOrderHistory(contract?: string, limit = 10) {
		const params: RequestParams = { limit };
		if (contract) params.symbol = contractToSymbol(contract);
		const orders = await this.request<any[]>(
			"GET",
			"/fapi/v1/allOrders",
			params,
			true,
		);
		return orders ?? [];
	}

	async getMyTrades(contract?: string, limit = 10) {
		const params: RequestParams = { limit };
		if (contract) params.symbol = contractToSymbol(contract);
		const trades = await this.request<any[]>(
			"GET",
			"/fapi/v1/userTrades",
			params,
			true,
		);
		return trades ?? [];
	}

	async getPositionHistory() {
		return [];
	}

	async getSettlementHistory() {
		return [];
	}
}
