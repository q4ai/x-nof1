
import { getBinancePrecision } from "./src/database/binancePrecision.ts";
import { BinanceClient } from "./src/services/binanceClient.ts";
import { createLogger } from "./src/utils/loggerUtils.ts";

const logger = createLogger({ name: "debug-precision" });

async function main() {
  const contract = "AAVE_USDT";
  
  console.log(`Checking precision for ${contract}...`);
  
  // Check DB
  const dbPrecision = await getBinancePrecision(contract);
  console.log("DB Precision:", dbPrecision);
  
  // Check API
  // Note: You might need valid API keys if getContractInfo requires auth, 
  // but usually exchangeInfo is public. 
  // The BinanceClient constructor takes apiKey, apiSecret, useTestnet, proxyUrl.
  // We can try with empty keys for public endpoints if allowed, or use env vars.
  
  const apiKey = process.env.BINANCE_API_KEY || "";
  const apiSecret = process.env.BINANCE_API_SECRET || "";
  const client = new BinanceClient(apiKey, apiSecret, false);
  
  try {
    const contractInfo = await client.getContractInfo(contract);
    console.log("API Contract Info:", JSON.stringify(contractInfo, null, 2));
  } catch (error) {
    console.error("API Error:", error);
  }
}

main().catch(console.error);
