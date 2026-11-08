/**
 * ═══════════════════════════════════════════════════════════════════════
 *  پرونده‌ی دائمی کلیدها — لایه‌ی مرکزی پیکربندی (Persistent Config Layer)
 * ═══════════════════════════════════════════════════════════════════════
 *
 *  هدف: کلیدهای API هرگز در بازنویسی‌های کد گم نشوند.
 *
 *  ترتیب اولویت خواندن هر کلید (اولین مقدار معتبر برنده است):
 *
 *    ۱) متغیر محیطی Vercel / سیستم‌عامل  ←  پایدار بین همه‌ی دیپلوی‌ها
 *    ۲) فایل `config.json` ریشه‌ی پروژه   ←  پرونده‌ی دائمی داخل مخزن
 *    ۳) `.env.local` / `.env`              ←  فقط برای توسعه‌ی محلی
 *
 *  بنابراین حتی اگر کل کد بازنویسی شود، تا وقتی `config.json` یا
 *  متغیرهای محیطی دست‌نخورده باشند، هیچ کلیدی از کار نمی‌افتد.
 *
 *  نکته‌ی امنیتی: `config.json` عمداً در `.gitignore` قرار می‌گیرد تا
 *  کلیدهای واقعی وارد تاریخچه‌ی گیت نشوند. نسخه‌ی `config.example.json`
 *  (بدون مقادیر) در گیت می‌ماند تا ساختار همیشه معلوم باشد.
 *  مقادیر واقعی در Vercel Environment Variables (نوع sensitive) هم
 *  نگهداری می‌شوند تا حتی با پاک شدن فایل، سرویس بالا بماند.
 */

import fs from "fs";
import path from "path";

type Section = Record<string, unknown>;

export type ConfigShape = Record<string, Section>;

let cached: ConfigShape | null = null;
let cachedMtime = 0;

/** مسیر فایل پایدار کلیدها. */
export const CONFIG_PATH = path.join(process.cwd(), "config.json");

function readConfigFile(): ConfigShape {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return {};
    const stat = fs.statSync(CONFIG_PATH);
    // در محیط production، فایل تغییر نمی‌کند → یک‌بار کش می‌شود.
    if (process.env.NODE_ENV === "production" && cachedMtime === stat.mtimeMs) {
      return cached || {};
    }
    const raw = fs.readFileSync(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as ConfigShape;
    cached = parsed;
    cachedMtime = stat.mtimeMs;
    return parsed;
  } catch {
    return {};
  }
}

/**
 * خواندن یک کلید از فایل پایدار.
 * `path` مثلاً "ai.GEMINI_API_KEY" یا "telegram.TELEGRAM_BOT_TOKEN".
 */
function fromFile(keyPath: string): string {
  const parts = keyPath.split(".");
  let node: unknown = readConfigFile();
  for (const part of parts) {
    if (!node || typeof node !== "object") return "";
    node = (node as Record<string, unknown>)[part];
  }
  if (node === undefined || node === null) return "";
  if (typeof node === "string") return node.trim();
  if (typeof node === "number" || typeof node === "boolean") return String(node);
  return "";
}

/**
 * خواندن یک کلید از فایل `.env.local` یا `.env` (فقط توسعه‌ی محلی).
 * فایل کامل پارس نمی‌شود؛ فقط خطوط KEY=VALUE خوانده می‌شوند.
 */
function fromDotEnv(key: string): string {
  for (const file of [".env.local", ".env"]) {
    try {
      const p = path.join(process.cwd(), file);
      if (!fs.existsSync(p)) continue;
      const content = fs.readFileSync(p, "utf8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq === -1) continue;
        if (trimmed.slice(0, eq).trim() !== key) continue;
        let value = trimmed.slice(eq + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        if (value) return value;
      }
    } catch {
      // فایل خراب یا غیرقابل خواندن → نادیده می‌گیریم
    }
  }
  return "";
}

/** نگاشت نام منطقی → مسیر در config.json */
const CONFIG_PATHS: Record<string, string> = {
  GEMINI_API_KEY: "ai.GEMINI_API_KEY",
  GEMINI_MODEL: "ai.GEMINI_MODEL",
  GEMINI_BASE_URL: "ai.GEMINI_BASE_URL",

  TELEGRAM_BOT_TOKEN: "telegram.TELEGRAM_BOT_TOKEN",
  TELEGRAM_ADMIN_CHAT_ID: "telegram.TELEGRAM_ADMIN_CHAT_ID",
  TELEGRAM_CHAT_ID: "telegram.TELEGRAM_CHAT_ID",
  TELEGRAM_BOT_USERNAME: "telegram.TELEGRAM_BOT_USERNAME",
  TELEGRAM_WEBHOOK_SECRET: "telegram.TELEGRAM_WEBHOOK_SECRET",
  TELEGRAM_API_BASE: "telegram.TELEGRAM_API_BASE",

  DATABASE_URL: "database.DATABASE_URL",
  DIRECT_URL: "database.DIRECT_URL",
  NEXT_PUBLIC_SUPABASE_URL: "database.NEXT_PUBLIC_SUPABASE_URL",
  SUPABASE_SERVICE_ROLE_KEY: "database.SUPABASE_SERVICE_ROLE_KEY",

  EXCHANGE_API_KEY: "exchange.EXCHANGE_API_KEY",
  EXCHANGE_SECRET_KEY: "exchange.EXCHANGE_SECRET_KEY",
  EXCHANGE_API_SECRET: "exchange.EXCHANGE_API_SECRET",
  EXCHANGE_TESTNET: "exchange.EXCHANGE_TESTNET",
  EXCHANGE_BASE_URL: "exchange.EXCHANGE_BASE_URL",
  AGENT_TRADING_ENABLED: "exchange.AGENT_TRADING_ENABLED",

  ADMIN_EMAIL: "auth.ADMIN_EMAIL",
  ADMIN_PASSWORD: "auth.ADMIN_PASSWORD",
  AUTH_SECRET: "auth.AUTH_SECRET",
  ADMIN_API_SECRET: "auth.ADMIN_API_SECRET",
  AGENT_MASTER_API_KEY: "auth.AGENT_MASTER_API_KEY",

  MASTER_WALLET_ADDRESS: "wallet.MASTER_WALLET_ADDRESS",
  MASTER_WALLET_NETWORK: "wallet.MASTER_WALLET_NETWORK",

  TRONGRID_API_KEY: "onchain.TRONGRID_API_KEY",
  ETHERSCAN_API_KEY: "onchain.ETHERSCAN_API_KEY",

  AGENT_WORKER_URL: "worker.AGENT_WORKER_URL",
  AGENT_WORKER_TOKEN: "worker.AGENT_WORKER_TOKEN",

  CRON_SECRET: "cron.CRON_SECRET",
  NEXT_PUBLIC_APP_URL: "app.NEXT_PUBLIC_APP_URL",
};

/**
 * ⚙️ تابع مرکزی: خواندن هر کلید پیکربندی.
 * اول محیط، بعد فایل پایدار، بعد فایل env محلی.
 */
export function conf(key: string): string {
  const fromEnv = process.env[key];
  if (typeof fromEnv === "string" && fromEnv.trim()) return fromEnv.trim();

  const cfgPath = CONFIG_PATHS[key];
  if (cfgPath) {
    const fromConfig = fromFile(cfgPath);
    if (fromConfig) return fromConfig;
  }

  // اگر کلید مستقیماً در ریشه‌ی config.json هم وجود داشت (مثل AGENT_KEY_*)
  const direct = fromFile(key);
  if (direct) return direct;

  return fromDotEnv(key);
}

/** آیا کلیدی مقدار معتبر دارد؟ (فقط وجود و غیرخالی بودن بررسی می‌شود) */
export function hasConf(key: string): boolean {
  return conf(key).length > 0;
}

/**
 * نمای کامل وضعیت پیکربندی — بدون افشای مقدار واقعی.
 * برای داشبورد /control/system و اندپوینت /api/system/status استفاده می‌شود.
 */
export function configInventory() {
  const groups = [
    { key: "ai", label: "هوش مصنوعی", keys: ["GEMINI_API_KEY", "GEMINI_MODEL"] },
    {
      key: "telegram",
      label: "تلگرام",
      keys: [
        "TELEGRAM_BOT_TOKEN",
        "TELEGRAM_ADMIN_CHAT_ID",
        "TELEGRAM_CHAT_ID",
        "TELEGRAM_BOT_USERNAME",
        "TELEGRAM_WEBHOOK_SECRET",
      ],
    },
    {
      key: "database",
      label: "پایگاه داده",
      keys: [
        "DATABASE_URL",
        "DIRECT_URL",
        "NEXT_PUBLIC_SUPABASE_URL",
        "SUPABASE_SERVICE_ROLE_KEY",
      ],
    },
    {
      key: "exchange",
      label: "صرافی",
      keys: [
        "EXCHANGE_API_KEY",
        "EXCHANGE_SECRET_KEY",
        "EXCHANGE_TESTNET",
        "EXCHANGE_BASE_URL",
        "AGENT_TRADING_ENABLED",
      ],
    },
    {
      key: "auth",
      label: "احراز هویت",
      keys: [
        "ADMIN_EMAIL",
        "ADMIN_PASSWORD",
        "AUTH_SECRET",
        "ADMIN_API_SECRET",
        "AGENT_MASTER_API_KEY",
      ],
    },
    { key: "wallet", label: "کیف پول واحد", keys: ["MASTER_WALLET_ADDRESS", "MASTER_WALLET_NETWORK"] },
    { key: "onchain", label: "تأیید زنجیره‌ای", keys: ["TRONGRID_API_KEY", "ETHERSCAN_API_KEY"] },
    { key: "worker", label: "ورکر ابزارها", keys: ["AGENT_WORKER_URL", "AGENT_WORKER_TOKEN"] },
    { key: "cron", label: "کرون", keys: ["CRON_SECRET"] },
    { key: "app", label: "اپ", keys: ["NEXT_PUBLIC_APP_URL"] },
  ];

  return groups.map((g) => ({
    group: g.key,
    label: g.label,
    items: g.keys.map((k) => {
      const value = conf(k);
      return {
        key: k,
        present: value.length > 0,
        source: process.env[k]?.trim() ? "env" : CONFIG_PATHS[k] ? "config.json" : "unset",
        // فقط برای کلیدهای غیرمحرمانه مقدار نشان داده می‌شود
        preview:
          k.includes("KEY") || k.includes("SECRET") || k.includes("PASSWORD") || k.includes("TOKEN") || k === "DATABASE_URL" || k === "DIRECT_URL"
            ? value
              ? `••••${value.slice(-4)}`
              : ""
            : value,
      };
    }),
  }));
}

/** آیا فایل پایدار کلیدها روی دیسک موجود است؟ */
export function configFileExists(): boolean {
  try {
    return fs.existsSync(CONFIG_PATH);
  } catch {
    return false;
  }
}

/** مسیر فایل پایدار (برای نمایش در داشبورد) */
export function configFilePath(): string {
  return CONFIG_PATH;
}
