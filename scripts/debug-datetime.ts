
import { createClient } from "@libsql/client";

const dbClient = createClient({
  url: process.env.DATABASE_URL || "file:./db/sqlite.db",
});

async function check() {
  try {
    console.log("Testing datetime function...");
    const result = await dbClient.execute("SELECT timestamp, datetime(timestamp) as dt FROM agent_decisions ORDER BY timestamp DESC LIMIT 5");
    console.log("Rows:", result.rows);
  } catch (e) {
    console.error(e);
  }
}

check();
