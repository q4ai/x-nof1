import "dotenv/config";
import { createClient } from "@libsql/client";
import { getActiveAccount } from "../src/services/accountConfigService";

async function main() {
  const dbClient = createClient({
    url: process.env.DATABASE_URL || "file:./db/sqlite.db",
  });

  const activeAccount = await getActiveAccount();
  const accountId = activeAccount ? activeAccount.id : null;
  console.log("活跃账户:", activeAccount?.id ?? "无");

  const total = await dbClient.execute("SELECT COUNT(*) as count FROM agent_decisions");
  console.log("agent_decisions 总数:", total.rows[0]);

  if (accountId !== null) {
    const filtered = await dbClient.execute({
      sql: "SELECT COUNT(*) as count FROM agent_decisions WHERE account_id = ?",
      args: [accountId],
    });
    console.log(`account_id=${accountId} 的决策数量:`, filtered.rows[0]);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
