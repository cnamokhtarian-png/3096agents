import { db } from "@/db";
import {
  agents,
  agentActivityLogs,
  agentLogs,
  systemEvents,
  transactions,
} from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { getMasterWallet } from "@/lib/seed";
import { normalizeNetwork, explorerUrl, verifyDeposit } from "@/lib/onchain";

/**
 * لایه‌ی اجرای واقعی ایجنت‌ها.
 *
 * قواعد سخت‌گیرانه (Production):
 *  ۱. هیچ پاداشی بدون مبلغ > 0 و شاهد واقعی (هش تراکنش یا تأیید مدیر) ثبت نمی‌شود.
 *  ۲. هر هش تراکنش فقط یک‌بار قابل ثبت است (idempotent) → ضد ثبت تکراری درآمد.
 *  ۳. هر رویداد در agent_activity_logs و agent_logs نوشته می‌شود تا قابل دیباگ باشد.
 *  ۴. شمارنده موفقیت با تابع دیتابیس agentos.increment_agent_success به‌روز می‌شود.
 */

export type RecordResult = {
  success: boolean;
  duplicate?: boolean;
  data?: typeof transactions.$inferSelect;
  activityId?: number;
  error?: string;
};

async function insertActivity(input: {
  agentId?: number | null;
  agentName: string;
  action: string;
  status?: string;
  detail?: string;
  rewardUsdt?: number;
  txHash?: string;
  jobId?: number | null;
  source?: string;
  meta?: Record<string, unknown>;
}) {
  const [row] = await db
    .insert(agentActivityLogs)
    .values({
      agentId: input.agentId ?? null,
      agentName: input.agentName,
      action: input.action,
      status: input.status ?? "success",
      detail: input.detail ?? "",
      rewardUsdt: input.rewardUsdt ?? 0,
      txHash: input.txHash ?? "",
      jobId: input.jobId ?? null,
      source: input.source ?? "system",
      meta: input.meta ?? {},
    })
    .returning({ id: agentActivityLogs.id });
  return row?.id;
}

async function insertLegacyLog(input: {
  agent: string;
  action: string;
  status?: string;
  detail?: string;
  durationMs?: number;
}) {
  await db
    .insert(agentLogs)
    .values({
      agent: input.agent,
      action: input.action,
      status: input.status ?? "success",
      detail: input.detail ?? "",
      durationMs: Math.max(0, Math.round(input.durationMs ?? 0)),
    })
    .catch(() => {});
}

async function findAgentByName(nameOrSlug: string) {
  const rows = await db.select().from(agents);
  return (
    rows.find((a) => a.name === nameOrSlug) ||
    rows.find((a) => a.slug === nameOrSlug) ||
    null
  );
}

async function callDbFunction(fn: "increment_agent_success" | "increment_agent_error", agentName: string) {
  try {
    await db.execute(sql.raw(`SELECT agentos.${fn}('${agentName.replace(/'/g, "''")}')`));
  } catch (e) {
    // اگر تابع دیتابیس اعمال نشده باشد، حداقل شمارنده را مستقیم آپدیت می‌کنیم
    await db
      .update(agents)
      .set(fn === "increment_agent_success" ? { successCount: sql`${agents.successCount} + 1` } : { errorCount: sql`${agents.errorCount} + 1` })
      .where(eq(agents.name, agentName))
      .catch(() => {});
    await db
      .insert(systemEvents)
      .values({
        level: "warn",
        scope: "db:function",
        message: `فراخوانی ${fn} ناموفق بود؛ ستون شمارنده مستقیم آپدیت شد`,
        meta: { error: String(e) },
      })
      .catch(() => {});
  }
}

/** ثبت خطای واقعی یک کارمند + شمارنده خطا (برای بخش گزارش‌های کارمندان). */
export async function recordAgentError(input: {
  agentName: string;
  action: string;
  detail: string;
  source?: string;
  jobId?: number | null;
  meta?: Record<string, unknown>;
}) {
  const agent = await findAgentByName(input.agentName);
  const activityId = await insertActivity({
    agentId: agent?.id ?? null,
    agentName: input.agentName,
    action: input.action,
    status: "failed",
    detail: input.detail,
    jobId: input.jobId ?? null,
    source: input.source ?? "system",
    meta: input.meta,
  });
  await insertLegacyLog({
    agent: input.agentName,
    action: input.action,
    status: "failed",
    detail: input.detail,
  });
  await callDbFunction("increment_agent_error", input.agentName);
  await db
    .insert(systemEvents)
    .values({
      level: "error",
      scope: `agent:${input.agentName}`,
      message: input.detail,
      meta: { action: input.action, ...(input.meta || {}) },
    })
    .catch(() => {});
  return activityId;
}

/** افزایش اتمیک درآمد کارمند با تابع دیتابیس (با فالبک مستقیم). */
async function applyRevenue(agentName: string, agentId: number | null, reward: number, txHash: string) {
  try {
    const r: any = await db.execute(
      sql`SELECT agentos.record_agent_revenue(${agentName}, ${agentId}, ${reward}, ${txHash}) AS applied`
    );
    return Boolean(r?.rows?.[0]?.applied ?? true);
  } catch {
    // نصب قدیمی بدون تابع: مستقیم آپدیت کن
    const where = agentId !== null ? eq(agents.id, agentId) : eq(agents.name, agentName);
    await db
      .update(agents)
      .set({
        earnedUsdt: sql`${agents.earnedUsdt} + ${reward}`,
        tasksCompleted: sql`${agents.tasksCompleted} + 1`,
        lastActiveAt: new Date(),
      })
      .where(where)
      .catch(() => {});
    return true;
  }
}

/**
 * ثبت واقعی درآمد یک ایجنت.
 * معادل تابع درخواستی recordRealAgentExecution — با کنترل ضدتکرار.
 */
export async function recordRealAgentExecution(input: {
  agentName: string;
  title: string;
  rewardUsdt: number;
  txHash: string;
  projectTitle?: string;
  network?: string;
  destinationWallet?: string;
  source?: string;
  jobId?: number | null;
  verified?: boolean;
  activityAction?: string;
  detail?: string;
}): Promise<RecordResult> {
  const reward = Number(input.rewardUsdt);
  const txHash = String(input.txHash || "").trim();

  if (!Number.isFinite(reward) || reward <= 0) {
    return { success: false, error: "مبلغ پاداش باید عددی بزرگ‌تر از صفر باشد" };
  }
  if (!txHash) {
    return { success: false, error: "هش تراکنش برای ثبت درآمد واقعی الزامی است" };
  }
  if (txHash.length < 16) {
    return { success: false, error: "هش تراکنش معتبر نیست (باید حداقل ۱۶ کاراکتر باشد)" };
  }

  // ضدتکرار: اگر همین هش قبلاً به‌عنوان درآمد ثبت شده باشد
  const existing = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.txHash, txHash), eq(transactions.kind, "income")))
    .limit(1);
  if (existing[0]) {
    await insertActivity({
      agentName: input.agentName,
      action: "تلاش برای ثبت تکراری درآمد",
      status: "skipped",
      detail: `هش ${txHash} قبلاً در تراکنش #${existing[0].id} ثبت شده است`,
      txHash,
      jobId: input.jobId ?? null,
      source: input.source ?? "system",
    });
    return { success: true, duplicate: true, data: existing[0] };
  }

  const agent = await findAgentByName(input.agentName);
  const wallet = await getMasterWallet();
  const network = normalizeNetwork(input.network || wallet.network);
  const started = Date.now();

  const [tx] = await db
    .insert(transactions)
    .values({
      title: input.title,
      projectTitle: input.projectTitle || agent?.role || "",
      agentName: input.agentName,
      destinationWallet: input.destinationWallet || wallet.address,
      amountUsdt: reward,
      network,
      txHash,
      kind: "income",
      status: "confirmed",
      verified: input.verified ?? true,
      source: input.source || "verified",
      reference: explorerUrl(network, txHash),
      jobId: input.jobId ?? null,
    })
    .returning();

  // ۱) افزایش اتمیک درآمد + تعداد تسک (پیش از ثبت رویداد، تا ضدتکرار کار کند)
  await applyRevenue(input.agentName, agent?.id ?? null, reward, txHash);

  // ۲) ثبت رویداد در دفتر فعالیت واقعی
  await insertActivity({
    agentId: agent?.id ?? null,
    agentName: input.agentName,
    action: input.activityAction || `واریز واقعی ${reward} USDT به کیف پول واحد`,
    status: "success",
    detail: input.detail || `پروژه: ${input.title} • هش تراکنش: ${txHash}`,
    rewardUsdt: reward,
    txHash,
    jobId: input.jobId ?? null,
    source: input.source || "verified",
    meta: { network, explorer: explorerUrl(network, txHash) },
  });

  await callDbFunction("increment_agent_success", input.agentName);
  await insertLegacyLog({
    agent: input.agentName,
    action: `واریز +${reward} USDT به کیف پول واحد`,
    status: "success",
    detail: `${input.title} • هش: ${txHash}`,
    durationMs: Date.now() - started,
  });

  return { success: true, data: tx, activityId: undefined };
}

/**
 * ثبت واریزی که هنوز تأیید نشده (مثلاً وبهوک بیرونی بدون شاهد).
 * مبلغ تا تأیید مدیرعامل در «درآمد محقق‌شده» حساب نمی‌شود.
 */
export async function recordPendingDeposit(input: {
  agentName: string;
  title: string;
  amountUsdt: number;
  txHash: string;
  network?: string;
  source?: string;
  jobId?: number | null;
  projectTitle?: string;
  verifyNote?: string;
}) {
  const agent = await findAgentByName(input.agentName);
  const wallet = await getMasterWallet();
  const network = normalizeNetwork(input.network || wallet.network);
  const amount = Number(input.amountUsdt) || 0;

  const [tx] = await db
    .insert(transactions)
    .values({
      title: input.title,
      projectTitle: input.projectTitle || agent?.role || "",
      agentName: input.agentName,
      destinationWallet: wallet.address,
      amountUsdt: amount,
      network,
      txHash: input.txHash,
      kind: "income",
      status: "pending_verification",
      verified: false,
      source: input.source || "ingest",
      reference: explorerUrl(network, input.txHash),
      jobId: input.jobId ?? null,
    })
    .returning();

  await insertActivity({
    agentId: agent?.id ?? null,
    agentName: input.agentName,
    action: `درآمد گزارش‌شده ${amount} USDT در انتظار تأیید`,
    status: "pending",
    detail: input.verifyNote || `هش ${input.txHash} • تا تأیید مدیرعامل در درآمد محقق‌شده حساب نمی‌شود`,
    rewardUsdt: 0,
    txHash: input.txHash,
    jobId: input.jobId ?? null,
    source: input.source || "ingest",
    meta: { network, amountReported: amount },
  });

  return tx;
}

/** تأیید نهایی یک واریز در انتظار (پس از بررسی زنجیره یا تأیید مدیرعامل). */
export async function confirmDeposit(input: {
  transactionId: number;
  actor: string;
  source?: string;
  verifiedOnchain?: boolean;
  note?: string;
}): Promise<{ ok: boolean; error?: string; transaction?: typeof transactions.$inferSelect; duplicate?: boolean }> {
  const rows = await db.select().from(transactions).where(eq(transactions.id, input.transactionId)).limit(1);
  const tx = rows[0];
  if (!tx) return { ok: false, error: "تراکنش پیدا نشد" };
  if (tx.status === "confirmed") return { ok: true, transaction: tx, duplicate: true };
  if (tx.kind !== "income") return { ok: false, error: "این تراکنش درآمد نیست" };
  if (!tx.txHash) return { ok: false, error: "تراکنش بدون هش قابل تأیید نیست" };

  const [updated] = await db
    .update(transactions)
    .set({
      status: "confirmed",
      verified: input.verifiedOnchain ?? true,
      source: input.source || "manual_approval",
    })
    .where(and(eq(transactions.id, input.transactionId), eq(transactions.status, "pending_verification")))
    .returning();

  if (!updated) {
    const again = await db.select().from(transactions).where(eq(transactions.id, input.transactionId)).limit(1);
    return { ok: true, transaction: again[0], duplicate: true };
  }

  const agent = await findAgentByName(updated.agentName);
  const amount = Number(updated.amountUsdt) || 0;

  await applyRevenue(updated.agentName, agent?.id ?? null, amount, updated.txHash);
  await callDbFunction("increment_agent_success", updated.agentName);

  await insertActivity({
    agentId: agent?.id ?? null,
    agentName: updated.agentName,
    action: `تأیید نهایی واریز ${amount} USDT`,
    status: "success",
    detail:
      input.note ||
      `تأیید توسط ${input.actor} • هش ${updated.txHash} • منبع: ${input.source || "manual"}`,
    rewardUsdt: amount,
    txHash: updated.txHash,
    jobId: updated.jobId ?? null,
    source: input.source || "manual_approval",
    meta: { transactionId: updated.id, verifiedOnchain: Boolean(input.verifiedOnchain) },
  });
  await insertLegacyLog({
    agent: updated.agentName,
    action: `تأیید واریز +${amount} USDT`,
    status: "success",
    detail: `هش ${updated.txHash} • تأییدکننده: ${input.actor}`,
  });

  return { ok: true, transaction: updated };
}

/**
 * اجرای وبهوک بیرونی‌ای که مدعی درآمد است:
 * ۱. اگر شاهد زنجیره‌ای تطابق داشت → همان لحظه به‌عنوان درآمد واقعی ثبت می‌شود.
 * ۲. وگرنه به‌صورت «در انتظار تأیید» ثبت و یک Job تأیید برای مدیرعامل ساخته می‌شود.
 */
export async function ingestExternalIncome(input: {
  agentName: string;
  title: string;
  amountUsdt: number;
  txHash: string;
  network?: string;
  source?: string;
  projectTitle?: string;
  jobId?: number | null;
  skipVerification?: boolean;
}) {
  const wallet = await getMasterWallet();
  const network = normalizeNetwork(input.network || wallet.network);
  const verification = input.skipVerification
    ? { checked: false, verified: false, network, reason: "بررسی زنجیره‌ای در این مسیر انجام نشد" }
    : await verifyDeposit({
        txHash: input.txHash,
        amountUsdt: input.amountUsdt,
        network,
        toAddress: wallet.address,
      });

  if (verification.verified) {
    const recorded = await recordRealAgentExecution({
      agentName: input.agentName,
      title: input.title,
      rewardUsdt: input.amountUsdt,
      txHash: input.txHash,
      network,
      projectTitle: input.projectTitle,
      source: "onchain_verified",
      jobId: input.jobId ?? null,
      verified: true,
      activityAction: `واریز ${input.amountUsdt} USDT تأییدشده روی زنجیره`,
      detail: `${verification.reason} • هش: ${input.txHash}`,
    });
    return { status: "confirmed" as const, verification, recorded };
  }

  const tx = await recordPendingDeposit({
    agentName: input.agentName,
    title: input.title,
    amountUsdt: input.amountUsdt,
    txHash: input.txHash,
    network,
    source: input.source || "ingest",
    projectTitle: input.projectTitle,
    jobId: input.jobId ?? null,
    verifyNote: `نیازمند تأیید دستی — ${verification.reason}`,
  });
  return { status: "pending_verification" as const, verification, transaction: tx };
}
