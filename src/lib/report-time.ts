/** کلید روزانه بر اساس ساعت رسمی ایران (Asia/Tehran) تا کرون UTC روز را عوض نکند. */
export function tehranDateKey(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tehran",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function dailyReportKey(agentId: number, chatId: string, now?: Date): string {
  return `daily:${tehranDateKey(now)}:agent:${agentId}:chat:${chatId}`;
}

export function cooReportKey(chatId: string, now?: Date): string {
  return `daily:${tehranDateKey(now)}:coo:chat:${chatId}`;
}

/** شروع روز رسمی ایران برای محاسبه «امروز» در گزارش‌ها. */
export function startOfTehranDay(now: Date = new Date()): Date {
  return new Date(`${tehranDateKey(now)}T00:00:00+03:30`);
}
