/** New exposure is blocked unless the operator explicitly enables the lifecycle. */
export function protectedTradeBlocker() {
  return {
    code: "protected_trade_unavailable",
    label: "چرخه خودکار آریا هنوز فعال نشده است",
    missing: ["TRADE_LIFECYCLE_ENABLED"] as string[],
    action: "پس از اعمال مهاجرت‌ها، آزمون و تنظیم زمان‌بند، TRADE_LIFECYCLE_ENABLED را فعال کنید.",
  };
}
