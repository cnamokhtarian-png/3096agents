import { NextRequest, NextResponse } from "next/server";
import { actorOf, guardAdmin } from "@/lib/auth";
import { safeRoute } from "@/lib/api-response";
import {
  backfillConfirmedIncome,
  getRewardRules,
  ledgerSummary,
  listRewards,
  moveFunds,
  seedCapital,
  setRewardRules,
} from "@/lib/ledger";
import {
  checkLiveGate,
  gateModeLabel,
  getLiveGate,
  setLiveGate,
  verifyExchangeReadiness,
} from "@/lib/live-gate";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * 📒 دفتر کل و لایهٔ پاداش + 🚦 دروازهٔ معاملهٔ واقعی
 *
 * GET    → وضعیت کامل: سرمایهٔ کاری، ردیف‌های دفتر، پاداش‌ها، قواعد، دروازه
 * POST   → عملیات مدیرعامل:
 *            seed_capital   { amountUsdt, txHash? , insideExchange? }
 *            move_funds     { from, to, amountUsdt, txHash }
 *            set_rules      { profitSharePct, pointsPerUsdt, ... }
 *            set_gate       { riskPctPerTrade, maxOrderUsdt, ... }
 *            halt / resume  { reason? }
 *            backfill       {} → وارد کردن درآمدهای تأییدشدهٔ قبلی به دفتر
 *            verify_keys    {} → تست بی‌خطر کلید صرافی
 */
export async function GET(req: NextRequest) {
  return safeRoute(
    async () => {
      const denied = guardAdmin(req);
      if (denied) return denied;

      const [summary, rewards, rules, gateConfig, gateCheck] = await Promise.all([
        ledgerSummary(),
        listRewards(30),
        getRewardRules(),
        getLiveGate(),
        checkLiveGate(),
      ]);

      return NextResponse.json(
        {
          ok: true,
          summary,
          rewards,
          rules,
          gate: {
            config: gateConfig,
            check: gateCheck,
            modeLabel: gateModeLabel(gateCheck.mode),
          },
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    },
    { logLabel: "ledger#GET", exposeDetail: process.env.NODE_ENV !== "production" },
  );
}

export async function POST(req: NextRequest) {
  return safeRoute(
    async () => {
      const denied = guardAdmin(req);
      if (denied) return denied;
      const body = await req.json().catch(() => ({}));
      const action = String(body.action || "");
      const actor = actorOf(req);

      switch (action) {
        case "seed_capital": {
          const res = await seedCapital({
            amountUsdt: Number(body.amountUsdt),
            txHash: String(body.txHash || ""),
            insideExchange: Boolean(body.insideExchange),
            actor,
            note: body.note ? String(body.note) : undefined,
          });
          return NextResponse.json(res, { status: res.ok ? 200 : 400 });
        }

        case "move_funds": {
          const from = body.from === "exchange" ? "exchange" : "wallet";
          const to = from === "wallet" ? "exchange" : "wallet";
          const res = await moveFunds({
            from,
            to,
            amountUsdt: Number(body.amountUsdt),
            txHash: String(body.txHash || ""),
            actor,
            note: body.note ? String(body.note) : undefined,
          });
          return NextResponse.json(res, { status: res.ok ? 200 : 400 });
        }

        case "set_rules": {
          const rules = await setRewardRules({
            profitSharePct:
              body.profitSharePct === undefined ? undefined : Number(body.profitSharePct),
            pointsPerUsdt:
              body.pointsPerUsdt === undefined ? undefined : Number(body.pointsPerUsdt),
            successPoints:
              body.successPoints === undefined ? undefined : Number(body.successPoints),
            compound: body.compound === undefined ? undefined : Boolean(body.compound),
            maxDailyCompoundPct:
              body.maxDailyCompoundPct === undefined
                ? undefined
                : Number(body.maxDailyCompoundPct),
            minProfitUsdt:
              body.minProfitUsdt === undefined ? undefined : Number(body.minProfitUsdt),
          });
          return NextResponse.json({ ok: true, rules });
        }

        case "set_gate": {
          // تغییر سقف‌ها فقط با تأیید صریح (ضد کلیک اشتباهی)
          if (body.confirm !== "APPLY_LIVE_GATE") {
            return NextResponse.json(
              {
                ok: false,
                error: "برای تغییر سقف‌های معاملهٔ واقعی، تأیید صریح لازم است.",
                requiresConfirm: "APPLY_LIVE_GATE",
              },
              { status: 428 },
            );
          }
          const config = await setLiveGate(
            {
              riskPctPerTrade:
                body.riskPctPerTrade === undefined ? undefined : Number(body.riskPctPerTrade),
              maxOrderUsdt:
                body.maxOrderUsdt === undefined ? undefined : Number(body.maxOrderUsdt),
              maxOrdersPerDay:
                body.maxOrdersPerDay === undefined ? undefined : Number(body.maxOrdersPerDay),
              maxDailyVolumeUsdt:
                body.maxDailyVolumeUsdt === undefined
                  ? undefined
                  : Number(body.maxDailyVolumeUsdt),
              maxDailyLossUsdt:
                body.maxDailyLossUsdt === undefined
                  ? undefined
                  : Number(body.maxDailyLossUsdt),
            },
            actor,
          );
          return NextResponse.json({ ok: true, config, check: await checkLiveGate() });
        }

        case "halt": {
          const config = await setLiveGate(
            { halted: true, haltReason: String(body.reason || "توقف دستی مدیرعامل") },
            actor,
          );
          return NextResponse.json({ ok: true, config });
        }

        case "resume": {
          const config = await setLiveGate({ halted: false, haltReason: "" }, actor);
          return NextResponse.json({ ok: true, config, check: await checkLiveGate() });
        }

        case "backfill": {
          const res = await backfillConfirmedIncome(Number(body.limit || 200));
          return NextResponse.json({ ok: true, ...res, summary: await ledgerSummary() });
        }

        case "verify_keys": {
          const health = await verifyExchangeReadiness(String(body.symbol || "BTCUSDT"));
          return NextResponse.json({ ok: health.ok, health, check: await checkLiveGate() });
        }

        default:
          return NextResponse.json(
            {
              ok: false,
              error:
                "action باید یکی از seed_capital / move_funds / set_rules / set_gate / halt / resume / backfill / verify_keys باشد",
            },
            { status: 400 },
          );
      }
    },
    { logLabel: "ledger#POST", exposeDetail: process.env.NODE_ENV !== "production" },
  );
}
