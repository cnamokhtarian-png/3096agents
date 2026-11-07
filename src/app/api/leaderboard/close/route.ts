import { NextRequest, NextResponse } from "next/server";
import { ensureSeed } from "@/lib/seed";
import { closeMonth } from "@/lib/leaderboard";

export const dynamic = "force-dynamic";

/** GET /api/leaderboard/close?period=... → پیش‌نمایش پیام تلگرام بدون هیچ تغییری */
export async function GET(req: NextRequest) {
  try {
    await ensureSeed();
    const period = new URL(req.url).searchParams.get("period");
    const result = await closeMonth(period, { dryRun: true });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "خطا در پیش‌نمایش" },
      { status: 400 }
    );
  }
}

/**
 * POST /api/leaderboard/close
 * { period?: 'YYYY-MM', dryRun?: boolean, force?: boolean }
 * برندهٔ ماه را ذخیره، پاداش دورهٔ بعد را فعال و گزارش را به تلگرام می‌فرستد.
 */
export async function POST(req: NextRequest) {
  try {
    await ensureSeed();
    const b = await req.json().catch(() => ({}));
    const result = await closeMonth(b.period, {
      dryRun: Boolean(b.dryRun),
      force: Boolean(b.force),
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "خطا در اعلام برنده" },
      { status: 400 }
    );
  }
}

/** GET /api/leaderboard (همان مسیر اصلی، اینجا فقط برای سازگاری مستقیم) */
export async function OPTIONS() {
  return NextResponse.json({
    endpoints: [
      "GET  /api/leaderboard?period=YYYY-MM",
      "PUT  /api/leaderboard  { weightSuccess, weightRevenue, weightSpeed, revenueTarget, durationTarget, boostMultiplier }",
      "POST /api/leaderboard/events  { agentId, outcome, projectTitle, durationMinutes, note }",
      "DELETE /api/leaderboard/events?id=.. | ?source=seed",
      "GET  /api/leaderboard/close?period=YYYY-MM  (پیش‌نمایش)",
      "POST /api/leaderboard/close { period, dryRun, force }",
      "GET  /api/leaderboard/cron  (Vercel Cron، نیازمند CRON_SECRET)",
    ],
  });
}
