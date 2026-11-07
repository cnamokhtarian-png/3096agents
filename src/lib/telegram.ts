/**
 * ارسال پیام به ربات تلگرام (مشترک بین Webhook، لیگ کارمندان و Cron)
 * اگر توکن یا چت آیدی تنظیم نشده باشد، پیام شبیه‌سازی می‌شود و خطایی ایجاد نمی‌کند.
 */

export type TelegramSendResult = {
  sent: boolean;
  status?: number;
  reason?: string;
};

export function getTelegramChatId(): string {
  return (
    process.env.TELEGRAM_ADMIN_CHAT_ID ||
    process.env.TELEGRAM_CHAT_ID ||
    ""
  );
}

export async function sendTelegramMessage(
  chatId: string | number,
  text: string,
  replyMarkup?: unknown
): Promise<TelegramSendResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatId) {
    return { sent: false, reason: "no_token_or_chat" };
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        reply_markup: replyMarkup,
      }),
    });
    const body: any = await res.json().catch(() => null);
    return {
      sent: res.ok && body?.ok !== false,
      status: res.status,
      reason: body?.description,
    };
  } catch {
    return { sent: false, reason: "network_error" };
  }
}
