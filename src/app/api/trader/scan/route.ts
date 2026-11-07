import { NextRequest, NextResponse } from "next/server";
import { ensureSeed } from "@/lib/seed";
import { scanMarket } from "@/lib/trader";

export const dynamic = "force-dynamic";

/** POST /api/trader/scan { force?: boolean } → اسکن بازار و ساخت پیشنهاد معامله */
export async function POST(req: NextRequest) {
  try {
    await ensureSeed();
    const b = await req.json().catch(() => ({}));
    const result = await scanMarket({ force: Boolean(b.force) });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "خطای اسکن بازار" },
      { status: 500 }
    );
  }
}
