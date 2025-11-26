import "dotenv/config";
import { createClient } from "@libsql/client";
import { getActiveAccount } from "../src/services/accountConfigService";

const dbClient = createClient({
  url: process.env.DATABASE_URL || "file:./data/database/sqlite.db",
});

async function backfill() {
  const activeAccount = await getActiveAccount();
  if (!activeAccount) {
    console.error("未找到活跃账户，无法回填 account_id");
    process.exit(1);
  }

  const accountId = activeAccount.id;
  console.log(`使用活跃账户 ID ${accountId} 回填历史数据`);

  const tables = ["agent_decisions", "agent_request_logs"] as const;
  for (const table of tables) {
    const result = await dbClient.execute({
      sql: `UPDATE ${table}
            SET account_id = ?
            WHERE account_id IS NULL OR account_id = '' OR account_id = 'default'`,
      args: [accountId],
    });
    const updated = typeof result.rowsAffected === "number" ? result.rowsAffected : 0;
    console.log(`${table} 已回填 ${updated} 条记录`);
  }

  console.log("回填完成");
}

backfill().catch((error) => {
  console.error("回填 account_id 失败", error);
  process.exit(1);
});
