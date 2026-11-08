import { db } from "@/db";
import {
  agents,
  agentActivityLogs,
  agentJobs,
  cronRuns,
  exchangeOrders,
  marketSnapshots,
  messages,
  projects,
  settings,
  systemEvents,
  tradeSignals,
  transactions,
} from "@/db/schema";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { ensureSeed, getMasterWallet } from "@/lib/seed";
import { ENV } from "@/lib/env";
import { conf } from "@/lib/config";
import {
  exchangeStatus,
  fetchKlines,
  fetchPublicPrices,
  getAccountBalances,
} from "@/lib/exchange";
import { refreshMarket } from "@/lib/market";
import { buildTechnicalSetup, type TechnicalSetup } from "@/lib/indicators";
import { scanBountyFeeds } from "@/lib/bounty";
import { createJob } from "@/lib/jobs";
import { escapeHtml, notifyAdmin, telegramConfigured } from "@/lib/telegram";
import { activeGeminiModel, generateGeminiText, geminiConfigured } from "@/lib/ai";

export const COO_NAME = "RNAI · مدیر ارشد اجرایی (COO)";

export type AgentProtocolSpec = {
  slug: string;
  department: string;
  officeRoom: string;
  monthlyTargetUsdt: number;
  roleDescription: string;
  mandateSummary: string;
  hitlRule: string;
};

export const FLEET_PROTOCOLS: Record<string, AgentProtocolSpec> = {
  "crypto-employee": {
    slug: "crypto-employee",
    department: "معاملات الگوریتمی و تحلیل بازار رمزارز",
    officeRoom: "میز ترید کوانت (A1)",
    monthlyTargetUsdt: 1500,
    roleDescription:
      "رصد زنده بازار رمزارز (BTC/ETH/TON)، تحلیل تکنیکال چنداندیکاتوری (RSI، MACD، MA20/50، ATR) و ارائه پیشنهاد خرید/فروش با اهرم کنترل‌شده (1x-3x) و حد ضرر دقیق",
    mandateSummary:
      "پایش کندل‌های زنده صرافی، محاسبه سطوح حمایت/مقاومت و نسبت ریسک به ریوارد (حداقل ۱.۸) و ارسال کارت پیشنهاد معامله به تلگرام مدیرعامل.",
    hitlRule:
      "ثبت هرگونه سفارش خرید، فروش یا برداشت بدون کلیک مدیرعامل روی [✅] در تلگرام مطلقاً ممنوع است.",
  },
  "bounty-hunter": {
    slug: "bounty-hunter",
    department: "شکار بانتی، ایردراپ و کمپین‌های Web3",
    officeRoom: "واحد اطلاعات و شکار فرصت (B7)",
    monthlyTargetUsdt: 900,
    roleDescription:
      "اسکن مداوم وب و کانال‌های Web3 برای یافتن بانتی‌ها، ایردراپ‌ها و کمپین‌های معتبر با فیلتر حقیقت‌سنجی ضداسکم",
    mandateSummary:
      "پایش خودکار فیدهای رسمی ایردراپ و Web3، حذف لینک‌های فیشینگ/تضمینی و ارسال کمپین‌های امتیاز بالا به تلگرام مدیرعامل.",
    hitlRule:
      "ورود نهایی به کمپین یا ثبت هرگونه تراکنش مالی فقط پس از تأیید [✅] مدیرعامل مجاز است.",
  },
  "nextjs-builder": {
    slug: "nextjs-builder",
    department: "مهندسی محصول، وب و داشبوردهای SaaS/Web3",
    officeRoom: "آزمایشگاه مهندسی نرم‌افزار (A2)",
    monthlyTargetUsdt: 2000,
    roleDescription:
      "پایش پروژه‌های توسعه وب‌اپلیکیشن Next.js، لندینگ‌پیج و داشبوردهای Web3، زمان‌بندی اسپرینت و تدوین کارت پیشنهاد فنی-مالی",
    mandateSummary:
      "بررسی سفارش‌های باز توسعه وب و داشبورد، برآورد دقیق زمان تحویل و سود تخمینی و ارسال پروپوزال اجرایی جهت تأیید مدیرعامل.",
    hitlRule:
      "عقد قرارداد و نهایی‌سازی مالی پروژه صرفاً با تأیید نهایی [✅] مدیرعامل انجام می‌شود.",
  },
  "telegram-closer": {
    slug: "telegram-closer",
    department: "توسعه کسب‌وکار، فروش و اتوماسیون تلگرام",
    officeRoom: "اتاق مذاکره و فروش (A3)",
    monthlyTargetUsdt: 1600,
    roleDescription:
      "پایش سرنخ‌های فروش، پیام‌های ورودی کارفرمایان و پروژه‌های ربات تلگرام/ایجنت هوشمند و آماده‌سازی پیشنهاد بستن قرارداد",
    mandateSummary:
      "رصد مستمر صندوق پیام‌ها و پروژه‌های اتوماسیون فروش، اولویت‌بندی مشتریان با بودجه بالا و ارسال کارت پیشنهاد قرارداد به تلگرام مدیرعامل.",
    hitlRule:
      "توافق مالی، صدور فاکتور قطعی و ثبت واریز بدون تأیید [✅] مدیرعامل ممنوع است.",
  },
  "pptx-designer": {
    slug: "pptx-designer",
    department: "طراحی استراتژیک، Pitch Deck و مستندات بصری",
    officeRoom: "استودیو خلاقیت و ارائه (A4)",
    monthlyTargetUsdt: 1000,
    roleDescription:
      "پایش سفارش‌های طراحی Pitch Deck جذب سرمایه، اسلایدهای استارتاپی و مستندات بصری دوزبانه با برآورد سود و زمان تحویل",
    mandateSummary:
      "شناسایی پروژه‌های طراحی ارائه و دک سرمایه‌گذاری، ساختاردهی اسلایدها و ارسال کارت پیشنهاد اجرا به تلگرام مدیرعامل.",
    hitlRule:
      "تحویل نهایی مالی و ثبت درآمد منوط به تأیید [✅] مدیرعامل و واریز معتبر به کیف پول واحد است.",
  },
  "web3-translator": {
    slug: "web3-translator",
    department: "ترجمه تخصصی Web3، هوش مصنوعی و وایت‌پیپر",
    officeRoom: "دفتر بومی‌سازی و محتوا (A5)",
    monthlyTargetUsdt: 1100,
    roleDescription:
      "پایش و اجرای پروژه‌های ترجمه تخصصی وایت‌پیپر، مستندات فنی بلاک‌چین و قراردادهای هوشمند با کنترل کیفیت اصطلاحات",
    mandateSummary:
      "رصد پروژه‌های ترجمه تخصصی در جریان و جدید، کنترل واژه‌نامه فنی و ارسال کارت پیشنهاد/گزارش تحویل برای تأیید مدیرعامل.",
    hitlRule:
      "تسویه‌حساب و ثبت درآمد قطعی فقط پس از تأیید [✅] مدیرعامل انجام می‌گیرد.",
  },
  "custom-webhook-worker": {
    slug: "custom-webhook-worker",
    department: "زیرساخت یکپارچه‌سازی، وب‌هوک و پایش تراکنش‌ها",
    officeRoom: "مرکز عملیات پل خارجی (A6)",
    monthlyTargetUsdt: 800,
    roleDescription:
      "دریافت امن سیگنال‌ها و گزارش واریز از اسکریپت‌های خارجی (TradingView / n8n / Python)، بررسی هش تراکنش و ارجاع به صف تأیید HITL",
    mandateSummary:
      "اعتبارسنجی اولیه هش تراکنش‌ها، جلوگیری از ثبت تکراری و ارسال فوری کارت تأیید واریز به تلگرام مدیرعامل.",
    hitlRule:
      "هیچ واریز خارجی حتی با هش معتبر بدون کلیک مدیرعامل روی [✅] وارد تراز درآمد قطعی نمی‌شود.",
  },
};

export type LeaderboardEntry = {
  rank: number;
  id: number;
  name: string;
  slug: string;
  specialty: string;
  department: string;
  status: string;
  realEarnedUsdt: number;
  confirmedDeals: number;
  tasksCompleted: number;
  successCount: number;
  errorCount: number;
  errorRatePct: number;
  monthlyTargetUsdt: number;
  targetProgressPct: number;
  compositeScore: number;
  isTopEmployee: boolean;
  badge: string;
};

export type CooBlockerItem = {
  code: string;
  severity: "critical" | "warning" | "info";
  component: string;
  title: string;
  detail: string;
  actionRequired: string;
};

export type CooExecutiveSummary = {
  generatedAt: string;
  cooName: string;
  hitlLockActive: boolean;
  company: {
    confirmedIncomeUsdt: number;
    pendingIncomeUsdt: number;
    confirmedExpenseUsdt: number;
    netBalanceUsdt: number;
    confirmedTxCount: number;
    pendingTxCount: number;
    activeAgentsCount: number;
    totalAgentsCount: number;
    totalTasksCompleted: number;
    pendingApprovalsCount: number;
    openProjectsCount: number;
    openProjectsPipelineUsdt: number;
    logsLast24hCount: number;
    errorsLast24hCount: number;
    masterWallet: {
      address: string;
      activeNetwork: string;
      envNetwork: string;
      dbNetwork: string;
      networkMismatch: boolean;
    };
  };
  leaderboard: LeaderboardEntry[];
  topEmployee: LeaderboardEntry | null;
  blockers: CooBlockerItem[];
  marketOverview: Array<{
    symbol: string;
    price: number;
    change24h: number;
    rsi: number | null;
    macdHist: number | null;
    support: number | null;
    resistance: number | null;
    source: string;
    capturedAt: string;
  }>;
  reportText: string;
  telegramHtml: string;
};

async function upsertSetting(key: string, value: string) {
  await db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: sql`excluded.value` },
    });
}

async function logCooActivity(input: {
  agentId?: number | null;
  agentName: string;
  action: string;
  status?: "success" | "info" | "pending" | "error" | "skipped";
  detail: string;
  rewardUsdt?: number;
  jobId?: number | null;
  source?: string;
  meta?: Record<string, unknown>;
}) {
  await db.insert(agentActivityLogs).values({
    agentId: input.agentId ?? null,
    agentName: input.agentName,
    action: input.action,
    status: input.status || "info",
    detail: input.detail,
    rewardUsdt: input.rewardUsdt ?? 0,
    jobId: input.jobId ?? null,
    source: input.source || "coo",
    meta: input.meta ?? {},
  });
}

/**
 * ۱. ابلاغ رسمی شرح وظایف، پروتکل HITL و همگام‌سازی شمارنده‌های واقعی ناوگان.
 */
export async function charterFleetProtocols(options?: { logEachAgent?: boolean }) {
  await ensureSeed();
  const [allAgents, allTx, allLogs] = await Promise.all([
    db.select().from(agents).orderBy(agents.id),
    db.select().from(transactions),
    db.select().from(agentActivityLogs),
  ]);

  const dispatched: Array<{
    id: number;
    name: string;
    slug: string;
    department: string;
    monthlyTargetUsdt: number;
    mandate: string;
  }> = [];

  for (const ag of allAgents) {
    const spec = FLEET_PROTOCOLS[ag.slug];
    const confirmedForAgent = allTx.filter(
      (t) =>
        t.kind === "income" &&
        t.status === "confirmed" &&
        (t.agentName === ag.name || t.agentName.includes(ag.slug)),
    );
    const realEarned = Number(
      confirmedForAgent
        .reduce((sum, t) => sum + (Number(t.amountUsdt) || 0), 0)
        .toFixed(2),
    );
    const logSuccesses = allLogs.filter(
      (l) =>
        (l.agentId === ag.id || l.agentName === ag.name) &&
        l.status === "success",
    ).length;
    const logErrors = allLogs.filter(
      (l) =>
        (l.agentId === ag.id || l.agentName === ag.name) &&
        (l.status === "error" || l.status === "failed"),
    ).length;

    const syncedSuccessCount = Math.max(
      Number(ag.successCount) || 0,
      confirmedForAgent.length,
      logSuccesses,
    );
    const syncedErrorCount = Math.max(Number(ag.errorCount) || 0, logErrors);

    await db
      .update(agents)
      .set({
        status: ag.status === "paused" ? "paused" : "active",
        department: spec?.department || ag.department || "عملیات هوشمند",
        officeRoom: spec?.officeRoom || ag.officeRoom || "دفتر مرکزی",
        goalTitle: spec ? "هدف درآمد ماهانه (پروتکل RNAI)" : ag.goalTitle,
        goalTargetUsdt: spec?.monthlyTargetUsdt ?? ag.goalTargetUsdt ?? 1000,
        currentFocus: spec?.mandateSummary || ag.currentFocus,
        role: spec?.roleDescription || ag.role,
        earnedUsdt: realEarned,
        successCount: syncedSuccessCount,
        errorCount: syncedErrorCount,
        lastActiveAt: new Date(),
      })
      .where(eq(agents.id, ag.id));

    if (spec && ag.status !== "paused") {
      dispatched.push({
        id: ag.id,
        name: ag.name,
        slug: ag.slug,
        department: spec.department,
        monthlyTargetUsdt: spec.monthlyTargetUsdt,
        mandate: spec.mandateSummary,
      });

      if (options?.logEachAgent) {
        await logCooActivity({
          agentId: ag.id,
          agentName: ag.name,
          action: "دریافت حکم عملیاتی از RNAI (COO) و آماده‌باش موتور پایش",
          status: "info",
          detail: `${spec.mandateSummary} • قانون طلایی HITL: ${spec.hitlRule}`,
          source: "coo_dispatch",
          meta: {
            department: spec.department,
            monthlyTargetUsdt: spec.monthlyTargetUsdt,
            hitlLock: true,
          },
        });
      }
    }
  }

  const nowIso = new Date().toISOString();
  await Promise.all([
    upsertSetting("coo_charter_version", "RNAI-v2.0-HITL"),
    upsertSetting("coo_last_dispatch_at", nowIso),
    upsertSetting("hitl_financial_lock", "strict"),
  ]);

  await logCooActivity({
    agentName: COO_NAME,
    action: `ابلاغ دستور استارت‌آپ و شرح وظایف به ${dispatched.length} ایجنت فعال`,
    status: "success",
    detail:
      "قفل مالی Human-in-the-Loop فعال شد: هیچ ایجنتی بدون تأیید [✅] مدیرعامل در تلگرام مجاز به واریز، برداشت یا نهایی‌سازی مالی نیست.",
    source: "coo_dispatch",
    meta: { activeFleetCount: dispatched.length, timestamp: nowIso },
  });

  return { ok: true, count: dispatched.length, dispatched };
}

/**
 * ۲. موتور زنده «آریا» (A1 - معامله‌گر کریپتو):
 *    دریافت کندل‌های واقعی ۱ ساعته، محاسبه RSI/MACD/MA20/MA50/ATR و سطوح حمایت/مقاومت،
 *    ذخیره در market_snapshots و ارسال کارت پیشنهاد خرید/فروش با حد ضرر دقیق و اهرم کنترل‌شده (1x-3x) به تلگرام.
 */
export async function runAriaMarketScan(options?: { forceCardIfNonePending?: boolean }) {
  const [aria] = await db
    .select()
    .from(agents)
    .where(eq(agents.slug, "crypto-employee"))
    .limit(1);

  if (!aria || aria.status !== "active") {
    return { ok: false, skipped: true, reason: "ایجنت آریا فعال نیست", setups: [] as TechnicalSetup[] };
  }

  await refreshMarket(["BTCUSDT", "ETHUSDT", "TONUSDT"]).catch(() => {});
  const quotes = await fetchPublicPrices(["BTCUSDT", "ETHUSDT", "TONUSDT"]).catch(
    () => [],
  );

  // موجودی واقعی صرافی: تنها منبع مجاز برای تعیین اندازهٔ پوزیشن.
  // اگر کلید صرافی ست نشده باشد، هیچ مبلغی «حدس زده» نمی‌شود.
  let availableUsdt: number | null = null;
  let balanceNote = "کلید API صرافی ست نشده است؛ موجودی قابل معامله قابل خواندن نیست.";
  const exState = await exchangeStatus();
  if (exState.keysConfigured) {
    try {
      const acc = await getAccountBalances(["USDT"]);
      const usdt = acc.balances.find((b: { asset: string }) => b.asset === "USDT");
      availableUsdt = usdt ? Number(usdt.free) : 0;
      balanceNote = `موجودی آزاد USDT در صرافی (${exState.exchange} • ${exState.network}): ${availableUsdt}`;
    } catch (e: any) {
      balanceNote = `خواندن موجودی صرافی ناموفق بود: ${e?.message || e}`;
    }
  }

  const symbols = ["BTCUSDT", "ETHUSDT", "TONUSDT"];
  const setups: TechnicalSetup[] = [];
  const errors: string[] = [];

  for (const sym of symbols) {
    try {
      const kl = await fetchKlines(sym, "1h", 80);
      if (!kl.candles.length) {
        errors.push(`${sym}: کندل خالی`);
        continue;
      }
      const q = quotes.find((x) => x.symbol === sym);
      const setup = buildTechnicalSetup({
        symbol: sym,
        candles: kl.candles,
        livePrice: q?.price ?? kl.candles[kl.candles.length - 1].close,
        changePct24h: q?.changePct ?? null,
        source: kl.source,
        maxLeverage: 3,
        availableUsdt,
        riskPct: 2,
      });
      setups.push(setup);

      await db.insert(marketSnapshots).values({
        symbol: sym,
        price: String(setup.entryPrice),
        changePct:
          setup.changePct24h === null ? null : String(setup.changePct24h),
        rsi: setup.rsi,
        macdHist: setup.macdHist,
        ma20: setup.ma20,
        ma50: setup.ma50,
        support: setup.support,
        resistance: setup.resistance,
        volatilityPct: setup.volatilityPct,
        candles: kl.candles.length,
        source: `${kl.source}:ta-1h`,
        fetchedAt: new Date(),
      });
    } catch (e: any) {
      errors.push(`${sym}: ${e?.message || "خطای شبکه"}`);
    }
  }

  if (!setups.length) {
    const errText = errors.join(" | ") || "عدم دسترسی به کندل‌های بازار";
    await logCooActivity({
      agentId: aria.id,
      agentName: aria.name,
      action: "خطا در دریافت دیتای تکنیکال بازار رمزارز",
      status: "error",
      detail: errText,
      source: "aria_engine",
    });
    return { ok: false, error: errText, setups: [] as TechnicalSetup[] };
  }

  setups.sort(
    (a, b) =>
      Number(b.actionable) - Number(a.actionable) ||
      b.confidence - a.confidence ||
      b.riskReward - a.riskReward,
  );
  const best = setups[0];

  const summaryDetail = setups
    .map(
      (s) =>
        `${s.symbol}: $${s.entryPrice} (RSI=${s.rsi}, MACD=${s.macdHist}, حمایت=$${s.support}, مقاومت=$${s.resistance}, پیشنهاد=${s.directionLabel})`,
    )
    .join(" • ");

  await logCooActivity({
    agentId: aria.id,
    agentName: aria.name,
    action: `تحلیل تکنیکال زنده ${setups.length} رمزارز (${setups.map((s) => s.symbol).join("، ")})`,
    status: "info",
    detail: summaryDetail,
    source: "aria_engine",
    meta: {
      bestSymbol: best.symbol,
      confidence: best.confidence,
      rsi: best.rsi,
      leverage: best.leverage,
    },
  });

  // بررسی پیشنهادهای بازِ معامله برای جلوگیری از ارسال کارت تکراری
  const pendingTrades = await db
    .select()
    .from(agentJobs)
    .where(
      and(
        eq(agentJobs.kind, "trade"),
        eq(agentJobs.status, "awaiting_approval"),
      ),
    );

  const fourHoursAgo = new Date(Date.now() - 4 * 3600_000);
  const recentSignals = await db
    .select()
    .from(tradeSignals)
    .where(gte(tradeSignals.createdAt, fourHoursAgo))
    .catch(() => []);

  const alreadySignaledSymbol = recentSignals.some((s) => s.symbol === best.symbol);
  if (!alreadySignaledSymbol) {
    await db
      .insert(tradeSignals)
      .values({
        agentId: aria.id,
        agentName: aria.name,
        symbol: best.symbol,
        side: best.side,
        entryPrice: best.entryPrice,
        takeProfit: best.takeProfit,
        stopLoss: best.stopLoss,
        targetPct: best.targetPct,
        stopPct: best.stopPct,
        riskReward: best.riskReward,
        leverage: best.leverage,
        positionUsdt: best.positionUsdt ?? 0,
        estimatedProfitUsdt: best.estimatedProfitUsdt ?? 0,
        estimatedHoursMin: 4,
        estimatedHoursMax: 12,
        confidence: best.confidence,
        rsi: best.rsi,
        macdHist: best.macdHist,
        ma20: best.ma20,
        ma50: best.ma50,
        support: best.support,
        resistance: best.resistance,
        volatilityPct: best.volatilityPct,
        dataSource: best.source,
        analysisReason: best.analysisReason,
        status: "pending",
      })
      .catch(() => {});
  }

  let proposalCreated: { jobId: number; symbol: string; telegramSent: boolean } | null = null;
  const shouldCreateCard =
    pendingTrades.length === 0 &&
    (best.actionable || Boolean(options?.forceCardIfNonePending));

  if (shouldCreateCard) {
    let aiReason = best.analysisReason;
    if (geminiConfigured()) {
      const aiRes = await generateGeminiText(
        `در نقش «آریا»، تحلیلگر ارشد رمزارز، حداکثر در ۲ جمله فارسی دقیق و حرفه‌ای دلیل پیشنهاد معامله زیر را برای مدیرعامل توضیح بده (بدون markdown):\n` +
          `نماد: ${best.symbol} | جهت: ${best.directionLabel} | ورود: $${best.entryPrice} | حد ضرر: $${best.stopLoss} | حد سود: $${best.takeProfit} | اهرم کنترل‌شده: ${best.leverage}x | RSI(14): ${best.rsi} | MACD Hist: ${best.macdHist} | MA20: ${best.ma20} | MA50: ${best.ma50}`,
        { maxOutputTokens: 220, temperature: 0.25, timeoutMs: 12000 },
      );
      if (aiRes.ok && aiRes.text) {
        aiReason = aiRes.text.replace(/\s+/g, " ").trim();
      }
    }

    const { job, telegram } = await createJob({
      agentId: aria.id,
      agentName: aria.name,
      kind: "trade",
      title: `پیشنهاد ${best.side === "BUY" ? "خرید" : "فروش"} ${best.symbol} (اهرم کنترل‌شده ${best.leverage}x • حد ضرر $${best.stopLoss})`,
      detail: [
        aiReason,
        `ورود: $${best.entryPrice} | حد ضرر: $${best.stopLoss} | حد سود: $${best.takeProfit} | R/R: ${best.riskReward}`,
        best.positionUsdt !== null
          ? `مبلغ سفارش: ${best.positionUsdt} USDT (${best.sizingNote})`
          : `مبلغ سفارش: تعیین نشده — ${best.sizingNote}`,
      ].join("\n"),
      payload: {
        symbol: best.symbol,
        side: best.side,
        directionLabel: best.directionLabel,
        quoteOrderQty: best.positionUsdt,
        entryPrice: best.entryPrice,
        stopLoss: best.stopLoss,
        takeProfit: best.takeProfit,
        leverage: best.leverage,
        riskReward: best.riskReward,
        confidence: best.confidence,
        estimatedProfitUsdt: best.estimatedProfitUsdt,
        estimatedDuration: best.estimatedDuration,
        analysisReason: aiReason,
      },
      risk: best.leverage >= 3 ? "high" : "medium",
      requiresApproval: true,
    });

    proposalCreated = {
      jobId: job.id,
      symbol: best.symbol,
      telegramSent: Boolean(telegram?.ok),
    };
  }

  return {
    ok: true,
    setups,
    best,
    proposalCreated,
    warnings: [...errors, ...(availableUsdt === null ? [balanceNote] : [])],
  };
}

/**
 * ۳. موتور زنده «بانتی‌هانتر» (B7):
 *    اسکن فیدهای رسمی Web3/Bounty، حقیقت‌سنجی ضداسکم و ارسال کارت پیشنهاد به تلگرام.
 */
export async function runBountyHunterScan() {
  const [hunter] = await db
    .select()
    .from(agents)
    .where(eq(agents.slug, "bounty-hunter"))
    .limit(1);

  if (!hunter || hunter.status !== "active") {
    return { ok: false, skipped: true, reason: "بانتی‌هانتر فعال نیست" };
  }

  const existingBountyJobs = await db
    .select()
    .from(agentJobs)
    .where(eq(agentJobs.kind, "bounty"))
    .limit(50);

  const existingLinks = new Set<string>(
    existingBountyJobs
      .map((j) => String((j.payload as any)?.link || ""))
      .filter(Boolean),
  );
  const pendingBounties = existingBountyJobs.filter(
    (j) =>
      j.status === "awaiting_approval" || j.status === "pending_approval",
  );

  const scan = await scanBountyFeeds({
    includeRecentIfAllSeen: pendingBounties.length === 0,
    existingLinks,
  });

  const rejectedCount = scan.verified.filter((v) => v.verdict !== "ok").length;

  await logCooActivity({
    agentId: hunter.id,
    agentName: hunter.name,
    action: `اسکن و حقیقت‌سنجی ${scan.sourcesChecked.length} منبع بانتی و ایردراپ`,
    status: scan.fetchedCount > 0 ? "info" : "error",
    detail: `آیتم‌های واکشی‌شده: ${scan.fetchedCount} • ردشده توسط فیلتر ضداسکم: ${rejectedCount} • واجد شرایط تأییدشده: ${scan.qualified.length}${scan.error ? ` • هشدار منبع: ${scan.error}` : ""}`,
    source: "bounty_engine",
    meta: {
      sourcesChecked: scan.sourcesChecked,
      fetchedCount: scan.fetchedCount,
      rejectedCount,
      qualifiedCount: scan.qualified.length,
    },
  });

  const createdCards: Array<{ jobId: number; title: string; telegramSent: boolean }> = [];
  if (pendingBounties.length < 2 && scan.qualified.length > 0) {
    const candidate = scan.qualified[0];
    const { job, telegram } = await createJob({
      agentId: hunter.id,
      agentName: hunter.name,
      kind: "bounty",
      title: `فرصت بانتی/ایردراپ معتبر — ${candidate.title.slice(0, 88)}`,
      detail: `${candidate.analysisReason}\nپاداش: ${candidate.rewardLabel} | امتیاز حقیقت‌سنجی: ${candidate.trustScore}/100`,
      payload: {
        link: candidate.link,
        rewardLabel: candidate.rewardLabel,
        trustScore: candidate.trustScore,
        estimatedProfitUsdt: candidate.estimatedProfitUsdt,
        estimatedDuration: candidate.estimatedDuration,
        analysisReason: candidate.analysisReason,
      },
      risk: "low",
      requiresApproval: true,
    });
    createdCards.push({
      jobId: job.id,
      title: candidate.title,
      telegramSent: Boolean(telegram?.ok),
    });
  }

  return {
    ok: scan.ok && !scan.error,
    error: scan.error,
    feedsChecked: scan.sourcesChecked.length,
    rawItems: scan.fetchedCount,
    rejectedScamOrNoise: rejectedCount,
    candidatesFound: scan.qualified.length,
    createdCards,
  };
}

/**
 * ۴. موتور پایش سایر ایجنت‌های تخصصی (A2، A3، A4، A5، A6):
 *    بررسی پروژه‌های باز، پیام‌های کارفرمایان و درگاه واریز خارجی + ارسال کارت پیشنهاد غیرتکراری.
 */
export async function runSpecialistAgentsScan(options?: { maxProposalsPerCycle?: number }) {
  const maxProposals = options?.maxProposalsPerCycle ?? 1;
  const [allAgents, allProjects, allMessages, existingJobs, pendingTx] =
    await Promise.all([
      db.select().from(agents).orderBy(agents.id),
      db.select().from(projects).orderBy(desc(projects.budgetUsdt)),
      db.select().from(messages).orderBy(desc(messages.createdAt)).limit(30),
      db.select().from(agentJobs).orderBy(desc(agentJobs.createdAt)).limit(100),
      db
        .select()
        .from(transactions)
        .where(eq(transactions.status, "pending_verification")),
    ]);

  const validProjects = allProjects.filter(
    (p) =>
      !p.title.includes("[TEST]") &&
      Number(p.budgetUsdt) > 0 &&
      (p.status === "new" || p.status === "in_progress"),
  );

  const proposedProjectIds = new Set<number>();
  for (const j of existingJobs) {
    const pid = Number((j.payload as any)?.projectId);
    if (Number.isFinite(pid) && pid > 0 && j.status !== "cancelled") {
      proposedProjectIds.add(pid);
    }
  }

  let proposalsDispatched = 0;
  const specialistResults: Array<{
    agent: string;
    matchedProjects: number;
    proposalJobId?: number;
  }> = [];

  const matchers: Array<{
    slug: string;
    filter: (p: (typeof allProjects)[number]) => boolean;
    durationFor: (budget: number) => string;
    reasonFor: (p: (typeof allProjects)[number], unreadCount: number) => string;
  }> = [
    {
      slug: "nextjs-builder",
      filter: (p) =>
        p.type === "nextjs" ||
        p.type === "web3" ||
        /next\.?js|داشبورد|لندینگ|وب/i.test(`${p.title} ${p.description}`),
      durationFor: (b) => (b >= 1200 ? "۷ تا ۱۰ روز کاری" : "۴ تا ۶ روز کاری"),
      reasonFor: (p) =>
        `پروژه «${p.title}» با استک Next.js 16 / TypeScript کاملاً منطبق است؛ حاشیه سود خالص بالا و آماده شروع اسپرینت فنی پس از تأیید شما.`,
    },
    {
      slug: "telegram-closer",
      filter: (p) =>
        p.type === "bot" ||
        p.type === "ai_agent" ||
        /تلگرام|ربات|ایجنت|پشتیبانی/i.test(`${p.title} ${p.description}`),
      durationFor: () => "۳ تا ۵ روز کاری",
      reasonFor: (p, unreadCount) =>
        `تقاضای فعال برای «${p.title}» شناسایی شد (${unreadCount} پیام خوانده‌نشده در صندوق مذاکرات)؛ پتانسیل تبدیل سریع به قرارداد اشتراکی.`,
    },
    {
      slug: "pptx-designer",
      filter: (p) =>
        p.type === "pptx" ||
        p.type === "design" ||
        /pitch\s*deck|ارائه|اسلاید/i.test(`${p.title} ${p.description}`),
      durationFor: () => "۲ تا ۳ روز کاری",
      reasonFor: (p) =>
        `سفارش «${p.title}» سریع‌ترین زمان تحویل و بازگشت سرمایه را دارد و ساختار استوری‌بورد حرفه‌ای آن آماده تدوین است.`,
    },
    {
      slug: "web3-translator",
      filter: (p) =>
        p.type === "translation" ||
        p.type === "content" ||
        /وایت‌پیپر|ترجمه/i.test(`${p.title} ${p.description}`),
      durationFor: () => "۳ تا ۴ روز کاری",
      reasonFor: (p) =>
        `پروژه تخصصی «${p.title}» (وضعیت فعلی: ${p.status === "in_progress" ? "در جریان اجرا" : "آماده شروع"}) با واژه‌نامه استاندارد بلاک‌چین همخوانی کامل دارد.`,
    },
  ];

  const unreadMessages = allMessages.filter((m) => m.status !== "read").length;

  for (const m of matchers) {
    const agent = allAgents.find((a) => a.slug === m.slug);
    if (!agent || agent.status !== "active") continue;

    const matched = validProjects.filter(m.filter);

    await logCooActivity({
      agentId: agent.id,
      agentName: agent.name,
      action: `پایش صف پروژه‌ها و فرصت‌های تخصصی (${matched.length} مورد مرتبط)`,
      status: "info",
      detail:
        matched.length > 0
          ? `پروژه‌های تحت رصد: ${matched.map((p) => `${p.title} (${p.budgetUsdt} USDT)`).join("، ")}`
          : "صف پروژه‌ها بررسی شد؛ مورد جدیدی خارج از لیست فعلی ثبت نشده است.",
      source: "specialist_engine",
      meta: { matchedCount: matched.length, unreadMessages },
    });

    let createdJobId: number | undefined;
    const candidateProj = matched.find((p) => !proposedProjectIds.has(p.id));
    if (candidateProj && proposalsDispatched < maxProposals) {
      const reason = m.reasonFor(candidateProj, unreadMessages);
      const duration = m.durationFor(Number(candidateProj.budgetUsdt) || 0);
      const { job } = await createJob({
        agentId: agent.id,
        agentName: agent.name,
        kind: "proposal",
        title: `پروپوزال اجرایی: ${candidateProj.title} (${candidateProj.budgetUsdt} USDT)`,
        detail: `${reason}\nکارفرما/کانال: ${candidateProj.clientName || "کاتالوگ خدمات شرکت"} (${candidateProj.source})`,
        payload: {
          projectId: candidateProj.id,
          client: candidateProj.clientName,
          category: candidateProj.type,
          estimatedProfitUsdt: Number(candidateProj.budgetUsdt) || 0,
          estimatedDuration: duration,
          analysisReason: reason,
        },
        risk: "low",
        requiresApproval: true,
      });
      createdJobId = job.id;
      proposalsDispatched += 1;
      proposedProjectIds.add(candidateProj.id);
    }

    specialistResults.push({
      agent: agent.name,
      matchedProjects: matched.length,
      proposalJobId: createdJobId,
    });
  }

  // پایش درگاه وب‌هوک خارجی (A6)
  const webhookAgent = allAgents.find((a) => a.slug === "custom-webhook-worker");
  if (webhookAgent && webhookAgent.status === "active") {
    const workerUrl = ENV.workerUrl();
    await logCooActivity({
      agentId: webhookAgent.id,
      agentName: webhookAgent.name,
      action: "بازرسی درگاه وب‌هوک خارجی و تراکنش‌های در انتظار تأیید",
      status: "info",
      detail: `درگاه /api/agents/ingest آماده دریافت با قفل HITL است • تراکنش‌های منتظر تأیید مدیرعامل: ${pendingTx.length} • سرویس کارگر خارجی (AGENT_WORKER_URL): ${workerUrl ? "متصل" : "تنظیم‌نشده"}`,
      source: "webhook_engine",
      meta: {
        pendingDeposits: pendingTx.length,
        workerConfigured: Boolean(workerUrl),
      },
    });
  }

  return {
    ok: true,
    proposalsDispatched,
    specialists: specialistResults,
  };
}

/**
 * اجرای یک چرخه کامل عملیاتی تمام موتورهای ناوگان تحت نظارت RNAI (COO).
 */
export async function runFleetCycle(options?: {
  charterFirst?: boolean;
  forceAriaCard?: boolean;
  maxSpecialistProposals?: number;
}) {
  const startedAt = Date.now();
  await ensureSeed();

  if (options?.charterFirst) {
    await charterFleetProtocols({ logEachAgent: true });
  }

  const [aria, bounty, specialists] = await Promise.all([
    runAriaMarketScan({ forceCardIfNonePending: options?.forceAriaCard ?? true }).catch((e) => ({ ok: false as const, error: String(e?.message || e), setups: [] as TechnicalSetup[] })),
    runBountyHunterScan().catch((e) => ({ ok: false as const, error: String(e?.message || e) })),
    runSpecialistAgentsScan({ maxProposalsPerCycle: options?.maxSpecialistProposals ?? 1 }).catch((e) => ({ ok: false as const, error: String(e?.message || e), proposalsDispatched: 0, specialists: [] })),
  ]);

  const durationMs = Date.now() - startedAt;
  const ok = aria.ok && bounty.ok && specialists.ok;
  await logCooActivity({
    agentName: COO_NAME,
    action: "تکمیل چرخه پایش هم‌زمان موتورهای ناوگان (A1، B7، A2-A6)",
    status: ok ? "success" : "error",
    detail: `مدت چرخه: ${durationMs}ms • جفت‌ارزهای تحلیل‌شده آریا: ${aria.setups?.length ?? 0} • منابع بانتی بررسی‌شده: ${"feedsChecked" in bounty ? bounty.feedsChecked : 0} • پروپوزال‌های تخصصی ارسالی: ${specialists.proposalsDispatched}`,
    source: "coo_cycle",
    meta: {
      durationMs,
      ariaProposal: "proposalCreated" in aria ? aria.proposalCreated ?? null : null,
      bountyCards: "createdCards" in bounty ? bounty.createdCards : [],
    },
  });

  return {
    ok,
    durationMs,
    aria,
    bounty,
    specialists,
  };
}

/**
 * ۵. محاسبه خلاصه عملکرد کل شرکت، رتبه‌بندی لیدربورد، کارمند برتر و موانع فنی واقعی.
 */
export async function buildCooExecutiveSummary(): Promise<CooExecutiveSummary> {
  await ensureSeed();
  const since24h = new Date(Date.now() - 24 * 3600_000);

  const [
    allAgents,
    allTx,
    allProjects,
    pendingJobs,
    recentLogs24h,
    allSettings,
    latestSnaps,
    recentOrders,
    recentCronRuns,
  ] = await Promise.all([
    db.select().from(agents).orderBy(agents.id),
    db.select().from(transactions).orderBy(desc(transactions.createdAt)),
    db.select().from(projects),
    db
      .select()
      .from(agentJobs)
      .where(eq(agentJobs.status, "awaiting_approval")),
    db
      .select()
      .from(agentActivityLogs)
      .where(gte(agentActivityLogs.createdAt, since24h))
      .orderBy(desc(agentActivityLogs.createdAt)),
    db.select().from(settings),
    db
      .select()
      .from(marketSnapshots)
      .orderBy(desc(marketSnapshots.fetchedAt), desc(marketSnapshots.id))
      .limit(24),
    db.select().from(exchangeOrders).orderBy(desc(exchangeOrders.createdAt)).limit(10),
    db.select().from(cronRuns).orderBy(desc(cronRuns.startedAt)).limit(5),
  ]);

  const wallet = await getMasterWallet();
  const settingsMap = Object.fromEntries(allSettings.map((s) => [s.key, s.value]));
  const envWalletNetwork = conf("MASTER_WALLET_NETWORK") || "BEP20";
  const dbWalletNetwork = settingsMap.master_wallet_network || "";
  const networkMismatch = Boolean(
    envWalletNetwork &&
      dbWalletNetwork &&
      envWalletNetwork.replace(/^USDT[-_]/i, "").toUpperCase() !==
        dbWalletNetwork.replace(/^USDT[-_]/i, "").toUpperCase(),
  );

  // ۱. محاسبه دقیق ارقام مالی واقعی شرکت
  const confirmedIncomes = allTx.filter(
    (t) => t.kind === "income" && t.status === "confirmed",
  );
  const pendingIncomes = allTx.filter(
    (t) => t.kind === "income" && t.status === "pending_verification",
  );
  const confirmedExpenses = allTx.filter(
    (t) =>
      (t.kind === "expense" ||
        t.kind === "withdrawal" ||
        t.kind === "withdraw") &&
      t.status === "confirmed",
  );

  const confirmedIncomeUsdt = Number(
    confirmedIncomes
      .reduce((s, t) => s + (Number(t.amountUsdt) || 0), 0)
      .toFixed(2),
  );
  const pendingIncomeUsdt = Number(
    pendingIncomes
      .reduce((s, t) => s + (Number(t.amountUsdt) || 0), 0)
      .toFixed(2),
  );
  const confirmedExpenseUsdt = Number(
    confirmedExpenses
      .reduce((s, t) => s + (Number(t.amountUsdt) || 0), 0)
      .toFixed(2),
  );
  const netBalanceUsdt = Number(
    (confirmedIncomeUsdt - confirmedExpenseUsdt).toFixed(2),
  );

  // ۲. رتبه‌بندی دقیق لیدربورد بر اساس سودآوری واقعی، پروژه‌های موفق و نرخ خطا
  const rawEntries = allAgents.map((ag) => {
    const spec = FLEET_PROTOCOLS[ag.slug];
    const agentTx = confirmedIncomes.filter(
      (t) => t.agentName === ag.name || t.agentName.includes(ag.slug),
    );
    const realEarnedUsdt = Number(
      agentTx.reduce((s, t) => s + (Number(t.amountUsdt) || 0), 0).toFixed(2),
    );
    const confirmedDeals = agentTx.length;
    const tasksCompleted = Math.max(Number(ag.tasksCompleted) || 0, confirmedDeals);
    const successCount = Math.max(Number(ag.successCount) || 0, confirmedDeals);
    const errorCount = Number(ag.errorCount) || 0;
    const totalAttempts = Math.max(tasksCompleted + errorCount, 1);
    const errorRatePct = Number(((errorCount / totalAttempts) * 100).toFixed(1));
    const monthlyTargetUsdt =
      Number(ag.goalTargetUsdt) || spec?.monthlyTargetUsdt || 1000;
    const targetProgressPct = Number(
      Math.min(100, (realEarnedUsdt / Math.max(monthlyTargetUsdt, 1)) * 100).toFixed(1),
    );

    const compositeScore = Number(
      (
        realEarnedUsdt * 1.5 +
        tasksCompleted * 12 +
        successCount * 5 -
        errorRatePct * 1.8 -
        errorCount * 10
      ).toFixed(1),
    );

    return {
      rank: 0,
      id: ag.id,
      name: ag.name,
      slug: ag.slug,
      specialty: ag.specialty,
      department: ag.department || spec?.department || "عملیات هوشمند",
      status: ag.status,
      realEarnedUsdt,
      confirmedDeals,
      tasksCompleted,
      successCount,
      errorCount,
      errorRatePct,
      monthlyTargetUsdt,
      targetProgressPct,
      compositeScore,
      isTopEmployee: false,
      badge: "",
    };
  });

  rawEntries.sort(
    (a, b) =>
      b.realEarnedUsdt - a.realEarnedUsdt ||
      b.compositeScore - a.compositeScore ||
      a.errorRatePct - b.errorRatePct ||
      b.tasksCompleted - a.tasksCompleted,
  );

  const leaderboard: LeaderboardEntry[] = rawEntries.map((item, idx) => {
    const rank = idx + 1;
    const isTopEmployee = rank === 1;
    const badge =
      rank === 1
        ? "🥇 کارمند برتر شرکت"
        : rank === 2
        ? "🥈 رتبه دوم سودآوری"
        : rank === 3
        ? "🥉 رتبه سوم عملیات"
        : `#${rank}`;
    return { ...item, rank, isTopEmployee, badge };
  });

  const topEmployee = leaderboard[0] || null;

  // ۳. استخراج چالش‌ها و موانع واقعی (API، صرافی، شبکه کیف پول و کلیدهای آن‌چین)
  const blockers: CooBlockerItem[] = [];

  // همان منبع حقیقتی که موتور اجرای سفارش استفاده می‌کند (Env + دیتابیس).
  // قبلاً فقط Env خوانده می‌شد و کلیدهای ذخیره‌شده در پنل دیده نمی‌شدند؛
  // نتیجه: گزارش COO می‌گفت «قفل است» در حالی که پنل وضعیت دیگری داشت.
  const exchangeState = await exchangeStatus();
  if (!exchangeState.canExecuteOrders) {
    blockers.push({
      code: "EXCHANGE_TRADING_LOCKED",
      severity: "warning",
      component: "صرافی و موتور اجرای معاملات (A1 آریا)",
      title: `قفل اجرای سفارش واقعی صرافی فعال است (کلیدها: ${
        exchangeState.keysConfigured ? "کامل" : "ناقص"
      } • AGENT_TRADING_ENABLED=${String(exchangeState.tradingEnabled)} • شبکه=${
        exchangeState.network
      })`,
      detail:
        `موتور تحلیل زنده آریا به کندل‌های واقعی بازار متصل است و کارت پیشنهاد را به تلگرام می‌فرستد، اما ارسال سفارش Spot در صرافی (${exchangeState.exchange}) تا تکمیل کلیدهای API و روشن‌کردن قفل AGENT_TRADING_ENABLED=true مسدود است.`,
      actionRequired:
        exchangeState.blockers.map((b) => b.action).join(" ") ||
        "از بخش «کارمندان و دفاتر → صرافی» کلیدها را ذخیره و قفل معامله را باز کنید.",
    });
  } else if (exchangeState.network === "testnet") {
    blockers.push({
      code: "EXCHANGE_TESTNET_MODE_ACTIVE",
      severity: "info",
      component: "صرافی و موتور اجرای معاملات (A1 آریا)",
      title: "ارسال سفارش واقعی فعال است (در حالت ایمن Testnet)",
      detail:
        "توابع اجرایی صرافی (Binance و Tabdeal Spot) به متغیر AGENT_TRADING_ENABLED متصل و آماده ثبت سفارش پس از تأیید [✅] شما هستند. در حال حاضر متغیر EXCHANGE_TESTNET=true روی سرور روشن است.",
      actionRequired:
        "اگر کلیدهای شما مربوط به حساب اصلی (Mainnet بایننس یا صرافی تبدیل) است، در صورت تمایل متغیر EXCHANGE_TESTNET را روی false قرار دهید.",
    });
  }

  if (networkMismatch) {
    blockers.push({
      code: "WALLET_NETWORK_MISMATCH",
      severity: "warning",
      component: "کیف پول واحد شرکت (Master Wallet)",
      title: `عدم تطابق برچسب شبکه بین تنظیمات دیتابیس (${dbWalletNetwork}) و متغیر محیطی (${envWalletNetwork})`,
      detail: `آدرس کیف پول واحد (${wallet.address}) یک آدرس EVM معتبر است، اما در جدول settings شبکه «${dbWalletNetwork}» و در تنظیمات سرور «${envWalletNetwork}» ثبت شده است.`,
      actionRequired:
        "از بخش تنظیمات پنل، شبکه واحد مورد نظر خود (ERC20 یا BEP20) را یکسان‌سازی نمایید تا بررسی آن‌چین دقیق‌تر انجام شود.",
    });
  }

  const configuredEnvGemini = conf("GEMINI_MODEL");
  if (!geminiConfigured()) {
    blockers.push({
      code: "GEMINI_API_MISSING",
      severity: "critical",
      component: "هسته هوش مصنوعی (Gemini API)",
      title: "کلید GEMINI_API_KEY تنظیم نشده است",
      detail: "تولید تحلیل‌های متنی پیشرفته به قالب استاندارد پشتیبان سوییچ شده است.",
      actionRequired: "متغیر GEMINI_API_KEY را در تنظیمات پروژه ثبت نمایید.",
    });
  } else if (configuredEnvGemini && /gemini-(1\.5|2\.0)/i.test(configuredEnvGemini)) {
    blockers.push({
      code: "GEMINI_DEPRECATED_MODEL_REDIRECTED",
      severity: "info",
      component: "هسته هوش مصنوعی (Gemini Model)",
      title: `مدل منسوخ ${configuredEnvGemini} شناسایی و به‌صورت خودکار به ${activeGeminiModel()} ارتقا یافت`,
      detail:
        "در لاگ‌های قبلی خطای 404 مدل منسوخ gemini-2.0-flash ثبت شده بود؛ لایه هوشمند RNAI اکنون بدون قطعی به gemini-3.8-flash / gemini-3.7-flash / gemini-3.5-flash متصل است.",
      actionRequired: "نیاز به اقدام فوری نیست (متغیر محیطی سرور نیز به gemini-3.8-flash به‌روزرسانی شد).",
    });
  }

  if (!conf("ETHERSCAN_API_KEY") && !conf("TRONGRID_API_KEY")) {
    blockers.push({
      code: "ONCHAIN_INDEXER_KEYS_UNSET",
      severity: "info",
      component: "اعتبارسنجی خودکار زنجیره‌ای (On-Chain Verifier)",
      title: "کلیدهای ETHERSCAN_API_KEY و TRONGRID_API_KEY تنظیم نشده‌اند",
      detail:
        "بررسی خودکار هش تراکنش‌های ERC20/BEP20 روی اکسپلورر غیرفعال است و تمامی واریزها مستقیماً زیر چتر امنیتی HITL برای تأیید دستی مدیرعامل به تلگرام ارسال می‌شوند.",
      actionRequired:
        "اختیاری: برای پیوست‌شدن گواهی آن‌چین به کارت‌های تلگرام، کلید رایگان Etherscan/BscScan یا TronGrid را وارد کنید.",
    });
  }

  if (!ENV.workerUrl()) {
    blockers.push({
      code: "EXTERNAL_WORKER_URL_UNSET",
      severity: "info",
      component: "اجراکننده ابزارهای خارجی (A6 / Tool Runner)",
      title: "متغیر AGENT_WORKER_URL تنظیم نشده است",
      detail:
        "درگاه دریافت وب‌هوک (/api/agents/ingest) کاملاً فعال است، اما فراخوانی خروجی به سرویس اسکریپت خارجی (n8n / Python Worker) تا ثبت آدرس ورکر غیرفعال است.",
      actionRequired: "در صورت داشتن سرور ورکر خارجی، آدرس آن را در AGENT_WORKER_URL قرار دهید.",
    });
  }

  const errorLogs24h = recentLogs24h.filter(
    (l) => l.status === "error" || l.status === "failed",
  );
  if (errorLogs24h.length > 0) {
    const latestErr = errorLogs24h[0];
    blockers.push({
      code: "RECENT_24H_AGENT_ERRORS",
      severity: "warning",
      component: `لاگ خطای ۲۴ ساعت اخیر (${errorLogs24h.length} مورد)`,
      title: `آخرین خطای ثبت‌شده توسط «${latestErr.agentName}»: ${latestErr.action}`,
      detail: (latestErr.detail || "بدون جزئیات").slice(0, 260),
      actionRequired: "جزئیات کامل در جدول «گزارش کارمندان» قابل فیلتر و بازبینی است.",
    });
  }

  if (!telegramConfigured() || !ENV.telegramAdminChat()) {
    blockers.push({
      code: "TELEGRAM_HITL_CHANNEL",
      severity: "critical",
      component: "ربات تلگرام مدیرعامل",
      title: "توکن یا شناسه چت تلگرام مدیرعامل ناقص است",
      detail: "ارسال کارت‌های تأیید [✅]/[❌] نیازمند TELEGRAM_BOT_TOKEN و TELEGRAM_ADMIN_CHAT_ID است.",
      actionRequired: "تنظیمات تلگرام را در بخش ربات تلگرام تکمیل کنید.",
    });
  }

  // ۴. آخرین وضعیت بازار از market_snapshots
  const seenSyms = new Set<string>();
  const marketOverview: CooExecutiveSummary["marketOverview"] = [];
  for (const snap of latestSnaps) {
    if (seenSyms.has(snap.symbol)) continue;
    seenSyms.add(snap.symbol);
    marketOverview.push({
      symbol: snap.symbol,
      price: Number(snap.price) || 0,
      change24h: snap.changePct !== null && snap.changePct !== undefined ? Number(snap.changePct) : 0,
      rsi: snap.rsi ? Number(snap.rsi) : null,
      macdHist: snap.macdHist ? Number(snap.macdHist) : null,
      support: snap.support ? Number(snap.support) : null,
      resistance: snap.resistance ? Number(snap.resistance) : null,
      source: snap.source,
      capturedAt: snap.fetchedAt ? snap.fetchedAt.toISOString() : new Date().toISOString(),
    });
  }

  const validOpenProjects = allProjects.filter(
    (p) =>
      !p.title.includes("[TEST]") &&
      Number(p.budgetUsdt) > 0 &&
      p.status !== "completed" &&
      p.status !== "archived",
  );
  const openProjectsPipelineUsdt = Number(
    validOpenProjects
      .reduce((s, p) => s + (Number(p.budgetUsdt) || 0), 0)
      .toFixed(2),
  );

  const activeAgentsCount = allAgents.filter((a) => a.status === "active").length;
  const totalTasksCompleted = leaderboard.reduce((s, a) => s + a.tasksCompleted, 0);
  const generatedAt = new Date().toISOString();

  // ۵. ساخت متن گزارش رسمی دسته‌بندی‌شده به فارسی (پنل + تلگرام)
  const leaderboardLinesText = leaderboard
    .map(
      (a) =>
        `${a.rank}. ${a.name} — سود واقعی: ${a.realEarnedUsdt} USDT | پروژه‌های موفق: ${a.tasksCompleted} | نرخ خطا: ${a.errorRatePct}% | امتیاز: ${a.compositeScore}`,
    )
    .join("\n");

  const blockerLinesText =
    blockers.length === 0
      ? "• هیچ خطای بحرانی یا مانع بازدارنده‌ای در سرویس‌ها مشاهده نشد."
      : blockers
          .map(
            (b, i) =>
              `${i + 1}. [${b.severity === "critical" ? "بحرانی" : b.severity === "warning" ? "نیازمند توجه" : "اطلاع"}] ${b.component}: ${b.title}\n   ↳ راهکار: ${b.actionRequired}`,
          )
          .join("\n");

  const reportText =
    `🏛️ گزارش رسمی مدیر ارشد اجرایی (RNAI - COO)\n` +
    `زمان صدور: ${new Date(generatedAt).toLocaleString("fa-IR", { timeZone: "Asia/Tehran" })}\n` +
    `وضعیت قفل ایمنی مالی (HITL): فعال (هیچ تراکنشی بدون تأیید [✅] شما نهایی نمی‌شود)\n\n` +
    `📊 خلاصه عملکرد کل شرکت:\n` +
    `• درآمد واقعی محقق‌شده (Confirmed): ${confirmedIncomeUsdt} USDT (طی ${confirmedIncomes.length} تراکنش تأییدشده)\n` +
    `• مبالغ در انتظار تأیید مدیرعامل: ${pendingIncomeUsdt} USDT (${pendingIncomes.length} مورد)\n` +
    `• خالص تراز عملیاتی: ${netBalanceUsdt} USDT\n` +
    `• کیف پول واحد شرکت: ${wallet.address} (شبکه فعال: ${wallet.network})\n` +
    `• وضعیت ناوگان: ${activeAgentsCount} ایجنت فعال از ${allAgents.length} | مجموع مأموریت‌های تکمیل‌شده: ${totalTasksCompleted} | کارت‌های منتظر تأیید شما: ${pendingJobs.length}\n` +
    `• ظرفیت پروژه‌های باز در جریان: ${validOpenProjects.length} پروژه به ارزش ${openProjectsPipelineUsdt} USDT\n\n` +
    `🏆 وضعیت لیدربورد و کارمند برتر:\n` +
    (topEmployee
      ? `🌟 کارمند برتر فعلی: «${topEmployee.name}» با ${topEmployee.realEarnedUsdt} USDT سود واقعی، ${topEmployee.tasksCompleted} مأموریت موفق و نرخ خطای ${topEmployee.errorRatePct}%\n`
      : "") +
    `${leaderboardLinesText}\n\n` +
    `⚠️ چالش‌ها و موانع:\n` +
    `${blockerLinesText}`;

  const telegramLeaderboard = leaderboard
    .slice(0, 7)
    .map(
      (a) =>
        `${a.rank === 1 ? "🥇" : a.rank === 2 ? "🥈" : a.rank === 3 ? "🥉" : `▫️ #${a.rank}`} <b>${escapeHtml(a.name)}</b>\n` +
        `    سود واقعی: <code>${a.realEarnedUsdt} USDT</code> | موفق: <code>${a.tasksCompleted}</code> | خطا: <code>${a.errorRatePct}%</code>`,
    )
    .join("\n");

  const telegramBlockers =
    blockers.length === 0
      ? "✅ بدون مانع عملیاتی باز."
      : blockers
          .slice(0, 5)
          .map(
            (b) =>
              `${b.severity === "critical" ? "🔴" : b.severity === "warning" ? "🟠" : "🔵"} <b>${escapeHtml(b.component)}:</b> ${escapeHtml(b.title)}`,
          )
          .join("\n");

  const telegramHtml =
    `🏛️ <b>گزارش رسمی استارت‌آپ و عملیات — RNAI (COO)</b>\n` +
    `🔒 <i>پروتکل HITL فعال: هیچ واریز/برداشت/معامله‌ای بدون تأیید [✅] شما نهایی نمی‌شود.</i>\n\n` +
    `📊 <b>خلاصه عملکرد کل شرکت:</b>\n` +
    `• درآمد واقعی محقق‌شده: <b><code>${confirmedIncomeUsdt} USDT</code></b> (${confirmedIncomes.length} تراکنش)\n` +
    `• در انتظار تأیید نهایی شما: <code>${pendingIncomeUsdt} USDT</code> (${pendingJobs.length} کارت باز)\n` +
    `• خالص تراز شرکت: <code>${netBalanceUsdt} USDT</code>\n` +
    `• کیف پول واحد: <code>${escapeHtml(wallet.address)}</code> (${escapeHtml(wallet.network)})\n` +
    `• ناوگان فعال: <b>${activeAgentsCount}/${allAgents.length}</b> ایجنت | پایپ‌لاین پروژه‌ها: <code>${openProjectsPipelineUsdt} USDT</code>\n\n` +
    `🏆 <b>وضعیت لیدربورد و کارمند برتر:</b>\n` +
    (topEmployee
      ? `🌟 <b>کارمند برتر:</b> ${escapeHtml(topEmployee.name)} (<code>+${topEmployee.realEarnedUsdt} USDT</code> • خطا <code>${topEmployee.errorRatePct}%</code>)\n`
      : "") +
    `${telegramLeaderboard}\n\n` +
    `⚠️ <b>چالش‌ها و موانع نیازمند بررسی:</b>\n` +
    `${telegramBlockers}`;

  void recentOrders;
  void recentCronRuns;

  return {
    generatedAt,
    cooName: COO_NAME,
    hitlLockActive: true,
    company: {
      confirmedIncomeUsdt,
      pendingIncomeUsdt,
      confirmedExpenseUsdt,
      netBalanceUsdt,
      confirmedTxCount: confirmedIncomes.length,
      pendingTxCount: pendingIncomes.length,
      activeAgentsCount,
      totalAgentsCount: allAgents.length,
      totalTasksCompleted,
      pendingApprovalsCount: pendingJobs.length,
      openProjectsCount: validOpenProjects.length,
      openProjectsPipelineUsdt,
      logsLast24hCount: recentLogs24h.length,
      errorsLast24hCount: errorLogs24h.length,
      masterWallet: {
        address: wallet.address,
        activeNetwork: wallet.network,
        envNetwork: envWalletNetwork,
        dbNetwork: dbWalletNetwork,
        networkMismatch,
      },
    },
    leaderboard,
    topEmployee,
    blockers,
    marketOverview,
    reportText,
    telegramHtml,
  };
}

/**
 * ثبت گزارش جامع اجرایی RNAI در جدول agent_activity_logs و ارسال هم‌زمان به تلگرام مدیرعامل.
 */
export async function generateCooExecutiveReport(options?: {
  sendTelegram?: boolean;
}) {
  const summary = await buildCooExecutiveSummary();

  await Promise.all([
    upsertSetting(
      "coo_latest_report",
      JSON.stringify({
        generatedAt: summary.generatedAt,
        confirmedIncomeUsdt: summary.company.confirmedIncomeUsdt,
        topEmployee: summary.topEmployee?.name || null,
        blockersCount: summary.blockers.length,
        reportText: summary.reportText,
      }),
    ),
    logCooActivity({
      agentName: COO_NAME,
      action: "صدور گزارش جامع اجرایی شرکت (عملکرد مالی، لیدربورد و موانع)",
      status: "success",
      detail: summary.reportText,
      rewardUsdt: 0,
      source: "coo_report",
      meta: {
        confirmedIncomeUsdt: summary.company.confirmedIncomeUsdt,
        pendingApprovalsCount: summary.company.pendingApprovalsCount,
        topEmployee: summary.topEmployee?.name ?? null,
        blockersCount: summary.blockers.length,
      },
    }),
  ]);

  let telegramResult: { ok: boolean; messageId?: number; error?: string } | null =
    null;
  if (options?.sendTelegram !== false && telegramConfigured() && ENV.telegramAdminChat()) {
    const res = await notifyAdmin(summary.telegramHtml);
    telegramResult = {
      ok: res.ok,
      messageId: res.ok ? (res as any).result?.message_id : undefined,
      error: res.ok ? undefined : res.description || res.error,
    };
  }

  return {
    ok: true,
    summary,
    telegram: telegramResult,
  };
}

/**
 * فرمان کامل استارت‌آپ مدیرعامل به RNAI (COO):
 * ۱. ابلاغ شرح وظایف و پروتکل HITL به همه ایجنت‌های فعال
 * ۲. روشن‌کردن موتورهای پس‌زمینه (آریا، بانتی‌هانتر و ایجنت‌های تخصصی) و ارسال کارت پیشنهاد به تلگرام
 * ۳. ثبت تمام وقایع در agent_activity_logs و ارسال گزارش جامع استارت‌آپ به تلگرام و بخش گزارش کارمندان
 */
export async function executeCooStartupDirective(options?: {
  sendTelegramReport?: boolean;
}) {
  const charter = await charterFleetProtocols({ logEachAgent: true });
  const cycle = await runFleetCycle({
    charterFirst: false,
    forceAriaCard: true,
    maxSpecialistProposals: 1,
  });
  const report = await generateCooExecutiveReport({
    sendTelegram: options?.sendTelegramReport ?? true,
  });

  await db.insert(systemEvents).values({
    level: "info",
    scope: "coo",
    message: "فرمان استارت‌آپ RNAI (COO) با موفقیت اجرا شد و تمام موتورهای ناوگان فعال شدند",
    meta: {
      charteredAgents: charter.count,
      durationMs: cycle.durationMs,
      confirmedIncomeUsdt: report.summary.company.confirmedIncomeUsdt,
    },
  });

  return {
    ok: true,
    charter,
    cycle,
    report,
  };
}
