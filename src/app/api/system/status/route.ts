import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { sql, desc, gte, and, eq } from "drizzle-orm";
import {
  agentJobs,
  agents,
  cronRuns,
  systemEvents,
  transactions,
} from "@/db/schema";
import { auditEnv } from "@/lib/env";
import { testExchangeConnection, exchangeStatus } from "@/lib/exchange";
import { getWebhookInfo, telegramConfigured } from "@/lib/telegram";
import { currentUser, guardAdmin } from "@/lib/auth";
import { ensureSeed } from "@/lib/seed";
import { conf } from "@/lib/config";
import { safeRoute } from "@/lib/api-response";
import { geminiModelPlan } from "@/lib/ai";
import { reportMode } from "@/lib/report-schedule";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * صفحه/اندپوینت دیباگ واقعی:
 *  • چک‌لیست Environment Variables (فقط حضور، نه مقدار)
 *  • اتصال دیتابیس و وجود جدول‌ها
 *  • تست واقعی اتصال صرافی و وبهوک تلگرام
 *  • آخرین اجرای کرون + خطاهای واقعی سیستم
 */
export async function GET(req: NextRequest) {
  return safeRoute(
    async () => {
      const denied = guardAdmin(req);
      if (denied) return denied;
      const url = new URL(req.url);
      const test = url.searchParams.get("test") === "1";
      const isAdmin = Boolean(currentUser(req));
      const audit = auditEnv();
      const reportGateMode = await reportMode();

      const dbCheck: Record<string, unknown> = { ok: false };
      try {
        await ensureSeed();
        const ping = await db.execute(sql`select 1 as ok`);
        const tables: any = await db.execute(sql`
      SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'agentos' ORDER BY table_name
    `);
        const names = (tables?.rows ?? []).map((r: any) => r.table_name);
        const required = [
          "agents",
          "transactions",
          "agent_activity_logs",
          "agent_jobs",
          "exchange_orders",
          "market_snapshots",
          "telegram_updates",
          "cron_runs",
          "system_events",
        ];
        dbCheck.ok = Boolean((ping as any)?.rows?.[0]?.ok);
        dbCheck.tables = names;
        dbCheck.missingTables = required.filter((t) => !names.includes(t));
      } catch (e: any) {
        dbCheck.ok = false;
        dbCheck.error = e?.message || String(e);
      }

      // اگر دیتابیس در دسترس نبود، به‌جای crash کردن route، وضعیت خالی
      // برمی‌گردانیم تا داشبورد مدیر همچنان قابل استفاده بماند.
      const emptyCounts = [
        [] as any[],
        [] as any[],
        [{ n: 0 }],
        [{ n: 0 }],
        [] as any[],
        [] as any[],
      ];
      let crons: any[] = [];
      let errors24h: any[] = [];
      let pendingApprovals: any[] = [{ n: 0 }];
      let unverified: any[] = [{ n: 0 }];
      let lastCron: any[] = [];
      let agentRows: any[] = [];
      try {
        const rows = await Promise.all([
          db.select().from(cronRuns).orderBy(desc(cronRuns.id)).limit(5),
          db
            .select()
            .from(systemEvents)
            .where(
              and(
                eq(systemEvents.level, "error"),
                gte(systemEvents.createdAt, new Date(Date.now() - 86400_000)),
              ),
            )
            .orderBy(desc(systemEvents.createdAt))
            .limit(20),
          db
            .select({ n: sql<number>`COUNT(*)` })
            .from(agentJobs)
            .where(eq(agentJobs.status, "awaiting_approval")),
          db
            .select({ n: sql<number>`COUNT(*)` })
            .from(transactions)
            .where(eq(transactions.status, "pending_verification")),
          db.select().from(cronRuns).orderBy(desc(cronRuns.id)).limit(1),
          db.select().from(agents),
        ]);
        [crons, errors24h, pendingApprovals, unverified, lastCron, agentRows] =
          rows as any;
        void emptyCounts;
      } catch (e: any) {
        dbCheck.ok = false;
        dbCheck.error = dbCheck.error || e?.message || String(e);
      }

      const webhook = telegramConfigured()
        ? await getWebhookInfo()
        : {
            ok: false as const,
            error: "not_configured",
            description: "TELEGRAM_BOT_TOKEN ست نشده",
          };

      const exchangeTest =
        test && isAdmin ? await testExchangeConnection() : null;

      return NextResponse.json({
        ok: Boolean(dbCheck.ok) && audit.missingRequired.length === 0,
        env: audit,
        database: dbCheck,
        exchange: { ...(await exchangeStatus()), test: exchangeTest },
        ai: {
          configured: Boolean(conf("GEMINI_API_KEY")),
          plan: await geminiModelPlan(),
          note: "مدل‌های 1.5/2.0/2.5 Flash بازنشسته شده‌اند و 404 می‌دهند؛ این‌ها هرگز استفاده نمی‌شوند.",
        },
        telegram: {
          configured: telegramConfigured(),
          webhook: (webhook as any).ok
            ? (webhook as any).result
            : (webhook as any).description,
        },
        cron: {
          last: lastCron[0] ?? null,
          recent: crons,
          secretConfigured: Boolean(conf("CRON_SECRET")),
          schedule: "روزانه job=full (ضربان پشتیبان) — گزارش دوره‌ای خاموش است",
          reports: {
            mode: reportGateMode,
            periodicEnabled: reportGateMode === "auto",
            note:
              "حالت پیش‌فرض «دستی» است: گزارش فقط با درخواست مدیرعامل (پنل یا /reports now) ارسال می‌شود.",
          },
        },
        queue: {
          pendingApprovals: Number(pendingApprovals[0]?.n || 0),
          unverifiedDeposits: Number(unverified[0]?.n || 0),
        },
        agents: agentRows.map((a) => ({
          id: a.id,
          name: a.name,
          status: a.status,
          earnedUsdt: Number(a.earnedUsdt),
          successCount: a.successCount,
          errorCount: a.errorCount,
          lastActiveAt: a.lastActiveAt,
        })),
        errors24h,
        checkedAt: new Date().toISOString(),
      });
    },
    {
      logLabel: "system/status#GET",
      exposeDetail: process.env.NODE_ENV !== "production",
    },
  );
}
