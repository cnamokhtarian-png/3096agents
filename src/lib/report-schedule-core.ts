/**
 * منطق خالص «حالت گزارش‌دهی» — بدون دیتابیس، قابل تست.
 *
 * دو حالت وجود دارد:
 *   • manual (پیش‌فرض): هیچ گزارش دوره‌ای/زمان‌بندی‌شده‌ای به تلگرام نمی‌رود؛
 *     گزارش فقط وقتی ارسال می‌شود که مدیرعامل خودش از پنل یا ربات درخواست کند.
 *   • auto: کرون و چرخهٔ ناوگان می‌توانند گزارش دوره‌ای بفرستند.
 *
 * درخواست‌های «در لحظه» (on-demand) همیشه ارسال می‌شوند، حتی در حالت manual؛
 * چون خودِ مدیرعامل آن‌ها را خواسته است.
 */

export const PERIODIC_REPORTS_SETTING_KEY = "periodic_reports_enabled";

export const REPORT_MODES = ["manual", "auto"] as const;
export type ReportMode = (typeof REPORT_MODES)[number];

export type ReportDecisionReason = "manual_mode" | "scheduled" | "on_demand";

/** مقدار ذخیره‌شده در جدول settings → حالت گزارش. پیش‌فرضِ نبودِ مقدار: manual. */
export function reportModeFromSetting(value: string | null | undefined): ReportMode {
  return String(value ?? "").trim().toLowerCase() === "true" ? "auto" : "manual";
}

/** حالت گزارش → مقداری که در جدول settings ذخیره می‌شود. */
export function settingValueForMode(mode: ReportMode): string {
  return mode === "auto" ? "true" : "false";
}

/**
 * تصمیم ارسال:
 *   periodic=true یعنی درخواست از مسیر زمان‌بندی‌شده (کرون/حلقه ناوگان) آمده است.
 *   periodic=false یعنی مدیرعامل دستی درخواست داده و همیشه مجاز است.
 */
export function periodicReportDecision(input: {
  mode: ReportMode;
  periodic: boolean;
}): { send: boolean; reason: ReportDecisionReason } {
  if (!input.periodic) return { send: true, reason: "on_demand" };
  if (input.mode === "auto") return { send: true, reason: "scheduled" };
  return { send: false, reason: "manual_mode" };
}

/** ورودی نامعتبر API → null؛ نام‌های فارسی و انگلیسی هر دو پذیرفته می‌شوند. */
export function normalizeReportMode(input: unknown): ReportMode | null {
  const v = String(input ?? "").trim().toLowerCase();
  if (v === "auto" || v === "automatic" || v === "خودکار" || v === "اتوماتیک") return "auto";
  if (v === "manual" || v === "دستی" || v === "دستی/off" || v === "off") return "manual";
  return null;
}

/** برچسب فارسی حالت گزارش برای پنل و پیام‌های ربات. */
export function reportModeLabel(mode: ReportMode): string {
  return mode === "auto" ? "خودکار" : "دستی";
}
