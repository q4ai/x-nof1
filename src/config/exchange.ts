import { getConfigStringValue } from "./riskParams.new";

export type ExchangeProvider = "okx" | "binance" | "bitget" | "gate";

export type OkxCredentials = {
	provider: "okx";
	apiKey: string;
	apiSecret: string;
	passphrase: string;
	simulated: boolean;
};

export type BinanceCredentials = {
	provider: "binance";
	apiKey: string;
	apiSecret: string;
	testnet: boolean;
};

export type BitgetCredentials = {
	provider: "bitget";
	apiKey: string;
	apiSecret: string;
	passphrase: string;
	simulated: boolean;
};

export type GateCredentials = {
	provider: "gate";
	apiKey: string;
	apiSecret: string;
	testnet: boolean;
};

export type ExchangeCredentials =
	| OkxCredentials
	| BinanceCredentials
	| BitgetCredentials
	| GateCredentials;

function asBoolean(value: string | undefined, fallback = "false"): boolean {
	const normalized = (value ?? fallback ?? "false").trim().toLowerCase();
	return normalized === "1" || normalized === "true" || normalized === "yes";
}

function getEnv(key: string, fallback = ""): string {
	return (process.env?.[key] ?? fallback) || fallback;
}

export function getExchangeProvider(): ExchangeProvider {
	const fromConfig = getConfigStringValue(
		"EXCHANGE_PROVIDER",
		getEnv("EXCHANGE_PROVIDER", "okx"),
	);
	const normalized = fromConfig.trim().toLowerCase();
	if (normalized === "binance") return "binance";
	if (normalized === "bitget") return "bitget";
	if (normalized === "gate") return "gate";
	return "okx";
}

export function getExchangeCredentials(): ExchangeCredentials {
	const provider = getExchangeProvider();

	if (provider === "binance") {
		const apiKey = getConfigStringValue(
			"BINANCE_API_KEY",
			getEnv("BINANCE_API_KEY"),
		);
		const apiSecret = getConfigStringValue(
			"BINANCE_API_SECRET",
			getEnv("BINANCE_API_SECRET"),
		);
		const testnet = asBoolean(
			getConfigStringValue(
				"BINANCE_USE_TESTNET",
				getEnv("BINANCE_USE_TESTNET", "false"),
			),
			"false",
		);

		return {
			provider: "binance",
			apiKey,
			apiSecret,
			testnet,
		};
	}

	if (provider === "bitget") {
		const apiKey = getConfigStringValue(
			"BITGET_API_KEY",
			getEnv("BITGET_API_KEY"),
		);
		const apiSecret = getConfigStringValue(
			"BITGET_API_SECRET",
			getEnv("BITGET_API_SECRET"),
		);
		const passphrase = getConfigStringValue(
			"BITGET_API_PASSPHRASE",
			getEnv("BITGET_API_PASSPHRASE"),
		);
		// Bitget doesn't have a standard "paper trading" flag in the same way, but we can support it if needed
		// For now, assume simulated is false or controlled by a similar env var
		const simulated = asBoolean(
			getConfigStringValue(
				"BITGET_USE_PAPER",
				getEnv("BITGET_USE_PAPER", "false"),
			),
			"false",
		);

		return {
			provider: "bitget",
			apiKey,
			apiSecret,
			passphrase,
			simulated,
		};
	}

	if (provider === "gate") {
		const apiKey = getConfigStringValue("GATE_API_KEY", getEnv("GATE_API_KEY"));
		const apiSecret = getConfigStringValue(
			"GATE_API_SECRET",
			getEnv("GATE_API_SECRET"),
		);
		const testnet = asBoolean(
			getConfigStringValue(
				"GATE_USE_TESTNET",
				getEnv("GATE_USE_TESTNET", "false"),
			),
			"false",
		);

		return {
			provider: "gate",
			apiKey,
			apiSecret,
			testnet,
		};
	}

	const apiKey = getConfigStringValue("OKX_API_KEY", getEnv("OKX_API_KEY"));
	const apiSecret = getConfigStringValue(
		"OKX_API_SECRET",
		getEnv("OKX_API_SECRET"),
	);
	const passphrase = getConfigStringValue(
		"OKX_API_PASSPHRASE",
		getEnv("OKX_API_PASSPHRASE"),
	);
	const simulated = asBoolean(
		getConfigStringValue("OKX_USE_PAPER", getEnv("OKX_USE_PAPER", "false")),
		"false",
	);

	return {
		provider: "okx",
		apiKey,
		apiSecret,
		passphrase,
		simulated,
	};
}

export function getExchangeProxy(): string {
	return getConfigStringValue(
		"HTTP_PROXY_URL",
		getEnv("HTTP_PROXY_URL", getEnv("EXCHANGE_HTTP_PROXY", "")),
	);
}
