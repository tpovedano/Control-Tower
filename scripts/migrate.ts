import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";
import { config } from "dotenv";

config({ path: ".env.local" });

async function main() {
  const url = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error("POSTGRES_URL no está definida (usa .env.local o `vercel env pull`).");
    process.exit(1);
  }
  await migrate(drizzle(neon(url)), { migrationsFolder: "./lib/db/migrations" });
  console.log("Migraciones aplicadas.");
}

main().catch((e) => {
  console.error("Error aplicando migraciones:", e instanceof Error ? e.message : e);
  process.exit(1);
});
