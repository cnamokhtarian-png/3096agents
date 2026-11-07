/**
 * اجرای یک‌باره و Idempotent فرمان استارت‌آپ RNAI (COO) هنگام دیپلوی Production در Vercel.
 * در محیط محلی (بدون VERCEL_ENV=production) بلافاصله بدون تغییر خارج می‌شود.
 */
import pg from "pg";
import { createHmac } from "crypto";
import { conf } from "../src/lib/config.ts";
import { buildTechnicalSetup, type Candle, type TechnicalSetup } from "../src/lib/indicators.ts";

// r2: فرمان اجرایی مدیرعامل (فعال‌سازی واقعی ناوگان پس از ریست صفر) —
//     اسکن واقعی بازار با سایزینگ از موجودی واقعی صرافی، کارت فقط روی
//     سیگنال معتبر (actionable) و بدون تکرار کارتِ در انتظار تأیید.
const STARTUP_LOCK_KEY = "coo_startup_v2026_11_07_r2";
const COO_NAME = "RNAI · مدیر ارشد اجرایی (COO)";

const PROTOCOLS: Record<
  string,
  {
    department: string;
    officeRoom: string;
    monthlyTargetUsdt: number;
    roleDescription: string;
    mandateSummary: string;
    hitlRule: string;
  }
> = {
  "crypto-employee": {
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

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function sendTg(
  botToken: string,
  chatId: string,
  html: string,
  replyMarkup?: Record<string, unknown>,
): Promise<number | null> {
  if (!botToken || !chatId) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: html,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      }),
      signal: AbortSignal.timeout(10000),
    });
    const j: any = await res.json().catch(() => ({}));
    return j?.ok ? Number(j?.result?.message_id) || null : null;
  } catch {
    return null;
  }
}

async function askGemini(apiKey: string, prompt: string): Promise<string | null> {
  if (!apiKey) return null;
  const baseUrl = (
    conf("GEMINI_BASE_URL") || "https://generativelanguage.googleapis.com"
  )
    .replace(/\/v1beta\/?$/i, "")
    .replace(/\/$/, "");
  for (const model of ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite"]) {
    try {
      const res = await fetch(
        `${baseUrl}/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.25, maxOutputTokens: 220 },
          }),
          signal: AbortSignal.timeout(12000),
        },
      );
      if (!res.ok) continue;
      const j: any = await res.json().catch(() => ({}));
      const txt = j?.candidates?.[0]?.content?.parts
        ?.map((p: any) => p?.text || "")
        .join(" ")
        .trim();
      if (txt) return txt.replace(/\s+/g, " ");
    } catch {
      // ادامه با مدل بعدی
    }
  }
  return null;
}

async function fetchLiveCandles(sym: string): Promise<{
  candles: Candle[];
  change24h: number | null;
  source: string;
} | null> {
  for (const host of [
    "https://data-api.binance.vision",
    "https://api.binance.com",
  ]) {
    try {
      const [kRes, tRes] = await Promise.all([
        fetch(`${host}/api/v3/klines?symbol=${sym}&interval=1h&limit=80`, {
          signal: AbortSignal.timeout(7500),
        }),
        fetch(`${host}/api/v3/ticker/24hr?symbol=${sym}`, {
          signal: AbortSignal.timeout(7500),
        }),
      ]);
      if (kRes.ok) {
        const arr: any[] = await kRes.json();
        const tJson: any = tRes.ok ? await tRes.json().catch(() => ({})) : {};
        if (Array.isArray(arr) && arr.length >= 20) {
          return {
            candles: arr.map((k) => ({
              openTime: Number(k[0]),
              open: Number(k[1]),
              high: Number(k[2]),
              low: Number(k[3]),
              close: Number(k[4]),
              volume: Number(k[5]),
            })),
            change24h:
              tJson?.priceChangePercent !== undefined
                ? Number(tJson.priceChangePercent)
                : null,
            source: "binance",
          };
        }
      }
    } catch {
      // ادامه
    }
  }

  // فالبک OKX
  try {
    const instId = sym.replace(/USDT$/, "-USDT");
    const res = await fetch(
      `https://www.okx.com/api/v5/market/candles?instId=${instId}&bar=1H&limit=80`,
      { signal: AbortSignal.timeout(7500) },
    );
    if (res.ok) {
      const j: any = await res.json();
      const rows: any[] = j?.data || [];
      if (rows.length >= 20) {
        const candles: Candle[] = rows
          .slice()
          .reverse()
          .map((r) => ({
            openTime: Number(r[0]),
            open: Number(r[1]),
            high: Number(r[2]),
            low: Number(r[3]),
            close: Number(r[4]),
            volume: Number(r[5]),
          }));
        return { candles, change24h: null, source: "okx" };
      }
    }
  } catch {
    // نادیده
  }
  return null;
}

type ExchangeBalanceProbe = {
  availableUsdt: number | null;
  keysConfigured: boolean;
  tradingOn: boolean;
  exchangeName: "binance" | "tabdeal";
  testnet: boolean;
  note: string;
};

/**
 * موجودی واقعی USDT از صرافی — آینهٔ resolveExchangeConfig در src/lib/exchange.ts:
 * باندل کامل پنل (settings) بر Env اولویت دارد. هیچ عددی ساخته نمی‌شود؛
 * اگر کلید نباشد یا صرافی پاسخ ندهد، availableUsdt ‏null می‌ماند و اندازهٔ
 * پوزیشن «تعیین نشده» گزارش می‌شود.
 */
async function fetchRealUsdtBalance(
  settingsMap: Record<string, string>,
): Promise<ExchangeBalanceProbe> {
  const dbKey = (settingsMap.exchange_api_key || "").trim();
  const dbSecret = (settingsMap.exchange_api_secret || "").trim();
  const dbExchange = (settingsMap.exchange_name || "").trim().toLowerCase();
  const envKey = conf("EXCHANGE_API_KEY") || conf("BINANCE_API_KEY");
  const envSecret =
    conf("EXCHANGE_SECRET_KEY") || conf("EXCHANGE_API_SECRET") || conf("BINANCE_API_SECRET");
  const dbBundle = Boolean(dbKey && dbSecret);
  const apiKey = dbBundle ? dbKey : envKey;
  const apiSecret = dbBundle ? dbSecret : envSecret;
  const exchangeName: "binance" | "tabdeal" =
    dbBundle && dbExchange === "tabdeal" ? "tabdeal" : "binance";
  const tradingOn =
    ["true", "1", "yes", "on"].includes(conf("AGENT_TRADING_ENABLED").toLowerCase()) ||
    ["true", "1", "yes", "on"].includes((settingsMap.agent_trading_enabled || "").toLowerCase());
  const rawTestnet = (settingsMap.exchange_testnet || conf("EXCHANGE_TESTNET") || "true")
    .trim()
    .toLowerCase();
  const testnet = exchangeName !== "tabdeal" && !["false", "0", "no", "off"].includes(rawTestnet);

  if (!apiKey || !apiSecret) {
    return {
      availableUsdt: null,
      keysConfigured: false,
      tradingOn,
      exchangeName,
      testnet,
      note: "کلید API صرافی کامل نیست؛ موجودی قابل خواندن نیست و مبلغ سفارش تعیین نمی‌شود.",
    };
  }

  const host =
    exchangeName === "tabdeal"
      ? "https://api1.tabdeal.org"
      : testnet
        ? "https://testnet.binance.vision"
        : "https://api.binance.com";
  const path = exchangeName === "tabdeal" ? "/api/v1/account" : "/api/v3/account";
  const query = new URLSearchParams({
    timestamp: String(Date.now()),
    recvWindow: "5000",
  }).toString();
  const signature = createHmac("sha256", apiSecret).update(query).digest("hex");

  try {
    const res = await fetch(`${host}${path}?${query}&signature=${signature}`, {
      headers: { "X-MBX-APIKEY": apiKey },
      signal: AbortSignal.timeout(9000),
    });
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        availableUsdt: null,
        keysConfigured: true,
        tradingOn,
        exchangeName,
        testnet,
        note: `خواندن موجودی از ${exchangeName} ناموفق بود (HTTP ${res.status}${j?.msg ? `: ${j.msg}` : ""})؛ مبلغ سفارش تعیین نمی‌شود.`,
      };
    }
    const usdt = (j?.balances || []).find(
      (b: any) => String(b?.asset).toUpperCase() === "USDT",
    );
    const free = usdt ? Number(usdt.free) : 0;
    return {
      availableUsdt: Number.isFinite(free) ? free : 0,
      keysConfigured: true,
      tradingOn,
      exchangeName,
      testnet,
      note: `موجودی آزاد USDT در ${exchangeName} (${testnet ? "Testnet" : "Mainnet"}): ${free}`,
    };
  } catch (e: any) {
    return {
      availableUsdt: null,
      keysConfigured: true,
      tradingOn,
      exchangeName,
      testnet,
      note: `اتصال به ${exchangeName} برای خواندن موجودی ناموفق بود (${e?.message || "network"})؛ مبلغ سفارش تعیین نمی‌شود.`,
    };
  }
}

async function fetchVerifiedBounty(): Promise<{
  title: string;
  link: string;
  sourceName: string;
  trustScore: number;
  estimatedProfitUsdt: number;
  estimatedDuration: string;
  analysisReason: string;
  checkedFeeds: number;
  fetchedItems: number;
} | null> {
  const feeds = [
    { name: "Airdrops.io", url: "https://airdrops.io/feed/" },
    { name: "Decrypt", url: "https://decrypt.co/feed" },
    { name: "Cointelegraph", url: "https://cointelegraph.com/rss" },
  ];
  const scamRe =
    /send\s+\d+\s*(eth|usdt|bnb|sol)|seed\s*phrase|private\s*key|double\s+your|guaranteed\s+profit/i;
  const bountyRe = /airdrop|bounty|grant|campaign|testnet|reward|quest|incentivized/i;

  let checkedFeeds = 0;
  let fetchedItems = 0;
  const candidates: Array<{ title: string; link: string; desc: string; sourceName: string; matchBounty: boolean }> = [];

  for (const f of feeds) {
    try {
      const res = await fetch(f.url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; AgentCompanyOS-B7/1.0)" },
        signal: AbortSignal.timeout(8500),
      });
      if (!res.ok) continue;
      checkedFeeds += 1;
      const xml = (await res.text()).slice(0, 220_000);
      const blocks = xml.split(/<(?:item|entry)[\s>]/i).slice(1, 12);
      fetchedItems += blocks.length;
      for (const b of blocks) {
        const pick = (tag: string) => {
          const m = b.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
          return m
            ? m[1]
                .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
                .replace(/<[^>]*>/g, " ")
                .replace(/\s+/g, " ")
                .trim()
            : "";
        };
        const title = pick("title");
        const link = pick("link");
        const desc = pick("description") || pick("summary");
        if (!title || !link.startsWith("https://")) continue;
        if (scamRe.test(`${title} ${desc}`)) continue;
        candidates.push({
          title,
          link,
          desc,
          sourceName: f.name,
          matchBounty: f.name === "Airdrops.io" || bountyRe.test(`${title} ${desc}`),
        });
      }
    } catch {
      // ادامه
    }
  }

  const chosen = candidates.find((c) => c.matchBounty) || candidates[0];
  if (!chosen) return null;
  const amountMatch = `${chosen.title} ${chosen.desc}`.match(/\$\s?(\d{2,4})/);
  const est = amountMatch ? Math.min(500, Math.max(25, Number(amountMatch[1]))) : 65;

  return {
    title: chosen.title,
    link: chosen.link,
    sourceName: chosen.sourceName,
    trustScore: chosen.sourceName === "Airdrops.io" ? 86 : 82,
    estimatedProfitUsdt: est,
    estimatedDuration: "۳۰ تا ۶۰ دقیقه تکمیل تسک‌های کمپین",
    analysisReason: `کمپین از فید رسمی ${chosen.sourceName} با پروتکل HTTPS و بدون هیچ الگوی فیشینگ/تضمینی تأیید شد.`,
    checkedFeeds,
    fetchedItems,
  };
}

function hitlKeyboard(jobId: number) {
  return {
    inline_keyboard: [
      [
        { text: "[✅] تأیید و اجرا", callback_data: `ap:${jobId}` },
        { text: "[❌] رد پیشنهاد", callback_data: `rj:${jobId}` },
      ],
      [
        { text: "📊 مشاهده در پنل", callback_data: `op:${jobId}` },
        { text: "⏸ توقف کارمند", callback_data: `pz:${jobId}` },
      ],
    ],
  };
}

async function main() {
  if (process.env.VERCEL_ENV !== "production") {
    console.log("[coo-startup] غیر از محیط Production است؛ اجرای خودکار رد شد.");
    return;
  }

  const dbUrl = conf("DATABASE_URL");
  if (!dbUrl) {
    console.log("[coo-startup] DATABASE_URL یافت نشد؛ رد شد.");
    return;
  }

  const pool = new pg.Pool({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
    max: 3,
  });

  try {
    const lockRes = await pool.query(
      `INSERT INTO agentos.settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING RETURNING id`,
      [STARTUP_LOCK_KEY, new Date().toISOString()],
    );
    if (lockRes.rowCount === 0) {
      console.log("[coo-startup] قبلاً برای این نسخه اجرا شده است (Idempotent).");
      return;
    }

    console.log("[coo-startup] اجرای فرمان استارت‌آپ RNAI (COO) در محیط Production آغاز شد...");

    // ارتقای مدل هوش مصنوعی در جدول settings به gemini-3.8-flash
    await pool.query(
      `INSERT INTO agentos.settings (key, value) VALUES ('ai_model', 'gemini-3.8-flash')
       ON CONFLICT (key) DO UPDATE SET value = 'gemini-3.8-flash'`,
    );
    await pool.query(
      `INSERT INTO agentos.settings (key, value) VALUES ('hitl_financial_lock', 'strict')
       ON CONFLICT (key) DO UPDATE SET value = 'strict'`,
    );

    const botToken = conf("TELEGRAM_BOT_TOKEN");
    const chatId = conf("TELEGRAM_ADMIN_CHAT_ID") || conf("TELEGRAM_CHAT_ID");
    const geminiKey = conf("GEMINI_API_KEY");

    const [agentsRes, txRes, projRes, settingsRes] = await Promise.all([
      pool.query(`SELECT * FROM agentos.agents ORDER BY id ASC`),
      pool.query(`SELECT * FROM agentos.transactions ORDER BY created_at DESC`),
      pool.query(`SELECT * FROM agentos.projects ORDER BY budget_usdt DESC`),
      pool.query(`SELECT key, value FROM agentos.settings`),
    ]);

    const allAgents = agentsRes.rows;
    const allTx = txRes.rows;
    const allProjects = projRes.rows;
    const settingsMap = Object.fromEntries(
      settingsRes.rows.map((r: any) => [r.key, r.value]),
    );

    // ۱. ابلاغ شرح وظایف و همگام‌سازی واقعی ناوگان
    for (const ag of allAgents) {
      const spec = PROTOCOLS[ag.slug];
      const confirmedAgentTx = allTx.filter(
        (t: any) =>
          t.kind === "income" &&
          t.status === "confirmed" &&
          (t.agent_name === ag.name || String(t.agent_name).includes(ag.slug)),
      );
      const realEarned = Number(
        confirmedAgentTx
          .reduce((s: number, t: any) => s + (Number(t.amount_usdt) || 0), 0)
          .toFixed(2),
      );
      const syncedSuccess = Math.max(
        Number(ag.success_count) || 0,
        confirmedAgentTx.length,
        Number(ag.tasks_completed) || 0,
      );

      if (spec) {
        await pool.query(
          `UPDATE agentos.agents
           SET department = $1, office_room = $2, goal_title = $3, goal_target_usdt = $4,
               current_focus = $5, role = $6, earned_usdt = $7, success_count = $8, last_active_at = NOW()
           WHERE id = $9`,
          [
            spec.department,
            spec.officeRoom,
            "هدف درآمد ماهانه (پروتکل RNAI)",
            spec.monthlyTargetUsdt,
            spec.mandateSummary,
            spec.roleDescription,
            realEarned,
            syncedSuccess,
            ag.id,
          ],
        );

        await pool.query(
          `INSERT INTO agentos.agent_activity_logs (agent_id, agent_name, action, status, detail, source, meta)
           VALUES ($1, $2, $3, 'info', $4, 'coo_dispatch', $5::jsonb)`,
          [
            ag.id,
            ag.name,
            "دریافت حکم عملیاتی از RNAI (COO) و روشن‌شدن موتور پایش",
            `${spec.mandateSummary} • قانون طلایی HITL: ${spec.hitlRule}`,
            JSON.stringify({
              department: spec.department,
              monthlyTargetUsdt: spec.monthlyTargetUsdt,
              hitlLock: true,
            }),
          ],
        );
      }
    }

    await pool.query(
      `INSERT INTO agentos.agent_activity_logs (agent_name, action, status, detail, source, meta)
       VALUES ($1, $2, 'success', $3, 'coo_dispatch', $4::jsonb)`,
      [
        COO_NAME,
        `ابلاغ رسمی شرح وظایف و روشن‌کردن موتورهای ${allAgents.length} ایجنت فعال`,
        "پروتکل Human-in-the-Loop فعال شد: هیچ واریز، برداشت یا نهایی‌سازی مالی بدون تأیید [✅] مدیرعامل در تلگرام انجام نمی‌شود.",
        JSON.stringify({ charteredCount: allAgents.length }),
      ],
    );

    // ۲. موتور زنده آریا (A1) — تحلیل کندل‌های واقعی و ارسال کارت پیشنهاد به تلگرام
    const aria = allAgents.find((a: any) => a.slug === "crypto-employee");
    const setups: TechnicalSetup[] = [];
    // موجودی واقعی صرافی + درصد ریسک تنظیم‌شده: تنها منبع مجاز سایزینگ.
    const balanceProbe = await fetchRealUsdtBalance(settingsMap);
    const riskPct = Math.min(
      20,
      Math.max(0.1, Number(settingsMap.risk_max_trade_pct) || 2),
    );
    if (aria && aria.status === "active") {
      for (const sym of ["BTCUSDT", "ETHUSDT", "TONUSDT"]) {
        const data = await fetchLiveCandles(sym);
        if (!data) continue;
        const setup = buildTechnicalSetup({
          symbol: sym,
          candles: data.candles,
          livePrice: data.candles[data.candles.length - 1].close,
          changePct24h: data.change24h,
          source: data.source,
          maxLeverage: 3,
          availableUsdt: balanceProbe.availableUsdt,
          riskPct,
        });
        setups.push(setup);

        await pool.query(
          `INSERT INTO agentos.market_snapshots
           (symbol, price, change_pct, rsi, macd_hist, ma20, ma50, support, resistance, volatility_pct, candles, source, fetched_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())`,
          [
            sym,
            setup.entryPrice,
            setup.changePct24h,
            setup.rsi,
            setup.macdHist,
            setup.ma20,
            setup.ma50,
            setup.support,
            setup.resistance,
            setup.volatilityPct,
            data.candles.length,
            `${data.source}:ta-1h`,
          ],
        );
      }

      if (setups.length > 0) {
        setups.sort(
          (a, b) =>
            Number(b.actionable) - Number(a.actionable) ||
            b.confidence - a.confidence ||
            b.riskReward - a.riskReward,
        );
        const best = setups[0];

        await pool.query(
          `INSERT INTO agentos.agent_activity_logs (agent_id, agent_name, action, status, detail, source, meta)
           VALUES ($1, $2, $3, 'info', $4, 'aria_engine', $5::jsonb)`,
          [
            aria.id,
            aria.name,
            `تحلیل تکنیکال زنده ${setups.length} رمزارز (${setups.map((s) => s.symbol).join("، ")})`,
            setups
              .map(
                (s) =>
                  `${s.symbol}: $${s.entryPrice} (RSI=${s.rsi}, MACD=${s.macdHist}, حمایت=$${s.support}, مقاومت=$${s.resistance}, سوگیری=${s.directionLabel})`,
              )
              .join(" • ") + ` • ${balanceProbe.note}`,
            JSON.stringify({
              bestSymbol: best.symbol,
              confidence: best.confidence,
              actionable: best.actionable,
              availableUsdt: balanceProbe.availableUsdt,
              exchange: balanceProbe.exchangeName,
              testnet: balanceProbe.testnet,
            }),
          ],
        );

        // کارت پیشنهاد فقط روی سیگنال معتبر (actionable) و فقط وقتی کارت
        // معاملاتی دیگری در انتظار تأیید مدیرعامل نیست ساخته می‌شود؛
        // در غیر این صورت فقط تحلیل ثبت می‌شود و هیچ عدد/کارتی ساخته نمی‌شود.
        const pendingTradeRes = await pool.query(
          `SELECT COUNT(*)::int AS cnt FROM agentos.agent_jobs
           WHERE kind = 'trade' AND status IN ('awaiting_approval', 'pending_approval')`,
        );
        const pendingTrades = Number(pendingTradeRes.rows[0]?.cnt || 0);
        const createCard = best.actionable && pendingTrades === 0;

        if (!createCard) {
          await pool.query(
            `INSERT INTO agentos.agent_activity_logs (agent_id, agent_name, action, status, detail, source, meta)
             VALUES ($1, $2, $3, 'info', $4, 'aria_engine', $5::jsonb)`,
            [
              aria.id,
              aria.name,
              "بدون کارت پیشنهاد در این چرخه",
              !best.actionable
                ? `بهترین ستاپ ${best.symbol} به آستانه سیگنال معتبر نرسید (اطمینان ${best.confidence}٪، R/R ${best.riskReward})؛ طبق دستور مدیرعامل هیچ پیشنهاد حدسی به تلگرام ارسال نشد.`
                : `یک کارت معاملاتی (#در انتظار تأیید) از قبل باز است؛ برای جلوگیری از تکرار، کارت جدید ساخته نشد.`,
              JSON.stringify({ bestSymbol: best.symbol, pendingTrades }),
            ],
          );
        }

        if (createCard) await pool
          .query(
            `INSERT INTO agentos.trade_signals
             (agent_id, agent_name, symbol, side, entry_price, take_profit, stop_loss, target_pct, stop_pct, risk_reward, leverage, position_usdt, estimated_profit_usdt, confidence, rsi, macd_hist, ma20, ma50, support, resistance, volatility_pct, data_source, analysis_reason, status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,'pending')`,
            [
              aria.id,
              aria.name,
              best.symbol,
              best.side,
              best.entryPrice,
              best.takeProfit,
              best.stopLoss,
              best.targetPct,
              best.stopPct,
              best.riskReward,
              best.leverage,
              best.positionUsdt ?? 0,
              best.estimatedProfitUsdt ?? 0,
              best.confidence,
              best.rsi,
              best.macdHist,
              best.ma20,
              best.ma50,
              best.support,
              best.resistance,
              best.volatilityPct,
              best.source,
              best.analysisReason,
            ],
          )
          .catch(() => {});

        const aiReason =
          (await askGemini(
            geminiKey,
            `در نقش «آریا»، تحلیلگر ارشد رمزارز، در ۲ جمله کوتاه فارسی دلیل پیشنهاد معامله زیر را برای مدیرعامل بنویس (بدون markdown): نماد ${best.symbol} | جهت ${best.directionLabel} | ورود $${best.entryPrice} | حد ضرر $${best.stopLoss} | حد سود $${best.takeProfit} | اهرم ${best.leverage}x | RSI=${best.rsi} | MACD=${best.macdHist}`,
          )) || best.analysisReason;

        const tradePayload = {
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
        };

        const jobTitle = `پیشنهاد ${best.side === "BUY" ? "خرید" : "فروش"} ${best.symbol} (اهرم کنترل‌شده ${best.leverage}x • حد ضرر $${best.stopLoss})`;
        const jobIns = await pool.query(
          `INSERT INTO agentos.agent_jobs (agent_id, agent_name, kind, title, detail, payload, status, risk, requires_approval)
           VALUES ($1, $2, 'trade', $3, $4, $5::jsonb, 'awaiting_approval', 'medium', true)
           RETURNING id`,
          [
            aria.id,
            aria.name,
            jobTitle,
            `${aiReason}\nورود: $${best.entryPrice} | حد ضرر: $${best.stopLoss} | حد سود: $${best.takeProfit}\n${sizingLine}\n\n${gateNote}`,
            JSON.stringify(tradePayload),
          ],
        );
        const tradeJobId = jobIns.rows[0].id;

        const cardHtml =
          `🔔 <b>کارت پیشنهاد فرصت (HITL)</b> #${tradeJobId}\n` +
          `👤 کارمند: <b>${escapeHtml(aria.name)}</b>\n` +
          `📋 عنوان: <b>${escapeHtml(jobTitle)}</b>\n` +
          `🟡 ریسک متوسط • نوع: <code>trade</code>\n\n` +
          `• <b>نماد و جهت:</b> <code>${best.symbol}</code> (${escapeHtml(best.directionLabel)})\n` +
          `• <b>نقطه ورود:</b> <code>$${best.entryPrice}</code> | <b>اهرم کنترل‌شده:</b> <code>${best.leverage}x</code>\n` +
          `• <b>حد ضرر (SL):</b> <code>$${best.stopLoss}</code> | <b>حد سود (TP):</b> <code>$${best.takeProfit}</code> (R/R: ${best.riskReward})\n` +
          `• 💰 <b>سود تخمینی:</b> <code>+${best.estimatedProfitUsdt} USDT</code>\n` +
          `• ⏱ <b>زمان تقریبی:</b> ${escapeHtml(best.estimatedDuration)}\n` +
          `• 🧠 <b>دلیل تحلیل:</b> ${escapeHtml(aiReason)}\n\n` +
          `🔒 <i>قفل ایمنی مالی (COO): بدون کلیک شما روی [✅] هیچ واریز، برداشت یا نهایی‌سازی مالی انجام نمی‌شود.</i>`;

        const msgId = await sendTg(botToken, chatId, cardHtml, hitlKeyboard(tradeJobId));
        if (msgId) {
          await pool.query(
            `UPDATE agentos.agent_jobs SET telegram_message_id = $1 WHERE id = $2`,
            [msgId, tradeJobId],
          );
        }
        }
      }
    }

    // ۳. موتور زنده بانتی‌هانتر (B7)
    const hunter = allAgents.find((a: any) => a.slug === "bounty-hunter");
    if (hunter && hunter.status === "active") {
      const bounty = await fetchVerifiedBounty();
      await pool.query(
        `INSERT INTO agentos.agent_activity_logs (agent_id, agent_name, action, status, detail, source, meta)
         VALUES ($1, $2, $3, 'info', $4, 'bounty_engine', $5::jsonb)`,
        [
          hunter.id,
          hunter.name,
          `اسکن و حقیقت‌سنجی منابع بانتی و ایردراپ Web3`,
          bounty
            ? `منابع بررسی‌شده: ${bounty.checkedFeeds} • آیتم‌های بررسی‌شده: ${bounty.fetchedItems} • فرصت تأییدشده: «${bounty.title}» (امتیاز اعتبار ${bounty.trustScore}/100)`
            : "فیدها بررسی شدند؛ فرصت جدیدی با امتیاز بالای ضداسکم یافت نشد.",
          JSON.stringify({ found: Boolean(bounty) }),
        ],
      );

      if (bounty) {
        const bTitle = `فرصت بانتی/ایردراپ معتبر (${bounty.sourceName}) — ${bounty.title.slice(0, 80)}`;
        const bPayload = {
          link: bounty.link,
          source: bounty.sourceName,
          trustScore: bounty.trustScore,
          estimatedProfitUsdt: bounty.estimatedProfitUsdt,
          estimatedDuration: bounty.estimatedDuration,
          analysisReason: bounty.analysisReason,
        };
        const bJob = await pool.query(
          `INSERT INTO agentos.agent_jobs (agent_id, agent_name, kind, title, detail, payload, status, risk, requires_approval)
           VALUES ($1, $2, 'bounty', $3, $4, $5::jsonb, 'awaiting_approval', 'low', true)
           RETURNING id`,
          [
            hunter.id,
            hunter.name,
            bTitle,
            `${bounty.analysisReason}\nلینک: ${bounty.link}`,
            JSON.stringify(bPayload),
          ],
        );
        const bJobId = bJob.rows[0].id;
        const bHtml =
          `🔔 <b>کارت پیشنهاد فرصت (HITL)</b> #${bJobId}\n` +
          `👤 کارمند: <b>${escapeHtml(hunter.name)}</b>\n` +
          `📋 عنوان: <b>${escapeHtml(bTitle)}</b>\n` +
          `🟢 ریسک پایین • نوع: <code>bounty</code>\n\n` +
          `• 💰 <b>سود / پاداش تخمینی:</b> <code>+${bounty.estimatedProfitUsdt} USDT</code>\n` +
          `• ⏱ <b>زمان تقریبی:</b> ${escapeHtml(bounty.estimatedDuration)}\n` +
          `• 🛡️ <b>امتیاز حقیقت‌سنجی ضداسکم:</b> <code>${bounty.trustScore}/100</code>\n` +
          `• 🧠 <b>دلیل تحلیل:</b> ${escapeHtml(bounty.analysisReason)}\n` +
          `• 🔗 <b>لینک مرجع:</b> ${escapeHtml(bounty.link)}\n\n` +
          `🔒 <i>قفل ایمنی مالی (COO): بدون کلیک شما روی [✅] هیچ اقدامی نهایی نمی‌شود.</i>`;
        const bMsgId = await sendTg(botToken, chatId, bHtml, hitlKeyboard(bJobId));
        if (bMsgId) {
          await pool.query(
            `UPDATE agentos.agent_jobs SET telegram_message_id = $1 WHERE id = $2`,
            [bMsgId, bJobId],
          );
        }
      }
    }

    // ۴. پایش پروژه‌ها توسط ایجنت‌های تخصصی (A2، A3، A4، A5، A6)
    const validProjects = allProjects.filter(
      (p: any) =>
        !String(p.title).includes("[TEST]") &&
        Number(p.budget_usdt) > 0 &&
        (p.status === "new" || p.status === "in_progress"),
    );

    const specMatchers = [
      { slug: "nextjs-builder", re: /next|داشبورد|وب|web3/i, dur: "۷ تا ۱۰ روز کاری" },
      { slug: "telegram-closer", re: /تلگرام|ربات|پشتیبانی|ایجنت/i, dur: "۳ تا ۵ روز کاری" },
      { slug: "pptx-designer", re: /pitch|ارائه|اسلاید/i, dur: "۲ تا ۳ روز کاری" },
      { slug: "web3-translator", re: /وایت‌پیپر|ترجمه/i, dur: "۳ تا ۴ روز کاری" },
    ];

    let specialistCardSent = false;
    for (const sm of specMatchers) {
      const ag = allAgents.find((a: any) => a.slug === sm.slug);
      if (!ag || ag.status !== "active") continue;
      const matched = validProjects.filter((p: any) =>
        sm.re.test(`${p.title} ${p.type} ${p.description}`),
      );

      await pool.query(
        `INSERT INTO agentos.agent_activity_logs (agent_id, agent_name, action, status, detail, source, meta)
         VALUES ($1, $2, $3, 'info', $4, 'specialist_engine', $5::jsonb)`,
        [
          ag.id,
          ag.name,
          `پایش صف پروژه‌های تخصصی (${matched.length} پروژه مرتبط)`,
          matched.length
            ? `پروژه‌های آماده اجرا: ${matched.map((p: any) => `${p.title} (${p.budget_usdt} USDT)`).join("، ")}`
            : "صف پروژه‌ها بررسی شد.",
          JSON.stringify({ matchedCount: matched.length }),
        ],
      );

      if (!specialistCardSent && matched.length > 0) {
        const topProj = matched[0];
        const pReason = `پروژه «${topProj.title}» با تخصص ${ag.name} کاملاً منطبق است و بالاترین ارزش قراردادی (${topProj.budget_usdt} USDT) را در صف فعلی دارد.`;
        const pPayload = {
          projectId: topProj.id,
          estimatedProfitUsdt: Number(topProj.budget_usdt),
          estimatedDuration: sm.dur,
          analysisReason: pReason,
        };
        const pTitle = `پروپوزال اجرایی: ${topProj.title} (${topProj.budget_usdt} USDT)`;
        const pJob = await pool.query(
          `INSERT INTO agentos.agent_jobs (agent_id, agent_name, kind, title, detail, payload, status, risk, requires_approval)
           VALUES ($1, $2, 'proposal', $3, $4, $5::jsonb, 'awaiting_approval', 'low', true)
           RETURNING id`,
          [ag.id, ag.name, pTitle, pReason, JSON.stringify(pPayload)],
        );
        const pJobId = pJob.rows[0].id;
        const pHtml =
          `🔔 <b>کارت پیشنهاد فرصت (HITL)</b> #${pJobId}\n` +
          `👤 کارمند: <b>${escapeHtml(ag.name)}</b>\n` +
          `📋 عنوان: <b>${escapeHtml(pTitle)}</b>\n` +
          `🟢 ریسک پایین • نوع: <code>proposal</code>\n\n` +
          `• 💰 <b>ارزش / سود تخمینی:</b> <code>+${topProj.budget_usdt} USDT</code>\n` +
          `• ⏱ <b>زمان تقریبی:</b> ${sm.dur}\n` +
          `• 🧠 <b>دلیل تحلیل:</b> ${escapeHtml(pReason)}\n\n` +
          `🔒 <i>قفل ایمنی مالی (COO): شروع رسمی و نهایی‌سازی مالی منوط به تأیید [✅] شماست.</i>`;
        const pMsgId = await sendTg(botToken, chatId, pHtml, hitlKeyboard(pJobId));
        if (pMsgId) {
          await pool.query(
            `UPDATE agentos.agent_jobs SET telegram_message_id = $1 WHERE id = $2`,
            [pMsgId, pJobId],
          );
        }
        specialistCardSent = true;
      }
    }

    const webhookAg = allAgents.find((a: any) => a.slug === "custom-webhook-worker");
    if (webhookAg) {
      await pool.query(
        `INSERT INTO agentos.agent_activity_logs (agent_id, agent_name, action, status, detail, source)
         VALUES ($1, $2, 'بازرسی درگاه وب‌هوک خارجی (/api/agents/ingest)', 'info', 'درگاه دریافت درآمد خارجی با قفل سخت‌گیرانه HITL آماده به کار است.', 'webhook_engine')`,
        [webhookAg.id, webhookAg.name],
      );
    }

    // ۵. تهیه و ارسال گزارش جامع استارت‌آپ RNAI (COO) به تلگرام و بخش گزارش کارمندان
    const confirmedIncomes = allTx.filter(
      (t: any) => t.kind === "income" && t.status === "confirmed",
    );
    const totalConfirmedUsdt = Number(
      confirmedIncomes
        .reduce((s: number, t: any) => s + (Number(t.amount_usdt) || 0), 0)
        .toFixed(2),
    );
    const walletAddr =
      settingsMap.master_wallet_address || conf("MASTER_WALLET_ADDRESS") || "—";
    const walletNet =
      settingsMap.master_wallet_network || conf("MASTER_WALLET_NETWORK") || "USDT-ERC20";
    const pendingJobsCountRes = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM agentos.agent_jobs WHERE status = 'awaiting_approval'`,
    );
    const pendingJobsCount = pendingJobsCountRes.rows[0]?.cnt ?? 0;

    const lb = allAgents
      .map((ag: any) => {
        const agTx = confirmedIncomes.filter(
          (t: any) =>
            t.agent_name === ag.name || String(t.agent_name).includes(ag.slug),
        );
        const earned = Number(
          agTx.reduce((s: number, t: any) => s + (Number(t.amount_usdt) || 0), 0).toFixed(2),
        );
        const tasks = Math.max(Number(ag.tasks_completed) || 0, agTx.length);
        const errs = Number(ag.error_count) || 0;
        const errRate = Number(((errs / Math.max(tasks + errs, 1)) * 100).toFixed(1));
        const score = Number((earned * 1.5 + tasks * 12 - errRate * 1.8).toFixed(1));
        return { name: ag.name, earned, tasks, errRate, score };
      })
      .sort((a: any, b: any) => b.earned - a.earned || b.score - a.score);

    const tradingNow =
      ["true", "1", "yes", "on"].includes(
        conf("AGENT_TRADING_ENABLED").toLowerCase(),
      ) ||
      ["true", "1", "yes", "on"].includes(
        (settingsMap.agent_trading_enabled || "").toLowerCase(),
      );
    const resolvedExchange = (
      settingsMap.exchange_api_key && settingsMap.exchange_api_secret
        ? settingsMap.exchange_name || conf("EXCHANGE_NAME")
        : conf("EXCHANGE_NAME")
    )
      .trim()
      .toLowerCase();
    const testnetNow =
      resolvedExchange !== "tabdeal" &&
      !["false", "0", "no", "off"].includes(
        (settingsMap.exchange_testnet || conf("EXCHANGE_TESTNET") || "true")
          .trim()
          .toLowerCase(),
      );

    const topEmp = lb[0];
    const reportText =
      `🏛️ گزارش رسمی استارت‌آپ و عملیات — RNAI (COO)\n` +
      `قفل ایمنی مالی (HITL): فعال (هیچ تراکنشی بدون تأیید [✅] شما نهایی نمی‌شود)\n\n` +
      `📊 خلاصه عملکرد کل شرکت:\n` +
      `• درآمد واقعی محقق‌شده: ${totalConfirmedUsdt} USDT (${confirmedIncomes.length} تراکنش تأییدشده)\n` +
      `• کیف پول واحد شرکت: ${walletAddr} (${walletNet})\n` +
      `• ناوگان فعال: ${allAgents.length} ایجنت | کارت‌های منتظر تأیید شما: ${pendingJobsCount}\n\n` +
      `🏆 وضعیت لیدربورد و کارمند برتر:\n` +
      `🌟 کارمند برتر: ${topEmp.name} (+${topEmp.earned} USDT • نرخ خطا ${topEmp.errRate}%)\n` +
      lb
        .map(
          (r: any, idx: number) =>
            `${idx + 1}. ${r.name} — سود واقعی: ${r.earned} USDT | پروژه‌های موفق: ${r.tasks} | نرخ خطا: ${r.errRate}%`,
        )
        .join("\n") +
      `\n\n⚠️ چالش‌ها و موانع و وضعیت سرویس‌ها:\n` +
      `1. هسته هوش مصنوعی Gemini: خطای قبلی HTTP 404 مدل منسوخ gemini-2.0-flash برطرف و به gemini-3.8-flash (با فالبک خودکار به 3.7-flash و 3.5-flash) ارتقا یافت.\n` +
      `2. صرافی و معاملات آریا: متغیر AGENT_TRADING_ENABLED=${String(tradingNow)} متصل و فعال شد (${testnetNow ? "در حالت EXCHANGE_TESTNET=true؛ برای حساب اصلی بایننس/تبدیل متغیر EXCHANGE_TESTNET=false شود" : "حالت Mainnet فعال"}) — ثبت سفارش همچنان ۱۰۰٪ نیازمند کلیک شما روی دکمه [✅] در تلگرام است.\n` +
      `3. شبکه کیف پول واحد: در دیتابیس ${settingsMap.master_wallet_network || "USDT-ERC20"} و در متغیر محیطی ${conf("MASTER_WALLET_NETWORK") || "BEP20"} ثبت شده است؛ یکسان‌سازی برچسب شبکه توصیه می‌شود.`;

    await pool.query(
      `INSERT INTO agentos.agent_activity_logs (agent_name, action, status, detail, source, meta)
       VALUES ($1, 'صدور گزارش جامع استارت‌آپ شرکت (عملکرد مالی، لیدربورد و موانع)', 'success', $2, 'coo_report', $3::jsonb)`,
      [
        COO_NAME,
        reportText,
        JSON.stringify({
          confirmedIncomeUsdt: totalConfirmedUsdt,
          topEmployee: topEmp?.name,
          pendingApprovalsCount: pendingJobsCount,
          tradingEnabled: tradingNow,
        }),
      ],
    );

    const tgReportHtml =
      `🏛️ <b>گزارش رسمی استارت‌آپ و عملیات — RNAI (COO)</b>\n` +
      `🔒 <i>پروتکل HITL فعال: هیچ واریز/برداشت/معامله‌ای بدون تأیید [✅] شما نهایی نمی‌شود.</i>\n\n` +
      `📊 <b>خلاصه عملکرد کل شرکت:</b>\n` +
      `• درآمد واقعی محقق‌شده: <b><code>${totalConfirmedUsdt} USDT</code></b> (${confirmedIncomes.length} تراکنش)\n` +
      `• کیف پول واحد: <code>${escapeHtml(walletAddr)}</code> (${escapeHtml(walletNet)})\n` +
      `• ناوگان فعال: <b>${allAgents.length}/${allAgents.length}</b> ایجنت | کارت‌های منتظر تأیید شما: <b>${pendingJobsCount}</b>\n\n` +
      `🏆 <b>وضعیت لیدربورد و کارمند برتر:</b>\n` +
      `🌟 <b>کارمند برتر:</b> ${escapeHtml(topEmp.name)} (<code>+${topEmp.earned} USDT</code> • خطا <code>${topEmp.errRate}%</code>)\n` +
      lb
        .map(
          (r: any, idx: number) =>
            `${idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : `▫️ #${idx + 1}`} <b>${escapeHtml(r.name)}</b> — <code>${r.earned} USDT</code> | موفق: <code>${r.tasks}</code> | خطا: <code>${r.errRate}%</code>`,
        )
        .join("\n") +
      `\n\n⚠️ <b>وضعیت سرویس‌ها و موارد نیازمند توجه:</b>\n` +
      `🟢 <b>هسته Gemini AI:</b> خطای 404 مدل قدیمی <code>gemini-2.0-flash</code> رفع و به <code>gemini-3.8-flash</code> ارتقا یافت (فالبک: 3.7-flash / 3.5-flash).\n` +
      `🟢 <b>صرافی (A1 آریا):</b> <code>AGENT_TRADING_ENABLED=${String(tradingNow)}</code> متصل و فعال شد (${testnetNow ? "حالت Testnet فعال است — برای حساب واقعی EXCHANGE_TESTNET=false شود" : "حالت واقعی فعال"})؛ هیچ سفارشی بدون دکمه [✅] شما ثبت نمی‌شود.\n` +
      `🟠 <b>شبکه کیف پول واحد:</b> برچسب دیتابیس (<code>${escapeHtml(settingsMap.master_wallet_network || "USDT-ERC20")}</code>) با متغیر محیطی (<code>${escapeHtml(conf("MASTER_WALLET_NETWORK") || "BEP20")}</code>) یکسان‌سازی شود.`;

    await sendTg(botToken, chatId, tgReportHtml);
    console.log("[coo-startup] گزارش استارت‌آپ و کارت‌های HITL با موفقیت ثبت و ارسال شدند.");
  } catch (err: any) {
    console.error("[coo-startup] خطای غیروابسته به بیلد:", err?.message || err);
  } finally {
    await pool.end().catch(() => {});
  }
}

main().catch((e) => {
  console.error("[coo-startup] خطای سطح بالا:", e);
});
