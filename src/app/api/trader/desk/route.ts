import { NextResponse } from "next/server";
import { ensureSeed } from "@/lib/seed";
import { getDeskData } from "@/lib/trader";

export const dynamic = "force-dynamic";

/** GET /api/trader/desk → تمام دادههای میز کار A1 (همزمان پوزیشنها را Mark-to-Market میکند) */
export async function GET() {
  try {
    await ensureSeed();
    return NextResponse.json(await getDeskData());
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "خطای میز کار" },
      { status: 500 }
    );
  }
}
