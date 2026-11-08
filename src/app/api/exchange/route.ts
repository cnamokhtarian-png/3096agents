import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { settings, agentActivityLogs, systemEvents } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ensureSeed } from "@/lib/seed";
import { actorOf, guardAdmin } from "@/lib/auth";
import {
  exchangeStatus,
  resolveExchangeConfig,
  testExchangeConnection,
} from "@/lib/exchange";
import { safeRoute } from "@/lib/api-response";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * تنظیمات واقعی صرافی از داخل پنل.
 *
 * چرا لازم بود؟
 * کلیدهای صرافی فقط از Environment Variables خوانده می‌شدند؛ اگر کاربر
 * نمی‌توانست (یا نمی‌خواست) Vercel را تغییر دهد، هیچ راهی برای «روشن کردن
 * کلید صرافی» از داخل پنل نبود و همه کارهای معاملاتی قفل می‌ماندند.
 *
 * این اندپوینت کلیدها را در جدول settings (پرونده‌ی پایدار، نه در گیت)
 * ذخیره می‌کند و همان موتوری که سفارش را ارسال می‌کند، از همان‌جا می‌خواند.
 * مقدار کلیدها هرگز برنمی‌گردد؛ فقط ۴ کاراکتر آخر برای تأیید چشمی.
 */

function mask(v: string): string {
  if (!v) return "";
  if (v.length <= 6) return "••••";
  return `${"•".repeat(Math.min(12, v.length - 4))}${v.slice(-4)}`;
}

async function upsert(key: string, value: string) {
  const existing = await db.select().from(settings).where(eq(settings.key, key));
  if (existing.length > 0) {
    await db.update(settings).set({ value }).where(eq(settings.key, key));
  } else {
    await db.insert(settings).values({ key, value });
  }
}

export async function GET(req: NextRequest) {
  return safeRoute(
    async () => {
      const denied = guardAdmin(req);
      if (denied) return denied;
      await ensureSeed();
      const [status, cfg] = await Promise.all([
        exchangeStatus(),
        resolveExchangeConfig(),
      ]);
      return NextResponse.json({
        ok: true,
        status,
        keys: {
          apiKeyPreview: mask(cfg.apiKey),
          apiSecretPreview: mask(cfg.apiSecret),
          apiKeySource: cfg.apiKeySource,
          apiSecretSource: cfg.apiSecretSource,
          tradingFlagSource: cfg.tradingFlagSource,
          exchangeName: cfg.exchangeName,
          testnet: cfg.testnet,
          tradingEnabled: cfg.tradingEnabled,
        },
        // راهنمای دقیق «چطور کار واقعی راه بیفتد»
        howToStart: [
          "۱. کلید API صرافی (فقط دسترسی Spot Trade — بدون دسترسی برداشت) را اینجا ذخیره کنید.",
          "۲. روشن کردن AGENT_TRADING_ENABLED لازم است تا دکمه تأیید سفارش واقعی بفرستد.",
          "۳. هر سفارش باید توسط شما در پنل یا تلگرام تأیید شود (قفل HITL).",
          "۴. درآمد فقط با هش تراکنش واقعی/تأیید شما در کیف پول واحد ثبت می‌شود.",
        ],
      });
    },
    { logLabel: "exchange#GET", exposeDetail: process.env.NODE_ENV !== "production" },
  );
}

export async function PUT(req: NextRequest) {
  return safeRoute(
    async () => {
      const denied = guardAdmin(req);
      if (denied) return denied;
      await ensureSeed();
      const b = await req.json().catch(() => ({}));
      const actor = actorOf(req);

      const apiKey = String(b.apiKey || "").trim();
      const apiSecret = String(b.apiSecret || "").trim();
      const tradingEnabled =
        b.tradingEnabled === undefined ? undefined : Boolean(b.tradingEnabled);
      const testnet =
        b.testnet === undefined ? undefined : Boolean(b.testnet);

      if (!apiKey && !apiSecret && tradingEnabled === undefined && testnet === undefined) {
        return NextResponse.json(
          { ok: false, error: "هیچ تغییری ارسال نشد" },
          { status: 400 },
        );
      }

      if ((apiKey && apiKey.length < 20) || (apiSecret && apiSecret.length < 20)) {
        return NextResponse.json(
          {
            ok: false,
            error:
              "کلید/سکرت صرافی معتبر نیست (طول کلید بایننس معمولاً ۶۴ کاراکتر است). مقدار ناقص ذخیره نمی‌شود.",
          },
          { status: 422 },
        );
      }

      // فعال‌سازی معامله واقعی فقط با تأیید صریح مدیرعامل
      if (tradingEnabled === true && b.confirm !== "ENABLE_REAL_TRADING") {
        return NextResponse.json(
          {
            ok: false,
            error:
              "برای فعال‌سازی ارسال سفارش واقعی، تأیید صریح لازم است. پنل این تأیید را با پیام هشدار ارسال می‌کند.",
            requiresConfirm: "ENABLE_REAL_TRADING",
          },
          { status: 428 },
        );
      }

      if (apiKey) await upsert("exchange_api_key", apiKey);
      if (apiSecret) await upsert("exchange_api_secret", apiSecret);
      if (testnet !== undefined)
        await upsert("exchange_testnet", String(testnet));
      if (tradingEnabled !== undefined)
        await upsert("agent_trading_enabled", String(tradingEnabled));

      const cfg = await resolveExchangeConfig();

      if (tradingEnabled !== undefined) {
        await upsert(
          "trading_flag_changed_by",
          `${actor} • ${new Date().toISOString()}`,
        );
      }

      const status = await exchangeStatus();

      await db
        .insert(agentActivityLogs)
        .values({
          agentName: "صرافی و موتور اجرای معاملات",
          action:
            tradingEnabled === undefined
              ? "ذخیره کلیدهای صرافی از پنل"
              : tradingEnabled
              ? "فعال‌سازی ارسال سفارش واقعی (AGENT_TRADING_ENABLED=true)"
              : "قفل کردن ارسال سفارش (AGENT_TRADING_ENABLED=false)",
          status: "success",
          detail: `توسط ${actor} • حالت: ${status.mode} • کلیدها: ${
            status.keysConfigured ? "کامل" : "ناقص"
          } • Testnet: ${cfg.testnet}`,
          source: "panel",
        })
        .catch(() => {});

      await db
        .insert(systemEvents)
        .values({
          level: tradingEnabled ? "warn" : "info",
          scope: "exchange:config",
          message: `پیکربندی صرافی توسط ${actor} به‌روزرسانی شد (mode=${status.mode})`,
          meta: { tradingEnabled: status.tradingEnabled, testnet: cfg.testnet },
        })
        .catch(() => {});

      return NextResponse.json({
        ok: true,
        status,
        keys: {
          apiKeyPreview: mask(cfg.apiKey),
          apiSecretPreview: mask(cfg.apiSecret),
        },
      });
    },
    { logLabel: "exchange#PUT", exposeDetail: process.env.NODE_ENV !== "production" },
  );
}

/** تست اتصال واقعی صرافی با کلیدهای ذخیره‌شده. */
export async function POST(req: NextRequest) {
  return safeRoute(
    async () => {
      const denied = guardAdmin(req);
      if (denied) return denied;
      await ensureSeed();
      const test = await testExchangeConnection();
      const status = await exchangeStatus();
      return NextResponse.json({
        ok: Boolean(test.prices?.length) && Boolean(test.account) && !test.accountError,
        status,
        test,
      });
    },
    { logLabel: "exchange#POST", exposeDetail: process.env.NODE_ENV !== "production" },
  );
}
