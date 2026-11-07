import { db } from "@/db";
import {
  agentActivityLogs,
  agentJobs,
  agents,
  marketSnapshots,
  messages,
  projects,
  tradeSignals,
  transactions,
} from "@/db/schema";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { conf } from "@/lib/config";
import { ENV } from "@/lib/env";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  موتور مأموریت‌سازی (Mission Engine) — سوخت حلقهٔ ۲۴/۷
 * ═══════════════════════════════════════════════════════════════════════
 *
 *  چرا این فایل وجود دارد؟
 *  موتورهای فعلی (آریا، بانتی‌هانتر، متخصص‌ها) فقط وقتی کارت می‌سازند که
 *  «دادهٔ بیرونی» موجود باشد (کندل صرافی، فید RSS، پروژهٔ ثبت‌شده در DB).
 *  نتیجه: اگر پروژهٔ جدیدی ثبت نشود، صف تأیید خالی می‌ماند و کارمند
 *  بیکار می‌شود — دقیقاً همان چیزی که مدیرعامل نمی‌خواهد.
 *
 *  این ماژول برای هر کارمند فعال، یک «مأموریت عملیاتی بعدی» می‌سازد که
 *  کاملاً بر پایهٔ دادهٔ واقعی همان لحظهٔ دیتابیس و وضعیت واقعی سرویس‌ها
 *  است (تعداد پیام خوانده‌نشده، پروژه‌های باز، سیگنال‌های ۲۴ ساعت گذشته،
 *  قیمت زنده، واریزهای منتظر تأیید، وضعیت کلیدها...).
 *
 *  قواعد سخت:
 *   • هیچ عدد درآمد/سودی از خودمان ساخته نمی‌شود؛ اگر بودجهٔ واقعی نباشد،
 *     سود تخمینی صفر می‌ماند و در کارت «تعیین‌نشده» نمایش داده می‌شود.
 *   • مأموریت یعنی «کار واقعی داخلی» (تحلیل، تدوین، بازرسی، آماده‌سازی
 *     تحویل) نه تراکنش مالی. هر مأموریت باید پیش از اجرا تأیید شود.
 *   • تکرار مأموریت‌ها با کلید پایدار (missionKey) و پنجرهٔ خنک‌شدن
 *     کنترل می‌شود تا صف با کارت‌های تکراری پر نشود.
 */

export type MissionAgent = {
  id: number;
  name: string;
  slug: string;
  department: string;
  specialty: string;
  status: string;
  goalTitle: string;
  goalTargetUsdt: number;
  earnedUsdt: number;
  tasksCompleted: number;
  currentFocus: string;
};

export type MissionFacts = {
  generatedAt: string;
  agent: {
    id: number;
    name: string;
    slug: string;
    department: string;
    specialty: string;
    monthlyTargetUsdt: number;
    earnedUsdt: number;
    tasksCompleted: number;
    currentFocus: string;
  };
  queue: {
    pending: number;
    running: number;
    succeeded7d: number;
    rejected7d: number;
    pendingTotal: number;
  };
  projects: {
    open: number;
    matching: Array<{
      id: number;
      title: string;
      budgetUsdt: number;
      status: string;
      type: string;
    }>;
  };
  messages: { unread: number; total: number };
  deposits: { pendingVerification: number };
  market: {
    available: boolean;
    latest: Array<{ symbol: string; price: number; rsi: number; changePct: number | null }>;
  };
  signals: { last24h: number; lastSymbol: string | null };
  services: {
    telegram: boolean;
    ai: boolean;
    worker: boolean;
    exchangeKeys: boolean;
    tradingEnabled: boolean;
  };
};

export type MissionCandidate = {
  /** کلید پایدار قالب — برای جلوگیری از تکرار */
  key: string;
  title: string;
  /** خروجی واقعی که کارمند پس از تأیید تولید می‌کند */
  deliverable: string;
  steps: string[];
  detail: string;
  estimatedDuration: string;
  risk: "low" | "medium";
  grounding: Record<string, unknown>;
};

const HOUR = 3600_000;

function fmt(n: number, max = 2) {
  return Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: max });
}

function projectMatcher(slug: string) {
  switch (slug) {
    case "nextjs-builder":
      return (p: { type: string; title: string; description: string }) =>
        p.type === "nextjs" ||
        p.type === "web3" ||
        /next\.?js|داشبورد|لندینگ|وب/i.test(`${p.title} ${p.description}`);
    case "telegram-closer":
      return (p: { type: string; title: string; description: string }) =>
        p.type === "bot" ||
        p.type === "ai_agent" ||
        /تلگرام|ربات|ایجنت|پشتیبانی/i.test(`${p.title} ${p.description}`);
    case "pptx-designer":
      return (p: { type: string; title: string; description: string }) =>
        p.type === "pptx" ||
        p.type === "design" ||
        /pitch\s*deck|ارائه|اسلاید/i.test(`${p.title} ${p.description}`);
    case "web3-translator":
      return (p: { type: string; title: string; description: string }) =>
        p.type === "translation" ||
        p.type === "content" ||
        /وایت‌پیپر|ترجمه/i.test(`${p.title} ${p.description}`);
    default:
      return () => false;
  }
}

/** جمع‌آوری واقعیت‌های همان لحظه برای یک کارمند (بدون هیچ دادهٔ ساختگی). */
export async function gatherMissionFacts(agent: MissionAgent): Promise<MissionFacts> {
  const since7d = new Date(Date.now() - 7 * 24 * HOUR);
  const since24h = new Date(Date.now() - 24 * HOUR);

  const [jobs, allProjects, msgRows, pendingTx, snapshotRows, signalRows, pendingTotalRow] =
    await Promise.all([
      db
        .select()
        .from(agentJobs)
        .where(eq(agentJobs.agentId, agent.id))
        .orderBy(desc(agentJobs.createdAt))
        .limit(60),
      db.select().from(projects),
      db.select().from(messages).orderBy(desc(messages.createdAt)).limit(60),
      db
        .select({ n: sql<number>`COUNT(*)` })
        .from(transactions)
        .where(eq(transactions.status, "pending_verification")),
      db
        .select({
          symbol: marketSnapshots.symbol,
          price: marketSnapshots.price,
          rsi: marketSnapshots.rsi,
          changePct: marketSnapshots.changePct,
          fetchedAt: marketSnapshots.fetchedAt,
        })
        .from(marketSnapshots)
        .where(inArray(marketSnapshots.symbol, ["BTCUSDT", "ETHUSDT", "TONUSDT"]))
        .orderBy(desc(marketSnapshots.fetchedAt))
        .limit(24)
        .catch(() => []),
      db
        .select()
        .from(tradeSignals)
        .where(gte(tradeSignals.createdAt, since24h))
        .orderBy(desc(tradeSignals.createdAt))
        .limit(10),
      db
        .select({ n: sql<number>`COUNT(*)` })
        .from(agentJobs)
        .where(inArray(agentJobs.status, ["awaiting_approval", "queued"])),
    ]);

  const matched = projectMatcher(agent.slug);
  const openProjects = allProjects.filter(
    (p) =>
      Number(p.budgetUsdt) > 0 &&
      (p.status === "new" || p.status === "in_progress") &&
      !p.title.includes("[TEST]"),
  );

  // آخرین اسنپ‌شات هر نماد (جدول تاریخچه است، نه وضعیت جاری)
  const latestBySymbol = new Map<string, (typeof snapshotRows)[number]>();
  for (const row of snapshotRows) {
    if (!latestBySymbol.has(row.symbol)) latestBySymbol.set(row.symbol, row);
  }

  return {
    generatedAt: new Date().toISOString(),
    agent: {
      id: agent.id,
      name: agent.name,
      slug: agent.slug,
      department: agent.department || "عملیات",
      specialty: agent.specialty || "custom_api",
      monthlyTargetUsdt: Number(agent.goalTargetUsdt || 0),
      earnedUsdt: Number(agent.earnedUsdt || 0),
      tasksCompleted: Number(agent.tasksCompleted || 0),
      currentFocus: agent.currentFocus || "",
    },
    queue: {
      pending: jobs.filter((j) => j.status === "awaiting_approval" || j.status === "queued").length,
      running: jobs.filter((j) => j.status === "running" || j.status === "approved").length,
      succeeded7d: jobs.filter(
        (j) => j.status === "succeeded" && j.createdAt && new Date(j.createdAt) >= since7d,
      ).length,
      rejected7d: jobs.filter(
        (j) => j.status === "rejected" && j.createdAt && new Date(j.createdAt) >= since7d,
      ).length,
      pendingTotal: Number(pendingTotalRow[0]?.n || 0),
    },
    projects: {
      open: openProjects.length,
      matching: openProjects
        .filter(matched)
        .slice(0, 5)
        .map((p) => ({
          id: p.id,
          title: p.title,
          budgetUsdt: Number(p.budgetUsdt || 0),
          status: p.status,
          type: p.type,
        })),
    },
    messages: {
      unread: msgRows.filter((m) => m.status !== "read").length,
      total: msgRows.length,
    },
    deposits: { pendingVerification: Number(pendingTx[0]?.n || 0) },
    market: {
      available: latestBySymbol.size > 0,
      latest: [...latestBySymbol.values()].map((r) => ({
        symbol: r.symbol,
        price: Number(r.price || 0),
        rsi: Number(r.rsi || 0),
        changePct: r.changePct === null ? null : Number(r.changePct),
      })),
    },
    signals: {
      last24h: signalRows.length,
      lastSymbol: signalRows[0]?.symbol ?? null,
    },
    services: {
      telegram: Boolean(ENV.telegramToken() && ENV.telegramAdminChat()),
      ai: Boolean(conf("GEMINI_API_KEY")),
      worker: Boolean(conf("AGENT_WORKER_URL")),
      exchangeKeys: Boolean(ENV.exchangeKey() && ENV.exchangeSecret()),
      tradingEnabled: ENV.tradingEnabled(),
    },
  };
}

/** چارچوب مشترک «کارت مأموریت» — همیشه با ذکر دادهٔ واقعیِ مبنا. */
function card(input: {
  key: string;
  title: string;
  objective: string;
  deliverable: string;
  steps: string[];
  facts: MissionFacts;
  duration: string;
  risk?: "low" | "medium";
  factsLine: string;
}): MissionCandidate {
  const f = input.facts;
  return {
    key: input.key,
    title: input.title,
    deliverable: input.deliverable,
    steps: input.steps,
    estimatedDuration: input.duration,
    risk: input.risk ?? "low",
    grounding: {
      missionKey: input.key,
      agentSlug: f.agent.slug,
      generatedAt: f.generatedAt,
      queuePending: f.queue.pending,
      openProjects: f.projects.open,
      matchingProjects: f.projects.matching.length,
      unreadMessages: f.messages.unread,
      pendingDeposits: f.deposits.pendingVerification,
      signalsLast24h: f.signals.last24h,
      marketAvailable: f.market.available,
      factsLine: input.factsLine,
    },
    detail: [
      `🎯 هدف: ${input.objective}`,
      `📦 خروجی مورد انتظار: ${input.deliverable}`,
      `🧾 دادهٔ مبنای این مأموریت (واقعی، همین حالا): ${input.factsLine}`,
      `🧭 گام‌های اجرا: ${input.steps.map((s, i) => `${i + 1}) ${s}`).join(" • ")}`,
      `⏱ زمان تقریبی: ${input.duration}`,
      "🔒 اجرای این مأموریت پس از تأیید [✅] شما انجام می‌شود و خروجی در دفتر کارمند و تلگرام ثبت می‌گردد.",
    ].join("\n"),
  };
}

/**
 * ساخت فهرست قالب‌های مأموریت برای یک کارمند.
 * ترتیب فهرست = اولویت؛ انتخاب‌کننده اولین قالبی را برمی‌دارد که
 * در پنجرهٔ خنک‌شدن استفاده نشده باشد.
 */
export function buildMissionCandidates(f: MissionFacts): MissionCandidate[] {
  const out: MissionCandidate[] = [];
  const slug = f.agent.slug;
  const name = f.agent.name;
  const targetGap = Math.max(
    0,
    Number(f.agent.monthlyTargetUsdt || 0) - Number(f.agent.earnedUsdt || 0),
  );
  const queueLine = `صف انتظار این کارمند: ${f.queue.pending} کارت • صف کل شرکت: ${f.queue.pendingTotal} • تحویل موفق ۷ روز اخیر: ${f.queue.succeeded7d}`;

  const targetLine = f.agent.monthlyTargetUsdt
    ? `هدف ماهانه: ${fmt(f.agent.monthlyTargetUsdt)} USDT • درآمد تأییدشده: ${fmt(f.agent.earnedUsdt)} USDT • فاصله تا هدف: ${fmt(targetGap)} USDT`
    : "هدف ماهانه تعیین نشده است";

  switch (slug) {
    // ── A1: آریا (کریپتو) ──────────────────────────────────────────────
    case "crypto-employee": {
      const marketLine = f.market.available
        ? f.market.latest
            .map(
              (m) =>
                `${m.symbol.replace("USDT", "")}=$${fmt(m.price, 4)} (RSI ${fmt(m.rsi, 1)})`,
            )
            .join(" • ")
        : "آخرین اسنپ‌شات بازار در دیتابیس موجود نیست";
      out.push(
        card({
          key: "crypto:risk-review",
          title: "بازبینی ریسک پوزیشن‌ها و به‌روزرسانی طرح مدیریت سرمایه",
          objective:
            "اطمینان از اینکه هیچ پوزیشن یا سیگنال بازی بدون حد ضرر و حد سود مشخص نمانده است",
          deliverable:
            "جدول بازبینی ریسک: هر سیگنال ۲۴ ساعت گذشته + فاصله تا حد ضرر/حد سود + تصمیم پیشنهادی (حفظ، اصلاح حد، خروج)",
          steps: [
            "خواندن آخرین سیگنال‌ها و اسنپ‌شات‌های تکنیکال از دیتابیس",
            "محاسبه نسبت ریسک به ریوارد مجدد با قیمت فعلی",
            "علامت‌گذاری سیگنال‌های خارج از محدودهٔ ریسک مجاز",
            "ثبت گزارش در دفتر کارمند و ارسال خلاصه به تلگرام مدیرعامل",
          ],
          facts: f,
          duration: "۲۰ تا ۳۰ دقیقه",
          factsLine: `${marketLine} • سیگنال‌های ۲۴ ساعت اخیر: ${f.signals.last24h} (آخرین نماد: ${f.signals.lastSymbol || "—"}) • ${queueLine}`,
        }),
      );
      out.push(
        card({
          key: "crypto:watchlist",
          title: "به‌روزرسانی واچ‌لیست و سطوح کلیدی BTC/ETH/TON",
          objective: "تعیین دقیق سطوح حمایت/مقاومت و نواحی ورود برای چرخهٔ بعدی بازار",
          deliverable:
            "واچ‌لیست به‌روزشده با سه سطح کلیدی برای هر رمزارز و شرط ورود/خروج شفاف",
          steps: [
            "دریافت کندل ۱ ساعته و محاسبه RSI/MACD/MA",
            "استخراج حمایت و مقاومت با نوسان واقعی بازار",
            "نوشتن شرط ورود و حد ضرر برای هر نماد",
            "ثبت واچ‌لیست در دفتر کارمند",
          ],
          facts: f,
          duration: "۳۰ تا ۴۵ دقیقه",
          factsLine: `${marketLine} • کلید صرافی: ${f.services.exchangeKeys ? "متصل" : "تنظیم‌نشده"} • قفل معامله: ${f.services.tradingEnabled ? "باز" : "بسته (HITL)"} • ${queueLine}`,
        }),
      );
      out.push(
        card({
          key: "crypto:post-trade-review",
          title: "تحلیل پس‌رویدادی معاملات تأییدشده و استخراج درس‌های اجرایی",
          objective: "بهبود نرخ برد در چرخه‌های بعدی با بازخوانی معاملات واقعی انجام‌شده",
          deliverable:
            "گزارش پس‌رویدادی: هر معامله، دلیل ورود، نتیجه، انحراف از طرح اولیه و اصلاح قاعدهٔ معاملاتی",
          steps: [
            "خواندن سفارش‌های ثبت‌شده و لاگ اجرای آریا",
            "مقایسهٔ نقطهٔ ورود/خروج واقعی با طرح اولیه",
            "استخراج دو قاعدهٔ اصلاحی برای چرخهٔ بعد",
            "ثبت گزارش در دفتر کارمند",
          ],
          facts: f,
          duration: "۲۵ تا ۴۰ دقیقه",
          factsLine: `${queueLine} • ${targetLine}`,
        }),
      );
      break;
    }

    // ── B7: بانتی‌هانتر ───────────────────────────────────────────────
    case "bounty-hunter": {
      out.push(
        card({
          key: "bounty:source-audit",
          title: "ممیزی منابع بانتی/ایردراپ و بازسازی فهرست فیدهای معتبر",
          objective: "حذف منابع کم‌بازده و افزودن منابع رسمی تازه برای اسکن بعدی",
          deliverable:
            "جدول ممیزی منابع: نرخ آیتم واجد شرایط، نرخ رد ضداسکم، وضعیت دسترسی و تصمیم (نگه‌داشتن/حذف/افزودن)",
          steps: [
            "خواندن لاگ اسکن‌های قبلی و شمارش آیتم‌های واجد شرایط هر منبع",
            "شناسایی منابعی که مکرراً خطا یا محتوای بی‌ربط می‌دهند",
            "پیشنهاد جانشین رسمی برای هر منبع حذف‌شده",
            "به‌روزرسانی فهرست منابع در تنظیمات",
          ],
          facts: f,
          duration: "۳۰ تا ۴۰ دقیقه",
          factsLine: `${queueLine} • واریزهای منتظر تأیید: ${f.deposits.pendingVerification} • ${targetLine}`,
        }),
      );
      out.push(
        card({
          key: "bounty:trust-playbook",
          title: "به‌روزرسانی چک‌لیست ضداسکم و قواعد حقیقت‌سنجی",
          objective: "کاهش ریسک ورود به کمپین‌های فیشینگ با قواعد سخت‌گیرانه‌تر",
          deliverable:
            "نسخهٔ تازهٔ چک‌لیست ۱۰ بندی ضداسکم + الگوی امتیازدهی اعتماد و نمونه‌های رد شده",
          steps: [
            "مرور آیتم‌های ردشده اخیر و الگوهای تکراری",
            "افزودن قاعده برای هر الگوی جدید",
            "تعریف آستانهٔ حداقل امتیاز اعتماد برای ارسال کارت",
            "ثبت نسخهٔ جدید در دفتر کارمند",
          ],
          facts: f,
          duration: "۲۰ تا ۳۰ دقیقه",
          factsLine: `${queueLine} • آیتم‌های ردشده و بررسی‌شده در چرخه‌های قبلی در دفتر کارمند ثبت است`,
        }),
      );
      out.push(
        card({
          key: "bounty:campaign-prep",
          title: "آماده‌سازی بستهٔ اجرای کمپین تأییدشده (چک‌لیست اقدام)",
          objective: "تبدیل کمپین تأییدشده به فهرست اقدام روزانه بدون هیچ تراکنش مالی خودکار",
          deliverable:
            "بستهٔ اجرا: وظایف روزانه، مدارک لازم، کیف پول مجاز، محدودیت‌های امنیتی و معیار موفقیت",
          steps: [
            "مرور کمپین‌های تأییدشده در صف کار",
            "تدوین وظایف روزانه و معیار سنجش",
            "ثبت هشدارهای امنیتی مخصوص همان کمپین",
            "ارسال خلاصه برای تأیید نهایی مدیرعامل",
          ],
          facts: f,
          duration: "۲۵ تا ۳۵ دقیقه",
          factsLine: `${queueLine} • ${targetLine}`,
        }),
      );
      break;
    }

    // ── A2: مهندسی Next.js ────────────────────────────────────────────
    case "nextjs-builder": {
      if (f.projects.matching.length > 0) {
        const first = f.projects.matching[0];
        out.push(
          card({
            key: "builder:proposal-pack",
            title: `تدوین بستهٔ پیشنهاد فنی-مالی برای ${f.projects.matching.length} پروژهٔ باز`,
            objective: "افزایش نرخ برد با پیشنهاد دقیق فنی، زمان‌بندی و تحویل‌شدنی روشن",
            deliverable:
              "بستهٔ پیشنهاد: معماری پیشنهادی، اسپرینت‌بندی، ریسک‌ها و صورت‌حساب مرحله‌ای برای هر پروژه",
            steps: [
              `تحلیل نیاز پروژه «${first.title}» (${fmt(first.budgetUsdt)} USDT)`,
              "تدوین معماری و تخمین زمان هر اسپرینت",
              "نوشتن بندهای تحویل و ضمانت اصلاح",
              "ثبت پیشنهاد جهت تأیید مدیرعامل",
            ],
            facts: f,
            duration: "۴۵ تا ۹۰ دقیقه",
            factsLine: `پروژه‌های منطبق: ${f.projects.matching.map((p) => `${p.title} (${fmt(p.budgetUsdt)} USDT)`).join("، ")} • ${queueLine}`,
          }),
        );
      }
      out.push(
        card({
          key: "builder:case-study",
          title: "تدوین کیس‌استادی فنی از تحویل‌های انجام‌شده",
          objective: "ساخت دارایی بازاریابی قابل استفاده در پیشنهادها و جذب پروژهٔ جدید",
          deliverable:
            "یک کیس‌استادی دوصفحه‌ای: مسئله، معماری، تصمیم‌های فنی، نتیجه و زمان تحویل",
          steps: [
            "انتخاب یک تحویل موفق از لاگ کارها",
            "مستندسازی معماری و تصمیم‌های کلیدی",
            "نوشتن نسخهٔ خلاصه برای ارسال به کارفرما",
            "ثبت در دفتر کارمند به‌عنوان دارایی قابل استفاده",
          ],
          facts: f,
          duration: "۶۰ تا ۹۰ دقیقه",
          factsLine: `تحویل موفق ۷ روز اخیر: ${f.queue.succeeded7d} • پروژه‌های باز منطبق: ${f.projects.matching.length} از ${f.projects.open} • ${targetLine}`,
        }),
      );
      out.push(
        card({
          key: "builder:quality-audit",
          title: "بازرسی کیفیت فنی داشبورد و بهینه‌سازی عملکرد",
          objective: "کاهش ریسک تحویل و افزایش سرعت بارگذاری پیش از پروژهٔ بعدی",
          deliverable:
            "گزارش بازرسی: خطاهای احتمالی، نقاط کندی، بدهی فنی و اقدام‌های اولویت‌دار",
          steps: [
            "بررسی لاگ خطاهای ۲۴ ساعت گذشته",
            "شناسایی کوئری‌ها/صفحات سنگین",
            "اولویت‌بندی اصلاحات با تخمین زمان",
            "ثبت گزارش و پیشنهاد اسپرینت اصلاحی",
          ],
          facts: f,
          duration: "۴۵ تا ۶۰ دقیقه",
          factsLine: `${queueLine} • سرویس ورکر ابزارها: ${f.services.worker ? "متصل" : "تنظیم‌نشده"}`,
        }),
      );
      break;
    }

    // ── A3: فروش و تلگرام ────────────────────────────────────────────
    case "telegram-closer": {
      if (f.messages.unread > 0) {
        out.push(
          card({
            key: "closer:lead-followup",
            title: `آماده‌سازی پاسخ به ${f.messages.unread} پیام خوانده‌نشده مشتری`,
            objective: "جلوگیری از سرد شدن سرنخ‌های واقعی موجود در صندوق پیام",
            deliverable:
              "پیش‌نویس پاسخ شخصی‌سازی‌شده برای هر سرنخ + پیشنهاد قیمت/زمان‌بندی + اولویت پیگیری",
            steps: [
              "مرور پیام‌های خوانده‌نشده و دسته‌بندی نیاز",
              "نوشتن پاسخ کوتاه با پیشنهاد مشخص",
              "تعیین اولویت بر اساس بودجه/فوریت",
              "ارسال پیش‌نویس‌ها جهت تأیید مدیرعامل",
            ],
            facts: f,
            duration: "۳۰ تا ۴۵ دقیقه",
            factsLine: `پیام خوانده‌نشده: ${f.messages.unread} از ${f.messages.total} پیام اخیر • ${queueLine}`,
          }),
        );
      }
      out.push(
        card({
          key: "closer:sales-sequence",
          title: "بازنویسی توالی پیام فروش و پیگیری سه‌مرحله‌ای",
          objective: "افزایش نرخ تبدیل سرنخ به قرارداد بدون ارسال پیام انبوه",
          deliverable:
            "توالی سه‌پیامی (معرفی، ارزش، پیگیری) با نسخهٔ شخصی‌سازی برای هر نوع خدمت",
          steps: [
            "مرور پیام‌های موفق و ناموفق قبلی",
            "نوشتن سه پیام کوتاه با CTA روشن",
            "تعیین قاعدهٔ زمان‌بندی پیگیری",
            "ثبت نسخهٔ نهایی در دفتر کارمند",
          ],
          facts: f,
          duration: "۴۰ تا ۶۰ دقیقه",
          factsLine: `${queueLine} • پیام‌های اخیر: ${f.messages.total} • ربات تلگرام: ${f.services.telegram ? "متصل" : "تنظیم‌نشده"}`,
        }),
      );
      out.push(
        card({
          key: "closer:pipeline-review",
          title: "بازبینی قیف فروش و شناسایی سرنخ‌های راکد",
          objective: "تصمیم صریح برای هر سرنخ راکد: پیگیری، تغییر پیشنهاد یا بستن پرونده",
          deliverable:
            "جدول قیف فروش با وضعیت هر سرنخ، آخرین تماس، اقدام بعدی و احتمال بستن",
          steps: [
            "استخراج پروژه‌ها و پیام‌های باز",
            "تعیین مدت رکود هر سرنخ",
            "نوشتن اقدام بعدی برای هر مورد",
            "ارسال خلاصه به تلگرام مدیرعامل",
          ],
          facts: f,
          duration: "۳۰ دقیقه",
          factsLine: `پروژه‌های باز: ${f.projects.open} • منطبق با فروش: ${f.projects.matching.length} • ${targetLine}`,
        }),
      );
      break;
    }

    // ── A4: طراحی ارائه ───────────────────────────────────────────────
    case "pptx-designer": {
      out.push(
        card({
          key: "deck:template-pack",
          title: "ساخت بستهٔ قالب ۱۲ اسلایدی Pitch Deck قابل استفادهٔ فوری",
          objective: "کوتاه‌کردن زمان تحویل سفارش‌های ارائه با قالب استاندارد آماده",
          deliverable:
            "ساختار ۱۲ اسلایدی با متن جایگزین، راهنمای استفاده و چک‌لیست تحویل",
          steps: [
            "تعیین ساختار استاندارد (مسئله، راه‌حل، بازار، مدل درآمد، تیم)",
            "نوشتن متن جایگزین فارسی/انگلیسی برای هر اسلاید",
            "تعریف قواعد بصری و فونت",
            "ثبت بسته در دفتر کارمند",
          ],
          facts: f,
          duration: "۶۰ تا ۹۰ دقیقه",
          factsLine: `پروژه‌های باز منطبق: ${f.projects.matching.length} • ${queueLine}`,
        }),
      );
      out.push(
        card({
          key: "deck:portfolio",
          title: "به‌روزرسانی نمونه‌کار و بستهٔ معرفی خدمات طراحی",
          objective: "افزایش شانس پذیرش پیشنهاد با نمونه‌کار به‌روز",
          deliverable: "بستهٔ نمونه‌کار (۳ نمونه) + یک‌صفحه معرفی خدمات و قیمت‌گذاری",
          steps: [
            "انتخاب سه تحویل شاخص از لاگ",
            "نوشتن توضیح کوتاه هر نمونه",
            "تدوین برگهٔ قیمت‌گذاری",
            "ارسال برای استفاده در پیشنهادها",
          ],
          facts: f,
          duration: "۴۵ تا ۷۵ دقیقه",
          factsLine: `تحویل موفق ۷ روز اخیر: ${f.queue.succeeded7d} • ${targetLine}`,
        }),
      );
      break;
    }

    // ── A5: ترجمه Web3 ────────────────────────────────────────────────
    case "web3-translator": {
      out.push(
        card({
          key: "translation:glossary",
          title: "به‌روزرسانی واژه‌نامهٔ تخصصی Web3 و قواعد یکدست‌سازی",
          objective: "کاهش بازکاری و افزایش سرعت تحویل ترجمه‌های فنی",
          deliverable:
            "واژه‌نامهٔ دوزبانهٔ به‌روزشده + قواعد نگارشی + فهرست اصطلاحات پرتکرار",
          steps: [
            "مرور پروژه‌های ترجمهٔ قبلی و اصطلاحات پرتکرار",
            "افزودن معادل‌های تأییدشده",
            "نوشتن قواعد نگارشی فارسی",
            "ثبت نسخهٔ جدید در دفتر کارمند",
          ],
          facts: f,
          duration: "۴۵ تا ۶۰ دقیقه",
          factsLine: `پروژه‌های باز منطبق: ${f.projects.matching.length} • ${queueLine}`,
        }),
      );
      out.push(
        card({
          key: "translation:qa",
          title: "کنترل کیفیت تحویل‌های ترجمه و گزارش انطباق اصطلاحات",
          objective: "اطمینان از یکدستی اصطلاحات پیش از تسویه‌حساب",
          deliverable: "گزارش QA: درصد انطباق واژه‌نامه، موارد اصلاح‌شده و ریسک باقی‌مانده",
          steps: [
            "انتخاب آخرین تحویل ترجمه",
            "مقایسه با واژه‌نامهٔ استاندارد",
            "اصلاح موارد ناهمخوان",
            "ثبت گزارش و ارسال خلاصه",
          ],
          facts: f,
          duration: "۳۰ تا ۴۵ دقیقه",
          factsLine: `${targetLine} • ${queueLine}`,
        }),
      );
      break;
    }

    // ── A6: وب‌هوک و یکپارچه‌سازی ────────────────────────────────────
    case "custom-webhook-worker": {
      out.push(
        card({
          key: "webhook:health",
          title: "بازرسی سلامت درگاه ingest و صف واریزهای منتظر تأیید",
          objective: "اطمینان از اینکه هیچ واریز واقعی بدون تأیید در صف گیر نکرده است",
          deliverable:
            "گزارش سلامت: وضعیت درگاه، تعداد واریز منتظر تأیید، قدیمی‌ترین مورد و اقدام لازم",
          steps: [
            "خواندن تراکنش‌های pending_verification",
            "محاسبهٔ عمر هر مورد",
            "بررسی پیکربندی تأیید زنجیره‌ای",
            "ثبت گزارش و ارسال هشدار در صورت تأخیر",
          ],
          facts: f,
          duration: "۱۵ تا ۲۵ دقیقه",
          factsLine: `واریزهای منتظر تأیید: ${f.deposits.pendingVerification} • سرویس ورکر: ${f.services.worker ? "متصل" : "تنظیم‌نشده"} • ${queueLine}`,
        }),
      );
      out.push(
        card({
          key: "webhook:signature-audit",
          title: "ممیزی امنیتی امضای درخواست‌ها و کلیدهای کارمندان",
          objective: "بستن مسیرهای ورود جعلی به API دریافت درآمد",
          deliverable:
            "گزارش ممیزی: وضعیت کلید هر کارمند، درخواست‌های ردشده، و توصیه‌های چرخش کلید",
          steps: [
            "مرور رویدادهای امنیتی اخیر",
            "بررسی وضعیت کلید API کارمندان",
            "تعیین سیاست چرخش کلید",
            "ثبت گزارش در دفتر کارمند",
          ],
          facts: f,
          duration: "۲۵ تا ۳۵ دقیقه",
          factsLine: `${queueLine} • ربات تلگرام: ${f.services.telegram ? "متصل" : "تنظیم‌نشده"}`,
        }),
      );
      break;
    }

    default:
      break;
  }

  // ── قالب عمومی (برای هر کارمندی که قالب اختصاصی ندارد) ─────────────
  out.push(
    card({
      key: "generic:kpi-review",
      title: "بازبینی شاخص‌های عملکرد و تدوین برنامهٔ هفتهٔ آینده",
      objective: "تبدیل وضعیت فعلی به فهرست اقدام مشخص برای روزهای بعد",
      deliverable:
        "جدول KPI (تحویل، خطا، درآمد تأییدشده) + سه اقدام اولویت‌دار هفته + ریسک‌ها",
      steps: [
        "استخراج آمار واقعی از دفتر کارمند",
        "محاسبهٔ فاصله تا هدف ماهانه",
        "تعیین سه اقدام با بیشترین اثر",
        "ثبت گزارش و ارسال خلاصه به تلگرام",
      ],
      facts: f,
      duration: "۲۵ تا ۴۰ دقیقه",
      factsLine: `${targetLine} • ${queueLine} • پیام خوانده‌نشده: ${f.messages.unread}`,
    }),
  );
  out.push(
    card({
      key: "generic:process-audit",
      title: "بازرسی فرایند اجرایی و حذف گلوگاه‌های تکراری",
      objective: "کاهش زمان تحویل و کاهش نرخ خطا در چرخهٔ بعدی",
      deliverable:
        "نقشهٔ فرایند فعلی + دو گلوگاه اصلی + اصلاح پیشنهادی با معیار سنجش",
      steps: [
        "مرور ۱۰ رویداد آخر دفتر کارمند",
        "شناسایی مراحل کند یا خطادار",
        "پیشنهاد اصلاح قابل اجرا",
        "ثبت گزارش در دفتر کارمند",
      ],
      facts: f,
      duration: "۳۰ تا ۴۵ دقیقه",
      factsLine: `نام کارمند: ${name} • دپارتمان: ${f.agent.department} • ${queueLine}`,
    }),
  );

  return out;
}

/**
 * انتخاب مأموریت بعدی برای یک کارمند با کنترل تکرار.
 *
 * @param cooldownHours هر قالب مأموریت تا این مدت تکرار نمی‌شود
 *                      (اگر همهٔ قالب‌ها اخیراً استفاده شده باشند، قدیمی‌ترین
 *                      انتخاب می‌شود تا صف هرگز خالی نماند)
 */
export async function pickMission(
  agent: MissionAgent,
  opts: { cooldownHours?: number } = {},
): Promise<
  | { ok: true; candidate: MissionCandidate; facts: MissionFacts; rotated: boolean }
  | { ok: false; reason: string; facts?: MissionFacts }
> {
  const facts = await gatherMissionFacts(agent);
  const candidates = buildMissionCandidates(facts);
  if (!candidates.length) {
    return { ok: false, reason: "هیچ قالب مأموریتی برای این کارمند تعریف نشده است", facts };
  }

  const cooldownHours = opts.cooldownHours ?? 6;
  const cutoff = new Date(Date.now() - cooldownHours * HOUR);

  let used = new Map<string, number>();
  try {
    const res: any = await db.execute(sql`
      SELECT payload->>'missionKey' AS key, MAX(created_at) AS last_at
        FROM agentos.agent_jobs
       WHERE agent_id = ${agent.id}
         AND created_at > ${cutoff.toISOString()}
         AND payload ? 'missionKey'
       GROUP BY 1
    `);
    for (const row of res?.rows ?? []) {
      const key = String(row?.key || "");
      if (!key) continue;
      used.set(key, new Date(row.last_at).getTime());
    }
  } catch {
    // اگر کوئری ممکن نبود، بدون کنترل تکرار ادامه می‌دهیم (صف نباید خالی بماند)
  }

  const fresh = candidates.filter((c) => !used.has(c.key));
  if (fresh.length) {
    return { ok: true, candidate: fresh[0], facts, rotated: false };
  }

  // همهٔ قالب‌ها در پنجرهٔ خنک‌شدن استفاده شده‌اند → قدیمی‌ترین را انتخاب کن
  const oldest = candidates
    .slice()
    .sort((a, b) => (used.get(a.key) ?? 0) - (used.get(b.key) ?? 0))[0];
  return { ok: true, candidate: oldest, facts, rotated: true };
}

/** آخرین فعالیت واقعی ثبت‌شده برای یک کارمند (برای نمایش «بیکار نمانده»). */
export async function lastAgentActivity(agentName: string) {
  const rows = await db
    .select()
    .from(agentActivityLogs)
    .where(and(eq(agentActivityLogs.agentName, agentName)))
    .orderBy(desc(agentActivityLogs.createdAt), desc(agentActivityLogs.id))
    .limit(1);
  return rows[0] ?? null;
}

/** فهرست کارمندان فعال (منبع مشترک حلقه و پنل). */
export async function activeAgentsForLoop(): Promise<MissionAgent[]> {
  const rows = await db.select().from(agents).orderBy(agents.id);
  return rows
    .filter((a) => a.status !== "paused")
    .map((a) => ({
      id: a.id,
      name: a.name,
      slug: a.slug,
      department: a.department,
      specialty: a.specialty,
      status: a.status,
      goalTitle: a.goalTitle,
      goalTargetUsdt: Number(a.goalTargetUsdt || 0),
      earnedUsdt: Number(a.earnedUsdt || 0),
      tasksCompleted: Number(a.tasksCompleted || 0),
      currentFocus: a.currentFocus,
    }));
}
