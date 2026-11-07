import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { projects, tasks, messages, transactions, agents, agentJobs, agentActivityLogs, cronRuns } from "@/db/schema";
import { desc, sql } from "drizzle-orm";
import { ensureSeed, getMasterWallet } from "@/lib/seed";
import { getMarketOverview } from "@/lib/market";
import { exchangeStatus } from "@/lib/exchange";
import { ConfigError } from "@/lib/env";
import { guardAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * آمار واقعی داشبورد — هیچ مقدار تصادفی یا ثابتی اینجا ساخته نمی‌شود.
 * همه اعداد از Supabase و (برای قیمت) از صرافی خوانده می‌شوند.
 */
export async function GET(req: NextRequest) {
  const denied = guardAdmin(req);
  if (denied) return denied;
  await ensureSeed();

  const [p, t, m, tx, ag, masterWallet, jobs, recentActivity, lastCron] = await Promise.all([
    db.select().from(projects),
    db.select().from(tasks),
    db.select().from(messages),
    db.select().from(transactions),
    db.select().from(agents),
    getMasterWallet(),
    db.select().from(agentJobs).orderBy(desc(agentJobs.createdAt)).limit(80),
    db
      .select()
      .from(agentActivityLogs)
      .orderBy(desc(agentActivityLogs.createdAt), desc(agentActivityLogs.id))
      .limit(12),
    db.select().from(cronRuns).orderBy(desc(cronRuns.id)).limit(1),
  ]);

  let market: Awaited<ReturnType<typeof getMarketOverview>> = {
    available: false,
    entries: [],
    error: null,
    fetchedAt: null,
    source: null,
  };
  try {
    market = await getMarketOverview();
  } catch (e: any) {
    market.error = e instanceof ConfigError ? e.message : e?.message || "market unavailable";
  }

  const totalBudget = p.reduce((s, x) => s + Number(x.budgetUsdt || 0), 0);
  const received = p.reduce((s, x) => s + Number(x.receivedUsdt || 0), 0);
  const confirmed = tx.filter(
    (x) => Number(x.amountUsdt) > 0 && x.status === "confirmed" && x.kind === "income"
  );
  const income = confirmed.reduce((s, x) => s + Number(x.amountUsdt || 0), 0);
  const incomePending = tx
    .filter((x) => x.status === "pending_verification")
    .reduce((s, x) => s + Number(x.amountUsdt || 0), 0);
  const withdrawals = tx
    .filter((x) => x.kind === "withdraw")
    .reduce((s, x) => s + Math.abs(Number(x.amountUsdt || 0)), 0);
  const fleetTotal = ag.reduce((s, x) => s + Number(x.earnedUsdt || 0), 0);

  // نمودار درآمد: ۶ ماه اخیر از تراکنش‌های واقعی
  let chart: Array<{ m: string; v: number }> = [];
  try {
    const rows: any = await db.execute(sql`
      SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS ym,
             COALESCE(SUM(amount_usdt), 0)::float AS total
        FROM agentos.transactions
       WHERE kind = 'income'
         AND status = 'confirmed'
         AND created_at >= date_trunc('month', NOW()) - INTERVAL '5 months'
       GROUP BY 1
       ORDER BY 1
    `);
    const map = new Map<string, number>();
    for (const r of rows?.rows ?? []) map.set(String(r.ym), Number(r.total));
    chart = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setDate(1);
      d.setMonth(d.getMonth() - i);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      chart.push({
        m: d.toLocaleDateString("fa-IR", { month: "long" }),
        v: Math.round(map.get(ym) || 0),
      });
    }
  } catch {
    chart = [];
  }

  const pendingJobs = jobs.filter((j) => ["queued", "awaiting_approval", "approved", "running"].includes(j.status));
  const awaitingApproval = jobs.filter((j) => j.status === "awaiting_approval").length;
  const failed24h = recentActivity.filter((a) => a.status === "failed").length;
  const exchange = exchangeStatus();

  return NextResponse.json({
    projects: p.length,
    active: p.filter((x) => x.status === "in_progress").length,
    pendingTasks: t.filter((x) => x.status === "pending").length,
    unread: m.filter((x) => x.status === "unread").length,
    totalBudget,
    received,
    income,
    incomePending,
    withdrawals,
    fleetTotal,
    activeAgents: ag.filter((x) => x.status === "active").length,
    totalAgents: ag.length,
    masterWallet,
    pendingAmount: Math.max(0, totalBudget - received),
    byStatus: Object.fromEntries(
      ["new", "negotiating", "approved", "in_progress", "delivered", "paid"].map((s) => [
        s,
        p.filter((x) => x.status === s).length,
      ])
    ),
    chart,
    market,
    // قیمت‌های واقعی برای هدر (اگر صرافی در دسترس نباشد null است، نه عدد ساختگی)
    btc: market.entries.find((e) => e.symbol === "BTCUSDT")?.price ?? null,
    eth: market.entries.find((e) => e.symbol === "ETHUSDT")?.price ?? null,
    ton: market.entries.find((e) => e.symbol === "TONUSDT")?.price ?? null,
    jobs: {
      open: pendingJobs.length,
      awaitingApproval,
      failed: jobs.filter((j) => j.status === "failed").length,
      succeeded: jobs.filter((j) => j.status === "succeeded").length,
      recent: pendingJobs.slice(0, 6),
    },
    health: {
      failed24h,
      lastCronAt: lastCron[0]?.finishedAt ?? lastCron[0]?.startedAt ?? null,
      lastCronJob: lastCron[0]?.job ?? null,
      exchange: exchange.mode,
      trading: exchange.tradingEnabled,
    },
    recentActivity,
  });
}
