import { db } from "@/db";
import { sql } from "drizzle-orm";
import { conf } from "@/lib/config";

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
    const raw = conf("DATABASE_URL");
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
    const t: any = await db.execute(sql`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'agentos'
    `);
    const tables: string[] = (t?.rows ?? []).map((r: any) => r.table_name);
    const required = [
      "agents",
      "transactions",
      "agent_activity_logs",
      "agent_jobs",
      "system_events",
    ];
    const missing = required.filter((x) => !tables.includes(x));
    return Response.json({
      ok: missing.length === 0,
      db: dbTarget(),
      schema: "agentos",
      tables: tables.length,
      missingTables: missing,
      hint: missing.length
        ? "فایل supabase/schema.sql را در SQL Editor سوپابیس اجرا کنید."
        : undefined,
    });
  } catch (e) {
    return Response.json(
      { ok: false, db: dbTarget(), error: errDetail(e) },
      { status: 500 },
    );
  }
}
