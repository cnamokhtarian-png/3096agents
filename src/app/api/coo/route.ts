import { NextRequest, NextResponse } from "next/server";
import { guardAdmin } from "@/lib/auth";
import { ENV } from "@/lib/env";
import {
  buildCooExecutiveSummary,
  charterFleetProtocols,
  executeCooStartupDirective,
  FLEET_PROTOCOLS,
  generateCooExecutiveReport,
  runFleetCycle,
} from "@/lib/coo";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isCronAuthorized(req: NextRequest): boolean {
  const expected = ENV.cronSecret();
  if (!expected) return false;
  const auth = (req.headers.get("authorization") || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  const header = (req.headers.get("x-cron-secret") || "").trim();
  return auth === expected || header === expected;
}

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    const denied = await guardAdmin(req);
    if (denied) return denied;
  }

  try {
    const summary = await buildCooExecutiveSummary();
    return NextResponse.json({
      ok: true,
      summary,
      protocols: FLEET_PROTOCOLS,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "خطا در محاسبه گزارش اجرایی COO" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    const denied = await guardAdmin(req);
    if (denied) return denied;
  }

  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "startup_directive");

  try {
    if (action === "startup_directive") {
      const res = await executeCooStartupDirective({
        sendTelegramReport: body.sendTelegram !== false,
      });
      return NextResponse.json(res);
    }

    if (action === "run_cycle") {
      const res = await runFleetCycle({
        charterFirst: Boolean(body.charterFirst),
        forceAriaCard: Boolean(body.forceAriaCard),
        maxSpecialistProposals:
          body.maxSpecialistProposals !== undefined
            ? Number(body.maxSpecialistProposals)
            : 1,
      });
      const summary = await buildCooExecutiveSummary();
      return NextResponse.json({ ok: true, cycle: res, summary });
    }

    if (action === "executive_report") {
      const res = await generateCooExecutiveReport({
        sendTelegram: body.sendTelegram !== false,
      });
      return NextResponse.json(res);
    }

    if (action === "charter_only") {
      const res = await charterFleetProtocols({ logEachAgent: true });
      return NextResponse.json(res);
    }

    return NextResponse.json(
      { ok: false, error: `عملیات ناشناخته: ${action}` },
      { status: 400 },
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "خطا در اجرای فرمان RNAI (COO)" },
      { status: 500 },
    );
  }
}
