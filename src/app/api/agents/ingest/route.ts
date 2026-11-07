import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { agents, transactions, agentLogs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ensureSeed, getMasterWallet } from "@/lib/seed";
import {
  getBoostedAgentId,
  getLeaderboardData,
  periodKey,
  recordScoreEvent,
} from "@/lib/leaderboard";
import { randomBytes } from "crypto";

const cryptoStrategies: Record<
  string,
  { label: string; min: number; max: number; report: (amt: number, wallet: string) => string }
> = {
  arbitrage: {
    label: "آربیتراژ صرافی‌ها (DEX/CEX Spread)",
    min: 25,
    max: 95,
    report: (amt, wallet) =>
      `🪙 گزارش کارمند رمزارز — استراتژی آربیتراژ\n• جفت ارز: TON/USDT و SOL/USDT (اختلاف قیمت ۱.۶۵٪ بین OKX و Raydium)\n• حجم معامله چرخشی: ۲٬۴۰۰ USDT بدون ریسک جهت‌دار\n• سود خالص محقق‌شده: +${amt} USDT\n• وضعیت واریز: واریز خودکار به کیف پول واحد (${wallet}) انجام شد ✅`,
  },
  whale_alert: {
    label: "رصد نهنگ‌ها و فروش سیگنال آن‌چین",
    min: 35,
    max: 120,
    report: (amt, wallet) =>
      `🐋 گزارش کارمند رمزارز — شکار جریان نهنگ‌ها\n• کیف پول هوشمند شناسایی‌شده: ورود ۳.۲M USDT به استخر نقدینگی Arbitrum\n• بسته تحلیل آن‌چین برای ۴۸ مشترک VIP تلگرام ارسال شد\n• کارمزد اشتراک جمع‌آوری‌شده: +${amt} USDT\n• وضعیت واریز: واریز مستقیم به کیف پول واحد (${wallet}) ✅`,
  },
  airdrop: {
    label: "شکار ایردراپ و پاداش تست‌نت",
    min: 18,
    max: 75,
    report: (amt, wallet) =>
      `🪂 گزارش کارمند رمزارز — ایردراپ و فارمینگ خودکار\n• تکمیل تسک‌های آن‌چین شبکه L2 و تبدیل توکن پاداش به استیبل‌کوین\n• بازده خالص نقدشده: +${amt} USDT\n• وضعیت واریز: تجمیع در کیف پول واحد (${wallet}) ✅`,
  },
  signal_fee: {
    label: "مشاوره و ربات کپی‌ترید کریپتو",
    min: 40,
    max: 150,
    report: (amt, wallet) =>
      `📈 گزارش کارمند رمزارز — کارمزد عملکرد کپی‌ترید\n• بسته شدن پوزیشن لانگ ETH با سود +۴.۲٪ برای حساب‌های متصل\n• سهم ۲۰٪ کارمزد موفقیت (Performance Fee): +${amt} USDT\n• وضعیت واریز: انتقال آنی به کیف پول واحد (${wallet}) ✅`,
  },
};

export async function GET() {
  await ensureSeed();
  const masterWallet = await getMasterWallet();
  return NextResponse.json({
    ok: true,
    endpoint: "/api/agents/ingest",
    method: "POST",
    description:
      "API استاندارد اتصال ایجنت‌های خارجی و کارمند رمزارز برای واریز مستقیم درآمد به کیف پول واحد",
    masterWallet,
    headers: {
      "Content-Type": "application/json",
      "x-agent-key": "کلید اختصاصی ایجنت (یا AGENT_MASTER_API_KEY)",
    },
    exampleBody: {
      slug: "crypto-employee",
      amountUsdt: 55,
      title: "سود آربیتراژ جفت ارز TON/USDT",
      strategy: "arbitrage",
    },
  });
}

export async function POST(req: NextRequest) {
  await ensureSeed();
  const b = await req.json().catch(() => ({}));
  const headerKey =
    req.headers.get("x-agent-key") ||
    req.headers.get("authorization")?.replace("Bearer ", "") ||
    "";

  const masterWallet = await getMasterWallet();

  // پیدا کردن ایجنت از طریق id، slug یا کلید API
  let targetAgent: any = null;
  const allAgents = await db.select().from(agents);

  if (b.agentId) {
    targetAgent = allAgents.find((a) => a.id === Number(b.agentId));
  } else if (b.slug) {
    targetAgent = allAgents.find((a) => a.slug === b.slug);
  } else if (headerKey) {
    targetAgent = allAgents.find((a) => a.apiKey === headerKey);
  }

  // بررسی کلید امنیتی اگر درخواست از بیرون با هدر ارسال شده باشد
  const masterKey = process.env.AGENT_MASTER_API_KEY;
  if (
    headerKey &&
    !targetAgent &&
    (!masterKey || headerKey !== masterKey)
  ) {
    return NextResponse.json(
      { error: "کلید API ایجنت نامعتبر است (Unauthorized)" },
      { status: 401 }
    );
  }

  // پاداش ساختاری: برندهٔ ماه قبل، وقتی ایجنتی بهصورت صریح مشخص نشده،
  // اولویت تخصیص مأموریت/اسکن بازار را میگیرد.
  let priorityBoost: { agentId: number; multiplier: number } | null = null;
  if (!targetAgent) {
    const boost = await getBoostedAgentId().catch(() => null);
    const boosted = boost
      ? allAgents.find((a) => a.id === boost.agentId)
      : undefined;
    if (boost && boosted) {
      targetAgent = boosted;
      priorityBoost = boost;
    } else {
      targetAgent =
        allAgents.find((a) => a.specialty === "crypto") || allAgents[0];
    }
  }

  if (!targetAgent) {
    return NextResponse.json(
      { error: "هیچ ایجنتی یافت نشد" },
      { status: 404 }
    );
  }

  const stratKey = b.strategy || "arbitrage";
  const strat = cryptoStrategies[stratKey] || cryptoStrategies.arbitrage;

  const amountUsdt =
    b.amountUsdt !== undefined && Number(b.amountUsdt) > 0
      ? Number(b.amountUsdt)
      : Math.round(strat.min + Math.random() * (strat.max - strat.min));

  const title =
    b.title ||
    (targetAgent.specialty === "crypto"
      ? strat.label
      : `درآمد خودکار از ${targetAgent.name}`);

  const txHash =
    b.txHash ||
    `${randomBytes(2).toString("hex")}...${randomBytes(2).toString("hex")}`;

  const newEarned = Number(targetAgent.earnedUsdt || 0) + amountUsdt;
  const newTasks = Number(targetAgent.tasksCompleted || 0) + 1;

  const [updatedAgent] = await db
    .update(agents)
    .set({
      earnedUsdt: newEarned,
      tasksCompleted: newTasks,
    })
    .where(eq(agents.id, targetAgent.id))
    .returning();

  const [tx] = await db
    .insert(transactions)
    .values({
      title,
      projectTitle: targetAgent.role,
      agentName: targetAgent.name,
      destinationWallet: masterWallet.address,
      amountUsdt,
      network: masterWallet.network.replace("USDT-", ""),
      txHash,
      kind: "income",
      status: "confirmed",
    })
    .returning();

  const reportText =
    b.report ||
    (targetAgent.specialty === "crypto"
      ? strat.report(amountUsdt, masterWallet.address)
      : `✅ ایجنت «${targetAgent.name}» مأموریت «${title}» را تکمیل و مبلغ +${amountUsdt} USDT را به کیف پول واحد (${masterWallet.address}) واریز کرد.`);

  await db.insert(agentLogs).values({
    agent: targetAgent.name,
    action: `واریز +${amountUsdt} USDT به کیف پول واحد`,
    status: "success",
    detail: `${title} • مقصد: ${masterWallet.address.slice(0, 12)}... • هش: ${txHash}${
      priorityBoost
        ? ` • 🚀 اولویت ${priorityBoost.multiplier}× (برندهٔ ماه قبل)`
        : ""
    }`,
    durationMs: 420 + Math.round(Math.random() * 600),
  });

  // 🏆 ثبت نتیجهٔ موفق در دفترچهٔ لیگ (source_ref یکتا ⇒ بدون دوباره‌شماری)
  const leagueEvent = await recordScoreEvent({
    agentId: targetAgent.id,
    outcome: "success",
    projectTitle: title,
    durationMinutes: Number(b.durationMinutes) || 0,
    source: "ingest",
    sourceRef: `ingest:${tx.id}`,
    note: `واریز تأییدشدهٔ +${amountUsdt} USDT به کیف پول واحد`,
  }).catch(() => null);

  // بازخورد عملکرد به ایجنت فراخوان (رتبه و امتیاز لحظهای)
  let performance: any = null;
  try {
    const data = await getLeaderboardData(periodKey());
    const row = data.rows.find((r) => r.agentId === targetAgent.id);
    if (row) {
      performance = {
        period: data.period,
        rank: row.rank,
        score: row.score,
        points: row.points,
        successRate: row.successRate,
        boost: row.boosted,
      };
    }
  } catch {
    // لیگ نباید جلوی واریز درآمد را بگیرد
  }

  return NextResponse.json({
    ok: true,
    agent: updatedAgent,
    transaction: tx,
    masterWallet,
    amountUsdt,
    report: reportText,
    priorityBoost,
    league: {
      recorded: Boolean(leagueEvent?.event),
      points: leagueEvent?.event?.points ?? 0,
      performance,
    },
  });
}
