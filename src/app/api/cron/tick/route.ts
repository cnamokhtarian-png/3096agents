import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { cronRuns, systemEvents, transactions } from "@/db/schema";
import { eq, lt, and, sql } from "drizzle-orm";
import { ENV } from "@/lib/env";
import { refreshMarket } from "@/lib/market";
import { expireStaleApprovals, remindPendingApprovals, runQueuedJobs, sendDailyReports } from "@/lib/jobs";
import { recordAgentError } from "@/lib/agent-execution";
import { currentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Vercel Cron — اجرای واقعی پس‌زمینه.
 * Vercel هدر `Authorization: Bearer $CRON_SECRET` را خودش می‌فرستد.
 *
 * کارها:
 *   market    → قیمت واقعی صرافی را در Supabase ذخیره می‌کند
 *   queue     → کارهای صف بدون نیاز به تأیید را اجرا می‌کند
 *   approvals → یادآوری درخواست‌های تأیید بی‌پاسخ در تلگرام
 *   expire    → منقضی کردن تأییدهای قدیمی
 *   reports   → گزارش روزانه هر کارمند را به تلگرام می‌فرستد
 *   cleanup   → رویدادهای قدیمی سیستم را پاک می‌کند
 */

function authorized(req: NextRequest) {
  const secret = ENV.cronSecret();
  if (!secret) return { ok: false, reason: "CRON_SECRET ست نشده است" };
  const auth = req.headers.get("authorization") || "";
  const bearer = auth.replace(/^Bearer\s+/i, "").trim();
  const q = new URL(req.url).searchParams.get("secret") || "";
  const headerSecret = req.headers.get("x-cron-secret") || "";
  if (bearer === secret || q === secret || headerSecret === secret) return { ok: true };
  // مدیرعامل وارد‌شده هم می‌تواند از پنل اجرای دستی را تحریک کند
  try {
    if (currentUser(req)) return { ok: true };
  } catch {
    // کوکی نامعتبر
  }
  return { ok: false, reason: "سکرت کرون نامعتبر است" };
}

export async function GET(req: NextRequest) {
  return run(req, new URL(req.url).searchParams.get("job") || "full");
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  return run(req, String(body?.job || "full"));
}

async function run(req: NextRequest, jobParam: string) {
  const auth = authorized(req);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.reason }, { status: 401 });
  }

  const job = ["full", "market", "queue", "approvals", "expire", "reports", "cleanup"].includes(jobParam)
    ? jobParam
    : "full";

  const started = Date.now();
  const [runRow] = await db.insert(cronRuns).values({ job, status: "running" }).returning();
  const steps: Record<string, unknown> = {};
  let status = "ok";

  try {
    if (job === "market" || job === "full") {
      const r = await refreshMarket();
      steps.market = r.ok
        ? { ok: true, prices: r.quotes.map((q) => `${q.symbol}:${q.price}`), durationMs: r.durationMs }
        : { ok: false, error: r.error };
      if (!r.ok) status = "partial";
    }

    if (job === "queue" || job === "full") {
      const results = await runQueuedJobs(5);
      steps.queue = { executed: results.length, results };
      if (results.some((r) => !r.ok)) status = "partial";
    }

    if (job === "approvals" || job === "full") {
      steps.approvals = await remindPendingApprovals(45);
    }

    if (job === "expire" || job === "full") {
      steps.expire = await expireStaleApprovals(72);
    }

    if (job === "reports") {
      const reports = await sendDailyReports();
      steps.reports = reports;
      if (reports.errors.length) status = "partial";
    }

    if (job === "cleanup" || job === "full") {
      const cutoff = new Date(Date.now() - 30 * 24 * 3600_000);
      await db.execute(sql`DELETE FROM agentos.system_events WHERE created_at < ${cutoff.toISOString()}`);
      await db.execute(sql`DELETE FROM agentos.market_snapshots WHERE fetched_at < ${cutoff.toISOString()}`);
      steps.cleanup = { ok: true, olderThanDays: 30 };
    }

    // شمارش واریزهای کهنه‌ی تأییدنشده (فقط گزارش، بدون تغییر داده)
    const stale = await db
      .select({ n: sql<number>`COUNT(*)` })
      .from(transactions)
      .where(
        and(
          eq(transactions.status, "pending_verification"),
          lt(transactions.createdAt, new Date(Date.now() - 48 * 3600_000))
        )
      );
    steps.staleDeposits = Number(stale[0]?.n || 0);

    const duration = Date.now() - started;
    await db
      .update(cronRuns)
      .set({ status, detail: JSON.stringify(steps).slice(0, 4000), durationMs: duration, finishedAt: new Date() })
      .where(eq(cronRuns.id, runRow.id));

    return NextResponse.json({ ok: true, job, status, durationMs: duration, steps, runId: runRow.id });
  } catch (e: any) {
    const duration = Date.now() - started;
    const message = e?.message || String(e);
    await db
      .update(cronRuns)
      .set({ status: "error", detail: message.slice(0, 2000), durationMs: duration, finishedAt: new Date() })
      .where(eq(cronRuns.id, runRow.id));
    await db
      .insert(systemEvents)
      .values({ level: "error", scope: "cron", message, meta: { job, steps } })
      .catch(() => {});
    await recordAgentError({
      agentName: "سیستم کرون",
      action: `اجرای کرون ${job} ناموفق بود`,
      detail: message,
      source: "cron",
    });
    return NextResponse.json({ ok: false, job, error: message, steps }, { status: 500 });
  }
}
