import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { settings, agentLogs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ensureSeed, requireAdmin } from "@/lib/seed";

// کلیدهای مجازی که داشبورد می‌تواند بخواند/بنویسد
const FIELDS = [
  { key: "exchange_name", label: "نام صرافی", secret: false },
  { key: "exchange_api_key", label: "کلید API صرافی", secret: true },
  { key: "exchange_api_secret", label: "رمز API صرافی", secret: true },
  { key: "ai_provider", label: "ارائه‌دهنده AI", secret: false },
  { key: "ai_api_key", label: "کلید AI", secret: true },
  { key: "ai_model", label: "مدل AI", secret: false },
  { key: "risk_max_trade_pct", label: "سقف ریسک هر معامله (٪)", secret: false },
  { key: "risk_max_leverage", label: "سقف اهرم", secret: false },
  { key: "risk_require_sl", label: "حد ضرر اجباری", secret: false },
] as const;

// چک‌لیست «از شما چه لازم داریم»
const CHECKS: { id: string; label: string; keys: string[] }[] = [
  { id: "payout_wallet", label: "آدرس برداشت متامسک", keys: ["master_wallet_address"] },
  { id: "exchange", label: "اتصال صرافی (کلید فقط خواندن+معامله)", keys: ["exchange_api_key", "exchange_api_secret"] },
  { id: "ai", label: "کلید AI برای ابزارهای تولیدی", keys: ["ai_api_key"] },
  { id: "risk", label: "سقف‌های ریسک معامله", keys: ["risk_max_trade_pct", "risk_max_leverage"] },
];

export async function GET(req: NextRequest) {
  await ensureSeed();
  if (!requireAdmin(req)) {
    return NextResponse.json({ error: "نیاز به ورود مدیر" }, { status: 401 });
  }
  const rows = await db.select().from(settings);
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const fields = FIELDS.map((f) => ({
    ...f,
    set: Boolean(map[f.key]),
    value: f.secret ? "" : map[f.key] || "",
    masked: f.secret && Boolean(map[f.key]) ? "•••••• (ثبت شده)" : "",
  }));
  const missing = CHECKS.filter((c) =>
    c.keys.some((k) => !map[k])
  ).map((c) => ({ id: c.id, label: c.label }));
  return NextResponse.json({
    fields,
    missing,
    telegramAdminChat: process.env.TELEGRAM_ADMIN_CHAT_ID || "",
    botUsername: map.bot_username || "@sina_freelance_agent_bot",
  });
}

export async function PUT(req: NextRequest) {
  await ensureSeed();
  if (!requireAdmin(req)) {
    return NextResponse.json({ error: "نیاز به ورود مدیر" }, { status: 401 });
  }
  const b = await req.json().catch(() => ({}));
  const key = String(b.key || "");
  const value = String(b.value ?? "").trim();
  const field = FIELDS.find((f) => f.key === key);
  if (!field) {
    return NextResponse.json({ error: "کلید نامعتبر است" }, { status: 400 });
  }
  if (
    (key === "risk_max_trade_pct" || key === "risk_max_leverage") &&
    !(Number(value) > 0)
  ) {
    return NextResponse.json(
      { error: "سقف ریسک باید عدد بزرگ‌تر از صفر باشد" },
      { status: 400 }
    );
  }
  const existing = await db
    .select()
    .from(settings)
    .where(eq(settings.key, key));
  if (existing.length > 0) {
    await db.update(settings).set({ value }).where(eq(settings.key, key));
  } else {
    await db.insert(settings).values({ key, value });
  }
  await db.insert(agentLogs).values({
    agent: "تنظیمات",
    action: `ثبت ${field.label}`,
    status: "success",
    detail: field.secret ? "مقدار محرمانه ذخیره شد" : value.slice(0, 60),
    durationMs: 0,
  });
  return NextResponse.json({ ok: true, key, set: Boolean(value) });
}
