import { NextRequest, NextResponse } from "next/server";
import { actorOf, guardAdmin } from "@/lib/auth";
import { ENV } from "@/lib/env";
import { escapeHtml, sendTelegramMessage, telegramConfigured } from "@/lib/telegram";
import { sendDailyReports } from "@/lib/jobs";
import { db } from "@/db";
import { agentActivityLogs, messages } from "@/db/schema";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * ارسال پیام واقعی تلگرام از پنل.
 * action = message | daily_reports | client_message
 */
export async function POST(req: NextRequest) {
  const denied = guardAdmin(req);
  if (denied) return denied;

  if (!telegramConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        error: "TELEGRAM_BOT_TOKEN ست نشده است؛ ارسال واقعی ممکن نیست.",
        code: "telegram_not_configured",
      },
      { status: 503 }
    );
  }

  const b = await req.json().catch(() => ({}));
  const action = String(b?.action || "message");

  if (action === "daily_reports") {
    const result = await sendDailyReports();
    return NextResponse.json({ ok: true, ...result });
  }

  const text = String(b?.text || "").trim();
  if (!text) return NextResponse.json({ error: "متن پیام خالی است" }, { status: 400 });

  const chatId = String(b?.chatId || ENV.telegramAdminChat() || "").trim();
  if (!chatId) {
    return NextResponse.json(
      { error: "chatId لازم است (TELEGRAM_ADMIN_CHAT_ID ست نشده)" },
      { status: 400 }
    );
  }

  // پیام به مشتری → در جدول messages ثبت می‌شود تا تاریخچه واقعی بماند
  if (action === "client_message" && b?.clientName) {
    await db.insert(messages).values({
      chatId,
      clientName: String(b.clientName),
      username: String(b.username || ""),
      direction: "out",
      text,
      status: "read",
      source: "telegram",
    });
  }

  const res = await sendTelegramMessage(chatId, escapeHtml(text));

  await db.insert(agentActivityLogs).values({
    agentName: action === "client_message" ? "ایجنت فروش و مذاکره تلگرام" : "مدیرعامل (تلگرام)",
    action: res.ok ? "پیام واقعی تلگرام ارسال شد" : "ارسال پیام تلگرام ناموفق بود",
    status: res.ok ? "success" : "failed",
    detail:
      `${action} → chat ${chatId}` +
      (res.ok ? "" : ` • خطا: ${(res as any).description || (res as any).error}`),
    source: "telegram",
    meta: { actor: actorOf(req) },
  }).catch(() => {});

  return NextResponse.json(
    {
      ok: res.ok,
      telegram: res.ok ? { messageId: (res as any).result?.message_id } : (res as any).description || (res as any).error,
    },
    { status: res.ok ? 200 : 502 }
  );
}
