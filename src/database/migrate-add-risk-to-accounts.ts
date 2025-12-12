import { createClient } from "@libsql/client";
import { getDatabaseUrl } from "../utils/pathUtils";
import * as dotenv from "dotenv";

dotenv.config();

async function main() {
	const dbUrl = process.env.DATABASE_URL || "file:./data/database/sqlite.db";
	console.log(`Connecting to database: ${dbUrl}`);

	const client = createClient({ url: dbUrl });

	try {
		console.log("Adding risk columns to account_configs table...");

		// Check if columns exist
		const tableInfo = await client.execute(
			"PRAGMA table_info(account_configs)",
		);
		const columns = tableInfo.rows.map((row: any) => row.name);

		if (!columns.includes("stop_loss_usdt")) {
			await client.execute(
				"ALTER TABLE account_configs ADD COLUMN stop_loss_usdt REAL",
			);
			console.log("Added stop_loss_usdt column");
		} else {
			console.log("stop_loss_usdt column already exists");
		}

		if (!columns.includes("take_profit_usdt")) {
			await client.execute(
				"ALTER TABLE account_configs ADD COLUMN take_profit_usdt REAL",
			);
			console.log("Added take_profit_usdt column");
		} else {
			console.log("take_profit_usdt column already exists");
		}

		console.log("Migration completed successfully.");
	} catch (error) {
		console.error("Migration failed:", error);
		process.exit(1);
	} finally {
		client.close();
	}
}

main();
