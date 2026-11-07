import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  agents,
  agentActivityLogs,
  agentJobs,
  agentLogs,
  transactions,
} from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { ensureSeed, getMasterWallet } from "@/lib/seed";
import { getMarketOverview } from "@/lib/market";
import { exchangeStatus } from "@/lib/exchange";
import { telegramConfigured } from "@/lib/telegram";
import { ENV } from "@/lib/env";
import { guardAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * داده کامل «دفتر کار» یک کارمند برای مدیرعامل:
 * هدف، فعالیت‌های واقعی، صف کار، درآمد تأییدشده و وضعیت زیرساخت.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = guardAdmin(req);
  if (denied) return denied;
  await ensureSeed();
  const { id } = await ctx.params;
  const agentId = Number(id);
  if (!Number.isFinite(agentId)) {
    return NextResponse.json({ error: "شناسه کارمند نامعتبر است" }, { status: 400 });
  }

  const rows = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  const agent = rows[0];
  if (!agent) return NextResponse.json({ error: "کارمند پیدا نشد" }, { status: 404 });

  const [activity, jobs, logs, txs, wallet] = await Promise.all([
    db
      .select()
      .from(agentActivityLogs)
      .where(eq(agentActivityLogs.agentName, agent.name))
      .orderBy(desc(agentActivityLogs.createdAt), desc(agentActivityLogs.id))
      .limit(60),
    db
      .select()
      .from(agentJobs)
      .where(eq(agentJobs.agentId, agent.id))
      .orderBy(desc(agentJobs.createdAt), desc(agentJobs.id))
      .limit(25),
    db
      .select()
      .from(agentLogs)
      .where(eq(agentLogs.agent, agent.name))
      .orderBy(desc(agentLogs.createdAt), desc(agentLogs.id))
      .limit(25),
    db
      .select()
      .from(transactions)
      .where(eq(transactions.agentName, agent.name))
      .orderBy(desc(transactions.createdAt), desc(transactions.id))
      .limit(25),
    getMasterWallet(),
  ]);

  const market = await getMarketOverview(undefined, { allowFetch: false }).catch(() => ({
    available: false,
    entries: [],
    error: "market unavailable",
    fetchedAt: null,
    source: null,
  }));

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const todayActivity = activity.filter(
    (a) => a.createdAt && new Date(a.createdAt).getTime() >= startOfDay.getTime()
  );

  const confirmedIncome = txs
    .filter((t) => t.kind === "income" && t.status === "confirmed")
    .reduce((s, t) => s + Number(t.amountUsdt), 0);
  const pendingIncome = txs
    .filter((t) => t.status === "pending_verification")
    .reduce((s, t) => s + Number(t.amountUsdt), 0);

  return NextResponse.json({
    agent,
    goal: {
      title: agent.goalTitle,
      targetUsdt: Number(agent.goalTargetUsdt),
      earnedUsdt: Number(agent.earnedUsdt),
      progress:
        Number(agent.goalTargetUsdt) > 0
          ? Math.min(100, Math.round((Number(agent.earnedUsdt) / Number(agent.goalTargetUsdt)) * 100))
          : null,
    },
    today: {
      earnedUsdt: todayActivity.reduce((s, a) => s + Number(a.rewardUsdt), 0),
      runs: todayActivity.length,
      failed: todayActivity.filter((a) => a.status === "failed").length,
    },
    income: { confirmed: confirmedIncome, pending: pendingIncome },
    activity,
    jobs,
    logs,
    transactions: txs,
    wallet,
    market,
    infra: {
      exchange: exchangeStatus(),
      telegram: {
        configured: telegramConfigured(),
        adminChat: Boolean(ENV.telegramAdminChat()),
      },
      worker: Boolean(ENV.workerUrl()),
      gemini: Boolean(ENV.geminiKey()),
      appUrl: Boolean(process.env.NEXT_PUBLIC_APP_URL),
    },
  });
}
