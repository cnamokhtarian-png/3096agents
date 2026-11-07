import { NextRequest, NextResponse } from "next/server";
import { ensureSeed } from "@/lib/seed";
import { getDepth, parseDepth, exErrorFa } from "@/lib/exchange";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  await ensureSeed();
  const symbol = new URL(req.url).searchParams.get("symbol") || "BTC_IRT";
  try {
    const d = await getDepth(symbol, 5);
    const p = parseDepth(d);
    if (!p) {
      return NextResponse.json({ error: `قیمت ${symbol} خوانده نشد.` }, { status: 502 });
    }
    return NextResponse.json({ ok: true, symbol: symbol.toUpperCase(), ...p });
  } catch (e: any) {
    return NextResponse.json({ error: exErrorFa(e?.message || "UNKNOWN") }, { status: 502 });
  }
}
