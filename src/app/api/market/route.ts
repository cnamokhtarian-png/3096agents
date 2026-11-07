import { NextRequest, NextResponse } from "next/server";
import { getMarketOverview, refreshMarket, latestSnapshots } from "@/lib/market";
import { guardAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** قیمت واقعی بازار. هیچ عدد ساختگی برنمی‌گردد. */
export async function GET(req: NextRequest) {
  const force = new URL(req.url).searchParams.get("refresh") === "1";
  if (force) {
    const denied = guardAdmin(req);
    if (denied) return denied;
    const r = await refreshMarket();
    const entries = await latestSnapshots();
    return NextResponse.json(
      { ok: r.ok, market: { available: entries.length > 0, entries, error: r.ok ? null : r.error }, refresh: r },
      { status: r.ok ? 200 : 502 }
    );
  }
  const market = await getMarketOverview();
  return NextResponse.json({ ok: market.available, market });
}

export async function POST(req: NextRequest) {
  const denied = guardAdmin(req);
  if (denied) return denied;
  const r = await refreshMarket();
  return NextResponse.json(r, { status: r.ok ? 200 : 502 });
}
