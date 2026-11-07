import { NextRequest, NextResponse } from "next/server";
import { ensureSeed, requireAdmin } from "@/lib/seed";
import { runShift } from "@/lib/company";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// شروع شیفت شرکت: مدیر (کوکی) یا کرون ورسل (CRON_SECRET)
function cronOk(req: NextRequest) {
  const s = process.env.CRON_SECRET;
  return !!s && req.headers.get("authorization") === `Bearer ${s}`;
}

async function handle(req: NextRequest) {
  await ensureSeed();
  if (!requireAdmin(req) && !cronOk(req)) {
    return NextResponse.json({ error: "نیاز به ورود مدیر" }, { status: 401 });
  }
  const url = new URL(req.url);
  const agent = url.searchParams.get("agent");
  const reports = await runShift(agent ? Number(agent) : undefined);
  return NextResponse.json({ ok: true, at: new Date().toISOString(), reports });
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
