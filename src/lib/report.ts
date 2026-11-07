import { db } from "@/db";
import {
  agents,
  agentActivityLogs,
  agentJobs,
  agentLogs,
  transactions,
} from "@/db/schema";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { ENV } from "@/lib/env";
import { exchangeStatus } from "@/lib/exchange";
import { getMarketOverview } from "@/lib/market";
import { getMasterWallet } from "@/lib/seed";
import { generateGeminiText } from "@/lib/ai";

/**
 * گزارش وضعیت کارمند — کاملاً بر پایه‌ی داده‌های واقعی دیتابیس.
 * اگر GEMINI_API_KEY ست شده باشد، همین «واقعیت‌ها» به مدل داده می‌شود و
 * مدل فقط متن گزارش را می‌نویسد (هیچ عددی از خودش نمی‌سازد).
 */

export type AgentFacts = Awaited<ReturnType<typeof buildAgentFacts>>;

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export async function buildAgentFacts(agentId: number) {
  const rows = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  const agent = rows[0];
  if (!agent) return null;

  const today = startOfToday();
  const [activity, jobs, legacyLogs, txs, wallet, market, daily] = await Promise.all([
    db
      .select()
      .from(agentActivityLogs)
      .where(eq(agentActivityLogs.agentName, agent.name))
      .orderBy(desc(agentActivityLogs.createdAt), desc(agentActivityLogs.id))
      .limit(40),
    db
      .select()
      .from(agentJobs)
      .where(eq(agentJobs.agentId, agent.id))
      .orderBy(desc(agentJobs.createdAt))
      .limit(30),
    db
      .select()
      .from(agentLogs)
      .where(eq(agentLogs.agent, agent.name))
      .orderBy(desc(agentLogs.createdAt), desc(agentLogs.id))
      .limit(20),
    db
      .select()
      .from(transactions)
      .where(eq(transactions.agentName, agent.name))
      .orderBy(desc(transactions.createdAt), desc(transactions.id))
      .limit(30),
    getMasterWallet(),
    getMarketOverview(undefined, { allowFetch: false }),
    db
      .select({
        earnedToday: sql<number>`COALESCE(SUM(${agentActivityLogs.rewardUsdt}), 0)`,
        runsToday: sql<number>`COUNT(*)`,
      })
      .from(agentActivityLogs)
      .where(and(eq(agentActivityLogs.agentName, agent.name), gte(agentActivityLogs.createdAt, today))),
  ]);

  const confirmedIncome = txs
    .filter((t) => t.status === "confirmed" && Number(t.amountUsdt) > 0)
    .reduce((s, t) => s + Number(t.amountUsdt), 0);
  const pendingIncome = txs
    .filter((t) => t.status === "pending_verification")
    .reduce((s, t) => s + Number(t.amountUsdt), 0);
  const pendingJobs = jobs.filter((j) => ["queued", "awaiting_approval", "approved", "running"].includes(j.status));
  const failedToday = activity.filter(
    (a) => a.status === "failed" && a.createdAt && new Date(a.createdAt).getTime() >= today.getTime()
  );

  const goalTarget = Number(agent.goalTargetUsdt) || 0;
  const goalProgress = goalTarget > 0 ? Math.min(100, Math.round((Number(agent.earnedUsdt) / goalTarget) * 100)) : null;

  return {
    generatedAt: new Date().toISOString(),
    agent: {
      id: agent.id,
      name: agent.name,
      slug: agent.slug,
      role: agent.role,
      specialty: agent.specialty,
      avatar: agent.avatar,
      status: agent.status,
      department: agent.department,
      goalTitle: agent.goalTitle,
      goalTargetUsdt: goalTarget,
      goalProgress,
      strategy: agent.strategy,
      earnedUsdt: Number(agent.earnedUsdt),
      tasksCompleted: Number(agent.tasksCompleted),
      successCount: Number(agent.successCount),
      errorCount: Number(agent.errorCount),
      lastActiveAt: agent.lastActiveAt,
      currentFocus: agent.currentFocus,
      apiEndpoint: agent.apiEndpoint,
    },
    today: {
      earnedUsdt: Number(daily[0]?.earnedToday || 0),
      runs: Number(daily[0]?.runsToday || 0),
      failed: failedToday.length,
    },
    wallet,
    income: { confirmed: confirmedIncome, pending: pendingIncome },
    jobs: {
      total: jobs.length,
      pending: pendingJobs.length,
      awaitingApproval: jobs.filter((j) => j.status === "awaiting_approval").length,
      succeeded: jobs.filter((j) => j.status === "succeeded").length,
      failed: jobs.filter((j) => j.status === "failed").length,
      recent: pendingJobs.slice(0, 5),
    },
    activity: activity.slice(0, 12).map((a) => ({
      action: a.action,
      status: a.status,
      detail: a.detail,
      rewardUsdt: Number(a.rewardUsdt),
      createdAt: a.createdAt,
    })),
    legacyLogs: legacyLogs.slice(0, 8),
    exchange: exchangeStatus(),
    market,
  };
}

/** متن گزارش از روی داده واقعی — بدون هیچ عدد ساختگی. */
export function composeDatabaseReport(facts: NonNullable<AgentFacts>) {
  const f = facts;
  const n = (v: number) => v.toLocaleString("fa-IR", { maximumFractionDigits: 2 });
  const lines: string[] = [];
  lines.push(`📋 گزارش وضعیت ${f.agent.name}`);
  lines.push(`⏱ زمان گزارش: ${new Date(f.generatedAt).toLocaleString("fa-IR")}`);
  lines.push(`💼 سمت: ${f.agent.role}${f.agent.department ? ` — دپارتمان ${f.agent.department}` : ""}`);
  lines.push(`🟢 وضعیت: ${f.agent.status === "active" ? "فعال" : f.agent.status === "paused" ? "متوقف" : f.agent.status}`);
  lines.push("");
  lines.push(`🎯 هدف فعلی: ${f.agent.goalTitle || "تعیین نشده"}`);
  if (f.agent.goalTargetUsdt > 0) {
    lines.push(`   پیشرفت هدف: ${n(f.agent.earnedUsdt)} از ${n(f.agent.goalTargetUsdt)} USDT (${f.agent.goalProgress}٪)`);
  }
  lines.push("");
  lines.push(`💰 درآمد تجمیعی: ${n(f.agent.earnedUsdt)} USDT (واریز به کیف پول واحد)`);
  lines.push(`📈 درآمد امروز: ${n(f.today.earnedUsdt)} USDT • اجراهای امروز: ${n(f.today.runs)}`);
  lines.push(`🧾 درآمد تأییدشده: ${n(f.income.confirmed)} USDT • در انتظار تأیید: ${n(f.income.pending)} USDT`);
  lines.push(`✅ تسک‌های تأییدشده: ${n(f.agent.tasksCompleted)} • موفقیت: ${n(f.agent.successCount)} • خطا: ${n(f.agent.errorCount)}`);
  lines.push("");
  lines.push(`📌 کار در جریان: ${f.agent.currentFocus || "موردی ثبت نشده"}`);
  lines.push(
    `🗂 صف کار: ${n(f.jobs.pending)} مورد باز • ${n(f.jobs.awaitingApproval)} منتظر تأیید • ${n(f.jobs.failed)} خطا`
  );
  lines.push(`💳 مقصد واریز: ${f.wallet.address || "تنظیم نشده"} (${f.wallet.network})`);
  lines.push(`🏦 صرافی: ${f.exchange.message}`);
  if (f.market.available && f.market.entries.length) {
    lines.push(
      `📊 بازار (${f.market.entries[0].stale ? "قیمت قدیمی" : "زنده"}): ` +
        f.market.entries
          .map((e) => `${e.symbol.replace("USDT", "")}=${n(e.price)}`)
          .join(" • ")
    );
  } else {
    lines.push(`📊 بازار: قیمت واقعی در دسترس نیست (${f.market.error || "نامشخص"})`);
  }
  lines.push("");
  lines.push("🧾 آخرین فعالیت‌های واقعی:");
  if (!f.activity.length) {
    lines.push("   • هنوز هیچ رویدادی ثبت نشده است. (درآمد و لاگ فقط با اجرای واقعی ساخته می‌شود)");
  } else {
    for (const a of f.activity.slice(0, 6)) {
      const mark = a.status === "success" ? "✅" : a.status === "failed" ? "⛔" : a.status === "pending" ? "⏳" : "•";
      const when = a.createdAt ? new Date(a.createdAt).toLocaleString("fa-IR") : "—";
      lines.push(`   ${mark} ${a.action}${a.rewardUsdt ? ` (+${n(a.rewardUsdt)} USDT)` : ""} — ${when}`);
    }
  }
  return lines.join("\n");
}

/**
 * گزارش هوشمند: اگر کلید جمینای موجود باشد، مدل گزارش را از روی
 * «فقط واقعیت‌های دیتابیس» می‌نویسد. در غیر این صورت قالب دیتابیسی.
 */
export async function generateAgentReport(
  agentId: number,
  opts: { useAi?: boolean } = {}
): Promise<{ ok: boolean; text: string; source: "gemini" | "database" | "none"; facts?: AgentFacts; error?: string }> {
  const facts = await buildAgentFacts(agentId);
  if (!facts) return { ok: false, text: "", source: "none", error: "کارمند پیدا نشد" };

  const fallback = composeDatabaseReport(facts);
  if (!opts.useAi) {
    return { ok: true, text: fallback, source: "database", facts };
  }

  const prompt = [
    "تو دستیار مدیرعامل یک شرکت ایجنت‌های دیجیتال هستی.",
    "فقط بر اساس JSON زیر یک گزارش وضعیت فارسی، رسمی، کوتاه (حداکثر ۱۸ خط) بنویس.",
    "هیچ عددی از خودت نساز. اگر داده‌ای نیست، صریح بنویس که ثبت نشده است.",
    "ساختار: خلاصه وضعیت، عملکرد امروز، هدف و پیشرفت، ریسک/خطاها، پیشنهاد اقدام بعدی مدیرعامل.",
    JSON.stringify(facts),
  ].join("\n");

  void ENV;
  const ai = await generateGeminiText(prompt, { temperature: 0.2, maxOutputTokens: 900 });
  if (!ai.ok) {
    return {
      ok: true,
      text: fallback,
      source: "database",
      facts,
      error: ai.error,
    };
  }
  return {
    ok: true,
    text: `${ai.text}\n\n— اعداد و وضعیت از دیتابیس واقعی؛ بازنویسی متنی توسط Gemini (${ai.model}).`,
    source: "gemini",
    facts,
  };
}
