import { NextRequest, NextResponse } from "next/server";
import { actorOf, guardAdmin } from "@/lib/auth";
import { ENV } from "@/lib/env";
import { safeRoute } from "@/lib/api-response";
import {
  getLoopState,
  getQueueSnapshot,
  runAutonomousLoop,
  setLoopConfig,
  toggleLoop,
  type LoopConfig,
  type LoopSource,
} from "@/lib/autoloop";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * کنترل و مشاهدهٔ حلقهٔ خودکار ۲۴/۷.
 *
 *  GET    /api/loop        → وضعیت حلقه + عکس صف تأیید به تفکیک کارمند
 *  POST   /api/loop        → اجرای یک تیک کامل  { source?, runEngines?, forceDigest?, maxCards? }
 *  PATCH  /api/loop        → تغییر تنظیمات      { enabled?, intervalMinutes?, ... }
 *  DELETE /api/loop        → توقف اضطراری حلقه  (enabled=false)
 *
 * احراز هویت:
 *   • کوکی نشست مدیرعامل یا هدر x-admin-secret (پنل و اسکریپت‌ها)
 *   • یا سکرت ماشین‌ها (Bearer CRON_SECRET / ?secret=) برای GitHub Actions
 *     — دقیقاً مثل /api/cron/tick
 */

function machineAuthorized(req: NextRequest) {
  const secret = ENV.cronSecret();
  if (!secret) return false;
  const bearer = (req.headers.get("authorization") || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  const q = new URL(req.url).searchParams.get("secret") || "";
  const header = (req.headers.get("x-cron-secret") || "").trim();
  return bearer === secret || q === secret || header === secret;
}

function authorized(req: NextRequest) {
  if (machineAuthorized(req)) return null;
  return guardAdmin(req);
}

export async function GET(req: NextRequest) {
  return safeRoute(
    async () => {
      const denied = authorized(req);
      if (denied) return denied;
      const state = await getLoopState();
      const queue = await getQueueSnapshot(state);
      return NextResponse.json(
        {
          ok: true,
          loop: state,
          queue,
          endpoints: {
            tick: "POST /api/loop",
            config: "PATCH /api/loop",
            cron: "GET/POST /api/cron/tick?job=loop",
            schedule: `هر ${state.intervalMinutes} دقیقه (GitHub Actions fleet-loop)`,
          },
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    },
    { logLabel: "api/loop#GET", exposeDetail: process.env.NODE_ENV !== "production" },
  );
}

export async function POST(req: NextRequest) {
  return safeRoute(
    async () => {
      const denied = authorized(req);
      if (denied) return denied;
      const body = await req.json().catch(() => ({}));
      const source: LoopSource =
        machineAuthorized(req) && !body?.source ? "cron" : (String(body?.source || "panel") as LoopSource);

      const result = await runAutonomousLoop({
        source,
        runEngines: body?.runEngines === undefined ? undefined : Boolean(body.runEngines),
        forceDigest: Boolean(body?.forceDigest),
        maxCards: body?.maxCards !== undefined ? Number(body.maxCards) : undefined,
      });

      return NextResponse.json(result);
    },
    { logLabel: "api/loop#POST", exposeDetail: process.env.NODE_ENV !== "production" },
  );
}

export async function PATCH(req: NextRequest) {
  return safeRoute(
    async () => {
      const denied = authorized(req);
      if (denied) return denied;
      const body = await req.json().catch(() => ({}));
      const patch: Partial<LoopConfig> = {};

      if (body?.enabled !== undefined) patch.enabled = Boolean(body.enabled);
      if (body?.intervalMinutes !== undefined)
        patch.intervalMinutes = Number(body.intervalMinutes);
      if (body?.targetPendingTotal !== undefined)
        patch.targetPendingTotal = Number(body.targetPendingTotal);
      if (body?.maxPendingPerAgent !== undefined)
        patch.maxPendingPerAgent = Number(body.maxPendingPerAgent);
      if (body?.maxCardsPerTick !== undefined)
        patch.maxCardsPerTick = Number(body.maxCardsPerTick);
      if (body?.runEnginesEveryTick !== undefined)
        patch.runEnginesEveryTick = Boolean(body.runEnginesEveryTick);
      if (body?.digestEnabled !== undefined) patch.digestEnabled = Boolean(body.digestEnabled);
      if (body?.digestMinMinutes !== undefined)
        patch.digestMinMinutes = Number(body.digestMinMinutes);
      if (body?.cooldownHours !== undefined) patch.cooldownHours = Number(body.cooldownHours);

      if (Object.keys(patch).length === 0) {
        return NextResponse.json(
          {
            ok: false,
            error:
              "هیچ تنظیمی ارسال نشد. کلیدهای مجاز: enabled, intervalMinutes, targetPendingTotal, maxPendingPerAgent, maxCardsPerTick, runEnginesEveryTick, digestEnabled, digestMinMinutes, cooldownHours",
          },
          { status: 400 },
        );
      }

      const state = await setLoopConfig(patch);
      // فعال/غیرفعال‌سازی جداگانه ثبت می‌شود تا در system_events هم دیده شود
      if (patch.enabled !== undefined) {
        await toggleLoop(patch.enabled, actorOf(req));
      }

      return NextResponse.json({ ok: true, loop: await getLoopState(), applied: patch, state });
    },
    { logLabel: "api/loop#PATCH", exposeDetail: process.env.NODE_ENV !== "production" },
  );
}

export async function DELETE(req: NextRequest) {
  return safeRoute(
    async () => {
      const denied = authorized(req);
      if (denied) return denied;
      const state = await toggleLoop(false, actorOf(req));
      return NextResponse.json({ ok: true, loop: state, message: "حلقهٔ خودکار متوقف شد" });
    },
    { logLabel: "api/loop#DELETE", exposeDetail: process.env.NODE_ENV !== "production" },
  );
}
