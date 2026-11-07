import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  agents,
  agentActivityLogs,
  agentJobs,
  messages,
  systemEvents,
  tasks,
  telegramUpdates,
} from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { ensureSeed, getMasterWallet } from "@/lib/seed";
import {
  answerCallbackQuery,
  editTelegramMessage,
  escapeHtml,
  getWebhookInfo,
  sendTelegramMessage,
  telegramConfigured,
} from "@/lib/telegram";
import { ENV, ConfigError } from "@/lib/env";
import { guardAdmin } from "@/lib/auth";
import {
  approveJob,
  getJob,
  rejectJob,
  syncTelegramApproval,
} from "@/lib/jobs";
import { generateAgentReport } from "@/lib/report";
import { conf } from "@/lib/config";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * وبهوک واقعی تلگرام (Human-in-the-Loop).
 *
 * چرخه‌ی کامل:
 *   ایجنت → Job در دیتابیس → پیام با دکمه‌های شیشه‌ای → کلیک مدیرعامل →
 *   اجرای واقعی (سفارش صرافی / تأیید واریز) → به‌روزرسانی همان پیام + لاگ.
 *
 * هیچ پاسخی «شبیه‌سازی» نمی‌شود؛ اگر توکن ست نشده باشد پاسخ ۵۰۳ با دلیل
 * صریح برمی‌گردد و رویداد در system_events ثبت می‌شود.
 */

function isAdminChat(chatId: string | number | undefined) {
  const admin = ENV.telegramAdminChat();
  return Boolean(admin) && String(chatId) === String(admin);
}

async function touchAgent(agentName: string) {
  await db
    .update(agents)
    .set({ lastActiveAt: new Date() })
    .where(eq(agents.name, agentName))
    .catch(() => {});
}

async function logActivity(input: {
  agentId?: number | null;
  agentName: string;
  action: string;
  status?: string;
  detail?: string;
  jobId?: number | null;
  meta?: Record<string, unknown>;
}) {
  await db
    .insert(agentActivityLogs)
    .values({
      agentId: input.agentId ?? null,
      agentName: input.agentName,
      action: input.action,
      status: input.status ?? "success",
      detail: input.detail ?? "",
      jobId: input.jobId ?? null,
      source: "telegram",
      meta: input.meta ?? {},
    })
    .catch(() => {});
}

/** دستورهای متنی مدیرعامل در تلگرام. */
async function handleAdminCommand(text: string, chatId: string | number) {
  const cmd = text
    .trim()
    .split(/\s+/)[0]
    .toLowerCase()
    .replace(`@${conf("TELEGRAM_BOT_USERNAME")}`, "");

  if (cmd === "/start" || cmd === "/help") {
    await sendTelegramMessage(
      chatId,
      [
        "<b>🏢 مرکز فرماندهی ایجنت‌ها</b>",
        "دستورهای موجود:",
        "• /status — وضعیت ناوگان",
        "• /jobs — کارهای منتظر تأیید",
        "• /report — گزارش همه کارمندان",
        "• /id — نمایش چت‌آیدی شما",
        "• /webhook — وضعیت وبهوک",
        "تأیید کارها با دکمه‌های شیشه‌ای همان پیام انجام می‌شود.",
      ].join("\n"),
    );
    return true;
  }

  if (cmd === "/id") {
    await sendTelegramMessage(
      chatId,
      `CHAT_ID: <code>${escapeHtml(String(chatId))}</code>`,
    );
    return true;
  }

  if (cmd === "/status") {
    const list = await db.select().from(agents);
    const total = list.reduce((s, a) => s + Number(a.earnedUsdt), 0);
    await sendTelegramMessage(
      chatId,
      [
        "<b>📊 وضعیت ناوگان</b>",
        `کارمندان: ${list.length} • فعال: ${list.filter((a) => a.status === "active").length}`,
        `درآمد واقعی تجمیع‌شده: ${total.toLocaleString("fa-IR")} USDT`,
        "",
        ...list.map(
          (a) =>
            `${a.avatar} ${escapeHtml(a.name)} — ${Number(a.earnedUsdt).toLocaleString("fa-IR")} USDT` +
            ` • موفق: ${a.successCount} • خطا: ${a.errorCount}`,
        ),
      ].join("\n"),
    );
    return true;
  }

  if (cmd === "/jobs") {
    const rows = await db
      .select()
      .from(agentJobs)
      .orderBy(desc(agentJobs.createdAt))
      .limit(20);
    const pending = rows.filter((j) => j.status === "awaiting_approval");
    await sendTelegramMessage(
      chatId,
      pending.length
        ? `<b>🗂 ${pending.length} کار منتظر تأیید</b>\n` +
            pending
              .map(
                (j) =>
                  `#${j.id} — ${escapeHtml(j.agentName)}: ${escapeHtml(j.title)}`,
              )
              .join("\n")
        : "هیچ کاری منتظر تأیید نیست ✅",
    );
    return true;
  }

  if (cmd === "/report") {
    const list = await db.select().from(agents);
    await sendTelegramMessage(
      chatId,
      `⏳ در حال ساخت ${list.length} گزارش از داده واقعی...`,
    );
    for (const a of list) {
      const rep = await generateAgentReport(a.id, { useAi: true });
      if (!rep.ok) continue;
      const lines = rep.text.split("\n");
      await sendTelegramMessage(
        chatId,
        `<b>${escapeHtml(lines[0])}</b>\n${escapeHtml(lines.slice(1).join("\n"))}`,
      );
    }
    return true;
  }

  if (cmd === "/webhook") {
    const info = await getWebhookInfo();
    if (info.ok) {
      await sendTelegramMessage(
        chatId,
        `<b>وضعیت وبهوک</b>\nURL: <code>${escapeHtml((info as any).result?.url || "—")}</code>\n` +
          `آپدیت‌های در انتظار: ${(info as any).result?.pending_update_count ?? 0}\n` +
          `آخرین خطا: ${escapeHtml((info as any).result?.last_error_message || "ندارد")}`,
      );
    } else {
      await sendTelegramMessage(
        chatId,
        `خطای Telegram: ${escapeHtml((info as any).description || "unknown")}`,
      );
    }
    return true;
  }

  return false;
}

export async function POST(req: NextRequest) {
  await ensureSeed();

  if (!telegramConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        error: "TELEGRAM_BOT_TOKEN ست نشده است؛ وبهوک واقعی کار نمی‌کند.",
        code: "telegram_not_configured",
      },
      { status: 503 },
    );
  }

  const secret = ENV.telegramSecret();
  const got = req.headers.get("x-telegram-bot-api-secret-token");
  if (secret && got !== secret) {
    await db
      .insert(systemEvents)
      .values({
        level: "warn",
        scope: "telegram:webhook",
        message: "درخواست وبهوک با سکرت نامعتبر رد شد",
      })
      .catch(() => {});
    return NextResponse.json(
      { ok: false, error: "invalid secret token" },
      { status: 403 },
    );
  }

  const update = await req.json().catch(() => ({}));
  const updateId = Number(update?.update_id);
  if (Number.isFinite(updateId)) {
    const ins = await db
      .insert(telegramUpdates)
      .values({
        updateId,
        kind: update?.callback_query ? "callback_query" : "message",
        payload: update,
        processed: false,
      })
      .onConflictDoNothing()
      .returning({ updateId: telegramUpdates.updateId });
    if (ins.length === 0) {
      return NextResponse.json({ ok: true, duplicate: true });
    }
  }

  try {
    // ─────────────── ۱) کلیک روی دکمه شیشه‌ای ───────────────
    if (update.callback_query) {
      const cb = update.callback_query;
      const data = String(cb.data || "");
      const [code, rawId] = data.split(":");
      const jobId = Number(rawId);
      const chatId = cb.message?.chat?.id;
      const messageId = cb.message?.message_id;
      const user = cb.from?.username
        ? `@${cb.from.username}`
        : `user:${cb.from?.id ?? "unknown"}`;
      const allowed = isAdminChat(chatId) || !ENV.telegramAdminChat();

      if (!allowed) {
        await answerCallbackQuery(
          cb.id,
          "⛔ فقط مدیرعامل اجازه تأیید دارد.",
          true,
        );
        return NextResponse.json({ ok: true, denied: true });
      }

      if (code === "ap" && jobId) {
        await answerCallbackQuery(cb.id, "⏳ در حال اجرا...");
        const res = await approveJob(jobId, `telegram:${user}`);
        const job = await getJob(jobId);
        await touchAgent(job?.agentName || "");
        if (!res.ok) {
          await editTelegramMessage(
            chatId,
            messageId,
            `⛔ <b>اجرا ناموفق</b> #${jobId}\n<code>${escapeHtml(res.error || "خطای نامشخص")}</code>`,
            { inline_keyboard: [] },
          ).catch(() => {});
        }
        return NextResponse.json({ ok: true, action: "approve", result: res });
      }

      if (code === "rj" && jobId) {
        await answerCallbackQuery(cb.id, "❌ رد شد");
        const res = await rejectJob(jobId, `telegram:${user}`);
        const job = await getJob(jobId);
        if (chatId && messageId) {
          await editTelegramMessage(
            chatId,
            messageId,
            `❌ درخواست #${jobId} توسط ${escapeHtml(user)} رد شد.\n${escapeHtml(job?.title || "")}`,
            { inline_keyboard: [] },
          ).catch(() => {});
        }
        return NextResponse.json({ ok: true, action: "reject", result: res });
      }

      if (code === "op" && jobId) {
        const job = await getJob(jobId);
        const base = conf("NEXT_PUBLIC_APP_URL");
        await answerCallbackQuery(
          cb.id,
          base
            ? `پنل: ${base}/control/office/${job?.agentId ?? ""}`
            : `کار #${jobId} — ${job?.status || "?"}`,
          true,
        );
        return NextResponse.json({ ok: true, action: "open", job });
      }

      if (code === "pz" && jobId) {
        const job = await getJob(jobId);
        if (job) {
          await db
            .update(agents)
            .set({ status: "paused" })
            .where(eq(agents.id, job.agentId ?? -1));
          await logActivity({
            agentId: job.agentId,
            agentName: job.agentName,
            action: "کارمند از تلگرام متوقف شد",
            status: "success",
            detail: `توسط ${user}`,
            jobId: job.id,
          });
        }
        await answerCallbackQuery(cb.id, "⏸ کارمند متوقف شد");
        return NextResponse.json({ ok: true, action: "pause", job });
      }

      await answerCallbackQuery(cb.id, "دستور ناشناخته");
      return NextResponse.json({ ok: true, action: "unknown", data });
    }

    // ─────────────── ۲) پیام متنی ───────────────
    const msg = update.message || update.edited_message;
    if (!msg) return NextResponse.json({ ok: true, ignored: true });

    const chatId = msg.chat?.id;
    const text = String(msg.text || "").trim();
    const name =
      [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ") ||
      "کاربر تلگرام";
    const username = msg.from?.username ? `@${msg.from.username}` : "";

    if (isAdminChat(chatId)) {
      const handled = text.startsWith("/")
        ? await handleAdminCommand(text, chatId)
        : false;
      await db.insert(agentActivityLogs).values({
        agentName: "مدیرعامل (تلگرام)",
        action: handled ? "دستور متنی اجرا شد" : "پیام مدیرعامل ثبت شد",
        status: "success",
        detail: text.slice(0, 300),
        source: "telegram",
      });
      if (!handled && text) {
        await sendTelegramMessage(
          chatId,
          "پیام شما ثبت شد. برای دیدن دستورها /help را بزنید.",
        );
      }
      return NextResponse.json({ ok: true, admin: true, handled });
    }

    // پیام از مشتری واقعی → ثبت در دیتابیس + ساخت تسک پیشنهادی (نیازمند تأیید)
    const [saved] = await db
      .insert(messages)
      .values({
        chatId: String(chatId ?? ""),
        clientName: name,
        username,
        direction: "in",
        text: text || "(پیام غیرمتنی)",
        status: "unread",
        source: "telegram",
      })
      .returning();

    const [task] = await db
      .insert(tasks)
      .values({
        title: `پاسخ به ${name}`,
        agent: "ایجنت فروش و مذاکره تلگرام",
        actionType: "send_message",
        description: text.slice(0, 500),
        projectTitle: `گفتگوی تلگرام ${username}`,
        status: "pending",
        risk: "medium",
        payload: `chat_id=${chatId}\nپاسخ پیشنهادی توسط ایجنت فروش و نیازمند تأیید مدیرعامل است.`,
      })
      .returning();

    await logActivity({
      agentName: "ایجنت فروش و مذاکره تلگرام",
      action: "پیام مشتری دریافت شد و تسک پاسخ ساخته شد",
      status: "pending",
      detail: `${username || name}: ${text.slice(0, 120)}`,
      meta: { chatId, taskId: task.id, messageId: saved.id },
    });

    const adminChat = ENV.telegramAdminChat();
    if (adminChat) {
      await sendTelegramMessage(
        adminChat,
        `📩 <b>پیام جدید مشتری</b>\n👤 ${escapeHtml(name)} ${escapeHtml(username)}\n` +
          `💬 ${escapeHtml(text || "(غیرمتنی)")}\n\n` +
          `تسک #${task.id} برای پاسخ ساخته شد (نیازمند تأیید).`,
        {
          inline_keyboard: [
            [{ text: "📊 مشاهده در پنل", callback_data: `op:${task.id}` }],
          ],
        },
      );
    }

    // پاسخ خودکار فقط «دریافت شد» است؛ محتوای تجاری بدون تأیید ارسال نمی‌شود.
    await sendTelegramMessage(
      chatId,
      "پیام شما دریافت شد ✅ کارشناس ما به‌زودی پاسخ می‌دهد.",
    );

    return NextResponse.json({ ok: true, message: saved, task });
  } catch (e: any) {
    const detail =
      e instanceof ConfigError
        ? `${e.message} (${e.missing.join(", ")})`
        : e?.message || String(e);
    await db
      .insert(systemEvents)
      .values({
        level: "error",
        scope: "telegram:webhook",
        message: detail,
        meta: { updateId },
      })
      .catch(() => {});
    return NextResponse.json({ ok: false, error: detail }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const denied = guardAdmin(req);
  if (denied) return denied;
  const info = telegramConfigured() ? await getWebhookInfo() : null;
  return NextResponse.json({
    ok: true,
    configured: telegramConfigured(),
    mode: telegramConfigured() ? "live_telegram_api" : "not_configured",
    adminChatConfigured: Boolean(ENV.telegramAdminChat()),
    secretConfigured: Boolean(ENV.telegramSecret()),
    webhook:
      info && info.ok
        ? (info as any).result
        : ((info as any)?.description ?? null),
    callbacks: ["ap:<jobId>", "rj:<jobId>", "op:<jobId>", "pz:<jobId>"],
  });
}
