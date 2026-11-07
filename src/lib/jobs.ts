import { db } from "@/db";
import {
  agents,
  agentActivityLogs,
  agentJobs,
  agentLogs,
  exchangeOrders,
  projects,
  systemEvents,
  tasks,
  toolRuns,
} from "@/db/schema";
import { and, asc, desc, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { ConfigError, ENV } from "@/lib/env";
import { ExchangeError, placeRealOrder } from "@/lib/exchange";
import { confirmDeposit, ingestExternalIncome, recordAgentError } from "@/lib/agent-execution";
import { generateAgentReport } from "@/lib/report";
import {
  editTelegramMessage,
  notifyAdmin,
  sendJobApprovalRequest,
  telegramConfigured,
  escapeHtml,
} from "@/lib/telegram";
import { buildAgentFacts } from "@/lib/report";
import { gatherMissionFacts, type MissionAgent } from "@/lib/missions";
import { generateGeminiText, geminiConfigured } from "@/lib/ai";
import { conf } from "@/lib/config";
import { checkLiveGate } from "@/lib/live-gate";
import { recordConfirmedIncomeInLedger, settleTradeOrder } from "@/lib/ledger";
import {
  approvalVerdict,
  preflightJobKind,
  statusLabel,
  type JobKind,
} from "@/lib/job-preflight";

/**
 * صف کار واقعی ایجنت‌ها.
 * هر کار یا خودکار اجرا می‌شود یا تا تأیید مدیرعامل در تلگرام/پنل می‌ماند.
 * هیچ کاری «شبیه‌سازی» نمی‌شود؛ خطاها عیناً ثبت می‌شوند.
 */

export type { JobKind };

export type JobRecord = typeof agentJobs.$inferSelect;

export type CreateJobInput = {
  agentId: number | null;
  agentName: string;
  kind: JobKind;
  title: string;
  detail?: string;
  payload?: Record<string, unknown>;
  risk?: "low" | "medium" | "high";
  requiresApproval?: boolean;
};

async function logActivity(input: {
  agentId?: number | null;
  agentName: string;
  action: string;
  status?: string;
  detail?: string;
  jobId?: number | null;
  source?: string;
  meta?: Record<string, unknown>;
}) {
  await db
    .insert(agentActivityLogs)
    .values({
      agentId: input.agentId ?? null,
      agentName: input.agentName,
      action: input.action,
      status: input.status ?? "success",
      detail: input.detail ?? "",
      jobId: input.jobId ?? null,
      source: input.source ?? "system",
      meta: input.meta ?? {},
    })
    .catch(() => {});
}

async function legacyLog(agent: string, action: string, status: string, detail: string, durationMs = 0) {
  await db
    .insert(agentLogs)
    .values({ agent, action, status, detail, durationMs: Math.max(0, Math.round(durationMs)) })
    .catch(() => {});
}

export async function createJob(input: CreateJobInput) {
  const requiresApproval = input.requiresApproval !== false;

  // پیش‌بررسی: اگر کار از همین ابتدا آماده اجرای واقعی نیست، مشکل
  // صریح در کار و کارت تأیید نوشته می‌شود تا مدیرعامل بداند چرا دکمه
  // تأیید کار نمی‌کند (به‌جای گیر کردن کار در وضعیت failed).
  const preflight = await preflightJobKind(
    input.kind,
    (input.payload || {}) as Record<string, any>,
  );
  const blockerNote = preflight.ready
    ? ""
    : [
        "⛔ این کار هنوز آماده اجرای واقعی نیست:",
        ...preflight.blockers.map((b) => `• ${b.label}`),
        ...preflight.blockers.map((b) => `   ↳ ${b.action}`),
      ].join("\n");

  const detail = [input.detail ?? "", blockerNote].filter(Boolean).join("\n\n");

  const [job] = await db
    .insert(agentJobs)
    .values({
      agentId: input.agentId,
      agentName: input.agentName,
      kind: input.kind,
      title: input.title,
      detail,
      payload: input.payload ?? {},
      status: requiresApproval ? "awaiting_approval" : preflight.ready ? "queued" : "needs_config",
      risk: input.risk ?? "medium",
      requiresApproval,
      error: preflight.ready ? "" : preflight.reason,
    })
    .returning();

  await logActivity({
    agentId: input.agentId,
    agentName: input.agentName,
    action: preflight.ready
      ? requiresApproval
        ? "درخواست کار ثبت شد (منتظر تأیید مدیرعامل)"
        : "کار در صف اجرا قرار گرفت"
      : "کار ثبت شد اما نیازمند تنظیمات است (اجرا نمی‌شود)",
    status: preflight.ready ? "pending" : "blocked",
    detail: preflight.ready ? input.title : `${input.title} • ${preflight.reason}`,
    jobId: job.id,
    source: "panel",
    meta: preflight.ready ? undefined : { blockers: preflight.blockers },
  });

  let telegram:
    | { ok: true; messageId?: number }
    | { ok: false; error: string; description?: string } = { ok: false, error: "skipped" };

  if (requiresApproval) {
    if (!telegramConfigured() || !ENV.telegramAdminChat()) {
      telegram = {
        ok: false,
        error: "not_configured",
        description: "توکن/چت‌آیدی تلگرام ست نشده؛ تأیید از پنل انجام شود.",
      };
      await db
        .insert(systemEvents)
        .values({
          level: "warn",
          scope: "jobs",
          message: `درخواست تأیید #${job.id} بدون تلگرام ساخته شد`,
          meta: { jobId: job.id, reason: "telegram_not_configured" },
        })
        .catch(() => {});
    } else {
      const res = await sendJobApprovalRequest({
        id: job.id,
        agentName: job.agentName,
        title: job.title,
        detail: job.detail,
        risk: job.risk,
        kind: job.kind,
        payload: (job.payload || {}) as Record<string, unknown>,
      });
      if (res.ok) {
        const messageId = (res as any).result?.message_id;
        if (messageId) {
          const [updated] = await db
            .update(agentJobs)
            .set({ telegramMessageId: messageId })
            .where(eq(agentJobs.id, job.id))
            .returning();
          job.telegramMessageId = updated?.telegramMessageId ?? messageId;
        }
        telegram = { ok: true, messageId };
      } else {
        telegram = { ok: false, error: res.error, description: (res as any).description };
      }
    }
  }

  return { job, telegram };
}

/**
 * چرخهٔ خودکار ۲۴/۷ — جایگزینی پویا (Dynamic Task Replenishment).
 *
 * به‌محض اینکه مدیرعامل یک کارت را تأیید یا رد می‌کند، جایگاه خالی آن
 * کارت باید بلافاصله با مأموریت تازهٔ همان کارمند پر شود. این تابع
 * بی‌صدا صدا زده می‌شود: هیچ خطایی در آن نباید نتیجهٔ تأیید را خراب کند.
 *
 * import داینامیک است تا وابستگی حلقهٔ خودکار و این فایل چرخهٔ ماژولی نسازد.
 */
async function triggerReplenish(agentId: number | null | undefined, reason: string) {
  if (!agentId) return;
  try {
    const loop = await import("@/lib/autoloop");
    await loop.replenishForAgent(agentId, reason);
  } catch {
    // خطای جایگزینی هرگز نباید تأیید/رد مدیرعامل را تحت تأثیر بگذارد
  }
}

async function triggerDecisionStat(
  kind: "approved" | "rejected",
  jobKind?: string,
) {
  try {
    const loop = await import("@/lib/autoloop");
    await loop.recordDecision(kind, { mission: jobKind === "mission" });
  } catch {
    // آمار حلقه حیاتی نیست
  }
}

export async function getJob(id: number) {
  const rows = await db.select().from(agentJobs).where(eq(agentJobs.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function listJobs(filter: { agentId?: number; status?: string[]; limit?: number } = {}) {
  const conds = [];
  if (filter.agentId) conds.push(eq(agentJobs.agentId, filter.agentId));
  if (filter.status?.length) conds.push(inArray(agentJobs.status, filter.status));
  const q = db.select().from(agentJobs).orderBy(desc(agentJobs.createdAt), desc(agentJobs.id)).limit(filter.limit ?? 100);
  return conds.length ? q.where(and(...conds)) : q;
}

export async function rejectJob(id: number, actor: string, reason = "") {
  const [job] = await db
    .update(agentJobs)
    .set({
      status: "rejected",
      approvedBy: actor,
      approvedAt: new Date(),
      finishedAt: new Date(),
      error: reason,
    })
    .where(and(eq(agentJobs.id, id), inArray(agentJobs.status, ["awaiting_approval", "queued", "approved"])))
    .returning();

  if (!job) {
    const current = await getJob(id);
    return {
      ok: false as const,
      error: current
        ? `این کار در وضعیت «${statusLabel(current.status)}» است و قابل رد کردن نیست.`
        : "کار پیدا نشد",
      job: current,
    };
  }

  await logActivity({
    agentId: job.agentId,
    agentName: job.agentName,
    action: "کار توسط مدیرعامل رد شد",
    status: "skipped",
    detail: `${job.title}${reason ? ` • دلیل: ${reason}` : ""}`,
    jobId: job.id,
    source: "panel",
    meta: { actor },
  });
  await legacyLog(job.agentName, "رد کار توسط مدیرعامل", "skipped", job.title);
  await triggerDecisionStat("rejected", job.kind);
  await triggerReplenish(job.agentId, `rejected:job#${job.id}`);
  return { ok: true as const, job };
}

/** تأیید کار + اجرای فوری (اتمیک، ضد اجرای دوباره). */
export async function approveJob(id: number, actor: string) {
  // ۰) پیش‌بررسی: کار «سالم و آماده» است؟
  // اگر نه، هیچ اجرایی شروع نمی‌شود و دلیل دقیق برگردانده می‌شود
  // (به‌جای اینکه کار در وضعیت failed گیر کند).
  const before = await getJob(id);
  if (!before) return { ok: false as const, error: "کار پیدا نشد" };
  const verdict = await approvalVerdict(before);
  if (!verdict.allowed) {
    if (before.status === "succeeded") {
      return {
        ok: true as const,
        job: before,
        alreadyDone: true,
        execution: before.result,
        message: verdict.message,
      };
    }
    return {
      ok: false as const,
      error: verdict.message,
      code: "not_ready",
      blockers: verdict.blockers,
      job: before,
    };
  }

  const [claimed] = await db
    .update(agentJobs)
    .set({ status: "approved", approvedBy: actor, approvedAt: new Date() })
    .where(
      and(
        eq(agentJobs.id, id),
        inArray(agentJobs.status, ["awaiting_approval", "queued"]),
      ),
    )
    .returning();

  if (!claimed) {
    const current = await getJob(id);
    if (!current) return { ok: false as const, error: "کار پیدا نشد" };
    if (current.status === "succeeded") {
      return { ok: true as const, job: current, alreadyDone: true, execution: current.result };
    }
    return {
      ok: false as const,
      error: `این کار در وضعیت «${statusLabel(current.status)}» است و قابل تأیید نیست.`,
      code: "wrong_status",
      job: current,
    };
  }

  await logActivity({
    agentId: claimed.agentId,
    agentName: claimed.agentName,
    action: "تأیید مدیرعامل ثبت شد — اجرا شروع شد",
    status: "success",
    detail: claimed.title,
    jobId: claimed.id,
    source: "panel",
    meta: { actor },
  });

  const execution = await executeJob(claimed, actor);
  await syncTelegramApproval(claimed, execution);
  await triggerDecisionStat("approved", claimed.kind);
  await triggerReplenish(claimed.agentId, `approved:job#${claimed.id}`);
  return { ok: execution.ok, job: (await getJob(id))!, execution };
}

type ExecutionResult = { ok: boolean; result?: unknown; error?: string; code?: string };

/**
 * کار به خاطر نبودِ پیکربندی (کلید صرافی، فلگ معامله، ورکر...) «شکست» نیست؛
 * فقط هنوز قابل اجرا نیست. این تابع آن را در وضعیت «needs_config» نگه
 * می‌دارد تا دکمه «تلاش دوباره» بعد از تنظیم کلیدها کار کند و کار در
 * وضعیت failed گیر نکند.
 */
async function markNeedsConfig(job: JobRecord, message: string, code = "not_configured") {
  await db
    .update(agentJobs)
    .set({ status: "needs_config", error: message, finishedAt: new Date() })
    .where(eq(agentJobs.id, job.id));
  await recordAgentError({
    agentName: job.agentName,
    action: `این کار نیاز به تنظیمات دارد: ${job.title}`,
    detail: `${message} • پس از تکمیل کلیدها/تنظیمات، «تلاش دوباره» را بزنید.`,
    source: "job",
    jobId: job.id,
    meta: { code, kind: job.kind, needsConfig: true },
  });
  return {
    ok: false as const,
    error: message,
    code,
    needsConfig: true as const,
  };
}

async function markFailed(job: JobRecord, message: string, code = "execution_failed") {
  await db
    .update(agentJobs)
    .set({ status: "failed", error: message, finishedAt: new Date() })
    .where(eq(agentJobs.id, job.id));
  await recordAgentError({
    agentName: job.agentName,
    action: `اجرای کار ناموفق: ${job.title}`,
    detail: message,
    source: "job",
    jobId: job.id,
    meta: { code, kind: job.kind },
  });
  return { ok: false as const, error: message, code };
}

async function executeTrade(job: JobRecord, _actor: string): Promise<ExecutionResult> {
  const p = (job.payload || {}) as Record<string, any>;
  const symbol = String(p.symbol || "").toUpperCase();
  const side = String(p.side || "BUY").toUpperCase() as "BUY" | "SELL";
  if (!symbol) return markFailed(job, "نماد معاملاتی در Payload مشخص نشده است", "invalid_payload");

  // ── دروازهٔ معاملهٔ واقعی (سقف خرد، سرمایهٔ ثبت‌شده، kill-switch) ──
  // این بررسی پیش از تماس با صرافی انجام می‌شود؛ اگر برقرار نباشد هیچ
  // درخواستی به صرافی نمی‌رود (به‌جای اینکه با خطای مبهم برگردد).
  const intendedUsdt = p.quoteOrderQty ? Number(p.quoteOrderQty) : undefined;
  const gate = await checkLiveGate(intendedUsdt);
  if (!gate.allowed) {
    return markNeedsConfig(
      job,
      `دروازهٔ معاملهٔ واقعی اجازه نمی‌دهد: ${gate.message}`,
      "live_gate_blocked",
    );
  }

  try {
    const order = await placeRealOrder({
      symbol,
      side,
      type: (p.type as "MARKET" | "LIMIT") || "MARKET",
      quantity: p.quantity ? Number(p.quantity) : undefined,
      quoteOrderQty: p.quoteOrderQty ? Number(p.quoteOrderQty) : undefined,
      price: p.price ? Number(p.price) : undefined,
    });

    await db.insert(exchangeOrders).values({
      exchange: order.exchange,
      testnet: order.testnet,
      symbol: order.symbol,
      side: order.side,
      orderType: (p.type as string) || "MARKET",
      quantity: p.quantity ? String(p.quantity) : null,
      quoteQty: p.quoteOrderQty ? String(p.quoteOrderQty) : null,
      price: p.price ? String(p.price) : null,
      status: order.status,
      clientOrderId: order.clientOrderId,
      exchangeOrderId: order.orderId,
      agentName: job.agentName,
      jobId: job.id,
      raw: order.raw as any,
    });

    await logActivity({
      agentId: job.agentId,
      agentName: job.agentName,
      action: `سفارش واقعی ${side} ${symbol} ارسال شد`,
      status: "success",
      detail: `شناسه صرافی: ${order.orderId} • وضعیت: ${order.status} • مقدار اجراشده: ${order.executedQty} • ${order.testnet ? "Testnet" : "Mainnet"}`,
      jobId: job.id,
      source: "exchange",
      meta: { order },
    });
    await legacyLog(
      job.agentName,
      `سفارش ${side} ${symbol}`,
      "success",
      `orderId=${order.orderId} status=${order.status}`
    );

    // ── دفتر کل + لایهٔ پاداش: سود/زیان واقعی از سفارش فروش محاسبه
    // می‌شود و پاداش/امتیاز همان لحظه برای کارمند ثبت می‌گردد.
    let settlement: Record<string, unknown> | null = null;
    try {
      const [saved] = await db
        .select()
        .from(exchangeOrders)
        .where(eq(exchangeOrders.clientOrderId, order.clientOrderId))
        .limit(1);
      if (saved) {
        const settled = await settleTradeOrder(saved.id);
        settlement = settled as unknown as Record<string, unknown>;
      }
    } catch (e: any) {
      await db
        .insert(systemEvents)
        .values({
          level: "warn",
          scope: "ledger",
          message: `تسویهٔ دفتری سفارش ${order.clientOrderId} ناموفق بود: ${e?.message || e}`,
          meta: { jobId: job.id, symbol },
        })
        .catch(() => {});
    }

    // اگر سود محقق‌شده با شاهد تراکنش همراه باشد، همان جریان تأیید واقعی طی می‌شود
    let profit: Record<string, unknown> | null = null;
    const profitUsdt = Number(p.profitUsdt || 0);
    const profitTxHash = String(p.profitTxHash || "").trim();
    if (profitUsdt > 0) {
      if (!profitTxHash || profitTxHash.length < 16) {
        profit = {
          status: "skipped",
          reason: "سود اعلام شده بدون هش تراکنش قابل ثبت نیست",
        };
      } else {
        const income = await ingestExternalIncome({
          agentName: job.agentName,
          title: `سود محقق‌شده معامله ${symbol}`,
          amountUsdt: profitUsdt,
          txHash: profitTxHash,
          network: String(p.profitNetwork || ""),
          source: "exchange",
          jobId: job.id,
        });
        profit = { status: income.status, verification: income.verification };
        if (income.status === "pending_verification") {
          await createJob({
            agentId: job.agentId,
            agentName: job.agentName,
            kind: "confirm_deposit",
            title: `تأیید سود معامله ${symbol} — ${profitUsdt} USDT`,
            detail: `هش: ${profitTxHash}\nدلیل نیاز به تأیید: ${(income.verification as any)?.reason || "بدون تأیید زنجیره‌ای"}`,
            payload: {
              transactionId: (income as any).transaction?.id,
              txHash: profitTxHash,
              verifiedOnchain: false,
            },
            risk: "medium",
            requiresApproval: true,
          });
        }
      }
    }

    return {
      ok: true,
      result: {
        order,
        settlement,
        profit,
        note:
          "سفارش واقعاً به صرافی ارسال شد. سود/زیان فقط با شاهد واریز (هش تراکنش) در درآمد ثبت می‌شود.",
      },
    };
  } catch (e: any) {
    if (e instanceof ConfigError) {
      return markNeedsConfig(
        job,
        `${e.message} (کلیدهای ناقص: ${e.missing.join(", ")}) — پس از تنظیم، دکمه «تلاش دوباره» را بزنید.`,
        e.code,
      );
    }
    if (e instanceof ExchangeError) {
      return markFailed(job, e.message, e.code);
    }
    return markFailed(job, e?.message || "خطای نامشخص در ارسال سفارش", "exchange_error");
  }
}

async function executeConfirmDeposit(job: JobRecord, actor: string): Promise<ExecutionResult> {
  const p = (job.payload || {}) as Record<string, any>;
  const transactionId = Number(p.transactionId);
  if (!transactionId) return markFailed(job, "شناسه تراکنش در Payload نیست", "invalid_payload");

  const res = await confirmDeposit({
    transactionId,
    actor,
    source: "job_approval",
    verifiedOnchain: Boolean(p.verifiedOnchain),
    note: p.note ? String(p.note) : undefined,
  });
  if (!res.ok) return markFailed(job, res.error || "تأیید واریز ناموفق بود", "confirm_failed");

  // ثبت موازی در کتابخانهٔ مالی داخلی (کیف پول واحد ↑ / درآمد ↓)
  let ledger: Record<string, unknown> | null = null;
  if (res.transaction) {
    try {
      const posted = await recordConfirmedIncomeInLedger({
        id: res.transaction.id,
        title: res.transaction.title,
        amountUsdt: Number(res.transaction.amountUsdt),
        txHash: res.transaction.txHash,
        agentName: res.transaction.agentName,
      });
      ledger = posted as unknown as Record<string, unknown>;
    } catch (e: any) {
      ledger = { ok: false, error: e?.message || String(e) };
    }
  }

  return {
    ok: true,
    result: {
      transaction: res.transaction,
      duplicate: res.duplicate ?? false,
      ledger,
      note: "واریز تأیید و در دفتر درآمد واقعی ثبت شد.",
    },
  };
}

async function executeStatusReport(job: JobRecord): Promise<ExecutionResult> {
  if (!job.agentId) return markFailed(job, "کارمند برای این گزارش مشخص نیست", "invalid_payload");
  const report = await generateAgentReport(job.agentId, { useAi: true });
  if (!report.ok) return markFailed(job, report.error || "تولید گزارش ناموفق بود", "report_failed");

  const chatId = ENV.telegramAdminChat();
  let telegram: any = { ok: false, error: "not_configured" };
  if (telegramConfigured() && chatId) {
    telegram = await notifyAdmin(
      `<b>${escapeHtml(report.text.split("\n")[0] || "گزارش وضعیت")}</b>\n\n${escapeHtml(
        report.text.split("\n").slice(1).join("\n")
      )}`
    );
  }
  await logActivity({
    agentId: job.agentId,
    agentName: job.agentName,
    action: "گزارش وضعیت تولید شد",
    status: "success",
    detail: `منبع: ${report.source}${report.error ? ` • هشدار: ${report.error}` : ""}`,
    jobId: job.id,
    source: "report",
  });
  return { ok: true, result: { report: report.text, source: report.source, telegram } };
}

async function executeToolRun(job: JobRecord): Promise<ExecutionResult> {
  const p = (job.payload || {}) as Record<string, any>;
  const workerUrl = ENV.workerUrl();
  if (!workerUrl) {
    return markNeedsConfig(
      job,
      "ورکر اجرای ابزار پیکربندی نشده است (AGENT_WORKER_URL). ابزارها بدون سرویس واقعی اجرا نمی‌شوند. پس از ست کردن، «تلاش دوباره» را بزنید.",
      "worker_not_configured"
    );
  }
  try {
    const res = await fetch(workerUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(conf("AGENT_WORKER_TOKEN") ? { Authorization: `Bearer ${conf("AGENT_WORKER_TOKEN")}` } : {}),
      },
      body: JSON.stringify({
        jobId: job.id,
        agent: job.agentName,
        tool: p.tool,
        input: p.input,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(25000),
    });
    const text = await res.text();
    let output: string;
    try {
      const json = JSON.parse(text);
      output = typeof json?.output === "string" ? json.output : JSON.stringify(json);
    } catch {
      output = text;
    }
    if (!res.ok) {
      const msg = `ورکر خطا برگرداند: HTTP ${res.status} — ${output.slice(0, 200)}`;
      await db.insert(toolRuns).values({
        tool: String(p.tool || job.title),
        input: String(p.input || ""),
        output: msg,
        status: "failed",
      });
      return markFailed(job, msg, "worker_error");
    }
    await db.insert(toolRuns).values({
      tool: String(p.tool || job.title),
      input: String(p.input || ""),
      output,
      status: "done",
    });
    await logActivity({
      agentId: job.agentId,
      agentName: job.agentName,
      action: `ابزار «${p.tool || job.title}» با ورکر واقعی اجرا شد`,
      status: "success",
      detail: output.slice(0, 400),
      jobId: job.id,
      source: "worker",
    });
    return { ok: true, result: { output } };
  } catch (e: any) {
    return markFailed(job, `عدم دسترسی به ورکر: ${e?.message || e}`, "worker_unreachable");
  }
}

async function executeWithdraw(job: JobRecord): Promise<ExecutionResult> {
  const p = (job.payload || {}) as Record<string, any>;
  const txHash = String(p.txHash || "").trim();
  if (!txHash || txHash.length < 16) {
    return markFailed(
      job,
      "برداشت بدون هش تراکنش واقعی قابل ثبت نیست. ابتدا انتقال را انجام دهید و هش را ثبت کنید.",
      "missing_proof"
    );
  }
  const amount = Number(p.amountUsdt) || 0;
  if (amount <= 0) return markFailed(job, "مبلغ برداشت نامعتبر است", "invalid_payload");

  await db.execute(sql`
    INSERT INTO agentos.transactions (title, project_title, agent_name, destination_wallet, amount_usdt, network, tx_hash, kind, status, verified, source, reference, job_id)
    VALUES (${String(p.title || "برداشت از کیف پول واحد")}, ${String(p.projectTitle || "")}, ${job.agentName},
            ${String(p.toAddress || "")}, ${-Math.abs(amount)}, ${String(p.network || "TRC20")}, ${txHash},
            'withdraw', 'confirmed', true, 'job_approval', ${String(p.reference || "")}, ${job.id})
  `);
  await logActivity({
    agentId: job.agentId,
    agentName: job.agentName,
    action: `برداشت ${amount} USDT ثبت شد`,
    status: "success",
    detail: `هش ${txHash} • ${p.network || "TRC20"}`,
    jobId: job.id,
    source: "manual",
  });
  return { ok: true, result: { txHash, amount } };
}

/**
 * اجرای یک «مأموریت» ساخته‌شده توسط حلقهٔ خودکار ۲۴/۷.
 *
 * مأموریت یعنی کار داخلی واقعی (تحلیل، تدوین، بازرسی) — نه تراکنش مالی.
 * خروجی این اجرا:
 *   • یک «برگهٔ تحویل» ساختاریافته بر پایهٔ دادهٔ واقعی همان لحظهٔ دیتابیس
 *   • در صورت وجود کلید جمینای، متن تحلیلی نوشته‌شده روی همان واقعیت‌ها
 *   • ثبت در دفتر کارمند + ارسال خلاصه در تلگرام مدیرعامل
 * هیچ عدد درآمدی یا سود تازه‌ای در این مسیر ساخته نمی‌شود.
 */
async function executeMission(job: JobRecord, actor: string): Promise<ExecutionResult> {
  const p = (job.payload || {}) as Record<string, any>;
  const rows = await db.select().from(agents).where(eq(agents.id, job.agentId ?? -1)).limit(1);
  const agent = rows[0];
  if (!agent) return markFailed(job, "کارمند این مأموریت پیدا نشد", "invalid_payload");

  const missionAgent: MissionAgent = {
    id: agent.id,
    name: agent.name,
    slug: agent.slug,
    department: agent.department,
    specialty: agent.specialty,
    status: agent.status,
    goalTitle: agent.goalTitle,
    goalTargetUsdt: Number(agent.goalTargetUsdt || 0),
    earnedUsdt: Number(agent.earnedUsdt || 0),
    tasksCompleted: Number(agent.tasksCompleted || 0),
    currentFocus: agent.currentFocus,
  };

  const facts = await gatherMissionFacts(missionAgent);
  const deliverable = String(p.deliverable || job.title);
  const steps: string[] = Array.isArray(p.steps) ? p.steps.map((s: any) => String(s)) : [];

  const factsBlock = [
    `دپارتمان: ${facts.agent.department}`,
    `هدف ماهانه: ${facts.agent.monthlyTargetUsdt} USDT • درآمد تأییدشده: ${facts.agent.earnedUsdt} USDT`,
    `کارت‌های منتظر تأیید این کارمند: ${facts.queue.pending} • کل شرکت: ${facts.queue.pendingTotal}`,
    `پروژه‌های باز: ${facts.projects.open} (منطبق: ${facts.projects.matching.length})`,
    `پیام خوانده‌نشده: ${facts.messages.unread} • واریز منتظر تأیید: ${facts.deposits.pendingVerification}`,
    `بازار: ${
      facts.market.available
        ? facts.market.latest
            .map((m) => `${m.symbol}=${m.price} (RSI ${m.rsi.toFixed(1)})`)
            .join(" | ")
        : "اسنپ‌شات موجود نیست"
    }`,
    `سیگنال ۲۴ ساعت اخیر: ${facts.signals.last24h} (آخرین نماد: ${facts.signals.lastSymbol || "—"})`,
    `سرویس‌ها: تلگرام=${facts.services.telegram ? "متصل" : "قطع"} • AI=${facts.services.ai ? "متصل" : "قطع"} • ورکر=${facts.services.worker ? "متصل" : "قطع"} • کلید صرافی=${facts.services.exchangeKeys ? "ست‌شده" : "نشده"} • قفل معامله=${facts.services.tradingEnabled ? "باز" : "قفل"}`,
  ].join("\n");

  let analysis = "";
  let analysisModel: string | null = null;
  if (geminiConfigured()) {
    const ai = await generateGeminiText(
      `تو «${agent.name}» هستی، کارمند دپارتمان «${facts.agent.department}» در شرکت RNAI. ` +
        `مأموریت تأییدشدهٔ مدیرعامل: «${job.title}». خروجی مورد انتظار: «${deliverable}».\n` +
        `فقط بر پایهٔ این واقعیت‌های دیتابیس (هیچ عددی از خودت نساز):\n${factsBlock}\n` +
        `یک برگهٔ تحویل حرفه‌ای فارسی بنویس با این بخش‌ها: ۱) خلاصهٔ مدیریتی (۲ خط) ۲) یافته‌های کلیدی بر پایهٔ همین اعداد ۳) سه اقدام پیشنهادی با اولویت ۴) ریسک‌ها و وابستگی‌ها. بدون markdown و بدون مقدمه.`,
      { maxOutputTokens: 900, temperature: 0.3, timeoutMs: 22000 },
    );
    if (ai.ok) {
      analysis = ai.text.trim();
      analysisModel = ai.model;
    }
  }

  const sheet = [
    `📋 برگهٔ تحویل مأموریت #${job.id}`,
    `👤 کارمند: ${agent.name} (${facts.agent.department})`,
    `🎯 مأموریت: ${job.title}`,
    `📦 خروجی: ${deliverable}`,
    "",
    "🧾 واقعیت‌های مبنا (ثبت‌شده در دیتابیس):",
    factsBlock,
    "",
    steps.length ? `🧭 گام‌های اجراشده: ${steps.map((s, i) => `${i + 1}) ${s}`).join(" • ")}` : "",
    analysis
      ? `🧠 تحلیل تحویل‌شده (${analysisModel}):\n${analysis}`
      : "🧠 تحلیل متنی تولید نشد (GEMINI_API_KEY ست نشده)؛ برگهٔ تحویل فقط بر پایهٔ دادهٔ واقعی ثبت شد.",
    "",
    `✅ تأییدکننده: ${actor}`,
  ]
    .filter(Boolean)
    .join("\n");

  await db.insert(agentActivityLogs).values({
    agentId: agent.id,
    agentName: agent.name,
    action: `مأموریت تأییدشده اجرا و برگهٔ تحویل ثبت شد: ${job.title}`,
    status: "success",
    detail: sheet.slice(0, 1900),
    jobId: job.id,
    source: "mission",
    meta: {
      missionKey: p.missionKey || null,
      deliverable,
      analysisModel,
      actor,
      facts: {
        pendingTotal: facts.queue.pendingTotal,
        openProjects: facts.projects.open,
        unreadMessages: facts.messages.unread,
        pendingDeposits: facts.deposits.pendingVerification,
      },
    },
  }).catch(() => {});

  await db
    .update(agents)
    .set({
      successCount: sql`${agents.successCount} + 1`,
      tasksCompleted: sql`${agents.tasksCompleted} + 1`,
      lastActiveAt: new Date(),
    })
    .where(eq(agents.id, agent.id))
    .catch(() => {});

  const chatId = ENV.telegramAdminChat();
  let telegram: any = { ok: false, error: "not_configured" };
  if (telegramConfigured() && chatId) {
    telegram = await notifyAdmin(
      `✅ <b>مأموریت اجرا شد — ${escapeHtml(agent.name)}</b> #${job.id}\n` +
        `📋 ${escapeHtml(job.title)}\n` +
        `📦 <b>خروجی:</b> ${escapeHtml(deliverable)}\n\n` +
        `<pre>${escapeHtml(analysis ? analysis.slice(0, 1200) : factsBlock.slice(0, 900))}</pre>\n` +
        `🔁 <i>جایگاه این مأموریت در صف با مأموریت بعدی پر می‌شود.</i>`,
    );
  }

  return {
    ok: true,
    result: {
      deliverable,
      analysis,
      analysisModel,
      facts: factsBlock,
      sheet,
      telegram,
      note: "برگهٔ تحویل در دفتر کارمند ثبت شد؛ هیچ تراکنش مالی در این مأموریت ساخته نشد.",
    },
  };
}

async function executeProposalOrBounty(
  job: JobRecord,
  actor: string,
): Promise<ExecutionResult> {
  const p = (job.payload || {}) as Record<string, any>;
  if (p.projectId) {
    await db
      .update(projects)
      .set({ status: "approved" })
      .where(eq(projects.id, Number(p.projectId)))
      .catch(() => {});
  }
  if (p.taskId) {
    await db
      .update(tasks)
      .set({ status: "approved" })
      .where(eq(tasks.id, Number(p.taskId)))
      .catch(() => {});
  }
  if (job.agentId) {
    await db
      .update(agents)
      .set({
        successCount: sql`${agents.successCount} + 1`,
        tasksCompleted: sql`${agents.tasksCompleted} + 1`,
        lastActiveAt: new Date(),
      })
      .where(eq(agents.id, job.agentId))
      .catch(() => {});
  }

  await logActivity({
    agentId: job.agentId,
    agentName: job.agentName,
    action:
      job.kind === "bounty"
        ? `کمپین بانتی با تأیید مدیرعامل فعال شد`
        : `پیشنهاد فرصت با تأیید مدیرعامل وارد فاز اجرا شد`,
    status: "success",
    detail: `${job.title} • تأییدکننده: ${actor} • سود تخمینی: ${p.estimatedProfitUsdt ?? 0} USDT (ثبت در کیف پول فقط پس از واریز واقعی و هش تراکنش)`,
    jobId: job.id,
    source: "hitl",
    meta: { actor, kind: job.kind, link: p.link || null },
  });

  return {
    ok: true,
    result: {
      approvedBy: actor,
      estimatedProfitUsdt: Number(p.estimatedProfitUsdt || 0),
      estimatedDuration: p.estimatedDuration || null,
      link: p.link || null,
      note: "پیشنهاد تأیید و آغاز شد. درآمد واقعی پس از دریافت هش تراکنش در کیف پول واحد ثبت می‌گردد.",
    },
  };
}

async function executeJob(job: JobRecord, actor: string): Promise<ExecutionResult> {
  const started = Date.now();
  const [running] = await db
    .update(agentJobs)
    .set({ status: "running", startedAt: new Date(), attempts: sql`${agentJobs.attempts} + 1` })
    .where(eq(agentJobs.id, job.id))
    .returning();
  void running;

  let result: ExecutionResult;
  try {
    switch (job.kind) {
      case "trade":
        result = await executeTrade(job, actor);
        break;
      case "confirm_deposit":
        result = await executeConfirmDeposit(job, actor);
        break;
      case "status_report":
        result = await executeStatusReport(job);
        break;
      case "tool_run":
        result = await executeToolRun(job);
        break;
      case "withdraw":
        result = await executeWithdraw(job);
        break;
      case "proposal":
      case "bounty":
        result = await executeProposalOrBounty(job, actor);
        break;
      case "mission":
        result = await executeMission(job, actor);
        break;
      default:
        result = await markFailed(job, `نوع کار «${job.kind}» اجراکننده ندارد`, "unsupported_kind");
    }
  } catch (e: any) {
    result = await markFailed(job, e?.message || "خطای نامشخص", "exception");
  }

  if (result.ok) {
    await db
      .update(agentJobs)
      .set({
        status: "succeeded",
        result: (result.result ?? {}) as any,
        finishedAt: new Date(),
        error: "",
      })
      .where(eq(agentJobs.id, job.id));
    await legacyLog(job.agentName, `تکمیل کار: ${job.title}`, "success", `مدت: ${Date.now() - started}ms`, Date.now() - started);
  }
  return result;
}

/** بعد از تأیید/اجرا، پیام تلگرام همان درخواست را به‌روزرسانی کن (HITL واقعی). */
export async function syncTelegramApproval(
  job: JobRecord,
  execution: { ok: boolean; error?: string; result?: unknown }
) {
  if (!telegramConfigured() || !ENV.telegramAdminChat() || !job.telegramMessageId) return;
  const statusLine = execution.ok
    ? "✅ <b>اجرا شد</b>"
    : `⛔ <b>اجرا ناموفق</b>\n<code>${escapeHtml(execution.error || "خطای نامشخص")}</code>`;
  const extra =
    execution.ok && job.kind === "trade"
      ? "\nسفارش واقعی ثبت شد؛ نتیجه در پنل قابل پیگیری است."
      : execution.ok && job.kind === "confirm_deposit"
      ? "\nواریز تأیید و در دفتر درآمد ثبت شد."
      : "";
  await editTelegramMessage(
    ENV.telegramAdminChat(),
    job.telegramMessageId,
    `🔔 درخواست #${job.id} — <b>${escapeHtml(job.title)}</b>\n${statusLine}${extra}`,
    { inline_keyboard: [] }
  );
}

/** تلاش دوباره برای کار ناموفق. */
export async function retryJob(id: number, actor: string) {
  const [job] = await db
    .update(agentJobs)
    .set({ status: "approved", error: "", finishedAt: null, approvedBy: actor, approvedAt: new Date() })
    .where(and(eq(agentJobs.id, id), inArray(agentJobs.status, ["failed", "expired", "needs_config"])))
    .returning();
  if (!job) {
    const current = await getJob(id);
    return {
      ok: false as const,
      error: current
        ? `این کار در وضعیت «${statusLabel(current.status)}» است؛ فقط کارهای ناموفق/نیازمند تنظیمات/منقضی قابل تلاش دوباره هستند.`
        : "کار پیدا نشد",
      job: current,
    };
  }

  // پیش از تلاش دوباره بررسی کن که علت قبلی رفع شده باشد
  const verdict = await approvalVerdict(job);
  if (!verdict.allowed) {
    await markNeedsConfig(job, verdict.message, "retry_blocked");
    return {
      ok: false as const,
      error: verdict.message,
      code: "not_ready",
      blockers: verdict.blockers,
      job: await getJob(id),
    };
  }

  await logActivity({
    agentId: job.agentId,
    agentName: job.agentName,
    action: "تلاش دوباره برای اجرای کار",
    status: "pending",
    detail: job.title,
    jobId: job.id,
    source: "panel",
    meta: { actor },
  });

  const execution = await executeJob(job, actor);
  await syncTelegramApproval(job, execution);
  return { ok: execution.ok, job: (await getJob(id))!, execution };
}

/** اجرای کارهای صف که نیازی به تأیید ندارند (کرون). */
export async function runQueuedJobs(limit = 5) {
  const jobs = await db
    .select()
    .from(agentJobs)
    .where(and(eq(agentJobs.status, "queued"), eq(agentJobs.requiresApproval, false), lt(agentJobs.attempts, 3)))
    .orderBy(asc(agentJobs.createdAt))
    .limit(limit);

  const results: Array<{ id: number; ok: boolean; error?: string }> = [];
  for (const job of jobs) {
    const exec = await executeJob(job, "cron");
    results.push({ id: job.id, ok: exec.ok, error: exec.error });
  }
  return results;
}

/**
 * یادآوری درخواست‌های تأییدِ بی‌پاسخ به تلگرام (کرون).
 * فقط کارهایی یادآوری می‌شوند که سنشان داخل پنجرهٔ [olderThanMinutes,
 * olderThanMinutes + windowMinutes) باشد؛ بنابراین با اجرای چرخه هر ۳۰
 * دقیقه، هر کار حداکثر یک‌بار یادآوری می‌شود و تلگرام مدیرعامل اسپم نمی‌شود.
 */
export async function remindPendingApprovals(olderThanMinutes = 45, windowMinutes = 40) {
  if (!telegramConfigured() || !ENV.telegramAdminChat()) return { sent: 0, skipped: "telegram_not_configured" };
  const now = Date.now();
  const newest = new Date(now - olderThanMinutes * 60_000);
  const oldest = new Date(now - (olderThanMinutes + windowMinutes) * 60_000);
  const rows = await db
    .select()
    .from(agentJobs)
    .where(
      and(
        eq(agentJobs.status, "awaiting_approval"),
        lt(agentJobs.createdAt, newest),
        gt(agentJobs.createdAt, oldest),
      ),
    )
    .orderBy(asc(agentJobs.createdAt))
    .limit(5);

  let sent = 0;
  for (const job of rows) {
    const res = await sendJobApprovalRequest({
      id: job.id,
      agentName: job.agentName,
      title: `یادآوری — ${job.title}`,
      detail: job.detail,
      risk: job.risk,
      kind: job.kind,
      payload: (job.payload || {}) as Record<string, unknown>,
    });
    if (res.ok) sent++;
  }
  return { sent, candidates: rows.length };
}

/**
 * گزارش دوره‌ای/روتین همه‌ی کارمندان.
 *
 * ⛔ سیاست مدیرعامل (۱۴۰۵/۰۸/۱۶): ارسال خودکار گزارش‌های دوره‌ای به تلگرام
 * متوقف شده است. گزارش فقط زمانی ساخته و ارسال می‌شود که مدیرعامل شخصاً
 * درخواست کند. برای همین این تابع (که تنها مصرف‌کننده‌اش کرون و پارامتر
 * دستی «ارسال گزارش روزانه» در پنل/تلگرام بود) هیچ پیامی نمی‌فرستد و فقط
 * وضعیت «غیرفعال» را برمی‌گرداند.
 *
 * گزارش دستی: POST /api/agents/[id]/report  (با useAi و sendToTelegram)
 */
export async function sendDailyReports() {
  void agents;
  void generateAgentReport;
  void notifyAdmin;
  void escapeHtml;
  void telegramConfigured;
  void ENV;
  return {
    sent: 0,
    agents: 0,
    disabled: true,
    reason:
      "ارسال خودکار گزارش‌های دوره‌ای به دستور مدیرعامل خاموش شده است؛ گزارش فقط با درخواست دستی شما تولید می‌شود.",
    errors: [] as string[],
  };
}

export async function expireStaleApprovals(olderThanHours = 72) {
  const cutoff = new Date(Date.now() - olderThanHours * 3600_000);
  const rows = await db
    .update(agentJobs)
    .set({ status: "expired", error: `بدون پاسخ مدیرعامل پس از ${olderThanHours} ساعت منقضی شد`, finishedAt: new Date() })
    .where(and(eq(agentJobs.status, "awaiting_approval"), lt(agentJobs.createdAt, cutoff)))
    .returning({ id: agentJobs.id });
  return { expired: rows.length };
}

export async function agentFactsOrNull(agentId: number) {
  return buildAgentFacts(agentId);
}
