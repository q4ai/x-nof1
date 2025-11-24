import "dotenv/config";
import { createClient } from "@libsql/client";
import { getActiveAccount } from "../src/services/accountConfigService";

async function run() {
  const dbClient = createClient({
    url: process.env.DATABASE_URL || "file:./db/sqlite.db",
  });

  const activeAccount = await getActiveAccount();
  const accountId = activeAccount ? activeAccount.id.toString() : "default";
  console.log("active account", accountId);

  const result = await dbClient.execute({
    sql: `SELECT id, timestamp, account_id FROM agent_decisions 
          WHERE account_id = ? OR account_id IS NULL OR account_id = 'default'
          ORDER BY id DESC LIMIT 10`,
    args: [accountId],
  });
  console.log(result.rows);
}

run();
