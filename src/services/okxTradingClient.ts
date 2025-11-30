import { createLogger } from "../utils/loggerUtils";
import { type OkxPosition, createOkxClient } from "./okxClient";

const logger = createLogger({
	name: "okx-trading-client",
	level: "info",
});

type FuturesAccountSnapshot = {
	total: string;
	available: string;
	positionMargin: string;
	orderMargin: string;
	unrealisedPnl: string;
	currency: string;
};

type FuturesTicker = {
	contract: string;
	last: string;
	markPrice: string;
	indexPrice: string;
	high24h: string;
	low24h: string;
	volume24h: string;
	changePercentage: string;
	fundingRate: string;
};

type FuturesOrder = {
	id: string;
	contract: string;
	size: string;
	price: string | null;
	avgFillPrice: string | null;
	fill_price?: string | null;
	left: string;
	status: string;
	side: "long" | "short";
	isReduceOnly?: boolean;
	is_reduce_only?: boolean;
	create_time?: string;
	finish_time?: string;
};

type FundingRate = {
	r: string;
	t: string;
};

type ContractInfo = {
	contract: string;
	tickSize: string;
	lotSize: string;
	orderSizeMin: string;
	orderSizeMax: string;
	quantoMultiplier: string;
	quoteCurrency: string;
	baseCurrency: string;
};

type FuturesCandle = {
	t: number;
	o: string;
	h: string;
	l: string;
	c: string;
	v: string;
};

type OrderBookSide = {
	p: string;
	s: string;
};

type OrderBook = {
	contract: string;
	bids: OrderBookSide[];
	asks: OrderBookSide[];
	ts?: string;
};

type AccountPosition = {
	contract: string;
	size: string;
	entryPrice: string;
	markPrice: string;
	leverage: string;
	unrealisedPnl: string;
	realisedPnl: string;
	margin: string;
	liqPrice: string;
	liquidationPrice: string;
	posSide: string;
	createTime?: string;
	updateTime?: string;
};

class TradingClient {
	private get client() {
		return createOkxClient();
	}
	private readonly orderContractCache = new Map<string, string>();

	private rememberOrder(orderId: string | undefined, contract: string) {
		if (orderId) {
			this.orderContractCache.set(orderId, contract);
		}
	}

	private mapPosition(pos: OkxPosition): AccountPosition {
		const size = Number.parseFloat(pos.size ?? "0");
		return {
			contract: pos.contract,
			size: pos.size ?? "0",
			entryPrice: pos.entryPrice ?? "0",
			markPrice: pos.markPrice ?? "0",
			leverage: pos.leverage ?? "1",
			unrealisedPnl: pos.unrealisedPnl ?? "0",
			realisedPnl: "0",
			margin: pos.margin ?? "0",
			liqPrice: pos.liqPrice ?? "0",
			liquidationPrice: pos.liqPrice ?? "0",
			posSide: pos.posSide ?? (size >= 0 ? "long" : "short"),
			createTime: pos.createTime,
			updateTime: pos.updateTime,
		};
	}

	async getFuturesAccount(): Promise<FuturesAccountSnapshot> {
		const snapshot = await this.client.getFuturesAccount();
		const total = Number.parseFloat(snapshot.total ?? "0");
		const available = Number.parseFloat(snapshot.available ?? "0");
		const positionMargin =
			snapshot.positionMargin ?? String(Math.max(total - available, 0));
		return {
			total: snapshot.total ?? "0",
			available: snapshot.available ?? "0",
			positionMargin,
			orderMargin: "0",
			unrealisedPnl: snapshot.unrealisedPnl ?? "0",
			currency: "USDT",
		};
	}

	async getPositions(): Promise<AccountPosition[]> {
		const positions = await this.client.getPositions();
		return positions.map((pos) => this.mapPosition(pos));
	}

	async getFuturesTicker(contract: string): Promise<FuturesTicker> {
		const ticker = await this.client.getFuturesTicker(contract);
		return {
			contract: ticker.contract,
			last: ticker.last ?? "0",
			markPrice: ticker.markPrice ?? ticker.last ?? "0",
			indexPrice: ticker.markPrice ?? ticker.last ?? "0",
			high24h: "0",
			low24h: "0",
			volume24h: ticker.volume_24h ?? "0",
			changePercentage: ticker.change_percentage?.toString() ?? "0",
			fundingRate: ticker.fundingRate ?? "0",
		};
	}

	async getFuturesCandles(
		contract: string,
		interval = "5m",
		limit = 100,
	): Promise<FuturesCandle[]> {
		const candles = await this.client.getFuturesCandles(
			contract,
			interval,
			limit,
		);
		return candles.map((candle) => ({
			t: candle.t,
			o: candle.o,
			h: candle.h,
			l: candle.l,
			c: candle.c,
			v: candle.v,
		}));
	}

	async getOrderBook(contract: string, depth = 10): Promise<OrderBook> {
		const book = await this.client.getOrderBook(contract, depth);
		return {
			contract: book.contract,
			bids: (book.bids ?? []).map((bid) => ({ p: bid.p, s: bid.s })),
			asks: (book.asks ?? []).map((ask) => ({ p: ask.p, s: ask.s })),
			ts: book.ts,
		};
	}

	async getContractInfo(contract: string): Promise<ContractInfo> {
		const info = await this.client.getContractInfo(contract);
		return {
			contract: info.contract,
			tickSize: info.tickSize ?? "0.1",
			lotSize: info.lotSize ?? "1",
			orderSizeMin: info.orderSizeMin ?? info.lotSize ?? "1",
			orderSizeMax: info.orderSizeMax ?? "1000000",
			quantoMultiplier: info.quantoMultiplier ?? info.contractValue ?? "0.01",
			quoteCurrency: info.quoteCcy ?? "USDT",
			baseCurrency: info.baseCcy ?? contract.replace("_USDT", ""),
		};
	}

	async setLeverage(
		contract: string,
		leverage: number,
		marginMode: "cross" | "isolated" = "cross",
	) {
		return this.client.setLeverage(contract, leverage, marginMode);
	}

	async placeOrder(params: {
		contract: string;
		size: number;
		price?: number;
		tif?: string;
		reduceOnly?: boolean;
		stopLoss?: number;
		takeProfit?: number;
		positionSide?: "long" | "short" | "net";
		marginMode?: "cross" | "isolated";
	}): Promise<FuturesOrder> {
		const order = await this.client.placeOrder(params);
		this.rememberOrder(order.id, params.contract);

		const side: "long" | "short" = params.size > 0 ? "long" : "short";

		return {
			id: order.id ?? "",
			contract: params.contract,
			size: order.size ?? String(Math.abs(params.size)),
			price: order.price ?? null,
			avgFillPrice: order.fill_price ?? order.avgPrice ?? null,
			fill_price: order.fill_price ?? order.avgPrice ?? null,
			left: order.left ?? "0",
			status: order.status ?? "live",
			side,
		};
	}

	async getOrder(orderId: string): Promise<FuturesOrder> {
		const order = await this.client.getOrder(orderId);
		if (order.contract) {
			this.rememberOrder(orderId, order.contract);
		}
		const rawSide = (order.side ?? order.posSide ?? "").toLowerCase();
		const side: "long" | "short" =
			rawSide === "buy" || rawSide === "long"
				? "long"
				: rawSide === "sell" || rawSide === "short"
					? "short"
					: Number.parseFloat(order.size ?? "0") >= 0
						? "long"
						: "short";

		return {
			id: order.id ?? orderId,
			contract: order.contract ?? this.orderContractCache.get(orderId) ?? "",
			size: order.size ?? "0",
			price: order.price ?? null,
			avgFillPrice: order.fill_price ?? null,
			fill_price: order.fill_price ?? null,
			left: order.left ?? "0",
			status: order.status ?? "live",
			side,
			create_time: order.create_time,
			finish_time: order.finish_time,
		};
	}

	private async resolveContract(orderId: string): Promise<string | undefined> {
		if (this.orderContractCache.has(orderId)) {
			return this.orderContractCache.get(orderId);
		}
		try {
			const order = await this.client.getOrder(orderId);
			if (order.contract) {
				this.rememberOrder(orderId, order.contract);
				return order.contract;
			}
		} catch (error) {
			logger.warn(`无法获取订单 ${orderId} 的合约信息: ${String(error)}`);
		}
		return undefined;
	}

	async cancelOrder(orderId: string) {
		const contract = await this.resolveContract(orderId);
		if (!contract) {
			throw new Error(`无法确定订单 ${orderId} 对应的合约，取消失败`);
		}
		await this.client.cancelOrder(contract, orderId);
	}

	async getOpenOrders(contract?: string): Promise<FuturesOrder[]> {
		const orders = await this.client.getOpenOrders(contract);
		return (orders ?? []).map((order: any) => {
			const contractCode = order.contract ?? contract ?? "";
			const size = Number.parseFloat(order.sz ?? "0");
			const filled = Number.parseFloat(order.accFillSz ?? "0");
			const left = Math.max(size - filled, 0);
			const side =
				order.side === "buy" || order.posSide === "long" ? "long" : "short";

			this.rememberOrder(order.ordId, contractCode);

			return {
				id: order.ordId,
				contract: contractCode,
				size: order.sz ?? "0",
				price: order.px ?? null,
				avgFillPrice: order.avgPx ?? null,
				fill_price: order.avgPx ?? null,
				left: String(left),
				status: order.state ?? "live",
				side,
				isReduceOnly: order.reduceOnly === "true" || order.reduceOnly === true,
				is_reduce_only:
					order.reduceOnly === "true" || order.reduceOnly === true,
				create_time: order.cTime,
				finish_time: order.uTime,
			};
		});
	}

	async getFundingRate(contract: string): Promise<FundingRate> {
		const rate = await this.client.getFundingRate(contract);
		return {
			r: rate?.fundingRate ?? rate?.r ?? "0",
			t: rate?.fundingTime ?? rate?.t ?? new Date().toISOString(),
		};
	}

	async getMyTrades(contract?: string, limit = 10) {
		const trades = await this.client.getMyTrades(contract, limit);
		return trades;
	}

	async getPositionHistory(contract?: string, limit = 100, after?: string) {
		return this.client.getPositionHistory(contract, limit, after);
	}

	async getSettlementHistory(contract?: string, limit = 100, after?: string) {
		return this.client.getSettlementHistory(contract, limit, after);
	}

	async getAllContracts() {
		return this.client.getAllContracts();
	}
}

let singleton: TradingClient | null = null;

export function createTradingClient(): TradingClient {
	if (!singleton) {
		singleton = new TradingClient();
	}
	return singleton;
}

// 保持向后兼容的别名
export const createOkxTradingClient = createTradingClient;
