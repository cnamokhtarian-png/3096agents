import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { messages, tasks, agentLogs, agents } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ensureSeed, getMasterWallet } from "@/lib/seed";
import { sendTelegramMessage } from "@/lib/telegram";
import { recordScoreEvent } from "@/lib/leaderboard";

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
  // تأیید/رد انسانی = تنها نقطهٔ ورود «نتیجهٔ پروژه» به لیگ کارمندان.
  if (b.callback_query) {
    const data = b.callback_query.data || "";
    const [action, idRaw] = data.split(":");
    const id = Number(idRaw);
    const approved = action === "approve";
    const rejected = action === "reject";
    let leagueNote = "";

    if ((approved || rejected) && id > 0) {
      const [task] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
      if (task) {
        await db
          .update(tasks)
          .set({ status: approved ? "approved" : "rejected" })
          .where(eq(tasks.id, id));

        const allAgents = await db.select().from(agents);
        const agent =
          allAgents.find((a) => a.name === task.agent) ||
          allAgents.find(
            (a) =>
              task.agent.length > 3 &&
              (task.agent.includes(a.name) || a.name.includes(task.agent))
          );

        if (agent) {
          const created = task.createdAt ? new Date(task.createdAt).getTime() : 0;
          const durationMinutes = created
            ? Math.min(10080, Math.max(1, Math.round((Date.now() - created) / 60000)))
            : 0;
          const result = await recordScoreEvent({
            agentId: agent.id,
            outcome: approved ? "success" : "failure",
            projectTitle: task.projectTitle || task.title,
            durationMinutes,
            source: "hitl",
            sourceRef: `task:${id}:${approved ? "approve" : "reject"}`,
            note: `تأیید انسانی (HITL) از ${b.callback_query.from?.username || "پنل مدیر"}`,
          }).catch((e) => ({ duplicate: true, event: null, error: String(e) }));
          leagueNote = result.duplicate
            ? " • نتیجه قبلاً ثبت شده بود (بدون دوباره‌شماری)"
            : ` • ${approved ? "+۱۰ موفقیت" : "-۵ شکست"} امتیاز لیگ برای «${agent.name}»`;
        } else {
          leagueNote = " • ایجنت متناظر یافت نشد (امتیازی ثبت نشد)";
        }
      }
    }

    await db.insert(agentLogs).values({
      agent: "Webhook تلگرام",
      action: data.startsWith("approve")
        ? "✅ تأیید انسانی از تلگرام"
        : "❌ رد تسک از تلگرام",
      status: "success",
      detail: `callback_query: ${data} از ${
        b.callback_query.from?.username || "admin"
      }${leagueNote}`,
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
    await sendTelegramMessage(
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
