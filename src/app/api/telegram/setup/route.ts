import { NextRequest, NextResponse } from "next/server";
import { guardAdmin } from "@/lib/auth";
import { ENV } from "@/lib/env";
import {
  appBaseUrl,
  deleteWebhook,
  getWebhookInfo,
  setWebhook,
  telegramConfigured,
} from "@/lib/telegram";
import { safeRoute } from "@/lib/api-response";

export const dynamic = "force-dynamic";

/** وضعیت وبهوک واقعی تلگرام. */
export async function GET(req: NextRequest) {
  return safeRoute(
    async () => {
      const denied = guardAdmin(req);
      if (denied) return denied;

      const info = telegramConfigured() ? await getWebhookInfo() : null;
      const expected = `${appBaseUrl(req)}/api/telegram/webhook`;
      return NextResponse.json({
        configured: telegramConfigured(),
        adminChatConfigured: Boolean(ENV.telegramAdminChat()),
        secretConfigured: Boolean(ENV.telegramSecret()),
        expectedUrl: expected,
        telegram:
          info && info.ok
            ? (info as any).result
            : ((info as any)?.description ?? null),
        infoError: info && !info.ok ? (info as any).description : null,
      });
    },
    {
      logLabel: "telegram/setup#GET",
      exposeDetail: process.env.NODE_ENV !== "production",
    },
  );
}

/** ثبت یا حذف وبهوک روی دامنه واقعی. */
export async function POST(req: NextRequest) {
  return safeRoute(
    async () => {
      const denied = guardAdmin(req);
      if (denied) return denied;

      if (!ENV.telegramToken()) {
        return NextResponse.json(
          {
            ok: false,
            error: "TELEGRAM_BOT_TOKEN ست نشده است",
            code: "telegram_not_configured",
          },
          { status: 503 },
        );
      }

      const body = await req.json().catch(() => ({}));
      const action = String(body?.action || "set");

      if (action === "delete") {
        const res = await deleteWebhook();
        return NextResponse.json({ ok: res.ok, result: res });
      }

      const base = String(body?.url || appBaseUrl(req) || "").replace(
        /\/$/,
        "",
      );
      if (!base || !/^https:\/\//.test(base)) {
        return NextResponse.json(
          {
            ok: false,
            error:
              "آدرس وبهوک باید با https شروع شود (NEXT_PUBLIC_APP_URL را ست کنید)",
          },
          { status: 400 },
        );
      }

      const url = `${base}/api/telegram/webhook`;
      const res = await setWebhook(url, ENV.telegramSecret() || undefined);
      return NextResponse.json(
        {
          ok: res.ok,
          url,
          secretConfigured: Boolean(ENV.telegramSecret()),
          telegram: res.ok ? (res as any).result : (res as any).description,
        },
        { status: res.ok ? 200 : 502 },
      );
    },
    {
      logLabel: "telegram/setup#POST",
      exposeDetail: process.env.NODE_ENV !== "production",
    },
  );
}
