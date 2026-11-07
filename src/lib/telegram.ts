import { ConfigError, ENV } from "@/lib/env";
import { db } from "@/db";
import { systemEvents } from "@/db/schema";
import { conf } from "@/lib/config";

/**
 * کلاینت واقعی Bot API تلگرام.
 * هیچ پیامی در دیتابیس «شبیه‌سازی» نمی‌شود: اگر توکن ست نشده باشد خطای
 * پیکربندی برمی‌گردد و در system_events به‌عنوان خطای واقعی ثبت می‌شود.
 */

const API = (conf("TELEGRAM_API_BASE") || "https://api.telegram.org").replace(/\/$/, "");

export type InlineButton = { text: string; callback_data: string; url?: string };
export type ReplyMarkup = { inline_keyboard: InlineButton[][] };

export type TgResult<T = any> =
  | { ok: true; result: T }
  | { ok: false; error: string; description?: string; status?: number };

export function telegramConfigured() {
  return Boolean(ENV.telegramToken());
}

async function logFailure(scope: string, message: string, meta: Record<string, unknown> = {}) {
  try {
    await db.insert(systemEvents).values({ level: "error", scope, message, meta });
  } catch {
    // اگر خود دیتابیس هم در دسترس نبود، حداقل در لاگ سرور باقی می‌ماند
    console.error(`[${scope}] ${message}`, meta);
  }
}

export async function tg<T = any>(
  method: string,
  payload: Record<string, unknown> = {},
  opts: { timeoutMs?: number } = {}
): Promise<TgResult<T>> {
  const token = ENV.telegramToken();
  if (!token) {
    return {
      ok: false,
      error: "not_configured",
      description: "TELEGRAM_BOT_TOKEN ست نشده است؛ ارسال واقعی امکان‌پذیر نیست.",
    };
  }
  try {
    const res = await fetch(`${API}/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(opts.timeoutMs ?? 8000),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok || json?.ok === false) {
      const desc = json?.description || `HTTP ${res.status}`;
      await logFailure(`telegram:${method}`, desc, { status: res.status });
      return { ok: false, error: "telegram_error", description: desc, status: res.status };
    }
    return { ok: true, result: json.result };
  } catch (e: any) {
    const desc = e?.name === "TimeoutError" ? "timeout" : e?.message || "network_error";
    await logFailure(`telegram:${method}`, desc, { method });
    return { ok: false, error: "network_error", description: desc };
  }
}

export function escapeHtml(s: string) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export async function sendTelegramMessage(
  chatId: string | number,
  text: string,
  replyMarkup?: ReplyMarkup
) {
  if (!chatId) {
    return { ok: false as const, error: "not_configured", description: "چت‌آیدی خالی است" };
  }
  return tg<any>("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
}

export async function editTelegramMessage(
  chatId: string | number,
  messageId: number,
  text: string,
  replyMarkup?: ReplyMarkup
) {
  return tg<any>("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
}

export async function answerCallbackQuery(callbackQueryId: string, text: string, alert = false) {
  return tg<any>("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text,
    show_alert: alert,
  });
}

export async function getWebhookInfo() {
  return tg<any>("getWebhookInfo");
}

export async function setWebhook(url: string, secret?: string) {
  return tg<any>("setWebhook", {
    url,
    secret_token: secret || undefined,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: false,
  });
}

export async function deleteWebhook() {
  return tg<any>("deleteWebhook", {});
}

export function appBaseUrl(req?: Request) {
  const fromEnv = conf("NEXT_PUBLIC_APP_URL").replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  if (req) {
    const url = new URL(req.url);
    const host = req.headers.get("x-forwarded-host") || url.host;
    const proto = req.headers.get("x-forwarded-proto") || url.protocol.replace(":", "");
    return `${proto}://${host}`;
  }
  return "";
}

/** کیبورد تأیید/رد یک Job واقعی. */
export function jobKeyboard(jobId: number, withEdit = true): ReplyMarkup {
  const row: InlineButton[] = [
    { text: "✅ تأیید و اجرا", callback_data: `ap:${jobId}` },
    { text: "❌ رد", callback_data: `rj:${jobId}` },
  ];
  const second: InlineButton[] = [{ text: "📊 مشاهده در پنل", callback_data: `op:${jobId}` }];
  if (withEdit) second.push({ text: "⏸ توقف کارمند", callback_data: `pz:${jobId}` });
  return { inline_keyboard: [row, second] };
}

/** پیام درخواست تأیید برای مدیرعامل. */
export async function sendJobApprovalRequest(job: {
  id: number;
  agentName: string;
  title: string;
  detail?: string;
  risk?: string;
  kind: string;
}) {
  const chatId = ENV.telegramAdminChat();
  if (!telegramConfigured() || !chatId) {
    return {
      ok: false as const,
      error: "not_configured",
      description: "TELEGRAM_BOT_TOKEN یا TELEGRAM_ADMIN_CHAT_ID ست نشده است.",
    };
  }
  const riskLabel =
    job.risk === "high" ? "🔴 ریسک بالا" : job.risk === "low" ? "🟢 ریسک پایین" : "🟡 ریسک متوسط";
  const text =
    `🔔 <b>درخواست تأیید جدید</b> #${job.id}\n` +
    `👤 کارمند: <b>${escapeHtml(job.agentName)}</b>\n` +
    `📋 اقدام: <b>${escapeHtml(job.title)}</b>\n` +
    `${riskLabel} • نوع: <code>${escapeHtml(job.kind)}</code>\n` +
    (job.detail ? `\n${escapeHtml(job.detail)}\n` : "") +
    `\nبا تأیید، دستور همین حالا در دیتابیس و صرافی اجرا می‌شود.`;
  const res = await sendTelegramMessage(chatId, text, jobKeyboard(job.id));
  return res;
}

export async function notifyAdmin(text: string, keyboard?: ReplyMarkup) {
  const chatId = ENV.telegramAdminChat();
  if (!chatId) {
    return { ok: false as const, error: "not_configured", description: "TELEGRAM_ADMIN_CHAT_ID خالی است" };
  }
  return sendTelegramMessage(chatId, text, keyboard);
}

export function assertTelegramConfigured() {
  const missing: string[] = [];
  if (!ENV.telegramToken()) missing.push("TELEGRAM_BOT_TOKEN");
  if (!ENV.telegramAdminChat()) missing.push("TELEGRAM_ADMIN_CHAT_ID");
  if (missing.length) {
    throw new ConfigError(
      "ربات تلگرام پیکربندی نشده است. کلیدهای لازم را در Vercel Environment Variables ست کنید.",
      missing,
      "telegram_not_configured"
    );
  }
}
