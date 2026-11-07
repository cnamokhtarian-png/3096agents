/**
 * 🏆 موتور ارزیابی و رقابت ایجنت‌ها (Agent Leaderboard / Employee of the Month)
 * ---------------------------------------------------------------------------
 * فرمول امتیاز (۰ تا ۱۰۰):
 *   Score = 100 × ( W_success × SR_adj + W_revenue × RS + W_speed × SS )
 *
 *   SR_adj = (موفقیت + ۱) / (کل پروژه‌ها + ۲)      ← Laplace smoothing
 *            جلوی «یک پروژهٔ موفق = ۱۰۰٪» و بازی با نمونهٔ کوچک را می‌گیرد.
 *   RS     = min(1, درآمد واقعی دوره / هدف درآمد)   ← از جدول transactions
 *   SS     = min(1, زمان هدف / میانگین زمان تأیید)   ← فقط پروژه‌های موفق
 *            بدون دادهٔ زمان: ۰٫۵ (خنثی)
 *
 * درآمد از جدول `transactions` خوانده می‌شود (تنها منبع مالی حقیقت)، پس ثبت
 * نتیجه در دفترچه و واریز سود دوبار شمرده نمی‌شود. وزن‌ها و اهداف از جدول
 * `settings` خوانده می‌شوند و از طریق داشبورد قابل تغییرند.
 */

import { db } from "@/db";
import {
  agents,
  agentScoreEvents,
  agentMonthlyAwards,
  transactions,
  settings,
  agentLogs,
} from "@/db/schema";
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { getTelegramChatId, sendTelegramMessage } from "@/lib/telegram";

export type Outcome = "success" | "failure" | "error";

export const OUTCOME_POINTS: Record<Outcome, number> = {
  success: 10,
  failure: -5,
  error: -8,
};

export const OUTCOME_LABELS: Record<Outcome, string> = {
  success: "✅ موفق و تأییدشده",
  failure: "❌ شکست / رد شده",
  error: "⚠️ خطای اجرایی",
};

export const DEFAULT_CONFIG = {
  weightSuccess: 60,
  weightRevenue: 30,
  weightSpeed: 10,
  revenueTarget: 1000, // USDT در هر دوره
  durationTarget: 60, // دقیقه، از پیشنهاد تا تأیید نهایی
  boostMultiplier: 2, // ضریب اولویت اسکن بازار برای برندهٔ ماه
};

export type LeaderboardConfig = typeof DEFAULT_CONFIG;

const SETTING_KEYS: Record<keyof LeaderboardConfig, string> = {
  weightSuccess: "leaderboard_weight_success",
  weightRevenue: "leaderboard_weight_revenue",
  weightSpeed: "leaderboard_weight_speed",
  revenueTarget: "leaderboard_revenue_target",
  durationTarget: "leaderboard_duration_target",
  boostMultiplier: "leaderboard_boost_multiplier",
};

const BOOST_KEYS = {
  agentId: "leaderboard_boost_agent_id",
  period: "leaderboard_boost_period",
  multiplier: "leaderboard_boost_multiplier",
};

const clamp = (n: number, min = 0, max = 1) =>
  Math.max(min, Math.min(max, Number.isFinite(n) ? n : min));
const round1 = (n: number) => Math.round(n * 10) / 10;
const pf = (n: number | string) =>
  Number(n || 0).toLocaleString("fa-IR", { maximumFractionDigits: 1 });

export function isOutcome(v: unknown): v is Outcome {
  return v === "success" || v === "failure" || v === "error";
}

/** 'YYYY-MM' بر اساس UTC؛ رشتهٔ نامعتبر خطا می‌دهد. */
export function normalizePeriod(value?: string | null): string {
  if (!value) return periodKey(new Date());
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    throw new Error("فرمت دوره باید YYYY-MM باشد");
  }
  return value;
}

export function periodKey(d: Date = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function shiftPeriod(period: string, delta: number): string {
  const [y, m] = period.split("-").map(Number);
  return periodKey(new Date(Date.UTC(y, m - 1 + delta, 1)));
}

export function periodBounds(period: string): { start: Date; end: Date } {
  const [y, m] = period.split("-").map(Number);
  return {
    start: new Date(Date.UTC(y, m - 1, 1)),
    end: new Date(Date.UTC(y, m, 1)),
  };
}

/** نام ماه به تقویم شمسی، مثلاً «آبان ۱۴۰۵». */
export function periodLabel(period: string): string {
  try {
    const { start } = periodBounds(period);
    return new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(start);
  } catch {
    return period;
  }
}

export function periodOptions(count = 6, from?: string): string[] {
  const base = normalizePeriod(from);
  return Array.from({ length: count }, (_, i) => shiftPeriod(base, -i));
}

async function readSettings(): Promise<Map<string, string>> {
  const rows = await db.select().from(settings);
  return new Map(rows.map((r) => [r.key, r.value]));
}

async function upsertSettings(entries: [string, string][]) {
  if (entries.length === 0) return;
  await db
    .insert(settings)
    .values(entries.map(([key, value]) => ({ key, value })))
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: sql`excluded.value` },
    });
}

export async function getConfig(): Promise<LeaderboardConfig> {
  const map = await readSettings();
  const read = (field: keyof LeaderboardConfig) => {
    const raw = map.get(SETTING_KEYS[field]);
    if (raw === undefined || raw === "") return DEFAULT_CONFIG[field];
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return DEFAULT_CONFIG[field];
    if (field.startsWith("weight") && n > 100) return DEFAULT_CONFIG[field];
    return n;
  };
  return {
    weightSuccess: read("weightSuccess"),
    weightRevenue: read("weightRevenue"),
    weightSpeed: read("weightSpeed"),
    revenueTarget: read("revenueTarget") || DEFAULT_CONFIG.revenueTarget,
    durationTarget: read("durationTarget") || DEFAULT_CONFIG.durationTarget,
    boostMultiplier: read("boostMultiplier") || DEFAULT_CONFIG.boostMultiplier,
  };
}

export async function saveConfig(
  patch: Partial<LeaderboardConfig>
): Promise<LeaderboardConfig> {
  const current = await getConfig();
  const next: LeaderboardConfig = { ...current };
  (Object.keys(DEFAULT_CONFIG) as (keyof LeaderboardConfig)[]).forEach((k) => {
    if (patch[k] !== undefined) {
      const v = Number(patch[k]);
      if (!Number.isFinite(v) || v < 0) {
        throw new Error(`مقدار «${k}» نامعتبر است`);
      }
      (next as any)[k] = v;
    }
  });
  if (
    next.weightSuccess + next.weightRevenue + next.weightSpeed <= 0 ||
    next.weightSuccess > 100 ||
    next.weightRevenue > 100 ||
    next.weightSpeed > 100
  ) {
    throw new Error("وزن‌ها باید بین ۰ تا ۱۰۰ و مجموع آن‌ها بزرگتر از صفر باشد");
  }
  if (next.revenueTarget <= 0 || next.durationTarget <= 0 || next.boostMultiplier <= 0) {
    throw new Error("اهداف درآمد، زمان و ضریب پاداش باید بزرگتر از صفر باشند");
  }
  await upsertSettings(
    (Object.keys(DEFAULT_CONFIG) as (keyof LeaderboardConfig)[]).map((k) => [
      SETTING_KEYS[k],
      String(next[k]),
    ])
  );
  return next;
}

export type LeaderboardRow = {
  agentId: number;
  name: string;
  slug: string;
  avatar: string;
  specialty: string;
  status: string;
  rank: number;
  previousRank: number | null;
  rankDelta: number | null;
  score: number;
  breakdown: { success: number; revenue: number; speed: number };
  totalProjects: number;
  successes: number;
  failures: number;
  errors: number;
  successRate: number;
  adjustedSuccessRate: number;
  revenueUsdt: number;
  avgDurationMinutes: number;
  points: number;
  needsReview: boolean;
  boosted: boolean;
};

type EventRow = typeof agentScoreEvents.$inferSelect;
type AgentRow = typeof agents.$inferSelect;

function buildRows(
  period: string,
  config: LeaderboardConfig,
  agentRows: AgentRow[],
  events: EventRow[],
  revenueByAgent: Map<number, number>
): LeaderboardRow[] {
  const sumW =
    config.weightSuccess + config.weightRevenue + config.weightSpeed || 100;
  const wS = config.weightSuccess / sumW;
  const wR = config.weightRevenue / sumW;
  const wP = config.weightSpeed / sumW;

  const rows: LeaderboardRow[] = agentRows.map((a) => {
    const evs = events.filter((e) => e.agentId === a.id);
    const total = evs.length;
    const successes = evs.filter((e) => e.outcome === "success").length;
    const failures = evs.filter((e) => e.outcome === "failure").length;
    const errors = evs.filter((e) => e.outcome === "error").length;
    const durations = evs
      .filter((e) => e.outcome === "success" && Number(e.durationMinutes) > 0)
      .map((e) => Number(e.durationMinutes));
    const avgDuration = durations.length
      ? durations.reduce((s, d) => s + d, 0) / durations.length
      : 0;
    const successRate = total ? successes / total : 0;
    // Laplace smoothing: نمونهٔ کوچک اجازهٔ جهش به صدر جدول را نمی‌گیرد.
    const adjustedSuccessRate = (successes + 1) / (total + 2);
    const revenueUsdt = revenueByAgent.get(a.id) || 0;
    const revenueScore = clamp(revenueUsdt / config.revenueTarget);
    const speedScore = durations.length
      ? clamp(config.durationTarget / avgDuration)
      : 0.5;
    const parts = {
      success: 100 * wS * adjustedSuccessRate,
      revenue: 100 * wR * revenueScore,
      speed: 100 * wP * speedScore,
    };
    const score =
      total === 0 ? 0 : round1(parts.success + parts.revenue + parts.speed);

    return {
      agentId: a.id,
      name: a.name,
      slug: a.slug,
      avatar: a.avatar,
      specialty: a.specialty,
      status: a.status,
      rank: 0,
      previousRank: null,
      rankDelta: null,
      score,
      breakdown: {
        success: round1(parts.success),
        revenue: round1(parts.revenue),
        speed: round1(parts.speed),
      },
      totalProjects: total,
      successes,
      failures,
      errors,
      successRate: round1(successRate * 100),
      adjustedSuccessRate: round1(adjustedSuccessRate * 100),
      revenueUsdt: round1(revenueUsdt),
      avgDurationMinutes: Math.round(avgDuration),
      points: evs.reduce((s, e) => s + Number(e.points || 0), 0),
      needsReview: total >= 3 && successRate < 0.6,
      boosted: false,
    };
  });

  rows.sort(
    (a, b) =>
      b.score - a.score ||
      b.revenueUsdt - a.revenueUsdt ||
      b.points - a.points ||
      a.name.localeCompare(b.name, "fa")
  );
  rows.forEach((r, i) => (r.rank = i + 1));
  return rows;
}

async function computePeriod(
  period: string,
  config: LeaderboardConfig
): Promise<{ rows: LeaderboardRow[]; unattributedRevenue: number }> {
  const { start, end } = periodBounds(period);
  const [agentRows, events, txs] = await Promise.all([
    db.select().from(agents),
    db.select().from(agentScoreEvents).where(eq(agentScoreEvents.period, period)),
    db
      .select()
      .from(transactions)
      .where(
        and(gte(transactions.createdAt, start), lt(transactions.createdAt, end))
      ),
  ]);

  // درآمد واقعی: فقط تراکنش‌های تأییدشدهٔ مثبت، منتسب با نام ایجنت.
  const revenueByAgent = new Map<number, number>();
  let unattributedRevenue = 0;
  for (const t of txs) {
    const amount = Number(t.amountUsdt || 0);
    if (amount <= 0 || t.status !== "confirmed") continue;
    const name = String(t.agentName || "");
    const agent =
      agentRows.find((a) => a.name === name) ||
      agentRows.find(
        (a) => name.length > 3 && (name.includes(a.name) || a.name.includes(name))
      );
    if (!agent) {
      unattributedRevenue += amount;
      continue;
    }
    revenueByAgent.set(agent.id, (revenueByAgent.get(agent.id) || 0) + amount);
  }

  return {
    rows: buildRows(period, config, agentRows, events, revenueByAgent),
    unattributedRevenue: round1(unattributedRevenue),
  };
}

export type LeaderboardData = {
  period: string;
  periodTitle: string;
  previousPeriod: string;
  periods: string[];
  config: LeaderboardConfig;
  formula: string;
  rows: LeaderboardRow[];
  winner: LeaderboardRow | null;
  totalEvents: number;
  totalRevenue: number;
  unattributedRevenue: number;
  recentEvents: EventRow[];
  awards: (typeof agentMonthlyAwards.$inferSelect)[];
  boost: {
    agentId: number | null;
    name: string;
    period: string;
    multiplier: number;
    active: boolean;
  };
};

export async function getLeaderboardData(
  periodInput?: string | null
): Promise<LeaderboardData> {
  const period = normalizePeriod(periodInput);
  const previousPeriod = shiftPeriod(period, -1);
  const config = await getConfig();
  const [cur, prev, recentEvents, awards, boostMap] = await Promise.all([
    computePeriod(period, config),
    computePeriod(previousPeriod, config),
    db
      .select()
      .from(agentScoreEvents)
      .where(eq(agentScoreEvents.period, period))
      .orderBy(desc(agentScoreEvents.id))
      .limit(40),
    db
      .select()
      .from(agentMonthlyAwards)
      .orderBy(desc(agentMonthlyAwards.period))
      .limit(12),
    readSettings(),
  ]);

  const prevRank = new Map(prev.rows.map((r) => [r.agentId, r.rank]));
  const boostAgentId = Number(boostMap.get(BOOST_KEYS.agentId) || 0) || null;
  const boostPeriod = boostMap.get(BOOST_KEYS.period) || "";
  const boostMultiplier =
    Number(boostMap.get(BOOST_KEYS.multiplier) || 0) || config.boostMultiplier;
  const boostName = boostAgentId
    ? cur.rows.find((r) => r.agentId === boostAgentId)?.name || ""
    : "";

  cur.rows.forEach((r) => {
    const p = prevRank.get(r.agentId);
    r.previousRank = p ?? null;
    r.rankDelta = p ? p - r.rank : null;
    r.boosted = Boolean(
      boostAgentId && boostPeriod === period && r.agentId === boostAgentId
    );
  });

  const hasActivity = cur.rows.some((r) => r.totalProjects > 0);
  return {
    period,
    periodTitle: periodLabel(period),
    previousPeriod,
    periods: periodOptions(8, period),
    config,
    formula: `امتیاز = ۱۰۰ × (${pf(config.weightSuccess)}٪ × نرخ موفقیت هموارشده + ${pf(config.weightRevenue)}٪ × درآمد/هدف + ${pf(config.weightSpeed)}٪ × سرعت/دقت)`,
    rows: cur.rows,
    winner: hasActivity ? cur.rows[0] : null,
    totalEvents: cur.rows.reduce((s, r) => s + r.totalProjects, 0),
    totalRevenue: round1(
      cur.rows.reduce((s, r) => s + r.revenueUsdt, 0)
    ),
    unattributedRevenue: cur.unattributedRevenue,
    recentEvents,
    awards,
    boost: {
      agentId: boostAgentId,
      name: boostName,
      period: boostPeriod,
      multiplier: boostMultiplier,
      active: Boolean(boostAgentId && boostPeriod === period),
    },
  };
}

export type ScoreEventInput = {
  agentId: number | string;
  outcome: Outcome;
  projectTitle?: string;
  durationMinutes?: number;
  source?: string;
  sourceRef?: string | null;
  note?: string;
  period?: string;
};

/** ثبت یک نتیجه در دفترچه — idempotent از طریق source_ref. */
export async function recordScoreEvent(input: ScoreEventInput) {
  const agentId = Number(input.agentId);
  const period = normalizePeriod(input.period);
  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
  if (!agent) throw new Error("ایجنت یافت نشد");
  if (!isOutcome(input.outcome)) throw new Error("نتیجه نامعتبر است");

  const durationMinutes = clamp(Number(input.durationMinutes) || 0, 0, 100000);
  const values = {
    agentId,
    agentName: agent.name,
    period,
    outcome: input.outcome,
    projectTitle: String(input.projectTitle || "").slice(0, 240),
    durationMinutes,
    points: OUTCOME_POINTS[input.outcome],
    source: String(input.source || "manual").slice(0, 40),
    sourceRef: input.sourceRef ? String(input.sourceRef).slice(0, 180) : null,
    note: String(input.note || "").slice(0, 500),
  };

  const inserted = await db
    .insert(agentScoreEvents)
    .values(values)
    .onConflictDoNothing({ target: agentScoreEvents.sourceRef })
    .returning();
  const event = inserted[0] || null;
  if (event) await flagNeedsReview(agentId, agent.name, period);
  return { event, duplicate: !event, period };
}

/**
 * ایجنتی که نرخ موفقیتش از ۶۰٪ پایین می‌رود (حداقل ۳ پروژه) در لاگ سیستم
 * به عنوان «نیازمند بازبینی پرامپت» علامت می‌خورد — حداکثر یک بار در روز.
 */
async function flagNeedsReview(agentId: number, name: string, period: string) {
  const evs = await db
    .select()
    .from(agentScoreEvents)
    .where(
      and(
        eq(agentScoreEvents.agentId, agentId),
        eq(agentScoreEvents.period, period)
      )
    );
  if (evs.length < 3) return;
  const good = evs.filter((e) => e.outcome === "success").length;
  if (good / evs.length >= 0.6) return;

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const existing = await db
    .select()
    .from(agentLogs)
    .where(
      and(
        eq(agentLogs.agent, name),
        eq(agentLogs.action, "⚠️ نیازمند بازبینی پرامپت"),
        gte(agentLogs.createdAt, today)
      )
    )
    .limit(1);
  if (existing.length) return;

  await db.insert(agentLogs).values({
    agent: name,
    action: "⚠️ نیازمند بازبینی پرامپت",
    status: "warning",
    detail: `نرخ موفقیت ${pf(Math.round((good / evs.length) * 100))}٪ در ${evs.length} پروژهٔ دورهٔ ${period} — پیشنهاد: بازبینی پرامپت/کد و کاهش خطاهای تکراری`,
    durationMs: 0,
  });
}

/** ایجنت برندهٔ دورهٔ قبل که باید در تخصیص منابع اولویت بگیرد. */
export async function getBoostedAgentId(): Promise<{
  agentId: number;
  multiplier: number;
} | null> {
  const map = await readSettings();
  if (map.get(BOOST_KEYS.period) !== periodKey()) return null;
  const id = Number(map.get(BOOST_KEYS.agentId) || 0);
  if (!id) return null;
  return {
    agentId: id,
    multiplier: Number(map.get(BOOST_KEYS.multiplier) || 0) || DEFAULT_CONFIG.boostMultiplier,
  };
}

export function buildTelegramReport(data: LeaderboardData): string {
  const w = data.winner;
  if (!w) return `🏆 لیگ کارمندان — ${data.periodTitle}\nهنوز پروژه‌ای ثبت نشده است.`;
  const medal = (i: number) => ["🥇", "🥈", "🥉"][i] || `${pf(i + 1)}.`;
  const others = data.rows
    .slice(1, 4)
    .map(
      (r, i) =>
        `${medal(i + 1)} ${r.avatar} ${r.name} — ${pf(r.score)} امتیاز (${pf(r.successRate)}٪ موفق)`
    )
    .join("\n");
  const boostPeriod = periodLabel(shiftPeriod(data.period, 1));
  return [
    `🏆 <b>کارمند برتر ماه — ${data.periodTitle}</b>`,
    "",
    `${medal(0)} <b>${w.avatar} ${w.name}</b> با <b>${pf(w.score)}</b> امتیاز از ۱۰۰`,
    `• نرخ موفقیت: ${pf(w.successRate)}٪ (${pf(w.successes)} از ${pf(w.totalProjects)} پروژهٔ استارت‌شده)`,
    `• سود خالص ثبت‌شده: ${pf(w.revenueUsdt)} تتر (USDT)`,
    `• میانگین زمان پیشنهاد تا تأیید: ${pf(w.avgDurationMinutes)} دقیقه`,
    `• امتیاز انگیزشی: ${pf(w.points)} (هر موفقیت +۱۰ / شکست -۵ / خطا -۸)`,
    "",
    `🎁 <b>پاداش ساختاری:</b> اولویت ${pf(data.config.boostMultiplier)} برابری در اسکن بازار و تخصیص پردازش برای ${boostPeriod}`,
    "",
    "📊 <b>جدول لیگ:</b>",
    others || "— رقیب دیگری ثبت نشده",
    "",
    `⚙️ ${data.formula}`,
    `#AgentLeague #EmployeeOfTheMonth`,
  ].join("\n");
}

export async function closeMonth(
  periodInput?: string | null,
  opts: { dryRun?: boolean; force?: boolean } = {}
) {
  const period = normalizePeriod(periodInput);
  const data = await getLeaderboardData(period);
  const message = buildTelegramReport(data);
  if (!data.winner) {
    return { ok: false, error: "در این دوره هیچ نتیجه‌ای ثبت نشده است", period, telegramMessage: message };
  }
  if (opts.dryRun) {
    return {
      ok: true,
      dryRun: true,
      period,
      winner: data.winner,
      telegramMessage: message,
      leaderboard: data,
    };
  }

  const existing = await db
    .select()
    .from(agentMonthlyAwards)
    .where(eq(agentMonthlyAwards.period, period))
    .limit(1);
  if (existing.length > 0 && !opts.force) {
    const previousAward = existing[0];
    // اگر جایزه ثبت شده ولی گزارش تلگرام ارسال نشده (مثلاً توکن بعداً اضافه
    // شده یا خطای شبکه)، بدون ساخت جایزهٔ تکراری دوباره تلاش میکنیم.
    if (!previousAward.telegramSent) {
      const retry = await sendTelegramMessage(
        getTelegramChatId(),
        previousAward.telegramMessage || message
      );
      if (retry.sent) {
        await db
          .update(agentMonthlyAwards)
          .set({ telegramSent: true })
          .where(eq(agentMonthlyAwards.period, period));
      }
      return {
        ok: true,
        alreadyAwarded: true,
        resent: true,
        period,
        award: { ...previousAward, telegramSent: Boolean(retry.sent) },
        winner: data.winner,
        telegram: retry,
        telegramMessage: previousAward.telegramMessage || message,
        leaderboard: data,
      };
    }
    return {
      ok: true,
      alreadyAwarded: true,
      period,
      award: previousAward,
      winner: data.winner,
      telegramMessage: message,
      leaderboard: data,
    };
  }

  const w = data.winner;
  const values = {
    period,
    agentId: w.agentId,
    agentName: w.name,
    avatar: w.avatar,
    score: w.score,
    successRate: w.successRate,
    totalProjects: w.totalProjects,
    successCount: w.successes,
    revenueUsdt: w.revenueUsdt,
    avgDurationMinutes: w.avgDurationMinutes,
    points: w.points,
    runnersUp: JSON.stringify(
      data.rows.slice(1, 4).map((r) => ({
        agentId: r.agentId,
        name: r.name,
        score: r.score,
      }))
    ),
    telegramMessage: message,
    telegramSent: false,
    boostMultiplier: data.config.boostMultiplier,
  };

  const [award] = await db
    .insert(agentMonthlyAwards)
    .values(values)
    .onConflictDoUpdate({
      target: agentMonthlyAwards.period,
      set: {
        agentId: values.agentId,
        agentName: values.agentName,
        avatar: values.avatar,
        score: values.score,
        successRate: values.successRate,
        totalProjects: values.totalProjects,
        successCount: values.successCount,
        revenueUsdt: values.revenueUsdt,
        avgDurationMinutes: values.avgDurationMinutes,
        points: values.points,
        runnersUp: values.runnersUp,
        telegramMessage: values.telegramMessage,
        telegramSent: false,
        boostMultiplier: values.boostMultiplier,
      },
    })
    .returning();

  // پاداش ساختاری برای دورهٔ بعدی تخصیص منابع
  await upsertSettings([
    [BOOST_KEYS.agentId, String(w.agentId)],
    [BOOST_KEYS.period, shiftPeriod(period, 1)],
    [BOOST_KEYS.multiplier, String(data.config.boostMultiplier)],
  ]);

  const telegram = await sendTelegramMessage(getTelegramChatId(), message);
  await db
    .update(agentMonthlyAwards)
    .set({ telegramSent: Boolean(telegram.sent) })
    .where(eq(agentMonthlyAwards.period, period));

  await db.insert(agentLogs).values({
    agent: w.name,
    action: "🏆 کارمند برتر ماه اعلام شد",
    status: "success",
    detail: `${periodLabel(period)} • امتیاز ${pf(w.score)} • ${pf(w.successRate)}٪ موفقیت • ${pf(w.revenueUsdt)} USDT • تلگرام: ${telegram.sent ? "ارسال شد" : telegram.reason || "ارسال نشد"}`,
    durationMs: 0,
  });

  return {
    ok: true,
    period,
    award: { ...award, telegramSent: Boolean(telegram.sent) },
    winner: w,
    telegram,
    telegramMessage: message,
    boostPeriod: shiftPeriod(period, 1),
    leaderboard: data,
  };
}
