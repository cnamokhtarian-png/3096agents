import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import { conf } from "@/lib/config";

const databaseUrl =
  conf("DATABASE_URL") ||
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

// Strip `sslmode` from the URL: this app manages TLS itself via the `ssl`
// option below. Newer `pg` versions map `sslmode=require` to full chain
// verification, which breaks Supabase pooler (self-signed chain) with
// SELF_SIGNED_CERT_IN_CHAIN. Removing it makes behavior deterministic.
let connectionString = databaseUrl;
try {
  const u = new URL(databaseUrl);
  if (u.searchParams.has("sslmode")) {
    u.searchParams.delete("sslmode");
    connectionString = u.toString();
  }
} catch {
  // keep original string if it is not a parseable URL
}

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
};

export const pool =
  globalForDb.__arenaNextJsPostgresqlPool ??
  new Pool({
    connectionString,
    max: process.env.VERCEL ? 4 : 10,
    idleTimeoutMillis: 20000,
    connectionTimeoutMillis: 10000,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__arenaNextJsPostgresqlPool = pool;
}

export const db = drizzle(pool, { schema });
