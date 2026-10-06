import "server-only";
import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type Db = NeonHttpDatabase<typeof schema>;
let _db: Db | null = null;

/** Neon (Vercel Postgres) usa el driver HTTP serverless; cualquier otro Postgres usa postgres-js. */
export function isNeonUrl(url: string): boolean {
  return process.env.DB_DRIVER === "neon" || (process.env.DB_DRIVER !== "postgres" && /\.neon\.tech|neon\.build/.test(url));
}

export function db(): Db {
  if (_db) return _db;
  const url = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("POSTGRES_URL no está configurada. Revisa el README (Vercel Postgres / Neon).");
  _db = isNeonUrl(url)
    ? drizzleNeon(neon(url), { schema })
    : // Misma API de consultas que usamos (select/insert/update/delete/execute).
      (drizzlePg(postgres(url, { max: 5, prepare: false }), { schema }) as unknown as Db);
  return _db;
}

export { schema };
