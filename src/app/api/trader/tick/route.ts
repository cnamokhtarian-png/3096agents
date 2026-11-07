import { NextRequest, NextResponse } from "next/server";
import { ensureSeed } from "@/lib/seed";
import { getTraderConfig, scanMarket, syncPositions } from "@/lib/trader";

export const dynamic = "force-dynamic";

async function runTick() {
  await ensureSeed();
  const cfg = await getTraderConfig();
  const sync = await syncPositions();
  let scan: any = null;
  if (cfg.enabled) scan = await scanMarket({ force: false });
  return {
    ok: true,
    tick: "A1-trader",
    synced: sync.checked,
    autoClosed: sync.closed,
    scan: scan
      ? {
          ok: scan.ok,
          skipped: Boolean(scan.skipped),
          reason: scan.reason,
          signalId: scan.signal?.id,
          alreadyPending: Boolean(scan.alreadyPending),
        }
      : null,
  };
}

/**
 * GET /api/trader/tick — تپش دورهای «کل شرکت» (Vercel Cron، امن با CRON_SECRET)
 *   ۱) پوزیشنهای باز را Mark-to-Market و روی TP/SL/زمان میبندد
 *   ۲) اگر ایجنت فعال و بدون پیشنهاد معلق است، بازار را اسکن و پیام HITL میفرستد
 * تا وقتی پیشنهادی معلق باشد، پیام تکراری ارسال نمیکند.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization") || "";
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
  }
  try {
    return NextResponse.json(await runTick());
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "tick error" },
      { status: 500 }
    );
  }
}

/** POST /api/trader/tick → اجرای دستی همان چرخه از میز کار */
export async function POST() {
  try {
    return NextResponse.json(await runTick());
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "tick error" },
      { status: 500 }
    );
  }
}
