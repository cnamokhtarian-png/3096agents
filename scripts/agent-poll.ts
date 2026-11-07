/**
 * scripts/agent-poll.ts
 * ----------------------
 * لوپ سبک و ۲۴ ساعته برای «بررسی تسک‌ها و فعالیت ایجنت‌ها» (بدون داده الشبیه‌سازی/مock).
 *
 * قوانینRegistro شده در درخواست:
 *   ۱. هیچ عدد یا مقدار نمایشی-شبیه‌سازی (Mock) تولید نمی‌شود.
 *      اگر صف/دیتابیس خالی باشد، همه‌ی شمارنده‌ها ۰ هستند (مقدار واقعی از دیتابیس).
 *   ۲. هر POLL_INTERVAL_MINUTES دقیقه (پیش‌فرض ۵) جدول agentJobs را چک می‌کند.
 *   ۳. فقط تسک‌های واقعی (status='queued' و نیازی به تأیید ندارند) کارت آن‌ها به تلگرام می‌رود.
 *      اگر تسکی نهی، هیچ پیامی ارسال نمی‌شود و فقط noop در کنسول ثبت می‌شود.
 *
 * اسکریپت کاملاً Self-Contained است (بدون’import از مسیر @/ و بدون وابستگی به Next.js)
 * تا بتواند به صورت مستقیم با `node --experimental-strip-types` اجرا شود.
 *
 * اجرا:
 *   npm run poll:tasks          # لوپ مداوم (Ctrl+C برای متوقف کردن)
 *   POLL_ONCE=1 npm run poll:tasks  # یک چکر یک‌باره (مناسب برای تست/کرون خارجی)
 */

import dotenv from "dotenv";
dotenv.config();

import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../src/db/schema.ts";
import { eq, gt, asc, and, sql } from "drizzle-orm";

const DATABASE_URL = process.env.DATABASE_URL;
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID;
const POLL_SETTING_KEY = "agent_poll_last_job_id";
const DEFAULT_INTERVAL_MIN = 5;
const BATCH_LIMIT = 10;
const API_BASE = (process.env.TELEGRAM_API_BASE || "https://api.telegram.org").replace(/\/$/, "");

const once = process.argv.includes("--once") || process.env.POLL_ONCE === "1";
const intervalMs = (Number(process.env.POLL_INTERVAL_MINUTES) || DEFAULT_INTERVAL_MIN) * 60 * 1000;

if (!DATABASE_URL) {
  console.error("[agent-poll] DATABASE_URL ست نشده است. تنظیم کنید و دوباره اجرا کنید.");
  process.exit(1);
}

const isLocal = DATABASE_URL.includes("127.0.0.1") || DATABASE_URL.includes("localhost");
let connectionString = DATABASE_URL;
try {
  const u = new URL(DATABASE_URL);
  if (u.searchParams.has("sslmode")) {
    u.searchParams.delete("sslmode");
    connectionString = u.toString();
  }
} catch {}

const pool = new Pool({
  connectionString,
  max: 4,
  idleTimeoutMillis: 20000,
  connectionTimeoutMillis: 10000,
  ssl: !isLocal ? { rejectUnauthorized: false } : undefined,
});

const db = drizzle(pool, { schema });

/** جداول مورد نیاز را در اولین اجرا می‌سازد (idempotent). */
async function queryWithRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  let lastErr: any;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;
      if (i < retries - 1) await sleep(1500);
    }
  }
  throw lastErr;
}

async function ensureTables(): Promise<void> {
  const stmts = [
    `CREATE SCHEMA IF NOT EXISTS agentos`,
    `CREATE TABLE IF NOT EXISTS agentos.settings (id SERIAL PRIMARY KEY, key TEXT NOT NULL UNIQUE, value TEXT NOT NULL DEFAULT '')`,
    `CREATE TABLE IF NOT EXISTS agentos.cron_runs (id SERIAL PRIMARY KEY, job TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'ok', detail TEXT NOT NULL DEFAULT '', duration_ms INTEGER NOT NULL DEFAULT 0, started_at TIMESTAMPTZ DEFAULT NOW(), finished_at TIMESTAMPTZ)`,
    `CREATE TABLE IF NOT EXISTS agentos.system_events (id BIGSERIAL PRIMARY KEY, level TEXT NOT NULL DEFAULT 'info', scope TEXT NOT NULL DEFAULT 'app', message TEXT NOT NULL, meta JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS agentos.agents (id SERIAL PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, role TEXT NOT NULL DEFAULT 'admin', specialty TEXT NOT NULL DEFAULT 'crypto', avatar TEXT NOT NULL DEFAULT '🤖', status TEXT NOT NULL DEFAULT 'active', api_endpoint TEXT NOT NULL DEFAULT '/api/agents/ingest', api_key TEXT NOT NULL, earned_usdt REAL NOT NULL DEFAULT 0, tasks_completed INTEGER NOT NULL DEFAULT 0, payout_mode TEXT NOT NULL DEFAULT 'auto_unified', strategy TEXT NOT NULL DEFAULT '', department TEXT NOT NULL DEFAULT '', goal_title TEXT NOT NULL DEFAULT '', goal_target_usdt REAL NOT NULL DEFAULT 0, office_floor TEXT NOT NULL DEFAULT '1', office_room TEXT NOT NULL DEFAULT '', current_focus TEXT NOT NULL DEFAULT '', success_count INTEGER NOT NULL DEFAULT 0, error_count INTEGER NOT NULL DEFAULT 0, last_active_at TIMESTAMPTZ, created_at TIMESTAMP DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS agentos.agent_jobs (id SERIAL PRIMARY KEY, agent_id INTEGER, agent_name TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', payload JSONB NOT NULL DEFAULT '{}'::jsonb, status TEXT NOT NULL DEFAULT 'queued', risk TEXT NOT NULL DEFAULT 'medium', requires_approval BOOLEAN NOT NULL DEFAULT TRUE, attempts INTEGER NOT NULL DEFAULT 0, result JSONB, error TEXT NOT NULL DEFAULT '', approved_by TEXT NOT NULL DEFAULT '', approved_at TIMESTAMPTZ, started_at TIMESTAMPTZ, finished_at TIMESTAMPTZ, telegram_message_id BIGINT, created_at TIMESTAMPTZ DEFAULT NOW())`,
  ];
  for (const s of stmts) {
    try {
      await queryWithRetry(() => pool.query(s));
    } catch (e: any) {
      const m = e.message || "";
      if (!m.includes("already exists")) console.log("[agent-poll] جداول:", m.slice(0, 100));
    }
  }
}

let running = true;
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    running = false;
    console.log(`\n[agent-poll] سیگنال ${sig} دریافت شد — پس از چکر جاری loop متوقف می‌شود.`);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function tgSendMessage(text: string): Promise<{ ok: boolean; error?: string; description?: string }> {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
    return { ok: false, error: "not_configured", description: "TELEGRAM_BOT_TOKEN یا TELEGRAM_ADMIN_CHAT_ID ست نشده است" };
  }
  try {
    const res = await fetch(`${API_BASE}/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(8000),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok || json?.ok === false) {
      return { ok: false, error: "telegram_error", description: json?.description || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: "network_error", description: e?.message || String(e) };
  }
}

async function getLastJobId(): Promise<number> {
  const [row] = await db.select().from(schema.settings).where(eq(schema.settings.key, POLL_SETTING_KEY));
  const v = row ? Number(row.value) : 0;
  return Number.isFinite(v) ? v : 0;
}

async function saveLastJobId(id: number): Promise<void> {
  await db
    .insert(schema.settings)
    .values({ key: POLL_SETTING_KEY, value: String(id) })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value: String(id) } });
}

async function countActiveAgents(): Promise<number> {
  const [{ cnt }] = await db
    .select({ cnt: sql<number>`count(*)` })
    .from(schema.agents)
    .where(eq(schema.agents.status, "active"));
  return Number(String(cnt ?? 0));
}

async function insertCronRun(job: string, status: string, detail: string, durationMs: number): Promise<void> {
  await db.insert(schema.cronRuns).values({ job, status, detail, durationMs }).catch(() => {});
}

async function insertSystemEvent(level: string, scope: string, message: string, meta: Record<string, unknown> = {}): Promise<void> {
  await db.insert(schema.systemEvents).values({ level, scope, message, meta }).catch(() => {});
}

async function runCycle(): Promise<{ jobsSent: number; activeAgents: number; error?: string }> {
  const started = Date.now();
  try {
    return await queryWithRetry(async () => {
      let jobsSent = 0;
      let activeAgents = 0;

      activeAgents = await countActiveAgents();
      const lastId = await getLastJobId();

      const jobs = await db
        .select()
        .from(schema.agentJobs)
        .where(
          and(
            eq(schema.agentJobs.status, "queued"),
            eq(schema.agentJobs.requiresApproval, false),
            gt(schema.agentJobs.id, lastId)
          )
        )
        .orderBy(asc(schema.agentJobs.id))
        .limit(BATCH_LIMIT);

      if (jobs.length === 0) {
        console.log(
          `[agent-poll] ${new Date().toISOString()} — تسکی در صف نیست (تعداد تسک جدید: ۰) | کارمندان فعال: ${activeAgents}`
        );
      }

      let maxId = lastId;
      for (const job of jobs) {
        const text =
          `🆕 <b>تسک جدید در صف ایجنت‌ها</b>\n` +
          `🔢 شماره: <code>#${job.id}</code>\n` +
          `👤 کارمند: ${escapeHtml(job.agentName)} (ID: ${job.agentId ?? "—"})\n` +
          `📋 عنوان: ${escapeHtml(job.title)}\n` +
          `🔧 نوع: <code>${escapeHtml(job.kind)}</code> | ریسک: <code>${escapeHtml(job.risk)}</code>\n` +
          `📝 توضیحات: ${escapeHtml(job.detail || "—")}\n` +
          `⏰ ثبت‌شده: ${job.createdAt}\n` +
          `💡 مقدارهای بالا از جدول واقعی agentJobs خوانده شده‌اند؛ هیچmade-up/شبیه‌سازی‌ای در این پیام نیست.`;

        const res = await tgSendMessage(text);
        if (!res.ok) {
          console.error(`[agent-poll] خطای ارسال کارت تسک #${job.id}: ${res.description || res.error}`);
          await insertSystemEvent("error", "agent_poll", `ارسال کارت تسک #${job.id} به تلگرام ناموفق بود`, {
            jobId: job.id,
            error: res.error,
            description: res.description,
          });
        } else {
          jobsSent++;
          console.log(`[agent-poll] کارت تسک #${job.id} به تلگرام ارسال شد.`);
        }

        if (Number(job.id) > maxId) maxId = Number(job.id);
      }

      if (maxId > lastId) await saveLastJobId(maxId);

      await insertCronRun("agent_poll", "ok", JSON.stringify({ jobsSent, activeAgents, checkedAt: new Date().toISOString() }), Date.now() - started);

      return { jobsSent, activeAgents };
    });
  } catch (e: any) {
    const message = e?.message || String(e);
    console.error("[agent-poll] خطای چکر:", message);
    await insertSystemEvent("error", "agent_poll", message, {});
    await insertCronRun("agent_poll", "error", message.slice(0, 2000), Date.now() - started);
    return { jobsSent: 0, activeAgents: 0, error: message };
  }
}

async function main(): Promise<void> {
  console.log("[agent-poll] شروع لوپ بررسی تسک‌های ایجنت‌ها (بدون Mock)");
  console.log(`[agent-poll] فاصله‌ی بررسی: ${intervalMs / 60000} دقیقه | حالت یک‌باره: ${once}`);

  await ensureTables();

  await runCycle();
  if (once) {
    await pool.end();
    process.exit(0);
  }

  while (running) {
    await sleep(intervalMs);
    if (!running) break;
    await runCycle();
  }

  await pool.end();
  console.log("[agent-poll] loop متوقف شد.");
}

main().catch((e) => {
  console.error("[agent-poll] خطای فنی:", e);
  process.exit(1);
});
