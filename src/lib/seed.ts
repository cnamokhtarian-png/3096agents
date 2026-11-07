import { db } from "@/db";
import {
  users,
  agents,
  projects,
  tasks,
  messages,
  transactions,
  agentLogs,
  toolRuns,
  settings,
  agentScoreEvents,
  agentMonthlyAwards,
  tradeSignals,
  tradePositions,
  agentJournal,
} from "@/db/schema";
import { createHash, createHmac } from "crypto";
import { eq } from "drizzle-orm";
import {
  DEFAULT_CONFIG,
  OUTCOME_POINTS,
  buildTelegramReport,
  getLeaderboardData,
  periodKey,
  shiftPeriod,
  type Outcome,
} from "@/lib/leaderboard";
import {
  TRADER_DEFAULTS,
  formatSignalMessage,
  getTraderAgent,
} from "@/lib/trader";

export const hashPw = (p: string) =>
  createHash("sha256").update(p).digest("hex");

const AUTH_SECRET =
  process.env.AUTH_SECRET || "freelance-agent-os-default-secret-key";

export function signSession(payload: {
  id: number;
  email: string;
  name: string;
}) {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", AUTH_SECRET).update(data).digest("base64url");
  return `${data}.${sig}`;
}

export function verifySession(token: string) {
  try {
    const [data, sig] = token.split(".");
    if (!data || !sig) return null;
    const expected = createHmac("sha256", AUTH_SECRET)
      .update(data)
      .digest("base64url");
    if (sig !== expected) return null;
    return JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

export async function getMasterWallet(): Promise<{
  address: string;
  network: string;
  autoSweep: boolean;
}> {
  try {
    const rows = await db.select().from(settings);
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    return {
      address:
        map.master_wallet_address ||
        process.env.MASTER_WALLET_ADDRESS ||
        "TXx7kP9mQvR4wN8sL2zB6cV1nM5xJ9Kf",
      network:
        map.master_wallet_network ||
        process.env.MASTER_WALLET_NETWORK ||
        "USDT-TRC20",
      autoSweep: map.auto_sweep_enabled !== "false",
    };
  } catch {
    return {
      address:
        process.env.MASTER_WALLET_ADDRESS ||
        "TXx7kP9mQvR4wN8sL2zB6cV1nM5xJ9Kf",
      network: process.env.MASTER_WALLET_NETWORK || "USDT-TRC20",
      autoSweep: true,
    };
  }
}

let seeded = false;

export async function ensureSeed() {
  if (seeded) return;
  try {
    const existingUsers = await db.select().from(users).limit(1);
    if (existingUsers.length === 0) {
      const adminEmail = process.env.ADMIN_EMAIL || "admin@freelance.ir";
      const adminPassword = process.env.ADMIN_PASSWORD || "admin123";
      await db
        .insert(users)
        .values({
          email: adminEmail,
          passwordHash: hashPw(adminPassword),
          name: "مدیر سیستم",
          role: "admin",
        })
        .onConflictDoNothing();
    }

    const defaultWallet =
      process.env.MASTER_WALLET_ADDRESS || "TXx7kP9mQvR4wN8sL2zB6cV1nM5xJ9Kf";
    const defaultNetwork =
      process.env.MASTER_WALLET_NETWORK || "USDT-TRC20";

    const existingSettings = await db.select().from(settings).limit(1);
    if (existingSettings.length === 0) {
      await db
        .insert(settings)
        .values([
          { key: "bot_username", value: "@sina_freelance_agent_bot" },
          { key: "bot_status", value: "connected" },
          { key: "master_wallet_address", value: defaultWallet },
          { key: "master_wallet_network", value: defaultNetwork },
          { key: "auto_sweep_enabled", value: "true" },
          { key: "wallet", value: `${defaultWallet} (${defaultNetwork})` },
          { key: "webhook", value: "/api/telegram/webhook" },
        ])
        .onConflictDoNothing();
    } else {
      const hasMaster = await db
        .select()
        .from(settings)
        .where(eq(settings.key, "master_wallet_address"));
      if (hasMaster.length === 0) {
        await db
          .insert(settings)
          .values([
            { key: "master_wallet_address", value: defaultWallet },
            { key: "master_wallet_network", value: defaultNetwork },
            { key: "auto_sweep_enabled", value: "true" },
          ])
          .onConflictDoNothing();
      }
    }

    const existingAgents = await db.select().from(agents).limit(1);
    if (existingAgents.length === 0) {
      await db
        .insert(agents)
        .values([
          {
            name: "آریا کریپتو (کارمند تخصصی رمزارز)",
            slug: "crypto-employee",
            role: "کارمند رمزارز، تحلیل آن‌چین و آربیتراژ DEX",
            specialty: "crypto",
            avatar: "🪙",
            status: "active",
            apiEndpoint: "/api/agents/ingest",
            apiKey: "ag_live_crypto_arya_9821",
            earnedUsdt: 1420,
            tasksCompleted: 34,
            payoutMode: "auto_unified",
            strategy:
              "رصد اختلاف قیمت صرافی‌ها، تحلیل ورود نهنگ‌ها، ایردراپ هانتینگ و واریز سود به کیف پول واحد",
          },
          {
            name: "ایجنت شکار و ساخت Next.js",
            slug: "nextjs-builder",
            role: "توسعه‌دهنده فول‌استک پروژه‌های وب و کریپتو",
            specialty: "freelance",
            avatar: "⚛️",
            status: "active",
            apiEndpoint: "/api/agents/ingest",
            apiKey: "ag_live_nextjs_dev_4410",
            earnedUsdt: 2350,
            tasksCompleted: 12,
            payoutMode: "auto_unified",
            strategy: "تولید خودکار لندینگ و داشبورد Web3 با تسویه USDT",
          },
          {
            name: "ایجنت فروش و مذاکره تلگرام",
            slug: "telegram-closer",
            role: "مسئول فروش ۲۴/۷ و صدور پیش‌فاکتور کریپتو",
            specialty: "bot",
            avatar: "🤖",
            status: "active",
            apiEndpoint: "/api/agents/ingest",
            apiKey: "ag_live_tg_sales_7732",
            earnedUsdt: 890,
            tasksCompleted: 27,
            payoutMode: "auto_unified",
            strategy: "پاسخ فوری به مشتریان تلگرام و دریافت پیش‌پرداخت TRC20",
          },
          {
            name: "ایجنت ساخت ارائه Pitch Deck",
            slug: "pptx-designer",
            role: "طراح اسلاید سرمایه‌گذاری استارتاپ و توکنومیکس",
            specialty: "content",
            avatar: "📊",
            status: "active",
            apiEndpoint: "/api/agents/ingest",
            apiKey: "ag_live_pptx_deck_3109",
            earnedUsdt: 640,
            tasksCompleted: 9,
            payoutMode: "auto_unified",
            strategy: "ساخت فایل PPTX حرفه‌ای انگلیسی و فارسی در ۵ دقیقه",
          },
          {
            name: "ایجنت مترجم تخصصی وایت‌پیپر",
            slug: "web3-translator",
            role: "مترجم متون بلاک‌چین و قراردادهای هوشمند",
            specialty: "content",
            avatar: "🌐",
            status: "active",
            apiEndpoint: "/api/agents/ingest",
            apiKey: "ag_live_trans_faen_5502",
            earnedUsdt: 540,
            tasksCompleted: 16,
            payoutMode: "auto_unified",
            strategy: "ترجمه دقیق FA↔EN با حفظ اصطلاحات DeFi",
          },
          {
            name: "ایجنت وب‌هوک خارجی (Custom API)",
            slug: "custom-webhook-worker",
            role: "دریافت درآمد از ربات ترید / n8n / TradingView",
            specialty: "custom_api",
            avatar: "🔌",
            status: "active",
            apiEndpoint: "/api/agents/ingest",
            apiKey: "ag_live_custom_hook_6190",
            earnedUsdt: 310,
            tasksCompleted: 19,
            payoutMode: "auto_unified",
            strategy: "دریافت سیگنال سود از سرویس‌های بیرونی و تجمیع در کیف پول واحد",
          },
        ])
        .onConflictDoNothing();
    }

    const existingProjects = await db.select().from(projects).limit(1);
    if (existingProjects.length === 0) {
      await db.insert(projects).values([
        {
          title: "لندینگ پیج Next.js برای صرافی رمزارز",
          clientName: "آرش کریمی",
          telegramUser: "@arash_crypto",
          source: "تلگرام",
          type: "nextjs",
          status: "in_progress",
          priority: "high",
          budgetUsdt: 850,
          receivedUsdt: 425,
          wallet: defaultWallet,
          deadline: "۱۴۰۵/۰۵/۱۸",
          description:
            "لندینگ فارسی RTL + اتصال قیمت لحظه‌ای و فرم ثبت‌نام",
        },
        {
          title: "ارائه PPTX سرمایه‌گذاری Web3",
          clientName: "Sara M.",
          telegramUser: "@sara_web3",
          source: "تلگرام",
          type: "pptx",
          status: "negotiating",
          priority: "medium",
          budgetUsdt: 320,
          receivedUsdt: 0,
          wallet: defaultWallet,
          deadline: "۱۴۰۵/۰۵/۲۲",
          description: "۱۸ اسلاید انگلیسی، نمودار توکنومیکس و رودمپ",
        },
        {
          title: "ترجمه وایت‌پیپر FA→EN",
          clientName: "نیما رستمی",
          telegramUser: "@nima_defi",
          source: "واتساپ",
          type: "translation",
          status: "approved",
          priority: "high",
          budgetUsdt: 540,
          receivedUsdt: 270,
          wallet: defaultWallet,
          deadline: "۱۴۰۵/۰۵/۱۵",
          description: "۱۲٬۰۰۰ کلمه تخصصی DeFi با حفظ اصطلاحات",
        },
        {
          title: "ربات تلگرام فروش اشتراک USDT",
          clientName: "Mina Trader",
          telegramUser: "@mina_trader",
          source: "تلگرام",
          type: "bot",
          status: "new",
          priority: "high",
          budgetUsdt: 1200,
          receivedUsdt: 0,
          wallet: defaultWallet,
          deadline: "۱۴۰۵/۰۵/۳۰",
          description: "پرداخت TRC20، فعال‌سازی خودکار، پنل ادمین",
        },
        {
          title: "ایجنت AI پشتیبانی فروشگاه",
          clientName: "علی محمدی",
          telegramUser: "@ali_shop",
          source: "معرفی",
          type: "ai_agent",
          status: "delivered",
          priority: "low",
          budgetUsdt: 680,
          receivedUsdt: 680,
          wallet: defaultWallet,
          deadline: "۱۴۰۵/۰۵/۱۰",
          description: "چت‌بات فارسی متصل به کاتالوگ و تلگرام",
        },
        {
          title: "داشبورد آنالیتیکس NFT",
          clientName: "Leo Park",
          telegramUser: "@leo_nft",
          source: "تلگرام",
          type: "nextjs",
          status: "paid",
          priority: "medium",
          budgetUsdt: 1500,
          receivedUsdt: 1500,
          wallet: defaultWallet,
          deadline: "۱۴۰۵/۰۵/۰۵",
          description: "Next.js + Charts + Wallet Connect",
        },
      ]);

      await db.insert(tasks).values([
        {
          title: "تأیید واریز سود آربیتراژ به کیف پول واحد",
          agent: "آریا کریپتو (کارمند تخصصی رمزارز)",
          actionType: "crypto_payout",
          description:
            "کارمند رمزارز اختلاف قیمت ۱.۸٪ جفت ارز TON/USDT شناسایی و ۸۵ USDT سود خالص کسب کرد. آماده واریز به کیف پول واحد.",
          projectTitle: "مأموریت آربیتراژ DEX",
          status: "pending",
          risk: "low",
          payload: `مقصد: ${defaultWallet} | مبلغ: +85 USDT | شبکه: TRC20`,
        },
        {
          title: "ارسال پیش‌فاکتور ۴۲۵ USDT",
          agent: "ایجنت فروش و مذاکره تلگرام",
          actionType: "send_invoice",
          description:
            "نیما رستمی درخواست تخفیف ۱۰٪ داده. ایجنت پیشنهاد ارسال پیش‌فاکتور با ۵٪ تخفیف و مهلت ۲۴ ساعته آماده کرده است.",
          projectTitle: "ترجمه وایت‌پیپر FA→EN",
          status: "pending",
          risk: "high",
          payload:
            "متن پیام: سلام نیما جان، برای شروع ۲۷۰ USDT پیش‌پرداخت...",
        },
        {
          title: "قبول پروژه ربات اشتراک",
          agent: "ایجنت فروش و مذاکره تلگرام",
          actionType: "accept_project",
          description:
            "پروژه ۱۲۰۰ USDT از @mina_trader — بودجه و ددلاین منطقی است. قبول خودکار نیازمند تأیید انسانی است.",
          projectTitle: "ربات تلگرام فروش اشتراک USDT",
          status: "pending",
          risk: "medium",
          payload: "پاسخ آماده: پروژه رو قبول می‌کنم، پیش‌پرداخت ۵۰٪...",
        },
        {
          title: "ساخت اسکلت Next.js صرافی",
          agent: "ایجنت شکار و ساخت Next.js",
          actionType: "run_tool",
          description:
            "اجرای ابزار Next.js Scaffolder برای لندینگ صرافی با RTL و Tailwind",
          projectTitle: "لندینگ پیج Next.js برای صرافی رمزارز",
          status: "approved",
          risk: "low",
          payload: "npx create-next-app + RTL config",
        },
      ]);

      await db.insert(messages).values([
        {
          chatId: "1001",
          clientName: "آرش کریمی",
          username: "@arash_crypto",
          direction: "in",
          text: "سلام، لندینگ رو تا چه حد پیش بردید؟ قیمت لحظه‌ای وصله؟",
          status: "unread",
        },
        {
          chatId: "1001",
          clientName: "آرش کریمی",
          username: "@arash_crypto",
          direction: "out",
          text: "سلام آرش جان 🌹 ۷۰٪ آماده‌ست، امروز نسخه پیش‌نمایش می‌فرستم.",
          status: "read",
        },
        {
          chatId: "1002",
          clientName: "Sara M.",
          username: "@sara_web3",
          direction: "in",
          text: "Hi, can we add tokenomics chart in slide 9?",
          status: "unread",
        },
        {
          chatId: "1003",
          clientName: "نیما رستمی",
          username: "@nima_defi",
          direction: "in",
          text: "اگر ۱۰٪ تخفیف بدید همین امروز پیش‌پرداخت می‌زنم.",
          status: "unread",
        },
        {
          chatId: "1004",
          clientName: "Mina Trader",
          username: "@mina_trader",
          direction: "in",
          text: "ربات اشتراک رو می‌خوام با پرداخت USDT. شروع می‌کنیم؟",
          status: "read",
        },
      ]);

      await db.insert(transactions).values([
        {
          title: "سود آربیتراژ و رصد آن‌چین TON/USDT",
          projectTitle: "عملیات خودکار رمزارز",
          agentName: "آریا کریپتو (کارمند تخصصی رمزارز)",
          destinationWallet: defaultWallet,
          amountUsdt: 620,
          network: "TRC20",
          txHash: "9f41...e81a",
          kind: "income",
          status: "confirmed",
        },
        {
          title: "تسویه داشبورد NFT",
          projectTitle: "داشبورد آنالیتیکس NFT",
          agentName: "ایجنت شکار و ساخت Next.js",
          destinationWallet: defaultWallet,
          amountUsdt: 1500,
          network: "TRC20",
          txHash: "8be1...77aa",
          kind: "income",
          status: "confirmed",
        },
        {
          title: "پیش‌پرداخت لندینگ صرافی",
          projectTitle: "لندینگ پیج Next.js",
          agentName: "ایجنت فروش و مذاکره تلگرام",
          destinationWallet: defaultWallet,
          amountUsdt: 425,
          network: "TRC20",
          txHash: "a3f9...c21e",
          kind: "income",
          status: "confirmed",
        },
        {
          title: "واریز وب‌هوک ربات تریدینگ‌ویو",
          projectTitle: "اتصال API بیرونی",
          agentName: "ایجنت وب‌هوک خارجی (Custom API)",
          destinationWallet: defaultWallet,
          amountUsdt: 310,
          network: "TRC20",
          txHash: "7c22...44b9",
          kind: "income",
          status: "confirmed",
        },
        {
          title: "پیش‌پرداخت ترجمه وایت‌پیپر",
          projectTitle: "ترجمه وایت‌پیپر",
          agentName: "ایجنت مترجم تخصصی وایت‌پیپر",
          destinationWallet: defaultWallet,
          amountUsdt: 270,
          network: "TRC20",
          txHash: "f002...9d31",
          kind: "income",
          status: "confirmed",
        },
      ]);

      await db.insert(agentLogs).values([
        {
          agent: "آریا کریپتو (کارمند تخصصی رمزارز)",
          action: "اسکن آربیتراژ و واریز به کیف پول واحد",
          status: "success",
          detail: `سود خالص +620 USDT به ${defaultWallet.slice(0, 10)}... واریز شد`,
          durationMs: 890,
        },
        {
          agent: "ایجنت فروش و مذاکره تلگرام",
          action: "پیشنهاد قیمت هوشمند",
          status: "success",
          detail: "پاسخ به @nima_defi آماده تأیید شد",
          durationMs: 1240,
        },
        {
          agent: "Webhook تلگرام",
          action: "دریافت پیام جدید",
          status: "success",
          detail: "۳ پیام از @arash_crypto همگام‌سازی شد",
          durationMs: 320,
        },
        {
          agent: "ایجنت وب‌هوک خارجی (Custom API)",
          action: "دریافت درآمد از API بیرونی",
          status: "success",
          detail: "310 USDT از اندپوینت /api/agents/ingest ثبت شد",
          durationMs: 210,
        },
      ]);

      await db.insert(toolRuns).values([
        {
          tool: "مترجم FA→EN",
          input: "وایت‌پیپر فصل ۲",
          output: "۲٬۴۰۰ کلمه ترجمه شد — آماده بازبینی",
          status: "done",
        },
        {
          tool: "سازنده PPTX",
          input: "Pitch Web3",
          output: "۱۸ اسلاید ساخته شد",
          status: "done",
        },
      ]);
    }
    try {
      await ensureLeaderboardSeed();
    } catch (e) {
      // اگر مایگریشن لیگ هنوز اعمال نشده، بقیهٔ اپ سالم می‌ماند.
      console.error("leaderboard seed error:", e);
    }
    try {
      await ensureTraderSeed();
    } catch (e) {
      // اگر مایگریشن میز کار هنوز اعمال نشده، بقیهٔ اپ سالم میماند.
      console.error("trader seed error:", e);
    }
    seeded = true;
  } catch (e) {
    console.error("seed error:", e);
  }
}

/**
 * دادهٔ نمونهٔ لیگ کارمندان (دورهٔ جاری + دورهٔ قبل) و پیکربندی پیش‌فرض.
 * کاملاً idempotent است: کلید `source_ref` جلوی تکرار را می‌گیرد و اسنپ‌شات
 * برندهٔ دورهٔ قبل فقط زمانی ساخته می‌شود که جدول جوایز خالی باشد.
 */
const LEAGUE_DEMO: Record<
  string,
  { success: number; failure: number; error: number; durations: number[] }
> = {
  "crypto-employee": {
    success: 9,
    failure: 1,
    error: 0,
    durations: [22, 31, 18, 27, 44, 25, 33, 29, 21],
  },
  "nextjs-builder": {
    success: 6,
    failure: 1,
    error: 1,
    durations: [95, 120, 80, 105, 70, 88],
  },
  "telegram-closer": {
    success: 12,
    failure: 2,
    error: 1,
    durations: [12, 18, 15, 20, 14, 17, 22, 11, 16, 19, 13, 15],
  },
  "pptx-designer": {
    success: 4,
    failure: 0,
    error: 0,
    durations: [45, 52, 38, 41],
  },
  "web3-translator": {
    success: 7,
    failure: 2,
    error: 0,
    durations: [65, 72, 58, 80, 61, 69, 75],
  },
  "custom-webhook-worker": {
    success: 5,
    failure: 3,
    error: 1,
    durations: [8, 12, 9, 11, 7],
  },
};

async function ensureLeaderboardSeed() {
  // ۱) پیکربندی پیش‌فرض وزن‌ها (در صورت وجود، دستکاری نمی‌شود)
  await db
    .insert(settings)
    .values([
      { key: "leaderboard_weight_success", value: String(DEFAULT_CONFIG.weightSuccess) },
      { key: "leaderboard_weight_revenue", value: String(DEFAULT_CONFIG.weightRevenue) },
      { key: "leaderboard_weight_speed", value: String(DEFAULT_CONFIG.weightSpeed) },
      { key: "leaderboard_revenue_target", value: String(DEFAULT_CONFIG.revenueTarget) },
      { key: "leaderboard_duration_target", value: String(DEFAULT_CONFIG.durationTarget) },
      { key: "leaderboard_boost_multiplier", value: String(DEFAULT_CONFIG.boostMultiplier) },
    ])
    .onConflictDoNothing();

  const agentRows = await db.select().from(agents).limit(50);
  const current = periodKey();
  const previous = shiftPeriod(current, -1);
  const events: (typeof agentScoreEvents.$inferInsert)[] = [];

  for (const period of [current, previous]) {
    const factor = period === current ? 1 : 0.65;
    const [y, m] = period.split("-").map(Number);
    for (const agent of agentRows) {
      const d = LEAGUE_DEMO[agent.slug];
      if (!d) continue;
      const counts: [Outcome, number][] = [
        ["success", Math.max(1, Math.round(d.success * factor))],
        ["failure", Math.round(d.failure * factor)],
        ["error", Math.round(d.error * factor)],
      ];
      let day = 2;
      for (const [outcome, count] of counts) {
        for (let i = 0; i < count; i++) {
          const duration =
            outcome === "success"
              ? d.durations[(i + (period === current ? 0 : 2)) % d.durations.length]
              : 0;
          day = Math.min(day, 27);
          events.push({
            agentId: agent.id,
            agentName: agent.name,
            period,
            outcome,
            projectTitle:
              outcome === "success"
                ? `پروژهٔ تحویل‌شدهٔ ${agent.name}`
                : `پروژهٔ نیازمند بازبینی ${agent.name}`,
            durationMinutes: duration,
            points: OUTCOME_POINTS[outcome],
            source: "seed",
            sourceRef: `seed:${period}:${agent.slug}:${outcome}:${i}`,
            note: "دادهٔ نمونهٔ لیگ — از پنل قابل حذف است",
            createdAt: new Date(Date.UTC(y, m - 1, day, 9, (i * 7) % 60)),
          });
          day += 1;
        }
      }
    }
  }

  if (events.length) {
    await db
      .insert(agentScoreEvents)
      .values(events)
      .onConflictDoNothing({ target: agentScoreEvents.sourceRef });
  }

  // ۲) یک اسنپ‌شات نمونه از «کارمند برتر ماه قبل» برای بخش تاریخچه
  const oldAwards = await db.select().from(agentMonthlyAwards).limit(1);
  if (oldAwards.length === 0) {
    const data = await getLeaderboardData(previous);
    const w = data.winner;
    if (w) {
      await db
        .insert(agentMonthlyAwards)
        .values({
          period: previous,
          agentId: w.agentId,
          agentName: w.name,
          avatar: w.avatar,
          score: w.score,
          successRate: w.successRate,
          totalProjects: w.totalProjects,
          successCount: w.successes,
          revenueUsdt: w.revenueUsdt,
          avgDurationMinutes: w.avgDurationMinutes,
          points: w.points,
          runnersUp: JSON.stringify(
            data.rows
              .slice(1, 4)
              .map((r) => ({ agentId: r.agentId, name: r.name, score: r.score }))
          ),
          telegramMessage: buildTelegramReport(data),
          // اسنپشات نمونه «ارسالشده» علامت میخورد تا Cron ماهانه پیام دموی
          // ناخواستهای به تلگرام مدیر نفرستد.
          telegramSent: true,
          boostMultiplier: DEFAULT_CONFIG.boostMultiplier,
        })
        .onConflictDoNothing();
    }
  }
}

/**
 * 🪙 دادهٔ نمونهٔ «میز کار آریا (A1)» — تنظیمات، کارنامه، خاطرات و یک
 * پیشنهاد معاملهٔ منتظر تأیید. کاملاً idempotent و با برچسب «نمونه» مشخص است.
 */
async function ensureTraderSeed() {
  const defaults: [string, string][] = [
    ["trader_enabled", "true"],
    ["trader_symbol", TRADER_DEFAULTS.symbol],
    ["trader_capital_usdt", String(TRADER_DEFAULTS.capitalUsdt)],
    ["trader_max_position_usdt", String(TRADER_DEFAULTS.maxPositionUsdt)],
    ["trader_max_leverage", String(TRADER_DEFAULTS.maxLeverage)],
    ["trader_min_rr", String(TRADER_DEFAULTS.minRiskReward)],
    ["trader_min_confidence", String(TRADER_DEFAULTS.minConfidence)],
    ["trader_max_risk_usdt", String(TRADER_DEFAULTS.maxRiskUsdt)],
    ["trader_min_fear_greed", String(TRADER_DEFAULTS.minFearGreed)],
    ["trader_max_fear_greed", String(TRADER_DEFAULTS.maxFearGreed)],
    ["trader_max_volatility_pct", String(TRADER_DEFAULTS.maxVolatilityPct)],
    ["trader_auto_close", "true"],
    ["trader_max_hold_hours", String(TRADER_DEFAULTS.maxHoldHours)],
    ["trader_max_open_positions", String(TRADER_DEFAULTS.maxOpenPositions)],
    ["trader_mode", "paper"],
  ];
  await db.insert(settings).values(defaults.map(([key, value]) => ({ key, value }))).onConflictDoNothing();

  const agent = await getTraderAgent();
  const agentId = agent?.id || 1;
  const agentName = agent?.name || "آریا (A1)";
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;

  const existingJournal = await db.select().from(agentJournal).limit(1);
  if (existingJournal.length === 0) {
    await db.insert(agentJournal).values([
      {
        agentId,
        agentName,
        kind: "skip",
        mood: "cautious",
        text: "ساعت ۱۲:۳۰ بازار بیتکوین رصد شد. بهدلیل نوسان شدید اخبار و جهش شاخص ترس و طمع، از ورود به معاملهٔ جدید صرفنظر کردم؛ سرمایه حفظ شد.",
        meta: JSON.stringify({ seed: true, fearGreed: 84 }),
        createdAt: new Date(now - 1 * day),
      },
      {
        agentId,
        agentName,
        kind: "scan",
        mood: "focused",
        text: "دفتر سفارشات Binance بررسی شد: عمق سمت خرید ۱۲٪ بیشتر از فروش است و سه سفارش بالای ۱۰۰ هزار تتر دیده شد. RSI چهارساعته روی ۵۴ و MACD مثبت است.",
        meta: JSON.stringify({ seed: true, source: "demo" }),
        createdAt: new Date(now - 2 * day),
      },
      {
        agentId,
        agentName,
        kind: "trade",
        mood: "confident",
        text: "پوزیشن LONG روی BTC/USDT با ۵۰۰ تتر و اهرم ۳x باز کردم. حد ضرر زیر کف کانال و هدف روی مقاومت ۴ ساعته تنظیم شد؛ نسبت سود به ریسک ۱ به ۲ رعایت شد.",
        meta: JSON.stringify({ seed: true }),
        createdAt: new Date(now - 3 * day),
      },
      {
        agentId,
        agentName,
        kind: "close",
        mood: "satisfied",
        text: "معاملهٔ قبل با رسیدن به تارگت بسته شد. +۵۸٫۴ USDT سود خالص ثبت شد و نتیجه به لیگ کارمندان منتقل شد.",
        meta: JSON.stringify({ seed: true }),
        createdAt: new Date(now - 3 * day + 5 * 60 * 60 * 1000),
      },
      {
        agentId,
        agentName,
        kind: "review",
        mood: "reflective",
        text: "یک stop-loss در روز چهارم فعال شد (-۲۴٫۸ USDT). پرامپت مدیریت ریسک بازبینی شد: در نوسان بالای ۳٪ دیگر اهرم ۳x پیشنهاد نمیدهم.",
        meta: JSON.stringify({ seed: true }),
        createdAt: new Date(now - 5 * day),
      },
    ]);
  }

  const existingPositions = await db.select().from(tradePositions).limit(1);
  if (existingPositions.length === 0) {
    const demo = [
      { pnl: 58.4, reason: "target", daysAgo: 3, side: "LONG" },
      { pnl: 41.2, reason: "target", daysAgo: 4, side: "LONG" },
      { pnl: -24.8, reason: "stop", daysAgo: 5, side: "SHORT" },
      { pnl: 73.6, reason: "target", daysAgo: 6, side: "LONG" },
      { pnl: -19.3, reason: "stop", daysAgo: 8, side: "SHORT" },
      { pnl: 35.9, reason: "target", daysAgo: 9, side: "LONG" },
    ];
    const entry = 75800;
    const stop = 74200;
    const tp = 79000;
    await db.insert(tradePositions).values(
      demo.map((d) => {
        const exit = d.pnl > 0 ? tp : stop;
        const opened = new Date(now - d.daysAgo * day);
        return {
          agentId,
          agentName,
          symbol: "BTC/USDT",
          side: d.side,
          entryPrice: entry,
          currentPrice: exit,
          takeProfit: d.side === "LONG" ? tp : entry - (tp - entry),
          stopLoss: d.side === "LONG" ? stop : entry + (entry - stop),
          sizeUsdt: 500,
          leverage: 3,
          quantity: (500 * 3) / entry,
          unrealizedPnl: d.pnl,
          realizedPnl: d.pnl,
          pnlPct: (d.pnl / 500) * 100,
          mode: "paper",
          status: "closed",
          closeReason: d.reason,
          openedAt: opened,
          closedAt: new Date(opened.getTime() + 5 * 60 * 60 * 1000),
          updatedAt: new Date(opened.getTime() + 5 * 60 * 60 * 1000),
        };
      })
    );
  }

  const existingSignals = await db.select().from(tradeSignals).limit(1);
  if (existingSignals.length === 0) {
    const entry = 75800;
    const stop = 74200;
    const tp = 79000;
    const targetPct = ((tp - entry) / entry) * 100;
    const stopPct = ((entry - stop) / entry) * 100;
    const draft = {
      symbol: "BTC/USDT",
      side: "LONG",
      entryPrice: entry,
      stopLoss: stop,
      takeProfit: tp,
      targetPct,
      stopPct,
      riskReward: targetPct / stopPct,
      leverage: 3,
      positionUsdt: 500,
      estimatedProfitUsdt: (500 * 3 * targetPct) / 100,
      estimatedHoursMin: 4,
      estimatedHoursMax: 6,
      confidence: 86,
      rsi: 54,
      macdHist: 26,
      ma20: 75300,
      ma50: 74400,
      support: 74180,
      resistance: 78980,
      fearGreed: 55,
      orderbookImbalance: 0.12,
      whaleFlowUsdt: 420000,
      sentiment: 0.1,
      volatilityPct: 1.4,
      dataSource: "seed",
      dataSources: ["دادهٔ نمونه میز کار"],
      analysisReason:
        "شکست کانال نزولی ۴ ساعته + واگرایی مثبت در RSI + افزایش حجم خریداران در صرافی.",
      riskNotes: "ریسک حداکثر ۵۰ USDT • سقف پوزیشن ۵۰۰ USDT • اهرم مجاز 5x • R/R ≥ ۱ به ۲",
      status: "pending",
      // کارت نمونهای فقط ۲۰ دقیقه صف تأیید را نگه میدارد؛ بعد از آن بهصورت
      // خودکار منقضی شده و اسکن واقعی بازار با دادهٔ زنده جایگزینش میشود.
      expiresAt: new Date(now + 20 * 60 * 1000),
      createdAt: new Date(now - 2 * 60 * 1000),
    };
    await db.insert(tradeSignals).values({
      ...draft,
      agentId,
      agentName,
      dataSources: JSON.stringify(draft.dataSources),
      telegramMessage: formatSignalMessage(draft),
    });
  }
}
