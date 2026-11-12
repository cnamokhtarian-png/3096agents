import { db } from "@/db";
import { agentActivityLogs, settings, systemEvents } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import {
  PERIODIC_REPORTS_SETTING_KEY,
  periodicReportDecision,
  reportModeFromSetting,
  settingValueForMode,
  type ReportMode,
} from "@/lib/report-schedule-core";

/**
 * تنظیم واقعی «گزارش دوره‌ای» در جدول settings.
 *
 * چرا؟ گزارش‌های زمان‌بندی‌شده (هر ۳۰ دقیقه در چرخهٔ ناوگان و گزارش روزانهٔ
 * کارمندان) باعث اسپم تلگرام می‌شدند. اکنون پیش‌فرض «دستی» است: هیچ گزارش
 * خودکاری ارسال نمی‌شود و مدیرعامل هر وقت خواست از پنل یا ربات گزارش می‌گیرد.
 *
 * اگر دیتابیس در دسترس نباشد، پیش‌فرض امن (manual) برگردانده می‌شود تا ارسال
 * ناخواسته رخ ندهد.
 */

export async function reportMode(): Promise<ReportMode> {
  try {
    const rows = await db
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, PERIODIC_REPORTS_SETTING_KEY))
      .limit(1);
    return reportModeFromSetting(rows[0]?.value);
  } catch {
    return "manual";
  }
}

export async function periodicReportsEnabled(): Promise<boolean> {
  return (await reportMode()) === "auto";
}

/**
 * مجوز ارسال را بر اساس «دستی/زمان‌بندی‌شده» تعیین می‌کند.
 * periodic=true را فقط مسیرهای کرون/زمان‌بندی‌شده پاس می‌دهند.
 */
export async function allowReportSend(options?: { periodic?: boolean }): Promise<{
  send: boolean;
  mode: ReportMode;
  reason: "manual_mode" | "scheduled" | "on_demand";
}> {
  const periodic = options?.periodic === true;
  const mode = await reportMode();
  return { mode, ...periodicReportDecision({ mode, periodic }) };
}

export async function setReportMode(mode: ReportMode, actor: string): Promise<ReportMode> {
  await db
    .insert(settings)
    .values({ key: PERIODIC_REPORTS_SETTING_KEY, value: settingValueForMode(mode) })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: sql`excluded.value` },
    });

  await db
    .insert(agentActivityLogs)
    .values({
      agentName: "مدیرعامل (پنل)",
      action:
        mode === "auto"
          ? "گزارش دوره‌ای تلگرام روشن شد"
          : "گزارش دوره‌ای تلگرام خاموش شد (فقط دستی)",
      status: "success",
      detail: `actor: ${actor} • ${PERIODIC_REPORTS_SETTING_KEY}=${settingValueForMode(mode)}`,
      source: "reports",
      meta: { mode, actor },
    })
    .catch(() => {});

  await db
    .insert(systemEvents)
    .values({
      level: "info",
      scope: "reports",
      message:
        mode === "auto"
          ? "ارسال گزارش دوره‌ای به تلگرام فعال شد"
          : "ارسال گزارش دوره‌ای به تلگرام متوقف شد؛ گزارش فقط دستی ارسال می‌شود",
      meta: { mode, actor },
    })
    .catch(() => {});

  return mode;
}
