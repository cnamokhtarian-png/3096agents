import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { tradeSignals } from "@/db/schema";
import { desc } from "drizzle-orm";
import { ensureSeed } from "@/lib/seed";
import { decideSignal, formatSignalMessage } from "@/lib/trader";

export const dynamic = "force-dynamic";

/** GET /api/trader/signals → تاریخچهٔ پیشنهادها */
export async function GET() {
  await ensureSeed();
  const rows = await db
    .select()
    .from(tradeSignals)
    .orderBy(desc(tradeSignals.id))
    .limit(50);
  return NextResponse.json(
    rows.map((r) => ({
      ...r,
      dataSources: JSON.parse(r.dataSources || "[]"),
      message: r.telegramMessage || formatSignalMessage(r),
    }))
  );
}

/** POST /api/trader/signals { id, decision: 'approve'|'reject', by? } → HITL */
export async function POST(req: NextRequest) {
  try {
    await ensureSeed();
    const b = await req.json().catch(() => ({}));
    const id = Number(b.id);
    const decision = String(b.decision || "");
    if (!id || (decision !== "approve" && decision !== "reject")) {
      return NextResponse.json(
        { error: "id و decision (approve|reject) الزامی است" },
        { status: 400 }
      );
    }
    const result = await decideSignal(id, decision, String(b.by || "پنل مدیر"));
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "خطای تأیید پیشنهاد" },
      { status: 500 }
    );
  }
}
