import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { messages, tasks, agentLogs } from "@/db/schema";
import { ensureSeed, getMasterWallet } from "@/lib/seed";

async function sendRealTelegramMessage(
  chatId: string | number,
  text: string,
  replyMarkup?: any
) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatId) return { sent: false, reason: "no_token" };
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: "HTML",
          reply_markup: replyMarkup,
        }),
      }
    );
    return { sent: res.ok, status: res.status };
  } catch {
    return { sent: false, reason: "network_error" };
  }
}

export async function POST(req: NextRequest) {
  await ensureSeed();
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const reqSecret = req.headers.get("x-telegram-bot-api-secret-token");
  if (secret && reqSecret && reqSecret !== secret) {
    return NextResponse.json({ error: "Invalid secret" }, { status: 403 });
  }

  const b = await req.json().catch(() => ({}));
  const masterWallet = await getMasterWallet();

  // 1) پاسخ دکمه شیشه‌ای تلگرام (Inline Button Callback)
  if (b.callback_query) {
    const data = b.callback_query.data || "";
    const [action, id] = data.split(":");
    await db.insert(agentLogs).values({
      agent: "Webhook تلگرام",
      action: data.startsWith("approve")
        ? "✅ تأیید انسانی از تلگرام"
        : "❌ رد تسک از تلگرام",
      status: "success",
      detail: `callback_query: ${data} از ${
        b.callback_query.from?.username || "admin"
      }`,
      durationMs: 180,
    });
    return NextResponse.json({
      ok: true,
      method: "answerCallbackQuery",
      text: action === "approve" ? "تأیید شد ✅" : "رد شد ❌",
      inline_keyboard: [
        [
          { text: "✅ تأیید", callback_data: `approve:${id}` },
          { text: "❌ رد", callback_data: `reject:${id}` },
          { text: "✏️ ویرایش", callback_data: `edit:${id}` },
        ],
      ],
    });
  }

  // 2) پیام ورودی از کاربر یا شبیه‌ساز
  const msg = b.message || b;
  const text = msg.text || b.text || "پیام جدید از تلگرام";
  const name = msg.from?.first_name || b.clientName || "کاربر تلگرام";
  const username = msg.from?.username
    ? "@" + msg.from.username
    : b.username || "@client";
  const chatId = String(msg.chat?.id || b.chatId || "9999");

  const [m] = await db
    .insert(messages)
    .values({
      chatId,
      clientName: name,
      username,
      direction: "in",
      text,
      status: "unread",
      source: "telegram",
    })
    .returning();

  let task: any = null;
  if (
    text.includes("قیمت") ||
    text.includes("پروژه") ||
    text.includes("USDT") ||
    text.includes("شروع") ||
    text.includes("رمزارز") ||
    text.includes("کریپتو")
  ) {
    const rows: any = await db
      .insert(tasks)
      .values({
        title: "پاسخ و پیشنهاد پرداخت به: " + name,
        agent: "ایجنت فروش و مذاکره تلگرام",
        actionType: "send_message",
        description: text,
        projectTitle: "پیام تلگرام " + username,
        status: "pending",
        risk: "medium",
        payload: `پاسخ پیشنهادی ایجنت: سلام ${name} عزیز، پروژه قابل انجام است. آدرس کیف پول واحد (${masterWallet.network}): ${masterWallet.address}`,
      })
      .returning();
    task = rows[0];
  }

  const inlineKeyboard = {
    inline_keyboard: [
      [
        { text: "✅ تأیید ارسال", callback_data: `approve:${task?.id || 0}` },
        { text: "❌ رد", callback_data: `reject:${task?.id || 0}` },
      ],
      [{ text: "📊 مشاهده در پنل", callback_data: `open:${task?.id || 0}` }],
    ],
  };

  // اگر توکن واقعی تلگرام ست شده باشد، به ادمین یا چت پاسخ می‌فرستد
  const adminChat = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (adminChat) {
    await sendRealTelegramMessage(
      adminChat,
      `📩 <b>پیام جدید از ${name} (${username}):</b>\n${text}`,
      inlineKeyboard
    );
  }

  await db.insert(agentLogs).values({
    agent: "Webhook تلگرام",
    action: "پیام همگام‌سازی شد",
    status: "success",
    detail: `${username}: ${text.slice(0, 80)}`,
    durationMs: 240,
  });

  return NextResponse.json({
    ok: true,
    message: m,
    task,
    bot_reply: {
      text: "پیام دریافت شد ✅ ایجنت در حال آماده‌سازی پاسخ است...",
      reply_markup: inlineKeyboard,
    },
  });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    webhook: "active",
    bot: "@sina_freelance_agent_bot",
    mode: process.env.TELEGRAM_BOT_TOKEN ? "live_telegram_api" : "simulation+webhook",
    inline_buttons: ["approve", "reject", "edit"],
  });
}
