import "server-only";
import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema";

let _db: NeonHttpDatabase<typeof schema> | null = null;

export function db(): NeonHttpDatabase<typeof schema> {
  if (_db) return _db;
  const url = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("POSTGRES_URL no está configurada. Revisa el README (Vercel Postgres / Neon).");
  _db = drizzle(neon(url), { schema });
  return _db;
}

export { schema };
