/** The entry-only executor cannot fulfill a protected trade yet. */
export function protectedTradeBlocker() {
  return {
    code: "protected_trade_unavailable",
    label: "ثبت و پیگیری خودکار حد سود و ضرر هنوز پیاده‌سازی نشده است",
    missing: [] as string[],
    action: "تا تکمیل و آزمایش خروج خودکار، تأیید این معامله سفارش واقعی ارسال نمی‌کند.",
  };
}
