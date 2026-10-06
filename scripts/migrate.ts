import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { migrate as migrateNeon } from "drizzle-orm/neon-http/migrator";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import { migrate as migratePg } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

config({ path: ".env.local" });
config();

const migrationsFolder = "./lib/db/migrations";

async function main() {
  const url = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!url) {
    if (process.argv.includes("--if-configured")) {
      console.warn("POSTGRES_URL no definida: se omiten las migraciones en este build.");
      return;
    }
    console.error("POSTGRES_URL no está definida (usa .env.local o `vercel env pull .env.local`).");
    process.exit(1);
  }
  const neonUrl = process.env.DB_DRIVER === "neon" || (process.env.DB_DRIVER !== "postgres" && /\.neon\.tech|neon\.build/.test(url));
  if (neonUrl) {
    await migrateNeon(drizzleNeon(neon(url)), { migrationsFolder });
  } else {
    const sql = postgres(url, { max: 1 });
    await migratePg(drizzlePg(sql), { migrationsFolder });
    await sql.end();
  }
  console.log("Migraciones aplicadas.");
}

main().catch((e) => {
  console.error("Error aplicando migraciones:", e instanceof Error ? e.message : e);
  process.exit(1);
});
