import { NextRequest, NextResponse } from "next/server";
import { ensureSeed } from "@/lib/seed";
import { getLeaderboardData, saveConfig } from "@/lib/leaderboard";

export const dynamic = "force-dynamic";

/** GET /api/leaderboard?period=YYYY-MM → جدول لیگ، برنده، رویدادها، جوایز، پاداش */
export async function GET(req: NextRequest) {
  try {
    await ensureSeed();
    const period = new URL(req.url).searchParams.get("period");
    const data = await getLeaderboardData(period);
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "خطای لیگ کارمندان" },
      { status: 400 }
    );
  }
}

/** PUT /api/leaderboard → تغییر وزن‌ها و اهداف فرمول امتیازدهی */
export async function PUT(req: NextRequest) {
  try {
    await ensureSeed();
    const b = await req.json().catch(() => ({}));
    const patch: Record<string, number> = {};
    for (const key of [
      "weightSuccess",
      "weightRevenue",
      "weightSpeed",
      "revenueTarget",
      "durationTarget",
      "boostMultiplier",
    ]) {
      if (b[key] !== undefined) patch[key] = Number(b[key]);
    }
    const config = await saveConfig(patch);
    return NextResponse.json({ ok: true, config });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "خطا در ذخیرهٔ تنظیمات" },
      { status: 400 }
    );
  }
}
