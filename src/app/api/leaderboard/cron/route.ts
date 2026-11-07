import { NextRequest, NextResponse } from "next/server";
import { ensureSeed } from "@/lib/seed";
import { closeMonth, periodKey, shiftPeriod } from "@/lib/leaderboard";

export const dynamic = "force-dynamic";

/**
 * Vercel Cron — اول هر ماه ساعت ۰۰:۰۰ UTC، برندهٔ ماه قبل را اعلام میکند.
 * امنیت: هدر Authorization: Bearer <CRON_SECRET> (Vercel بهصورت خودکار میفرستد).
 * Idempotent: اگر جایزهٔ آن دوره قبلاً صادر شده باشد، پیام دوبارهای ارسال نمیشود.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET تنظیم نشده است" },
      { status: 503 }
    );
  }
  const auth = req.headers.get("authorization") || "";
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    await ensureSeed();
    const period = shiftPeriod(periodKey(), -1);
    const result = await closeMonth(period);
    return NextResponse.json({ cron: "agent-leaderboard-monthly", ...result });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "cron error" },
      { status: 500 }
    );
  }
}
