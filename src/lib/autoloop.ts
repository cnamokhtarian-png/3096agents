import { db } from "@/db";
import {
  agentActivityLogs,
  agentJobs,
  agents,
  settings,
  systemEvents,
} from "@/db/schema";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { createJob } from "@/lib/jobs";
import {
  activeAgentsForLoop,
  lastAgentActivity,
  pickMission,
  type MissionAgent,
} from "@/lib/missions";
import { runFleetCycle } from "@/lib/coo";
import { ENV } from "@/lib/env";
import { escapeHtml, notifyAdmin, telegramConfigured } from "@/lib/telegram";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  حلقهٔ خودکار ۲۴/۷ (Autonomous Loop) — قلب عملیات پیوستهٔ شرکت
 * ═══════════════════════════════════════════════════════════════════════
 *
 *  هر «تیک» (tick) این حلقه پنج کار انجام می‌دهد:
 *
 *   ۱. اجرای موتورهای زندهٔ ناوگان (آریا / بانتی‌هانتر / متخصص‌ها) —
 *      همان job=full که تا امروز دستی یا با کرون اجرا می‌شد.
 *   ۲. پر نگه‌داشتن صف (Always-On Queue): برای هر کارمند فعال که کمتر از
 *      سهمیهٔ کارت منتظر تأیید دارد، «مأموریت بعدی» ساخته می‌شود.
 *   ۳. جایگزینی پویا (Dynamic Replenishment): به‌محض تأیید/رد یک کارت،
 *      همان کارمند بلافاصله مأموریت تازه می‌گیرد (تابع replenishForAgent
 *      از مسیر تأیید پنل و تلگرام صدا زده می‌شود).
 *   ۴. گزارش خلاصه در تلگرام مدیرعامل (با محدودیت زمانی برای جلوگیری از
 *      اسپم).
 *   ۵. ثبت وضعیت حلقه در جدول settings (تیک بعدی، آمار، زمان آخرین اجرا).
 *
 *  هیچ دادهٔ مالی‌ای در این مسیر ساخته نمی‌شود: مأموریت‌ها کار داخلی
 *  (تحلیل، تدوین، بازرسی) هستند و همه پیش از اجرا تأیید مدیرعامل را
 *  می‌خواهند — قفل HITL دست‌نخورده می‌ماند.
 *
 *  حالت‌های اجرا:
 *   • source = "cron"  → GitHub Actions / Vercel Cron
 *   • source = "panel" → دکمهٔ «اجرای یک تیک» در داشبورد
 *   • source = "telegram" → دستور /loop در ربات
 */

export type LoopSource = "cron" | "panel" | "telegram" | "api";

export type LoopConfig = {
  enabled: boolean;
  intervalMinutes: number;
  targetPendingTotal: number;
  maxPendingPerAgent: number;
  maxCardsPerTick: number;
  runEnginesEveryTick: boolean;
  digestEnabled: boolean;
  digestMinMinutes: number;
  cooldownHours: number;
};

export type LoopState = LoopConfig & {
  lastTickAt: string | null;
  lastTickSource: string | null;
  nextTickAt: string | null;
  lastDigestAt: string | null;
  totals: {
    ticks: number;
    cardsCreated: number;
    cardsApproved: number;
    cardsRejected: number;
    missionsApproved: number;
    errors: number;
  };
};

const KEYS = {
  enabled: "loop_enabled",
  interval: "loop_interval_minutes",
  target: "loop_target_pending",
  perAgent: "loop_max_pending_per_agent",
  perTick: "loop_max_cards_per_tick",
  engines: "loop_run_engines",
  digest: "loop_digest_enabled",
  digestMin: "loop_digest_min_minutes",
  cooldown: "loop_cooldown_hours",
  lastTick: "loop_last_tick_at",
  lastSource: "loop_last_source",
  lastDigestAt: "loop_last_digest_at",
  totals: "loop_totals",
} as const;

const DEFAULTS: LoopConfig = {
  enabled: true,
  intervalMinutes: 15,
  targetPendingTotal: 8,
  maxPendingPerAgent: 2,
  maxCardsPerTick: 3,
  runEnginesEveryTick: true,
  digestEnabled: true,
  digestMinMinutes: 45,
  cooldownHours: 6,
};

function num(raw: string | undefined, fallback: number) {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function bool(raw: string | undefined, fallback: boolean) {
  if (raw === undefined || raw === "") return fallback;
  return ["true", "1", "yes", "on", "enabled"].includes(raw.trim().toLowerCase());
}

async function readSettings(): Promise<Map<string, string>> {
  try {
    const rows = await db.select().from(settings);
    return new Map(rows.map((r) => [r.key, r.value]));
  } catch {
    return new Map();
  }
}

async function writeSetting(key: string, value: string) {
  await db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value: sql`excluded.value` } });
}

function parseTotals(raw?: string): LoopState["totals"] {
  const base: LoopState["totals"] = {
    ticks: 0,
    cardsCreated: 0,
    cardsApproved: 0,
    cardsRejected: 0,
    missionsApproved: 0,
    errors: 0,
  };
  if (!raw) return base;
  try {
    const parsed = JSON.parse(raw);
    return {
      ticks: Number(parsed.ticks || 0),
      cardsCreated: Number(parsed.cardsCreated || 0),
      cardsApproved: Number(parsed.cardsApproved || 0),
      cardsRejected: Number(parsed.cardsRejected || 0),
      missionsApproved: Number(parsed.missionsApproved || 0),
      errors: Number(parsed.errors || 0),
    };
  } catch {
    return base;
  }
}

/** وضعیت کامل حلقه (برای پنل، API و تلگرام). */
export async function getLoopState(): Promise<LoopState> {
  const map = await readSettings();
  const config: LoopConfig = {
    enabled: bool(map.get(KEYS.enabled), DEFAULTS.enabled),
    intervalMinutes: num(map.get(KEYS.interval), DEFAULTS.intervalMinutes),
    targetPendingTotal: num(map.get(KEYS.target), DEFAULTS.targetPendingTotal),
    maxPendingPerAgent: num(map.get(KEYS.perAgent), DEFAULTS.maxPendingPerAgent),
    maxCardsPerTick: num(map.get(KEYS.perTick), DEFAULTS.maxCardsPerTick),
    runEnginesEveryTick: bool(map.get(KEYS.engines), DEFAULTS.runEnginesEveryTick),
    digestEnabled: bool(map.get(KEYS.digest), DEFAULTS.digestEnabled),
    digestMinMinutes: num(map.get(KEYS.digestMin), DEFAULTS.digestMinMinutes),
    cooldownHours: num(map.get(KEYS.cooldown), DEFAULTS.cooldownHours),
  };

  const lastTickAt = map.get(KEYS.lastTick) || null;
  const nextTickAt = lastTickAt
    ? new Date(
        new Date(lastTickAt).getTime() + config.intervalMinutes * 60_000,
      ).toISOString()
    : null;

  return {
    ...config,
    lastTickAt,
    lastTickSource: map.get(KEYS.lastSource) || null,
    nextTickAt,
    lastDigestAt: map.get(KEYS.lastDigestAt) || null,
    totals: parseTotals(map.get(KEYS.totals)),
  };
}

/** تغییر تنظیمات حلقه (پنل / تلگرام / API). */
export async function setLoopConfig(patch: Partial<LoopConfig>) {
  const jobs: Array<Promise<void>> = [];
  if (patch.enabled !== undefined) jobs.push(writeSetting(KEYS.enabled, String(patch.enabled)));
  if (patch.intervalMinutes !== undefined)
    jobs.push(
      writeSetting(
        KEYS.interval,
        String(Math.max(1, Math.round(patch.intervalMinutes))),
      ),
    );
  if (patch.targetPendingTotal !== undefined)
    jobs.push(
      writeSetting(KEYS.target, String(Math.max(1, Math.round(patch.targetPendingTotal)))),
    );
  if (patch.maxPendingPerAgent !== undefined)
    jobs.push(
      writeSetting(KEYS.perAgent, String(Math.max(1, Math.round(patch.maxPendingPerAgent)))),
    );
  if (patch.maxCardsPerTick !== undefined)
    jobs.push(
      writeSetting(KEYS.perTick, String(Math.max(1, Math.round(patch.maxCardsPerTick)))),
    );
  if (patch.runEnginesEveryTick !== undefined)
    jobs.push(writeSetting(KEYS.engines, String(patch.runEnginesEveryTick)));
  if (patch.digestEnabled !== undefined)
    jobs.push(writeSetting(KEYS.digest, String(patch.digestEnabled)));
  if (patch.digestMinMinutes !== undefined)
    jobs.push(
      writeSetting(
        KEYS.digestMin,
        String(Math.max(5, Math.round(patch.digestMinMinutes))),
      ),
    );
  if (patch.cooldownHours !== undefined)
    jobs.push(writeSetting(KEYS.cooldown, String(Math.max(0, Math.round(patch.cooldownHours)))));
  await Promise.all(jobs);

  await db
    .insert(agentActivityLogs)
    .values({
      agentName: "RNAI · مدیر ارشد اجرایی (COO)",
      action: "تنظیمات حلقهٔ خودکار ۲۴/۷ به‌روزرسانی شد",
      status: "info",
      detail: Object.entries(patch)
        .map(([k, v]) => `${k}=${v}`)
        .join(" • "),
      source: "autoloop",
    })
    .catch(() => {});

  return getLoopState();
}

type QueueSnapshot = {
  byAgent: Array<{
    id: number;
    name: string;
    pending: number;
    lastActivityAt: string | null;
    needsCard: boolean;
  }>;
  pendingTotal: number;
  targetPendingTotal: number;
  maxPerAgent: number;
  enabled: boolean;
};

/** عکس لحظه‌ای صف تأیید به تفکیک کارمند. */
export async function getQueueSnapshot(state?: LoopState): Promise<QueueSnapshot> {
  const loop = state ?? (await getLoopState());
  const [active, pendingJobs] = await Promise.all([
    activeAgentsForLoop(),
    db
      .select({ agentId: agentJobs.agentId, status: agentJobs.status })
      .from(agentJobs)
      .where(inArray(agentJobs.status, ["awaiting_approval", "queued"])),
  ]);

  const counts = new Map<number, number>();
  for (const j of pendingJobs) {
    if (j.agentId === null) continue;
    counts.set(j.agentId, (counts.get(j.agentId) || 0) + 1);
  }

  const byAgent = await Promise.all(
    active.map(async (a) => {
      const pending = counts.get(a.id) || 0;
      const last = await lastAgentActivity(a.name).catch(() => null);
      return {
        id: a.id,
        name: a.name,
        pending,
        lastActivityAt: last?.createdAt ? new Date(last.createdAt).toISOString() : null,
        needsCard: pending < loop.maxPendingPerAgent,
      };
    }),
  );

  return {
    byAgent,
    pendingTotal: pendingJobs.length,
    targetPendingTotal: loop.targetPendingTotal,
    maxPerAgent: loop.maxPendingPerAgent,
    enabled: loop.enabled,
  };
}

/**
 * جایگزینی پویا برای یک کارمند مشخص.
 * از مسیر تأیید/رد (پنل، تلگرام، API) صدا زده می‌شود تا جایگاه کارت
 * خالی نماند. کاملاً بی‌صدا و مقاوم به خطاست: خطای این تابع نباید
 * تأیید مدیرعامل را خراب کند.
 */
export async function replenishForAgent(
  agentId: number,
  reason: string,
): Promise<{ ok: boolean; createdJobId?: number; skipped?: string }> {
  try {
    const state = await getLoopState();
    if (!state.enabled) return { ok: false, skipped: "loop_disabled" };

    const rows = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
    const agent = rows[0];
    if (!agent || agent.status === "paused") return { ok: false, skipped: "agent_inactive" };

    const pending = await db
      .select({ n: sql<number>`COUNT(*)` })
      .from(agentJobs)
      .where(
        and(
          eq(agentJobs.agentId, agentId),
          inArray(agentJobs.status, ["awaiting_approval", "queued"]),
        ),
      );
    const pendingCount = Number(pending[0]?.n || 0);
    if (pendingCount >= state.maxPendingPerAgent) {
      return { ok: false, skipped: "agent_queue_full" };
    }

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

    const picked = await pickMission(missionAgent, { cooldownHours: state.cooldownHours });
    if (!picked.ok) return { ok: false, skipped: "no_mission_candidate" };

    const { job } = await createJob({
      agentId: agent.id,
      agentName: agent.name,
      kind: "mission",
      title: picked.candidate.title,
      detail: picked.candidate.detail,
      payload: {
        ...picked.candidate.grounding,
        missionKey: picked.candidate.key,
        deliverable: picked.candidate.deliverable,
        steps: picked.candidate.steps,
        rotation: picked.rotated,
        refillReason: reason,
      },
      risk: picked.candidate.risk,
      requiresApproval: true,
    });

    await db.insert(agentActivityLogs).values({
      agentId: agent.id,
      agentName: agent.name,
      action: picked.rotated
        ? "مأموریت جایگزین (دور دوم قالب) به‌دلیل خالی‌شدن جایگاه صف ساخته شد"
        : "مأموریت جدید به‌صورت خودکار جایگزین کارت تعیین‌تکلیف‌شده شد",
      status: "pending",
      detail: `دلیل: ${reason} • ${picked.candidate.title}`,
      jobId: job.id,
      source: "autoloop",
      meta: { missionKey: picked.candidate.key, rotated: picked.rotated, refillReason: reason },
    }).catch(() => {});

    await bumpTotals({ cardsCreated: 1 }).catch(() => {});
    return { ok: true, createdJobId: job.id };
  } catch (e: any) {
    await db
      .insert(systemEvents)
      .values({
        level: "error",
        scope: "autoloop:replenish",
        message: e?.message || String(e),
        meta: { agentId, reason },
      })
      .catch(() => {});
    return { ok: false, skipped: "error" };
  }
}

async function bumpTotals(patch: Partial<LoopState["totals"]>) {
  const map = await readSettings();
  const totals = parseTotals(map.get(KEYS.totals));
  const next: LoopState["totals"] = {
    ticks: totals.ticks + (patch.ticks || 0),
    cardsCreated: totals.cardsCreated + (patch.cardsCreated || 0),
    cardsApproved: totals.cardsApproved + (patch.cardsApproved || 0),
    cardsRejected: totals.cardsRejected + (patch.cardsRejected || 0),
    missionsApproved: totals.missionsApproved + (patch.missionsApproved || 0),
    errors: totals.errors + (patch.errors || 0),
  };
  await writeSetting(KEYS.totals, JSON.stringify(next));
  return next;
}

/** ثبت تصمیم مدیرعامل در آمار حلقه (از approve/reject صدا زده می‌شود). */
export async function recordDecision(
  kind: "approved" | "rejected",
  opts: { mission?: boolean } = {},
) {
  await bumpTotals(
    kind === "approved"
      ? { cardsApproved: 1, missionsApproved: opts.mission ? 1 : 0 }
      : { cardsRejected: 1 },
  ).catch(() => {});
}

export type LoopTickResult = {
  ok: boolean;
  source: LoopSource;
  skipped?: string;
  durationMs: number;
  engines: {
    ran: boolean;
    durationMs?: number;
    ariaSetups?: number;
    bountyFeeds?: number;
    specialistProposals?: number;
    error?: string;
  };
  missions: {
    created: number;
    cards: Array<{ agent: string; jobId: number; title: string; missionKey: string; rotated: boolean }>;
    perAgentCapped: string[];
    poolExhausted: boolean;
  };
  decisions: { approvedSinceLastTick: number; rejectedSinceLastTick: number };
  queueBefore: { pendingTotal: number };
  queueAfter: { pendingTotal: number };
  digest: { sent: boolean; reason?: string };
  state: LoopState;
  orders?: string[];
};

function buildDigest(result: LoopTickResult, cardsLines: string[]) {
  const lines = [
    "♾️ <b>گزارش حلقهٔ خودکار ۲۴/۷ — RNAI (COO)</b>",
    `🕒 تیک: <code>${escapeHtml(new Date().toLocaleString("fa-IR"))}</code> • منبع: <code>${escapeHtml(result.source)}</code>`,
    "",
    `📥 <b>صف تأیید:</b> قبل ${result.queueBefore.pendingTotal} → بعد <b>${result.queueAfter.pendingTotal}</b> از هدف ${result.state.targetPendingTotal}`,
    `📨 <b>تصمیم‌های شما از تیک قبل:</b> تأیید ${result.decisions.approvedSinceLastTick} • رد ${result.decisions.rejectedSinceLastTick}`,
    `🆕 <b>مأموریت تازه:</b> ${result.missions.created} کارت`,
  ];
  if (cardsLines.length) lines.push("", ...cardsLines);
  if (result.decisions.approvedSinceLastTick + result.decisions.rejectedSinceLastTick > 0) {
    lines.push("", "🔁 جایگاه هر کارت تعیین‌تکلیف‌شده بلافاصله با مأموریت تازه پر شد.");
  }
  if (result.missions.perAgentCapped.length) {
    lines.push(
      `⏳ در سقف کارت: ${escapeHtml(result.missions.perAgentCapped.join("، "))} (تا تعیین‌تکلیف کارت‌های فعلی، مأموریت جدید نمی‌گیرند)`,
    );
  }
  if (result.engines.ran) {
    lines.push(
      "",
      `📡 <b>موتورهای زنده:</b> جفت‌ارز تحلیل‌شده ${result.engines.ariaSetups ?? 0} • فید بانتی ${result.engines.bountyFeeds ?? 0} • پروپوزال تخصصی ${result.engines.specialistProposals ?? 0}`,
    );
  }
  if (result.engines.error) {
    lines.push(`⚠️ خطای موتور: ${escapeHtml(result.engines.error)}`);
  }
  lines.push(
    "",
    "🔒 <i>هیچ تراکنش مالی بدون دکمه [✅] شما اجرا نمی‌شود؛ حلقه فقط پیشنهاد می‌سازد.</i>",
  );
  return lines.join("\n");
}

/**
 * یک تیک کامل حلقهٔ خودکار.
 *
 * @param options.source        منبع فراخوانی
 * @param options.runEngines    اجرای موتورهای زنده (آریا/بانتی/متخصص‌ها)
 * @param options.forceDigest   ارسال گزارش حتی بدون تغییر
 * @param options.maxCards      سقف کارت‌های این تیک
 */
export async function runAutonomousLoop(
  options: {
    source?: LoopSource;
    runEngines?: boolean;
    forceDigest?: boolean;
    maxCards?: number;
  } = {},
): Promise<LoopTickResult> {
  const started = Date.now();
  const source: LoopSource = options.source ?? "api";
  const orders: string[] = [];

  const before = await getLoopState();

  // توقف اضطراری فقط روی تیک‌های خودکار اثر دارد؛ اجرای دستی (پنل/تلگرام)
  // و اجرای با گزینهٔ صریح، همیشه مجاز است تا مدیرعامل قفل نشود.
  const isManual = source === "panel" || source === "telegram";
  if (
    !before.enabled &&
    !isManual &&
    !options.forceDigest &&
    options.runEngines === undefined &&
    !options.maxCards
  ) {
    const queue = await getQueueSnapshot(before);
    return {
      ok: true,
      source,
      skipped: "loop_disabled",
      durationMs: Date.now() - started,
      engines: { ran: false },
      missions: { created: 0, cards: [], perAgentCapped: [], poolExhausted: false },
      decisions: { approvedSinceLastTick: 0, rejectedSinceLastTick: 0 },
      queueBefore: { pendingTotal: queue.pendingTotal },
      queueAfter: { pendingTotal: queue.pendingTotal },
      digest: { sent: false, reason: "loop_disabled" },
      state: before,
      orders,
    };
  }

  // ── ۱) موتورهای زنده ────────────────────────────────────────────────
  const engines: LoopTickResult["engines"] = { ran: false };
  const shouldRunEngines = options.runEngines ?? before.runEnginesEveryTick;
  if (shouldRunEngines) {
    const t0 = Date.now();
    try {
      const cycle = await runFleetCycle({
        charterFirst: false,
        forceAriaCard: false,
        maxSpecialistProposals: 1,
      });
      engines.ran = true;
      engines.durationMs = Date.now() - t0;
      engines.ariaSetups = cycle.aria.setups?.length ?? 0;
      engines.bountyFeeds = "feedsChecked" in cycle.bounty ? cycle.bounty.feedsChecked : 0;
      engines.specialistProposals = cycle.specialists.proposalsDispatched;
      orders.push(
        `engines: ${engines.ariaSetups} setups • ${engines.bountyFeeds} bounty feeds • ${engines.specialistProposals} proposals`,
      );
    } catch (e: any) {
      engines.ran = true;
      engines.durationMs = Date.now() - t0;
      engines.error = e?.message || String(e);
      orders.push(`engines failed: ${engines.error}`);
      await db
        .insert(systemEvents)
        .values({
          level: "error",
          scope: "autoloop:engines",
          message: engines.error!,
        })
        .catch(() => {});
    }
  }

  // ── ۲) پر نگه‌داشتن صف ─────────────────────────────────────────────
  const queueBefore = await getQueueSnapshot(before);
  const cards: LoopTickResult["missions"]["cards"] = [];
  const perAgentCapped: string[] = [];
  const pool = await activeAgentsForLoop();

  let pendingTotal = queueBefore.pendingTotal;
  const maxCards = Math.max(
    0,
    Math.min(options.maxCards ?? before.maxCardsPerTick, 12),
  );

  // اولویت: کارمندانی که کمترین کارت را دارند (عدالت در توزیع کار)
  const order = pool
    .map((a) => ({
      agent: a,
      pending: queueBefore.byAgent.find((x) => x.id === a.id)?.pending ?? 0,
    }))
    .sort((a, b) => a.pending - b.pending || a.agent.id - b.agent.id);

  for (const { agent, pending } of order) {
    if (cards.length >= maxCards) break;
    if (pendingTotal >= before.targetPendingTotal) break;
    if (pending >= before.maxPendingPerAgent) {
      perAgentCapped.push(agent.name);
      continue;
    }

    const picked = await pickMission(agent, { cooldownHours: before.cooldownHours });
    if (!picked.ok) {
      orders.push(`skip ${agent.slug}: ${picked.reason}`);
      continue;
    }

    try {
      const { job, telegram } = await createJob({
        agentId: agent.id,
        agentName: agent.name,
        kind: "mission",
        title: picked.candidate.title,
        detail: picked.candidate.detail,
        payload: {
          ...picked.candidate.grounding,
          missionKey: picked.candidate.key,
          deliverable: picked.candidate.deliverable,
          steps: picked.candidate.steps,
          rotation: picked.rotated,
          refillReason: "loop_tick",
        },
        risk: picked.candidate.risk,
        requiresApproval: true,
      });

      cards.push({
        agent: agent.name,
        jobId: job.id,
        title: picked.candidate.title,
        missionKey: picked.candidate.key,
        rotated: picked.rotated,
      });
      pendingTotal += 1;
      orders.push(
        `card #${job.id} ${agent.slug} → ${picked.candidate.key}${telegram.ok ? " (telegram sent)" : " (panel only)"}`,
      );

      await db.insert(agentActivityLogs).values({
        agentId: agent.id,
        agentName: agent.name,
        action: "مأموریت خودکار بعدی ساخته شد (حلقهٔ ۲۴/۷)",
        status: "pending",
        detail: `${picked.candidate.title} • ${picked.candidate.deliverable}`,
        jobId: job.id,
        source: "autoloop",
        meta: {
          missionKey: picked.candidate.key,
          rotated: picked.rotated,
          pendingBefore: pending,
        },
      }).catch(() => {});

      await db
        .update(agents)
        .set({ currentFocus: picked.candidate.title.slice(0, 180), lastActiveAt: new Date() })
        .where(eq(agents.id, agent.id))
        .catch(() => {});
    } catch (e: any) {
      orders.push(`card failed ${agent.slug}: ${e?.message || e}`);
    }
  }

  const queueAfter = await getQueueSnapshot(before);

  // ── ۳) تصمیم‌های مدیرعامل از تیک قبل ───────────────────────────────
  const since = before.lastTickAt ? new Date(before.lastTickAt) : new Date(Date.now() - 60 * 60_000);
  const decisions = { approvedSinceLastTick: 0, rejectedSinceLastTick: 0 };
  try {
    const rows = await db
      .select({ status: agentJobs.status })
      .from(agentJobs)
      .where(
        and(
          inArray(agentJobs.status, ["succeeded", "rejected"]),
          gte(agentJobs.approvedAt, since),
        ),
      );
    decisions.approvedSinceLastTick = rows.filter((r) => r.status === "succeeded").length;
    decisions.rejectedSinceLastTick = rows.filter((r) => r.status === "rejected").length;
  } catch {
    // شمارش تصمیم‌ها حیاتی نیست
  }

  const durationMs = Date.now() - started;

  // شمارنده‌ها به‌صورت اتمیک اضافه می‌شوند (نه بازنویسی) تا اگر مدیرعامل
  // وسط همین تیک کارتی را تأیید/رد کند، آمار از دست نرود.
  const totals = await bumpTotals({
    ticks: 1,
    cardsCreated: cards.length,
    errors: engines.error ? 1 : 0,
  }).catch(() => before.totals);

  const nextState: LoopState = {
    ...before,
    lastTickAt: new Date().toISOString(),
    lastTickSource: source,
    nextTickAt: new Date(Date.now() + before.intervalMinutes * 60_000).toISOString(),
    totals,
  };

  const result: LoopTickResult = {
    ok: true,
    source,
    durationMs,
    engines,
    missions: {
      created: cards.length,
      cards,
      perAgentCapped,
      poolExhausted: cards.length < maxCards && pendingTotal < before.targetPendingTotal,
    },
    decisions,
    queueBefore: { pendingTotal: queueBefore.pendingTotal },
    queueAfter: { pendingTotal: queueAfter.pendingTotal },
    digest: { sent: false },
    state: nextState,
    orders,
  };

  // ── ۴) گزارش تلگرام ────────────────────────────────────────────────
  const lastDigestMs = before.lastDigestAt ? new Date(before.lastDigestAt).getTime() : 0;
  const digestDue =
    before.digestEnabled &&
    (options.forceDigest ||
      cards.length > 0 ||
      decisions.approvedSinceLastTick + decisions.rejectedSinceLastTick > 0 ||
      Date.now() - lastDigestMs >= before.digestMinMinutes * 60_000);

  if (!telegramConfigured() || !ENV.telegramAdminChat()) {
    result.digest = { sent: false, reason: "telegram_not_configured" };
  } else if (!digestDue) {
    result.digest = { sent: false, reason: "throttled" };
  } else {
    const lines = cards.slice(0, 6).map(
      (c) =>
        `• #${c.jobId} <b>${escapeHtml(c.agent)}</b> — ${escapeHtml(c.title)}${c.rotated ? " ♻️" : ""}`,
    );
    const res = await notifyAdmin(buildDigest(result, lines));
    result.digest = res.ok
      ? { sent: true }
      : { sent: false, reason: (res as any).description || (res as any).error || "failed" };
    if (res.ok) {
      nextState.lastDigestAt = new Date().toISOString();
      result.state.lastDigestAt = nextState.lastDigestAt;
    }
  }

  // ── ۵) ثبت وضعیت ──────────────────────────────────────────────────
  await Promise.all([
    writeSetting(KEYS.lastTick, nextState.lastTickAt!),
    writeSetting(KEYS.lastSource, source),
    nextState.lastDigestAt
      ? writeSetting(KEYS.lastDigestAt, nextState.lastDigestAt)
      : Promise.resolve(),
    db
      .insert(agentActivityLogs)
      .values({
        agentName: "RNAI · مدیر ارشد اجرایی (COO)",
        action: `تیک حلقهٔ خودکار ۲۴/۷ اجرا شد (${source})`,
        status: engines.error ? "error" : "success",
        detail: `کارت تازه: ${cards.length} • صف: ${queueBefore.pendingTotal} → ${queueAfter.pendingTotal} • تصمیم‌های شما: تأیید ${decisions.approvedSinceLastTick} / رد ${decisions.rejectedSinceLastTick} • مدت: ${durationMs}ms${engines.error ? ` • خطای موتور: ${engines.error}` : ""}`,
        source: "autoloop",
        meta: {
          source,
          cardsCreated: cards.length,
          pendingBefore: queueBefore.pendingTotal,
          pendingAfter: queueAfter.pendingTotal,
          decisions,
          durationMs,
          digestSent: result.digest.sent,
        },
      })
      .catch(() => {}),
  ]);

  return result;
}

/** فعال/غیرفعال کردن حلقه از تلگرام یا پنل، با پیام تأیید. */
export async function toggleLoop(enabled: boolean, actor: string) {
  const state = await setLoopConfig({ enabled });
  await db
    .insert(systemEvents)
    .values({
      level: "info",
      scope: "autoloop",
      message: enabled ? "حلقهٔ خودکار ۲۴/۷ فعال شد" : "حلقهٔ خودکار ۲۴/۷ متوقف شد",
      meta: { actor },
    })
    .catch(() => {});
  return state;
}
