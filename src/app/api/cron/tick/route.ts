import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { cronRuns, systemEvents, transactions } from "@/db/schema";
import { eq, lt, and, sql } from "drizzle-orm";
import { ENV } from "@/lib/env";
import { refreshMarket } from "@/lib/market";
import { monitorApprovedTabdealPositions } from "@/lib/exit-monitor";
import { diagnoseLegacyTabdealOrders } from "@/lib/trade-diagnostics";
import { sendPendingTradeCloseReports } from "@/lib/trade-close-report";
import { reconcilePendingTabdealEntries } from "@/lib/reconcile-entry";
import { reconcilePendingTabdealExits } from "@/lib/reconcile-exit";
import {
  expireStaleApprovals,
  remindPendingApprovals,
  runQueuedJobs,
  sendDailyReports,
} from "@/lib/jobs";
import { recordAgentError } from "@/lib/agent-execution";
import { currentUser } from "@/lib/auth";
import { generateCooExecutiveReport, runFleetCycle } from "@/lib/coo";
import { escapeHtml, notifyAdmin } from "@/lib/telegram";

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
  if (bearer === secret || q === secret || headerSecret === secret)
    return { ok: true };
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
    return NextResponse.json(
      { ok: false, error: auth.reason },
      { status: 401 },
    );
  }

  const job = [
    "full",
    "fleet",
    "market",
    "queue",
    "approvals",
    "expire",
    "reports",
    "cleanup",
    "trade_diagnostics",
    "trade_reconcile",
    "trade_monitor",
  ].includes(jobParam)
    ? jobParam
    : "full";

  const started = Date.now();
  let runRow: typeof cronRuns.$inferSelect;
  try {
    [runRow] = await db.insert(cronRuns).values({ job, status: "running" }).returning();
  } catch (error: unknown) {
    // Database errors can contain connection credentials; expose only an error code.
    const cause = (error as { cause?: { code?: unknown } })?.cause;
    const code = typeof cause?.code === "string" && /^[A-Z0-9_]{1,32}$/.test(cause.code)
      ? cause.code : "DATABASE_UNAVAILABLE";
    console.error(`[cron] database unavailable: ${code}`);
    return NextResponse.json({ ok: false, job, error: `اتصال دیتابیس یا ثبت اجرای کرون ناموفق بود (${code})` }, { status: 503 });
  }
  const steps: Record<string, unknown> = {};
  let status = "ok";

  try {
    if (job === "trade_diagnostics") {
      const diagnostics = await diagnoseLegacyTabdealOrders();
      steps.tradeDiagnostics = diagnostics;
      if (!diagnostics.ok) status = "partial";
    }
    // Opt-in, reconciliation only. It does not monitor prices or submit sells.
    if (job === "trade_reconcile") {
      const entries = await reconcilePendingTabdealEntries();
      const result = await reconcilePendingTabdealExits();
      steps.entryReconcile = entries;
      steps.tradeReconcile = result;
      const reports = await sendPendingTradeCloseReports();
      steps.tradeCloseReports = reports;
      if (!result.ok || !entries.ok || !reports.ok) status = "partial";
    }
    // The existing five-minute full endpoint can run the lifecycle once the
    // migrations and end-to-end checks are complete and it is explicitly enabled.
    if (job === "trade_monitor" || (job === "full" && process.env.TRADE_LIFECYCLE_ENABLED === "true")) {
      const entries = await reconcilePendingTabdealEntries();
      const monitored = await monitorApprovedTabdealPositions();
      const reconciled = await reconcilePendingTabdealExits();
      steps.entryReconcile = entries;
      steps.tradeMonitor = monitored;
      steps.tradeReconcile = reconciled;
      const reports = await sendPendingTradeCloseReports();
      steps.tradeCloseReports = reports;
      if (!entries.ok || !monitored.ok || !reconciled.ok || !reports.ok) status = "partial";
    }
    if (job === "market" || job === "full") {
      const r = await refreshMarket();
      steps.market = r.ok
        ? {
            ok: true,
            prices: r.quotes.map((q) => `${q.symbol}:${q.price}`),
            durationMs: r.durationMs,
          }
        : { ok: false, error: r.error };
      if (!r.ok) status = "partial";
    }

    if (job === "fleet" || job === "full") {
      const fleet = await runFleetCycle({
        charterFirst: false,
        forceAriaCard: false,
        maxSpecialistProposals: 1,
      });
      if (!fleet.ok) status = "partial";
      steps.fleet = {
        ok: fleet.ok,
        durationMs: fleet.durationMs,
        ariaSetups: fleet.aria.setups?.length ?? 0,
        bountyFeeds: "feedsChecked" in fleet.bounty ? fleet.bounty.feedsChecked : 0,
        specialistProposals: fleet.specialists.proposalsDispatched,
        aria: fleet.aria,
        bounty: fleet.bounty,
        specialists: fleet.specialists,
      };
      const aria = fleet.aria;
      const bounty = fleet.bounty;
      const report = [
        `چرخه زنده ناوگان: ${fleet.ok ? "تکمیل شد" : "با خطا"}`,
        `آریا: ${aria.ok ? `${aria.setups.length} تحلیل: ${aria.setups.map((s) => `${s.symbol} $${s.entryPrice}`).join("، ")}` : ("error" in aria ? aria.error : aria.reason)}`,
        ...("warnings" in aria ? (aria.warnings ?? []) : []),
        `B7: ${"rawItems" in bounty ? `${bounty.rawItems} آیتم، ${bounty.candidatesFound} نامزد، ${bounty.createdCards?.length ?? 0} کارت` : "اسکن ناموفق"}`,
        ...("error" in bounty && bounty.error ? [`خطای B7: ${bounty.error}`] : []),
        ...("reason" in bounty ? [bounty.reason] : []),
        `متخصصان: ${fleet.specialists.proposalsDispatched} پیشنهاد`,
        ...("error" in fleet.specialists ? [`خطای متخصصان: ${fleet.specialists.error}`] : []),
        "نامزدها تضمین امنیت یا پاداش نیستند؛ اقدامات حساس نیازمند تأیید مدیرعامل‌اند.",
      ].join("\n");
      const notification = await notifyAdmin(escapeHtml(report.slice(0, 3500)));
      steps.fleetTelegram = notification.ok ? { ok: true } : { ok: false, error: notification.description || notification.error };
      if (!notification.ok) status = "partial";
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
      const [reports, coo] = await Promise.all([
        sendDailyReports(),
        generateCooExecutiveReport({ sendTelegram: true }),
      ]);
      steps.reports = reports;
      steps.cooReport = {
        ok: coo.ok,
        telegramSent: Boolean(coo.telegram?.ok),
        confirmedIncomeUsdt: coo.summary.company.confirmedIncomeUsdt,
      };
      if (reports.errors.length) status = "partial";
    }

    if (job === "cleanup" || job === "full") {
      const cutoff = new Date(Date.now() - 30 * 24 * 3600_000);
      await db.execute(
        sql`DELETE FROM agentos.system_events WHERE created_at < ${cutoff.toISOString()}`,
      );
      await db.execute(
        sql`DELETE FROM agentos.market_snapshots WHERE fetched_at < ${cutoff.toISOString()}`,
      );
      steps.cleanup = { ok: true, olderThanDays: 30 };
    }

    // شمارش واریزهای کهنه‌ی تأییدنشده (فقط گزارش، بدون تغییر داده)
    const stale = await db
      .select({ n: sql<number>`COUNT(*)` })
      .from(transactions)
      .where(
        and(
          eq(transactions.status, "pending_verification"),
          lt(transactions.createdAt, new Date(Date.now() - 48 * 3600_000)),
        ),
      );
    steps.staleDeposits = Number(stale[0]?.n || 0);

    const duration = Date.now() - started;
    await db
      .update(cronRuns)
      .set({
        status,
        detail: JSON.stringify(steps).slice(0, 4000),
        durationMs: duration,
        finishedAt: new Date(),
      })
      .where(eq(cronRuns.id, runRow.id));

    return NextResponse.json({
      ok: (job === "trade_reconcile" || job === "trade_monitor" || job === "trade_diagnostics") ? status === "ok" : true,
      job,
      status,
      durationMs: duration,
      steps,
      runId: runRow.id,
    }, { status: (job === "trade_reconcile" || job === "trade_monitor" || job === "trade_diagnostics") && status !== "ok" ? 503 : 200 });
  } catch (e: any) {
    const duration = Date.now() - started;
    const message = e?.message || String(e);
    await db
      .update(cronRuns)
      .set({
        status: "error",
        detail: message.slice(0, 2000),
        durationMs: duration,
        finishedAt: new Date(),
      })
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
    return NextResponse.json(
      { ok: false, job, error: message, steps },
      { status: 500 },
    );
  }
}
