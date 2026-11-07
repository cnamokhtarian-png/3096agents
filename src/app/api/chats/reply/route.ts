import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { messages, agentLogs } from "@/db/schema";
import { ensureSeed, requireAdmin } from "@/lib/seed";

// ارسال واقعی پیام از طریق ربات تلگرام — فقط وقتی chatId واقعی عددی باشد.
export async function POST(req: NextRequest) {
  await ensureSeed();
  if (!requireAdmin(req)) {
    return NextResponse.json({ error: "نیاز به ورود مدیر" }, { status: 401 });
  }
  const b = await req.json().catch(() => ({}));
  const chatId = String(b.chatId || "");
  const text = String(b.text || "").trim();
  const clientName = String(b.clientName || "مشتری");
  const username = String(b.username || "");
  if (!/^\d{5,}$/.test(chatId)) {
    return NextResponse.json(
      { error: "chatId واقعی تلگرام نیست — فقط می‌توانید داخلی ذخیره کنید.", saveOnly: true },
      { status: 400 }
    );
  }
  if (!text) {
    return NextResponse.json({ error: "متن پیام خالی است" }, { status: 400 });
  }
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "توکن ربات تنظیم نشده" }, { status: 500 });
  }
  let sent = false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: Number(chatId), text }),
    });
    sent = res.ok;
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return NextResponse.json(
        { error: "ارسال تلگرام ناموفق بود: " + t.slice(0, 200) },
        { status: 502 }
      );
    }
  } catch {
    return NextResponse.json({ error: "خطای شبکه در ارسال تلگرام" }, { status: 502 });
  }
  const [m] = await db
    .insert(messages)
    .values({
      chatId,
      clientName,
      username,
      direction: "out",
      text,
      status: "read",
      source: "panel_telegram",
    })
    .returning();
  await db.insert(agentLogs).values({
    agent: "پنل گفتگو",
    action: "ارسال واقعی در تلگرام",
    status: "success",
    detail: `${clientName}: ${text.slice(0, 80)}`,
    durationMs: 0,
  });
  return NextResponse.json({ ok: true, sent, message: m });
}
