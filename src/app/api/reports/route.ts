import { NextRequest, NextResponse } from "next/server";
import { actorOf, guardAdmin } from "@/lib/auth";
import { safeRoute } from "@/lib/api-response";
import { ENV } from "@/lib/env";
import { generateCooExecutiveReport } from "@/lib/coo";
import { sendDailyReports } from "@/lib/jobs";
import { telegramConfigured } from "@/lib/telegram";
import {
  normalizeReportMode,
  reportModeLabel,
  type ReportMode,
} from "@/lib/report-schedule-core";
import { reportMode, setReportMode } from "@/lib/report-schedule";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * مرکز کنترل گزارش‌های تلگرام — «فقط دستی» به‌صورت پیش‌فرض.
 *
 *   GET   /api/reports            → وضعیت حالت گزارش (manual/auto) + راهنما
 *   POST  /api/reports {mode}     → تغییر حالت: "manual" (توقف دوره‌ای) یا "auto"
 *   POST  /api/reports {action}   → گرفتن گزارش در لحظه (همیشه مجاز است):
 *           coo              گزارش جامع اجرایی RNAI (COO)
 *           daily_reports    گزارش وضعیت همهٔ کارمندان
 *           all              هر دو
 *
 * هیچ ارسال خودکاری در حالت manual انجام نمی‌شود؛ درخواست دستی مدیرعامل
 * همیشه ارسال می‌شود، چون خواستهٔ صریح اوست.
 */
export async function GET(req: NextRequest) {
  return safeRoute(
    async () => {
      const denied = guardAdmin(req);
      if (denied) return denied;

      const mode = await reportMode();
      return NextResponse.json({
        ok: true,
        mode,
        modeLabel: reportModeLabel(mode),
        periodicEnabled: mode === "auto",
        telegramConfigured: telegramConfigured(),
        adminChatConfigured: Boolean(ENV.telegramAdminChat()),
        note:
          mode === "manual"
            ? "گزارش دوره‌ای به تلگرام خاموش است. گزارش فقط وقتی ارسال می‌شود که خودتان از پنل یا ربات درخواست کنید."
            : "گزارش دوره‌ای روشن است؛ کرون و چرخهٔ ناوگان می‌توانند گزارش بفرستند.",
        actions: {
          coo: "گزارش جامع اجرایی RNAI (COO)",
          daily_reports: "گزارش وضعیت همهٔ کارمندان",
          all: "هر دو گزارش",
        },
      });
    },
    { logLabel: "reports#GET", exposeDetail: process.env.NODE_ENV !== "production" },
  );
}

export async function POST(req: NextRequest) {
  return safeRoute(
    async () => {
      const denied = guardAdmin(req);
      if (denied) return denied;

      const body = await req.json().catch(() => ({}));

      // ۱) تغییر حالت گزارش‌دهی
      if (body?.mode !== undefined) {
        const mode: ReportMode | null = normalizeReportMode(body.mode);
        if (!mode) {
          return NextResponse.json(
            { ok: false, error: 'حالت نامعتبر است؛ فقط "manual" یا "auto" مجاز است.' },
            { status: 400 },
          );
        }
        const saved = await setReportMode(mode, actorOf(req));
        return NextResponse.json({
          ok: true,
          mode: saved,
          modeLabel: reportModeLabel(saved),
          periodicEnabled: saved === "auto",
          message:
            saved === "manual"
              ? "گزارش دوره‌ای متوقف شد ✅ از این به بعد فقط با درخواست خودتان گزارش ارسال می‌شود."
              : "گزارش دوره‌ای روشن شد ⚠️ کرون و چرخهٔ ناوگان دوباره گزارش خودکار می‌فرستند.",
        });
      }

      // ۲) گرفتن گزارش در لحظه (دستی) — مستقل از حالت، همیشه مجاز است
      const action = String(body?.action || "coo");
      if (!["coo", "daily_reports", "all"].includes(action)) {
        return NextResponse.json(
          {
            ok: false,
            error: `عملیات ناشناخته: ${action}. مجاز: coo | daily_reports | all | mode`,
          },
          { status: 400 },
        );
      }

      if (!telegramConfigured()) {
        return NextResponse.json(
          {
            ok: false,
            error: "TELEGRAM_BOT_TOKEN ست نشده است؛ ارسال واقعی ممکن نیست.",
            code: "telegram_not_configured",
          },
          { status: 503 },
        );
      }

      const useAi = body?.useAi !== false;
      const result: Record<string, unknown> = { ok: true, action };

      if (action === "coo" || action === "all") {
        const coo = await generateCooExecutiveReport({ sendTelegram: true, periodic: false });
        result.coo = {
          ok: coo.ok,
          telegramSent: Boolean(coo.telegram?.ok),
          telegramError: coo.telegram?.ok ? null : coo.telegram?.error ?? null,
          confirmedIncomeUsdt: coo.summary.company.confirmedIncomeUsdt,
        };
      }

      if (action === "daily_reports" || action === "all") {
        const daily = await sendDailyReports({ periodic: false, useAi });
        result.dailyReports = daily;
      }

      const sentAny =
        (result.coo as any)?.telegramSent ||
        Number((result.dailyReports as any)?.sent || 0) > 0;
      const errors = (result.dailyReports as any)?.errors as string[] | undefined;
      if (!sentAny && (errors?.length || (result.coo as any)?.telegramError)) {
        return NextResponse.json({ ...result, ok: false }, { status: 502 });
      }

      return NextResponse.json(result);
    },
    { logLabel: "reports#POST", exposeDetail: process.env.NODE_ENV !== "production" },
  );
}
