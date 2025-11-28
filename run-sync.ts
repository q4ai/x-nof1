
import { syncBinancePrecisions } from "./src/scheduler/binancePrecisionSync.ts";
import { createLogger } from "./src/utils/loggerUtils.ts";

// Mock logger to avoid pino issues if possible, or just hope it works
console.log("Starting sync...");
syncBinancePrecisions()
  .then(() => console.log("Sync complete"))
  .catch(err => console.error("Sync failed", err));
