import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const databaseUrl =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.SUPABASE_DB_URL;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is required. Set it in .env locally or in Vercel Environment Variables."
  );
}

const isLocal =
  databaseUrl.includes("127.0.0.1") || databaseUrl.includes("localhost");

const needsSsl =
  !isLocal ||
  databaseUrl.includes("supabase") ||
  databaseUrl.includes("sslmode=require") ||
  process.env.NODE_ENV === "production";

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
};

export const pool =
  globalForDb.__arenaNextJsPostgresqlPool ??
  new Pool({
    connectionString: databaseUrl,
    max: process.env.VERCEL ? 4 : 10,
    idleTimeoutMillis: 20000,
    connectionTimeoutMillis: 10000,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__arenaNextJsPostgresqlPool = pool;
}

export const db = drizzle(pool, { schema });
