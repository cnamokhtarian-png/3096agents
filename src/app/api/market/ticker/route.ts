import { NextResponse } from "next/server";
import { db } from "@/db";
import { settings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ensureSeed } from "@/lib/seed";

export const dynamic = "force-dynamic";

// نوار قیمت زنده: دلار (نوبیتکس) + انس طلا (gold-api) + بیت‌کوین (تبدیل) — کش ۵ دقیقه‌ای
async function getSetting(key: string): Promise<string> {
  const rows: any = await db.select().from(settings).where(eq(settings.key, key));
  return rows[0]?.value || "";
}

async function setSetting(key: string, value: string) {
  await db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } });
}

function staleCache(cachedRaw: string) {
  try {
    return NextResponse.json({ ...JSON.parse(cachedRaw), cached: true, stale: true });
  } catch {
    return NextResponse.json({ ok: false, error: "قیمت گرفته نشد" }, { status: 502 });
  }
}

export async function GET() {
  await ensureSeed();
  const cachedRaw = await getSetting("ticker_cache");
  const at = Number((await getSetting("ticker_at")) || 0);
  if (cachedRaw && Date.now() - at < 5 * 60 * 1000) {
    try {
      return NextResponse.json({ ...JSON.parse(cachedRaw), cached: true });
    } catch {}
  }
  try {
    const [nobi, gold, btc] = await Promise.all([
      fetch("https://apiv2.nobitex.ir/market/stats?srcCurrency=usdt&dstCurrency=rls", {
        signal: AbortSignal.timeout(10000),
      })
        .then((r) => r.json())
        .catch(() => null),
      fetch("https://api.gold-api.com/price/XAU", { signal: AbortSignal.timeout(10000) })
        .then((r) => r.json())
        .catch(() => null),
      import("@/lib/exchange")
        .then((m) => m.getDepth("BTC_IRT").then((d) => m.parseDepth(d)))
        .catch(() => null),
    ]);
    const usdRls = Number(nobi?.stats?.["usdt-rls"]?.latest || 0);
    const usdToman = usdRls > 0 ? Math.round(usdRls / 10) : 0;
    const xauUsd = Number(gold?.price || 0);
    const out: any = {
      ok: true,
      usd_toman: usdToman,
      usd_change: nobi?.stats?.["usdt-rls"]?.dayChange ?? null,
      xau_usd: Math.round(xauUsd * 100) / 100,
      xau_toman: usdToman > 0 && xauUsd > 0 ? Math.round(xauUsd * usdToman) : 0,
      btc_irt: btc ? Math.round((btc as any).mid) : 0,
      at: Date.now(),
    };
    if (usdToman > 0) {
      await setSetting("ticker_cache", JSON.stringify(out));
      await setSetting("ticker_at", String(Date.now()));
      return NextResponse.json({ ...out, cached: false });
    }
    if (cachedRaw) return staleCache(cachedRaw);
    return NextResponse.json({ ok: false, error: "قیمت گرفته نشد" }, { status: 502 });
  } catch {
    if (cachedRaw) return staleCache(cachedRaw);
    return NextResponse.json({ ok: false, error: "قیمت گرفته نشد" }, { status: 502 });
  }
}
