import { NextRequest, NextResponse } from "next/server";
import { ensureSeed } from "@/lib/seed";
import {
  getTraderConfig,
  scanMarket,
  syncPositions,
} from "@/lib/trader";
import { closeMonth, periodKey, shiftPeriod } from "@/lib/leaderboard";

export const dynamic = "force-dynamic";

/**
 * ⏱️ تپش روزانهٔ «کل شرکت» — همان Cron قدیمی `/api/company/tick` که حالا واقعاً
 * کار میکند: پوزیشنهای آریا را بستن/Mark-to-Market میکند، بازار را اسکن میکند
 * و در اول هر ماه «کارمند برتر» دورهٔ قبل را اعلام مینماید.
 * امنیت: Authorization: Bearer <CRON_SECRET> (در صورت تنظیم بودن).
 */
async function run() {
  await ensureSeed();
  const cfg = await getTraderConfig();
  const sync = await syncPositions();
  const scan = cfg.enabled ? await scanMarket({ force: false }) : null;
  let league: any = null;
  if (new Date().getUTCDate() === 1) {
    league = await closeMonth(shiftPeriod(periodKey(), -1)).catch((e) => ({
      ok: false,
      error: String(e),
    }));
  }
  return {
    ok: true,
    company: "Freelance & Crypto Agent OS",
    trader: {
      enabled: cfg.enabled,
      synced: sync.checked,
      autoClosed: sync.closed,
      signalId: scan?.signal?.id ?? null,
      skipped: Boolean(scan?.skipped),
      reason: scan?.reason ?? null,
    },
    leaderboard: league
      ? { ok: league.ok, alreadyAwarded: Boolean(league.alreadyAwarded) }
      : { skipped: "فقط اول هر ماه اجرا میشود" },
    at: new Date().toISOString(),
  };
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await run());
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "company tick error" },
      { status: 500 }
    );
  }
}

export async function POST() {
  try {
    return NextResponse.json(await run());
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "company tick error" },
      { status: 500 }
    );
  }
}
