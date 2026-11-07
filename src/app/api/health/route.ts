import { db } from "@/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

function errDetail(e: unknown): string {
  if (e instanceof Error) {
    const anyE = e as Error & { cause?: unknown; code?: unknown };
    const code = anyE.code !== undefined ? ` [code=${String(anyE.code)}]` : "";
    const cause =
      anyE.cause !== undefined && anyE.cause !== null
        ? " | cause: " + errDetail(anyE.cause)
        : "";
    return `${e.message}${code}${cause}`;
  }
  return String(e);
}

function dbTarget(): string {
  try {
    const raw = process.env.DATABASE_URL || "";
    if (!raw) return "DATABASE_URL is empty";
    const u = new URL(raw);
    const user = (u.username || "?").split(".")[0];
    return `${user}@[hidden]@${u.hostname}:${u.port || "?"}`;
  } catch {
    return "DATABASE_URL is invalid";
  }
}

export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return Response.json({ ok: true, db: dbTarget() });
  } catch (e) {
    return Response.json(
      { ok: false, db: dbTarget(), error: errDetail(e) },
      { status: 500 }
    );
  }
}
