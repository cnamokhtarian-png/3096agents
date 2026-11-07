import { db } from "@/db";
import { users, agents, settings } from "@/db/schema";
import { createHash, createHmac } from "crypto";
import type { NextRequest } from "next/server";

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

// احراز هویت ادمین از روی کوکی نشست (برای APIهای حساس مثل تنظیمات و برداشت)
export function requireAdmin(req: NextRequest) {
  const token = req.cookies.get("session")?.value || "";
  if (!token) return null;
  return verifySession(token);
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
      address: map.master_wallet_address || process.env.MASTER_WALLET_ADDRESS || "",
      network:
        map.master_wallet_network ||
        process.env.MASTER_WALLET_NETWORK ||
        "USDT-BEP20",
      autoSweep: map.auto_sweep_enabled === "true",
    };
  } catch {
    return {
      address: process.env.MASTER_WALLET_ADDRESS || "",
      network: process.env.MASTER_WALLET_NETWORK || "USDT-BEP20",
      autoSweep: false,
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

    // فقط کلیدهای گمشده اضافه می‌شوند؛ مقادیر ثبت‌شده کاربر دست نمی‌خورند.
    await db
      .insert(settings)
      .values([
        { key: "bot_username", value: "@sina_freelance_agent_bot" },
        { key: "bot_status", value: "connected" },
        {
          key: "master_wallet_address",
          value: process.env.MASTER_WALLET_ADDRESS || "",
        },
        {
          key: "master_wallet_network",
          value: process.env.MASTER_WALLET_NETWORK || "USDT-BEP20",
        },
        { key: "auto_sweep_enabled", value: "false" },
        { key: "wallet", value: "—" },
        { key: "webhook", value: "/api/telegram/webhook" },
        { key: "exchange_name", value: "" },
        { key: "exchange_api_key", value: "" },
        { key: "exchange_api_secret", value: "" },
        { key: "ai_provider", value: "" },
        { key: "ai_api_key", value: "" },
        { key: "ai_model", value: "gemini-3.5-flash" },
        { key: "risk_max_trade_pct", value: "2" },
        { key: "risk_max_leverage", value: "3" },
        { key: "risk_require_sl", value: "true" },
        { key: "trade_signal_drop_pct", value: "3" },
        { key: "a1_last_btc", value: "" },
      ])
      .onConflictDoNothing();

    // ایجنت‌ها با شمارنده صفر واقعی ساخته می‌شوند — بدون درآمد نمایشی.
    const existingAgents = await db.select().from(agents).limit(1);
    if (existingAgents.length === 0) {
      await db
        .insert(agents)
        .values([
          {
            name: "A1 · آریا — کارمند رمزارز",
            slug: "crypto-employee",
            role: "ترید، آربیتراژ و درآمد آن‌چین",
            specialty: "crypto",
            avatar: "🪙",
            status: "active",
            apiEndpoint: "/api/agents/ingest",
            apiKey: "ag_live_crypto_arya_9821",
            earnedUsdt: 0,
            tasksCompleted: 0,
            payoutMode: "manual_approval",
            strategy:
              "کسب درآمد واقعی رمزارز فقط با تأیید شما در تلگرام؛ هر واریز نیاز به مدرک (هش تراکنش) دارد.",
          },
          {
            name: "A2 · سازنده وب — Next.js",
            slug: "nextjs-builder",
            role: "ساخت سایت و وب‌اپ",
            specialty: "freelance",
            avatar: "⚛️",
            status: "active",
            apiEndpoint: "/api/agents/ingest",
            apiKey: "ag_live_nextjs_dev_4410",
            earnedUsdt: 0,
            tasksCompleted: 0,
            payoutMode: "manual_approval",
            strategy: "تحویل وب‌سایت واقعی و تسویه USDT با تأیید شما.",
          },
          {
            name: "A3 · فروشنده تلگرام",
            slug: "telegram-closer",
            role: "مذاکره و صدور فاکتور",
            specialty: "bot",
            avatar: "💬",
            status: "active",
            apiEndpoint: "/api/agents/ingest",
            apiKey: "ag_live_tg_sales_7732",
            earnedUsdt: 0,
            tasksCompleted: 0,
            payoutMode: "manual_approval",
            strategy:
              "پاسخ به مشتری واقعی تلگرام و ثبت پیش‌فاکتور؛ ارسال نهایی فقط با تأیید شما.",
          },
          {
            name: "A4 · طراح ارائه",
            slug: "pptx-designer",
            role: "Pitch Deck و اسلاید سرمایه‌گذاری",
            specialty: "content",
            avatar: "📊",
            status: "active",
            apiEndpoint: "/api/agents/ingest",
            apiKey: "ag_live_pptx_deck_3109",
            earnedUsdt: 0,
            tasksCompleted: 0,
            payoutMode: "manual_approval",
            strategy: "طراحی ارائه واقعی برای مشتری واقعی.",
          },
          {
            name: "A5 · مترجم",
            slug: "web3-translator",
            role: "ترجمه تخصصی FA↔EN",
            specialty: "content",
            avatar: "🌐",
            status: "active",
            apiEndpoint: "/api/agents/ingest",
            apiKey: "ag_live_trans_faen_5502",
            earnedUsdt: 0,
            tasksCompleted: 0,
            payoutMode: "manual_approval",
            strategy: "ترجمه واقعی با حفظ اصطلاحات DeFi.",
          },
          {
            name: "A6 · وب‌هوک خارجی",
            slug: "custom-webhook-worker",
            role: "اتصال API و ربات‌های بیرونی",
            specialty: "custom_api",
            avatar: "🔌",
            status: "active",
            apiEndpoint: "/api/agents/ingest",
            apiKey: "ag_live_custom_hook_6190",
            earnedUsdt: 0,
            tasksCompleted: 0,
            payoutMode: "manual_approval",
            strategy:
              "ثبت درآمد ربات‌ها و سرویس‌های بیرونی فقط با مبلغ و هش واقعی.",
          },
        ])
        .onConflictDoNothing();
    }

    // عمداً هیچ پروژه، پیام، تراکنش، تسک یا لاگ نمایشی ساخته نمی‌شود.
    // محصولات/پروژه‌های واقعی را خودتان از داشبورد اضافه می‌کنید.
    seeded = true;
  } catch (e) {
    console.error("seed error:", e);
  }
}
