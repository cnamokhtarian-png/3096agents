/**
 * scripts/agent-poll.ts
 * ----------------------
 * لوپ سبک و ۲۴ ساعته برای «بررسی تسک‌ها و فعالیت ایجنت‌ها» (بدون داده-network/مock).
 *
 * قوانین رعایت شده در این فایل:
 *   ۱. هیچ عدد یا مقدار نمایشی-شبیه‌سازی (Mock) تولید نمی‌شود.
 *      اگر صف/دیتابیس خالی باشد، همه‌ی شمارنده‌ها ۰ هستند (مقدار واقعی از دیتابیس).
 *   ۲. هر POLL_INTERVAL_MINUTES دقیقه (پیش‌فرض ۵) جدول agentJobs را چک می‌کند.
 *   ۳. فقط تسک‌های واقعی (status='queued' و نیازی به تأیید ندارند) کارت آن‌ها به تلگرام می‌رود.
 *      اگر تسکی نهی، هیچ پیامی ارسال نمی‌شود و فقط noop در کنسول ثبت می‌شود.
 *
 * اجرا:
 *   npm run poll:tasks          # لوپ مداوم (Ctrl+C برای متوقف کردن)
 *   POLL_ONCE=1 npm run poll:tasks  # یک چکر یک‌باره (مناسب برای تست/کرون خارجی)
 */

import dotenv from "dotenv";
dotenv.config();

import { db } from "../src/db";
import { agentJobs, agents, settings, cronRuns, systemEvents } from "../src/db/schema";
import { and, eq, gt, asc, sql } from "drizzle-orm";
import { notifyAdmin, escapeHtml } from "../src/lib/telegram";

const POLL_SETTING_KEY = "agent_poll_last_job_id"; // نشانه-place (watermark) در جدول settings
const DEFAULT_INTERVAL_MIN = 5;
const BATCH_LIMIT = 10;

const once = process.argv.includes("--once") || process.env.POLL_ONCE === "1";
const intervalMs = (Number(process.env.POLL_INTERVAL_MINUTES) || DEFAULT_INTERVAL_MIN) * 60 * 1000;

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

/** آخرین تسکی که کارت آن به تلگرام رفته (برای عدم ارسال تکرار یک تسک دو بار). */
async function getLastJobId(): Promise<number> {
  const [row] = await db.select().from(settings).where(eq(settings.key, POLL_SETTING_KEY));
  const v = row ? Number(row.value) : 0;
  return Number.isFinite(v) ? v : 0;
}

async function saveLastJobId(id: number): Promise<void> {
  await db
    .insert(settings)
    .values({ key: POLL_SETTING_KEY, value: String(id) })
    .onConflictDoUpdate({ target: settings.key, set: { value: String(id) } });
}

/** تعداد واقعی کارمندان فعال (۰ اگر خالی باشد — نه عددmade-up). */
async function countActiveAgents(): Promise<number> {
  const [{ cnt }] = await db
    .select({ cnt: sql<number>`count(*)` })
    .from(agents)
    .where(eq(agents.status, "active"));
  return Number(String(cnt ?? 0));
}

async function runCycle(): Promise<{ jobsSent: number; activeAgents: number; error?: string }> {
  const started = Date.now();
  let jobsSent = 0;
  let activeAgents = 0;

  try {
    activeAgents = await countActiveAgents();
    const lastId = await getLastJobId();

    // فقط تسک‌های واقعی آماده اجرا (بدون نیاز به تأیید Human-in-the-Loop)
    const jobs = await db
      .select()
      .from(agentJobs)
      .where(
        and(
          eq(agentJobs.status, "queued"),
          eq(agentJobs.requiresApproval, false),
          gt(agentJobs.id, lastId)
        )
      )
      .orderBy(asc(agentJobs.id))
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

      const res = await notifyAdmin(text);
      if (!res.ok) {
        console.error(
          `[agent-poll] خطای ارسال کارت تسک #${job.id}: ${res.description || res.error}`
        );
        await db
          .insert(systemEvents)
          .values({
            level: "error",
            scope: "agent_poll",
            message: `ارسال کارت تسک #${job.id} به تلگرام ناموفق بود`,
            meta: { jobId: job.id, error: res.error, description: res.description },
          })
          .catch(() => {});
      } else {
        jobsSent++;
        console.log(`[agent-poll] کارت تسک #${job.id} به تلگرام ارسال شد.`);
      }

      if (job.id > maxId) maxId = job.id;
    }

    if (maxId > lastId) await saveLastJobId(maxId);

    await db
      .insert(cronRuns)
      .values({
        job: "agent_poll",
        status: "ok",
        detail: JSON.stringify({ jobsSent, activeAgents, checkedAt: new Date().toISOString() }),
        durationMs: Date.now() - started,
      })
      .catch(() => {});

    return { jobsSent, activeAgents };
  } catch (e: any) {
    const message = e?.message || String(e);
    console.error("[agent-poll] خطای چکر:", message);
    await db
      .insert(systemEvents)
      .values({ level: "error", scope: "agent_poll", message, meta: {} })
      .catch(() => {});
    await db
      .insert(cronRuns)
      .values({ job: "agent_poll", status: "error", detail: message.slice(0, 2000), durationMs: Date.now() - started })
      .catch(() => {});
    return { jobsSent: 0, activeAgents: 0, error: message };
  }
}

async function main(): Promise<void> {
  console.log("[agent-poll] شروع لوپ بررسی تسک‌های ایجنت‌ها (بدون Mock)");
  console.log(
    `[agent-poll] فاصله‌ی بررسی: ${intervalMs / 60000} دقیقه | حالت یک‌باره: ${once}`
  );

  await runCycle();
  if (once) {
    process.exit(0);
  }

  while (running) {
    await sleep(intervalMs);
    if (!running) break;
    await runCycle();
  }

  console.log("[agent-poll] loop متوقف شد.");
}

main().catch((e) => {
  console.error("[agent-poll] خطای فنی:", e);
  process.exit(1);
});
