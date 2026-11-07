/**
 * Environment / configuration audit.
 *
 * این ماژول هیچ داده‌ای شبیه‌سازی نمی‌کند؛ فقط بررسی می‌کند چه کلیدی روی
 * محیط (Vercel / لوکال) واقعاً ست شده است. مقدار کلیدها هرگز به کلاینت
 * برنمی‌گردد؛ فقط «ست شده / ست نشده» و توضیح کارکرد.
 */

export type EnvCheck = {
  key: string;
  label: string;
  purpose: string;
  required: boolean;
  present: boolean;
  group: "database" | "auth" | "wallet" | "telegram" | "exchange" | "ai" | "cron" | "supabase";
  hint: string;
};

type Def = Omit<EnvCheck, "present"> & { check?: () => boolean };

function has(key: string) {
  const v = process.env[key];
  return typeof v === "string" && v.trim().length > 0;
}

const DEFS: Def[] = [
  {
    key: "DATABASE_URL",
    label: "اتصال دیتابیس (Pooler)",
    purpose: "تمام خواندن/نوشتن واقعی روی Supabase PostgreSQL از این مسیر انجام می‌شود",
    required: true,
    group: "database",
    hint: "postgres://agentos.<ref>:<pass>@...pooler.supabase.com:6543/postgres",
  },
  {
    key: "DIRECT_URL",
    label: "اتصال مستقیم (Migration)",
    purpose: "اجرای drizzle-kit push / اعمال supabase/schema.sql",
    required: false,
    group: "database",
    hint: "پورت ۵۴۳۲ سوپابیس",
  },
  {
    key: "ADMIN_EMAIL",
    label: "ایمیل مدیرعامل",
    purpose: "ساخت کاربر مدیر در اولین اجرا",
    required: false,
    group: "auth",
    hint: "مثلاً ceo@company.com",
  },
  {
    key: "ADMIN_PASSWORD",
    label: "رمز مدیرعامل",
    purpose: "ورود به داشبورد مدیریت",
    required: true,
    group: "auth",
    hint: "یک رمز قوی و غیر از مقدار پیش‌فرض admin123",
  },
  {
    key: "AUTH_SECRET",
    label: "کلید امضای نشست",
    purpose: "امضای HMAC کوکی نشست (HttpOnly)",
    required: true,
    group: "auth",
    hint: 'python3 -c "import secrets;print(secrets.token_hex(32))"',
  },
  {
    key: "MASTER_WALLET_ADDRESS",
    label: "آدرس کیف پول واحد",
    purpose: "مقصد واریز درآمد همه کارمندان",
    required: false,
    group: "wallet",
    hint: "آدرس TRC20 / BEP20 / ERC20",
  },
  {
    key: "TELEGRAM_BOT_TOKEN",
    label: "توکن ربات تلگرام",
    purpose: "ارسال دکمه‌های شیشه‌ای تأیید و دریافت وبهوک",
    required: true,
    group: "telegram",
    hint: "از @BotFather — بدون آن هیچ پیام واقعی ارسال نمی‌شود",
  },
  {
    key: "TELEGRAM_ADMIN_CHAT_ID",
    label: "چت‌آیدی مدیرعامل",
    purpose: "مقصد ارسال درخواست‌های تأیید",
    required: true,
    group: "telegram",
    hint: "عدد چت‌آیدی شما (با /id در ربات بگیرید)",
  },
  {
    key: "TELEGRAM_WEBHOOK_SECRET",
    label: "سکرت وبهوک تلگرام",
    purpose: "امن‌سازی وبهوک و رد درخواست‌های جعلی",
    required: false,
    group: "telegram",
    hint: "یک رشته تصادفی؛ هنگام setWebhook ارسال می‌شود",
  },
  {
    key: "EXCHANGE_API_KEY",
    label: "کلید API صرافی (آریا)",
    purpose: "دریافت موجودی و ارسال سفارش واقعی",
    required: false,
    group: "exchange",
    hint: "Binance (ترجیحاً Testnet)",
  },
  {
    key: "EXCHANGE_SECRET_KEY",
    label: "سکرت API صرافی (یا EXCHANGE_API_SECRET)",
    purpose: "امضای HMAC درخواست‌های سفارش",
    required: false,
    group: "exchange",
    hint: "Secret Key پنل صرافی",
  },
  {
    key: "EXCHANGE_TESTNET",
    label: "کلیدهای Testnet",
    purpose: "اگر true باشد، سفارش‌ها به testnet.binance.vision می‌روند",
    required: false,
    group: "exchange",
    hint: "true / false",
  },
  {
    key: "AGENT_TRADING_ENABLED",
    label: "اجازه معامله واقعی",
    purpose: "قفل ایمنی: بدون true هیچ سفارشی ارسال نمی‌شود",
    required: false,
    group: "exchange",
    hint: "فقط بعد از تست Testnet مقدار true بگذارید",
  },
  {
    key: "TRONGRID_API_KEY",
    label: "کلید TronGrid",
    purpose: "تأیید خودکار واریزهای TRC20 روی زنجیره",
    required: false,
    group: "exchange",
    hint: "trongrid.io — بدون آن تأیید دستی مدیرعامل لازم است",
  },
  {
    key: "ETHERSCAN_API_KEY",
    label: "کلید Etherscan",
    purpose: "تأیید خودکار واریزهای ERC20/BEP20",
    required: false,
    group: "exchange",
    hint: "etherscan.io — رایگان",
  },
  {
    key: "ADMIN_API_SECRET",
    label: "سکرت API مدیریت",
    purpose: "دسترسی ماشین‌به‌ماشین به عملیات حساس (هدر x-admin-secret)",
    required: false,
    group: "auth",
    hint: "اختیاری — برای اسکریپت‌های خودکار مدیر",
  },
  {
    key: "AGENT_WORKER_URL",
    label: "وب‌هوک ورکر ابزارها",
    purpose: "اجرای واقعی ابزارها (Next.js / PPTX / ترجمه) توسط ورکر بیرونی (n8n)",
    required: false,
    group: "ai",
    hint: "https://n8n.example.com/webhook/agent-tool",
  },
  {
    key: "GEMINI_API_KEY",
    label: "کلید جمینای",
    purpose: "نوشتن گزارش وضعیت کارمند بر پایه‌ی داده‌های واقعی دیتابیس",
    required: false,
    group: "ai",
    hint: "Google AI Studio — بدون آن گزارش با قالب دیتابیسی ساخته می‌شود",
  },
  {
    key: "CRON_SECRET",
    label: "سکرت کرون",
    purpose: "اجازه اجرای /api/cron/tick توسط Vercel Cron",
    required: true,
    group: "cron",
    hint: "یک رشته تصادفی؛ در Vercel به عنوان Bearer ارسال می‌شود",
  },
  {
    key: "NEXT_PUBLIC_SUPABASE_URL",
    label: "آدرس پروژه Supabase",
    purpose: "اختیاری — برای لینک مستقیم پنل/کتابخانه سوپابیس",
    required: false,
    group: "supabase",
    hint: "https://<ref>.supabase.co",
  },
  {
    key: "SUPABASE_SERVICE_ROLE_KEY",
    label: "Service Role Key",
    purpose: "اختیاری — این پروژه مستقیم با Postgres کار می‌کند و به آن نیاز ندارد",
    required: false,
    group: "supabase",
    hint: "فقط اگر بعداً supabase-js اضافه کنید",
  },
  {
    key: "NEXT_PUBLIC_APP_URL",
    label: "دامنه عمومی اپ",
    purpose: "ساخت آدرس وبهوک تلگرام و لینک گزارش‌ها",
    required: false,
    group: "cron",
    hint: "https://your-app.vercel.app",
  },
];

const ALIASES: Record<string, string[]> = {
  EXCHANGE_SECRET_KEY: ["EXCHANGE_API_SECRET", "BINANCE_SECRET_KEY"],
  EXCHANGE_API_KEY: ["BINANCE_API_KEY"],
};

export function auditEnv() {
  const checks: EnvCheck[] = DEFS.map((d) => ({
    ...d,
    present: has(d.key) || (ALIASES[d.key] || []).some(has),
  }));
  const missingRequired = checks.filter((c) => c.required && !c.present).map((c) => c.key);

  const exchangeReady =
    (has("EXCHANGE_API_KEY") || has("BINANCE_API_KEY")) &&
    (has("EXCHANGE_SECRET_KEY") || has("EXCHANGE_API_SECRET") || has("BINANCE_SECRET_KEY"));
  const tradingEnabled = String(process.env.AGENT_TRADING_ENABLED).toLowerCase() === "true";

  return {
    checks,
    missingRequired,
    ready: {
      database: has("DATABASE_URL"),
      auth: has("AUTH_SECRET") && has("ADMIN_PASSWORD"),
      telegram: has("TELEGRAM_BOT_TOKEN") && has("TELEGRAM_ADMIN_CHAT_ID"),
      exchangeKeys: exchangeReady,
      tradingEnabled,
      trading: exchangeReady && tradingEnabled,
      ai: has("GEMINI_API_KEY"),
      cron: has("CRON_SECRET"),
      worker: has("AGENT_WORKER_URL"),
      onchain: has("TRONGRID_API_KEY") || has("ETHERSCAN_API_KEY"),
    },
    environment: {
      isVercel: Boolean(process.env.VERCEL),
      region: process.env.VERCEL_REGION || "local",
      node: process.version,
      nodeEnv: process.env.NODE_ENV || "development",
    },
  };
}

export function requireEnv(keys: string[]): string[] {
  return keys.filter((k) => !has(k));
}

export const ENV = {
  telegramToken: () => process.env.TELEGRAM_BOT_TOKEN?.trim() || "",
  telegramAdminChat: () => process.env.TELEGRAM_ADMIN_CHAT_ID?.trim() || "",
  telegramSecret: () => process.env.TELEGRAM_WEBHOOK_SECRET?.trim() || "",
  // پذیرش نام‌های رایج هر دو سبک (سازگاری با envهای موجود در Vercel)
  exchangeKey: () =>
    process.env.EXCHANGE_API_KEY?.trim() ||
    process.env.BINANCE_API_KEY?.trim() ||
    "",
  exchangeSecret: () =>
    process.env.EXCHANGE_SECRET_KEY?.trim() ||
    process.env.EXCHANGE_API_SECRET?.trim() ||
    process.env.BINANCE_SECRET_KEY?.trim() ||
    "",
  exchangeTestnet: () => String(process.env.EXCHANGE_TESTNET).toLowerCase() === "true",
  tradingEnabled: () => String(process.env.AGENT_TRADING_ENABLED).toLowerCase() === "true",
  geminiKey: () => process.env.GEMINI_API_KEY?.trim() || "",
  cronSecret: () => process.env.CRON_SECRET?.trim() || "",
  workerUrl: () => process.env.AGENT_WORKER_URL?.trim() || "",
};

/** خطای پیکربندی: یعنی یک قابلیت واقعی هنوز ست نشده است (نه شبیه‌سازی). */
export class ConfigError extends Error {
  status = 503;
  code: string;
  missing: string[];
  constructor(message: string, missing: string[] = [], code = "not_configured") {
    super(message);
    this.code = code;
    this.missing = missing;
  }
}
