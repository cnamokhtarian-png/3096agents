import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { tradePositions } from "@/db/schema";
import { desc } from "drizzle-orm";
import { ensureSeed } from "@/lib/seed";
import { emergencyClose, syncPositions } from "@/lib/trader";

export const dynamic = "force-dynamic";

/** GET /api/trader/positions → پوزیشنها (همزمان sync میکند) */
export async function GET() {
  await ensureSeed();
  await syncPositions().catch(() => null);
  const rows = await db
    .select()
    .from(tradePositions)
    .orderBy(desc(tradePositions.id))
    .limit(50);
  return NextResponse.json(rows);
}

/** POST /api/trader/positions { id, action: 'close' } → خروج اضطراری */
export async function POST(req: NextRequest) {
  try {
    await ensureSeed();
    const b = await req.json().catch(() => ({}));
    if (b.action !== "close") {
      return NextResponse.json({ error: "action=close الزامی است" }, { status: 400 });
    }
    const result = await emergencyClose(Number(b.id));
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "خطای بستن پوزیشن" },
      { status: 500 }
    );
  }
}
