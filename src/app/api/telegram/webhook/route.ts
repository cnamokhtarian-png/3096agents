import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { messages, tasks, agentLogs, transactions, agents } from "@/db/schema";
import { ensureSeed, getMasterWallet } from "@/lib/seed";
import { eq, desc } from "drizzle-orm";

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

// ─── داشبورد تعاملی تلگرام ───
async function tgApi(method: string, params: any) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    return await res.json().catch(() => null);
  } catch {
    return null;
  }
}

function isAdmin(telegramUserId: any) {
  const admin = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!admin) return true;
  return String(telegramUserId || "") === String(admin);
}

function mainMenuKeyboard(pending: number) {
  return {
    inline_keyboard: [
      [
        { text: "🪙 صرافی و رمزارز", callback_data: "menu:exchange" },
        { text: `🎯 فرصت‌ها (${pending})`, callback_data: "menu:bounty" },
      ],
      [
        { text: "🤖 ایجنت‌ها", callback_data: "menu:agents" },
        { text: "💳 کیف پول", callback_data: "menu:wallet" },
      ],
    ],
  };
}

const backKeyboard = (extraRows: any[] = []) => ({
  inline_keyboard: [
    ...extraRows,
    [{ text: "🔙 منوی اصلی", callback_data: "menu:main" }],
  ],
});

async function menuContent(kind: string): Promise<{ text: string; keyboard: any }> {
  if (kind === "main") {
    const rows: any = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.status, "pending"));
    return {
      text: `🏠 <b>منوی اصلی</b>\n\n🎯 تسک‌های منتظر تأیید: <b>${rows.length}</b>\nیکی را انتخاب کنید:`,
      keyboard: mainMenuKeyboard(rows.length),
    };
  }
  if (kind === "exchange") {
    try {
      const { getSpotBalances, getFundingBalances, getDepth } = await import(
        "@/lib/exchange"
      );
      const [spot, funding, depth] = await Promise.all([
        getSpotBalances().catch((e: any) => ({ error: e?.message })),
        getFundingBalances().catch(() => []),
        getDepth("BTC_IRT").catch(() => null),
      ]);
      let t = `🪙 <b>وضعیت صرافی تبدیل</b>\n\n`;
      if ((spot as any)?.error) {
        t += `⚠️ خطای موجودی: ${(spot as any).error}\n`;
      } else {
        const s: any[] = spot as any[];
        t += `💰 <b>اسپات:</b>${s.length === 0 ? " خالی" : ""}\n`;
        for (const b of s.slice(0, 12)) t += `• ${b.asset}: ${b.free}\n`;
        const f: any[] = funding as any[];
        if (f.length > 0) {
          t += `\n👛 <b>فاندینگ:</b>\n`;
          for (const b of f.slice(0, 12)) t += `• ${b.asset}: ${b.free}\n`;
        }
      }
      if (depth)
        t += `\n📊 BTC_IRT — خرید: ${Math.round(depth.bid)} / فروش: ${Math.round(depth.ask)}`;
      const rows: any = await db
        .select({ id: tasks.id })
        .from(tasks)
        .where(eq(tasks.status, "pending"));
      t += `\n\n🎯 سفارش‌های منتظر تأیید شما: ${rows.length}`;
      return {
        text: t,
        keyboard: backKeyboard([
          [{ text: "🔄 به‌روزرسانی", callback_data: "menu:exchange" }],
        ]),
      };
    } catch (e: any) {
      return {
        text: `🪙 خطای صرافی: ${e?.message || e}`,
        keyboard: backKeyboard(),
      };
    }
  }
  if (kind === "bounty") {
    const rows: any = await db
      .select()
      .from(tasks)
      .where(eq(tasks.status, "pending"))
      .orderBy(desc(tasks.id))
      .limit(5);
    if (rows.length === 0)
      return {
        text: `🎯 <b>شکارچی فرصت</b>\n\nهمه‌چیز به‌روز است — تسک منتظری نیست. ✅`,
        keyboard: backKeyboard(),
      };
    let t = `🎯 <b>فرصت‌های منتظر تأیید:</b>\n`;
    const kb: any[] = [];
    for (const r of rows) {
      t += `\n<b>#${r.id}</b> ${r.title}\n🤖 ${r.agent} | ⚠️ ${r.risk}\n`;
      kb.push([
        { text: `✅ تأیید #${r.id}`, callback_data: `approve:${r.id}` },
        { text: `❌ رد #${r.id}`, callback_data: `reject:${r.id}` },
      ]);
    }
    return { text: t, keyboard: backKeyboard(kb) };
  }
  if (kind === "agents") {
    const rows: any = await db.select().from(agents).orderBy(agents.id);
    let t = `🤖 <b>وضعیت ایجنت‌ها:</b>\n`;
    const kb: any[] = [];
    for (const a of rows) {
      const on = a.status !== "paused";
      t += `\n${a.avatar} <b>${a.name}</b> — ${on ? "🟢 روشن" : "🔴 خاموش"}\n💵 ${a.earnedUsdt} USDT | ✅ ${a.tasksCompleted} تسک`;
      kb.push([
        {
          text: `${on ? "🔴 خاموش کن" : "🟢 روشن کن"}: ${a.name}`,
          callback_data: `agent:${on ? "off" : "on"}:${a.id}`,
        },
      ]);
    }
    return { text: t, keyboard: backKeyboard(kb) };
  }
  const w = await getMasterWallet();
  const txs: any = await db
    .select()
    .from(transactions)
    .orderBy(desc(transactions.id))
    .limit(50);
  let income = 0;
  let payout = 0;
  for (const x of txs) {
    if (x.kind === "payout") payout += x.amountUsdt || 0;
    else income += x.amountUsdt || 0;
  }
  return {
    text:
      `💳 <b>کیف پول واحد</b>\n\n` +
      `📬 آدرس: <code>${w.address || "ثبت نشده"}</code>\n` +
      `🌐 شبکه: ${w.network}\n\n` +
      `📥 ورودی: <b>${income}</b> USDT\n` +
      `📤 خروجی: <b>${payout}</b> USDT\n` +
      `📊 سود/زیان: <b>${income - payout}</b> USDT\n` +
      `🧾 تعداد تراکنش: ${txs.length}`,
    keyboard: backKeyboard(),
  };
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
    const parts = data.split(":");
    const action = parts[0] || "";
    const id = parts[1] || "";
    const cbId = b.callback_query.id || "";
    const cbChatId = b.callback_query.message?.chat?.id;
    const cbMsgId = b.callback_query.message?.message_id;

    // ─── منوی تعاملی: menu:<section> ───
    if (action === "menu") {
      if (!isAdmin(b.callback_query.from?.id)) {
        return NextResponse.json({
          ok: true,
          method: "answerCallbackQuery",
          callback_query_id: cbId,
          text: "⛔ فقط ادمین",
          show_alert: true,
        });
      }
      const m = await menuContent(id || "main");
      if (cbChatId && cbMsgId) {
        await tgApi("editMessageText", {
          chat_id: cbChatId,
          message_id: cbMsgId,
          text: m.text,
          parse_mode: "HTML",
          reply_markup: m.keyboard,
        });
      }
      await db.insert(agentLogs).values({
        agent: "داشبورد تلگرام",
        action: `مشاهده منوی ${id || "main"}`,
        status: "success",
        detail: `menu:${id}`,
        durationMs: 150,
      });
      return NextResponse.json({
        ok: true,
        method: "answerCallbackQuery",
        callback_query_id: cbId,
        text: "",
      });
    }

    // ─── روشن/خاموش ایجنت: agent:<on|off>:<agentId> ───
    if (action === "agent") {
      if (!isAdmin(b.callback_query.from?.id)) {
        return NextResponse.json({
          ok: true,
          method: "answerCallbackQuery",
          callback_query_id: cbId,
          text: "⛔ فقط ادمین",
          show_alert: true,
        });
      }
      const agentId = Number(parts[2]);
      const turnOn = id === "on";
      if (agentId > 0) {
        await db
          .update(agents)
          .set({ status: turnOn ? "active" : "paused" })
          .where(eq(agents.id, agentId));
        await db.insert(agentLogs).values({
          agent: "داشبورد تلگرام",
          action: turnOn ? "🟢 روشن شدن ایجنت" : "🔴 خاموش شدن ایجنت",
          status: "success",
          detail: `agent ${agentId} → ${turnOn ? "active" : "paused"}`,
          durationMs: 120,
        });
      }
      const m = await menuContent("agents");
      if (cbChatId && cbMsgId) {
        await tgApi("editMessageText", {
          chat_id: cbChatId,
          message_id: cbMsgId,
          text: m.text,
          parse_mode: "HTML",
          reply_markup: m.keyboard,
        });
      }
      return NextResponse.json({
        ok: true,
        method: "answerCallbackQuery",
        callback_query_id: cbId,
        text: turnOn ? "روشن شد 🟢" : "خاموش شد 🔴",
      });
    }

    const taskId = Number(id);
    // Human-in-the-loop: تأیید/رد واقعی — وضعیت تسک در دیتابیس عوض می‌شود
    const newStatus =
      action === "approve"
        ? "approved"
        : action === "reject"
        ? "rejected"
        : null;
    if (newStatus && taskId > 0) {
      const found: any = await db
        .select()
        .from(tasks)
        .where(eq(tasks.id, taskId));
      const target = found[0];
      await db
        .update(tasks)
        .set({ status: newStatus })
        .where(eq(tasks.id, taskId));
      // اگر تسک از نوع برداشت باشد، وضعیت برداشت هم همگام می‌شود
      if (
        target?.actionType === "payout" &&
        target.payload?.startsWith("payout_tx:")
      ) {
        const payoutId = Number(target.payload.split(":")[1]);
        if (payoutId > 0) {
          await db
            .update(transactions)
            .set({ status: newStatus })
            .where(eq(transactions.id, payoutId));
          const adminChat = process.env.TELEGRAM_ADMIN_CHAT_ID;
          if (adminChat) {
            await sendRealTelegramMessage(
              adminChat,
              newStatus === "approved"
                ? `✅ <b>برداشت تأیید شد.</b>\nحالا انتقال را در متامسک انجام دهید و هش تراکنش را در داشبورد ← بخش «برداشت» ثبت کنید تا وضعیت «تکمیل» شود.`
                : `❌ <b>درخواست برداشت رد شد.</b>`
            );
          }
        }
      }
    }
    // اجرای سفارش صرافی بعد از تأیید انسانی (فقط اسپات)
    if (newStatus && taskId > 0) {
      const found2: any = await db.select().from(tasks).where(eq(tasks.id, taskId));
      const t2 = found2[0];
      if (t2?.actionType === "order") {
        if (newStatus === "approved") {
          try {
            const o = JSON.parse(t2.payload || "{}");
            const { newOrder } = await import("@/lib/exchange");
            const res: any = await newOrder({
              symbol: o.symbol,
              side: o.side,
              type: o.type,
              quantity: String(o.quantity),
              price: o.price ? String(o.price) : undefined,
            });
            await db
              .update(tasks)
              .set({ payload: t2.payload + `\n\n✅ اجرا شد: orderId=${res.orderId} status=${res.status}` })
              .where(eq(tasks.id, taskId));
            const ac = process.env.TELEGRAM_ADMIN_CHAT_ID;
            if (ac) {
              await sendRealTelegramMessage(
                ac,
                `✅ <b>سفارش صرافی اجرا شد</b>\n• ${o.side} ${o.quantity} ${o.symbol}\n• orderId: <code>${res.orderId}</code>\n• وضعیت: ${res.status}`
              );
            }
          } catch (e: any) {
            await db
              .update(tasks)
              .set({ payload: t2.payload + `\n\n❌ خطای اجرا: ${e?.message || e}` })
              .where(eq(tasks.id, taskId));
            const ac = process.env.TELEGRAM_ADMIN_CHAT_ID;
            if (ac) {
              await sendRealTelegramMessage(ac, `❌ <b>اجرای سفارش ناموفق بود</b>\n${e?.message || e}`);
            }
          }
        } else {
          const ac = process.env.TELEGRAM_ADMIN_CHAT_ID;
          if (ac) {
            await sendRealTelegramMessage(ac, `❌ <b>سفارش صرافی رد شد و اجرا نشد.</b>`);
          }
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
      }`,
      durationMs: 180,
    });
    return NextResponse.json({
      ok: true,
      method: "answerCallbackQuery",
      callback_query_id: b.callback_query.id || "",
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

  // ─── دستور /start: ارسال منوی اصلی داشبورد ───
  if (text.trim().startsWith("/start")) {
    if (!isAdmin(msg.from?.id)) {
      await sendRealTelegramMessage(chatId, "⛔ این ربات خصوصی است.");
    } else {
      const m0 = await menuContent("main");
      await sendRealTelegramMessage(
        chatId,
        `🤖 <b>داشبورد ایجنت 3096</b>\n\n${m0.text}`,
        m0.keyboard
      );
    }
    await db.insert(agentLogs).values({
      agent: "داشبورد تلگرام",
      action: "/start",
      status: "success",
      detail: `${username}: منوی اصلی ارسال شد`,
      durationMs: 200,
    });
    return NextResponse.json({ ok: true, message: m, menu: true });
  }

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
        agent: "A3 · فروشنده تلگرام",
        actionType: "send_message",
        description: text,
        projectTitle: "پیام تلگرام " + username,
        status: "pending",
        risk: "medium",
        payload: `پاسخ پیشنهادی ایجنت: سلام ${name} عزیز، پروژه قابل انجام است. آدرس کیف پول برداشت (${masterWallet.network}): ${masterWallet.address || "هنوز ثبت نشده — از داشبورد وارد کنید"}`,
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
