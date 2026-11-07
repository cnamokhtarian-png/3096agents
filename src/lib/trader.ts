/**
 * 🪙 موتور میز کار «آریا - A1» (ایجنت تریدر رمزارز)
 * ---------------------------------------------------------------------------
 * چرخهٔ کامل:
 *   اسکن بازار → دروازههای ریسک/اخبار → ساخت پیشنهاد معامله (R/R، اهرم، SL/TP،
 *   زمان و دلیل تحلیل) → ارسال کارت HITL به تلگرام → تأیید/رد انسانی → باز
 *   شدن پوزیشن → Mark-to-Market لحظهای → بستن خودکار روی TP/SL/زمان/اضطراری
 *   → گزارش نهایی + ثبت نتیجه در لیگ کارمندان + دفترچه خاطرات.
 *
 * صداقت اجرا: پیشفرض «Paper Trading» است. اجرای زنده فقط با env کلید صرافی +
 * تنظیم صریح trader_mode=live + تأیید انسانی انجام میشود (exchange.ts).
 */

import { db } from "@/db";
import {
  agents,
  transactions,
  settings,
  tradeSignals,
  tradePositions,
  agentJournal,
  marketSnapshots,
} from "@/db/schema";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import {
  fetchMarketSnapshot,
  fetchPrice,
  type MarketSnapshot,
} from "@/lib/market";
import { liveCredentialsPresent, placeOrder, type ExecMode } from "@/lib/exchange";
import { getTelegramChatId, sendTelegramMessage } from "@/lib/telegram";
import { getLeaderboardData, periodKey, recordScoreEvent } from "@/lib/leaderboard";

export const TRADER_DEFAULTS = {
  enabled: true,
  symbol: "BTC/USDT",
  capitalUsdt: 2500,
  maxPositionUsdt: 500,
  maxLeverage: 5,
  minRiskReward: 2,
  minConfidence: 65,
  maxRiskUsdt: 50,
  minFearGreed: 15,
  maxFearGreed: 80,
  maxVolatilityPct: 4,
  autoClose: true,
  maxHoldHours: 24,
  maxOpenPositions: 1,
  mode: "paper" as ExecMode,
};

export type TraderConfig = typeof TRADER_DEFAULTS;

const KEYS: Record<keyof TraderConfig, string> = {
  enabled: "trader_enabled",
  symbol: "trader_symbol",
  capitalUsdt: "trader_capital_usdt",
  maxPositionUsdt: "trader_max_position_usdt",
  maxLeverage: "trader_max_leverage",
  minRiskReward: "trader_min_rr",
  minConfidence: "trader_min_confidence",
  maxRiskUsdt: "trader_max_risk_usdt",
  minFearGreed: "trader_min_fear_greed",
  maxFearGreed: "trader_max_fear_greed",
  maxVolatilityPct: "trader_max_volatility_pct",
  autoClose: "trader_auto_close",
  maxHoldHours: "trader_max_hold_hours",
  maxOpenPositions: "trader_max_open_positions",
  mode: "trader_mode",
};

const BOOL_KEYS: (keyof TraderConfig)[] = ["enabled", "autoClose"];
const NUM_KEYS: (keyof TraderConfig)[] = [
  "capitalUsdt",
  "maxPositionUsdt",
  "maxLeverage",
  "minRiskReward",
  "minConfidence",
  "maxRiskUsdt",
  "minFearGreed",
  "maxFearGreed",
  "maxVolatilityPct",
  "maxHoldHours",
  "maxOpenPositions",
];

const pf = (n: number | string, digits = 1) =>
  Number(n || 0).toLocaleString("fa-IR", { maximumFractionDigits: digits });
const usd = (n: number | string) =>
  `$${Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, Number.isFinite(n) ? n : min));

async function upsertSettings(entries: [string, string][]) {
  if (!entries.length) return;
  await db
    .insert(settings)
    .values(entries.map(([key, value]) => ({ key, value })))
    .onConflictDoUpdate({ target: settings.key, set: { value: sql`excluded.value` } });
}

export async function getTraderConfig(): Promise<TraderConfig> {
  const rows = await db.select().from(settings);
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const cfg: any = { ...TRADER_DEFAULTS };
  (Object.keys(KEYS) as (keyof TraderConfig)[]).forEach((k) => {
    const raw = map.get(KEYS[k]);
    if (raw === undefined || raw === "") return;
    if (BOOL_KEYS.includes(k)) cfg[k] = raw !== "false";
    else if (NUM_KEYS.includes(k)) {
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0) cfg[k] = n;
    } else if (k === "mode") cfg[k] = raw === "live" ? "live" : "paper";
    else cfg[k] = raw;
  });
  return cfg as TraderConfig;
}

export async function saveTraderConfig(
  patch: Partial<TraderConfig>
): Promise<TraderConfig> {
  const current = await getTraderConfig();
  const next: TraderConfig = { ...current };
  (Object.keys(KEYS) as (keyof TraderConfig)[]).forEach((k) => {
    if (patch[k] === undefined) return;
    if (BOOL_KEYS.includes(k)) (next as any)[k] = Boolean(patch[k]);
    else if (NUM_KEYS.includes(k)) {
      const n = Number(patch[k]);
      if (!Number.isFinite(n) || n <= 0) throw new Error(`مقدار «${k}» نامعتبر است`);
      (next as any)[k] = n;
    } else if (k === "mode") {
      const v = String(patch[k]);
      if (v !== "paper" && v !== "live") throw new Error("حالت اجرا نامعتبر است");
      if (v === "live" && !liveCredentialsPresent()) {
        throw new Error(
          "اجرای زنده نیازمند EXCHANGE_API_KEY و EXCHANGE_API_SECRET در متغیرهای محیطی است"
        );
      }
      (next as any)[k] = v;
    } else (next as any)[k] = String(patch[k]).slice(0, 40);
  });
  if (next.maxLeverage > 20) throw new Error("حداکثر اهرم مجاز ۲۰ است");
  if (next.minRiskReward < 1) throw new Error("نسبت سود به ریسک نمیتواند کمتر از ۱ باشد");
  if (next.maxPositionUsdt > next.capitalUsdt) {
    throw new Error("سقف هر معامله نمیتواند از سرمایهٔ تخصیصیافته بیشتر باشد");
  }
  await upsertSettings(
    (Object.keys(KEYS) as (keyof TraderConfig)[]).map((k) => [
      KEYS[k],
      BOOL_KEYS.includes(k) ? String(Boolean((next as any)[k])) : String((next as any)[k]),
    ])
  );
  return next;
}

type AgentRow = typeof agents.$inferSelect;

export async function getTraderAgent(): Promise<AgentRow | null> {
  const rows = await db.select().from(agents);
  return (
    rows.find((a) => a.slug === "crypto-employee") ||
    rows.find((a) => a.specialty === "crypto") ||
    rows[0] ||
    null
  );
}

export async function addJournal(
  agent: AgentRow | null,
  kind: string,
  text: string,
  mood = "focused",
  meta: Record<string, unknown> = {}
) {
  await db.insert(agentJournal).values({
    agentId: agent?.id || 0,
    agentName: agent?.name || "آریا (A1)",
    kind,
    mood,
    text,
    meta: JSON.stringify(meta),
  });
}

/** اسنپشات بازار با کش ۴ دقیهای (جلوی تماس مکرر با API صرافی). */
export async function getSnapshot(
  symbol: string,
  force = false
): Promise<MarketSnapshot> {
  if (!force) {
    const [last] = await db
      .select()
      .from(marketSnapshots)
      .where(eq(marketSnapshots.symbol, symbol))
      .orderBy(desc(marketSnapshots.id))
      .limit(1);
    if (
      last &&
      last.createdAt &&
      Date.now() - new Date(last.createdAt).getTime() < 4 * 60 * 1000
    ) {
      return {
        symbol: last.symbol,
        price: last.price,
        rsi: last.rsi,
        macd: 0,
        macdSignal: 0,
        macdHist: last.macdHist,
        ma20: last.ma20,
        ma50: last.ma50,
        support: last.support,
        resistance: last.resistance,
        fearGreed: last.fearGreed,
        fearGreedLabel: "",
        orderbookImbalance: last.orderbookImbalance,
        whaleFlowUsdt: last.whaleFlowUsdt,
        sentiment: last.sentiment,
        volumeUsdt: last.volumeUsdt,
        volatilityPct: last.volatilityPct,
        source: last.source as MarketSnapshot["source"],
        sources: JSON.parse(last.sources || "[]"),
        notes: JSON.parse(last.notes || "[]"),
        candles: last.candles,
        fetchedAt: new Date(last.createdAt).toISOString(),
      };
    }
  }
  const snap = await fetchMarketSnapshot(symbol);
  await db.insert(marketSnapshots).values({
    symbol: snap.symbol,
    price: snap.price,
    rsi: snap.rsi,
    macdHist: snap.macdHist,
    ma20: snap.ma20,
    ma50: snap.ma50,
    support: snap.support,
    resistance: snap.resistance,
    fearGreed: snap.fearGreed,
    orderbookImbalance: snap.orderbookImbalance,
    whaleFlowUsdt: snap.whaleFlowUsdt,
    sentiment: snap.sentiment,
    volumeUsdt: snap.volumeUsdt,
    volatilityPct: snap.volatilityPct,
    source: snap.source,
    sources: JSON.stringify(snap.sources),
    notes: JSON.stringify(snap.notes),
    candles: snap.candles,
  });
  return snap;
}

function appUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "")
  );
}

/** متن دقیق کارت پیشنهاد معامله (HTML تلگرام). */
export function formatSignalMessage(s: any): string {
  const long = s.side === "LONG";
  const url = appUrl();
  return [
    `📊 <b>پیشنهاد معامله جدید | ایجنت آریا (A1)</b>`,
    "",
    `• <b>جفتارز:</b> <code>${s.symbol}</code>`,
    `• <b>نوع پوزیشن:</b> ${long ? "🟢 LONG (خرید)" : "🔴 SHORT (فروش)"}`,
    `• <b>نقطه ورود:</b> <code>${usd(s.entryPrice)}</code>`,
    `• <b>تخمین سود:</b> <code>+${pf(s.targetPct)}٪</code> (معادل ${pf(
      s.estimatedProfitUsdt
    )} USDT روی پوزیشن ${pf(s.positionUsdt, 0)} USDT با اهرم ${pf(s.leverage, 0)}x)`,
    `• <b>اهرم پیشنهادی:</b> <code>${pf(s.leverage, 0)}x</code> (ریسک کنترلشده)`,
    `• <b>تخمین زمان:</b> ~ ${pf(s.estimatedHoursMin, 0)} الی ${pf(
      s.estimatedHoursMax,
      0
    )} ساعت`,
    `• <b>حد ضرر (Stop-Loss):</b> <code>${usd(s.stopLoss)}</code>`,
    `• <b>حد سود (Take-Profit):</b> <code>${usd(s.takeProfit)}</code>`,
    `• <b>نسبت سود/ریسک:</b> ۱ به ${pf(s.riskReward)} ✅`,
    `• <b>دلیل تحلیل:</b> «${s.analysisReason}»`,
    "",
    `📡 <b>منبع داده:</b> ${s.dataSource} — ${s.dataSources?.join("، ") || "آفلاین"}`,
    ...(s.dataSource !== "live"
      ? [
          `⚠️ <b>توجه:</b> منبع دادهٔ زنده در دسترس نیست (${s.dataSource})؛ این کارت صرفاً شبیهسازی/آفلاین است و سیگنال معاملاتی واقعی محسوب نمیشود.`,
        ]
      : []),
    `⚙️ اطمینان ${pf(s.confidence, 0)}٪ • شاخص ترس/طمع ${pf(s.fearGreed, 0)} • RSI ${pf(s.rsi, 0)}`,
    `🛡️ ${s.riskNotes || ""}`,
    "",
    `🔘 [✅ تایید و اجرای معامله] | 🔘 [❌ رد پیشنهاد]`,
    ...(url ? [``, `🖥 <a href="${url}/agents/crypto-arya">میز کار آریا</a>`] : []),
  ].join("\n");
}

function tradeKeyboard(id: number) {
  const rows: any[] = [
    [
      { text: "✅ تایید و اجرای معامله", callback_data: `trade_approve:${id}` },
      { text: "❌ رد پیشنهاد", callback_data: `trade_reject:${id}` },
    ],
  ];
  const url = appUrl();
  if (url) rows.push([{ text: "🖥 میز کار آریا", url: `${url}/agents/crypto-arya` }]);
  return { inline_keyboard: rows };
}

async function notify(text: string, keyboard?: unknown) {
  const chatId = getTelegramChatId();
  return sendTelegramMessage(chatId, text, keyboard);
}

type Gate = { pass: boolean; reason: string };

function evaluate(s: MarketSnapshot, cfg: TraderConfig) {
  const gates: Gate[] = [];
  const price = s.price;
  const bullish =
    s.ma20 > s.ma50 && price > s.ma20 && s.macdHist > 0 && s.orderbookImbalance > -0.05;
  const bearish =
    s.ma20 < s.ma50 && price < s.ma20 && s.macdHist < 0 && s.orderbookImbalance < 0.05;
  const side: "LONG" | "SHORT" = bullish ? "LONG" : "SHORT";

  gates.push({
    pass: bullish || bearish,
    reason: "همسویی روند (MA20/MA50 + MACD + دفتر سفارشات) برقرار نیست؛ ورود نکردم.",
  });
  gates.push({
    pass: s.fearGreed >= cfg.minFearGreed && s.fearGreed <= cfg.maxFearGreed,
    reason: `شاخص ترس و طمع ${pf(s.fearGreed, 0)} خارج از محدودهٔ امن (${pf(
      cfg.minFearGreed,
      0
    )}–${pf(cfg.maxFearGreed, 0)}) است؛ بهدلیل ریسک هیجانی بازار صرفنظر کردم.`,
  });
  gates.push({
    pass: s.volatilityPct <= cfg.maxVolatilityPct,
    reason: `نوسان ۴ ساعته ${pf(s.volatilityPct)}٪ بیش از سقف ${pf(
      cfg.maxVolatilityPct
    )}٪ است؛ نویز اخبار بالاست، وارد نشدم.`,
  });
  gates.push({
    pass: s.rsi >= 30 && s.rsi <= 72,
    reason: `RSI(${pf(s.rsi, 0)}) در ناحیهٔ اشباع/پرریسک است؛ منتظر تأیید بهتر میمانم.`,
  });
  gates.push({
    pass: s.sentiment > -0.35,
    reason: "احساسات غالب اخبار منفی است؛ تا روشنشدن فضای خبری معاملهای باز نکردم.",
  });

  const failed = gates.find((g) => !g.pass);
  if (failed) return { ok: false as const, reason: failed.reason, side };

  // --- سطوح ورود/خروج با تضمین R/R ---
  let stop: number;
  let tp: number;
  if (side === "LONG") {
    stop = Math.max(s.support * 0.998, price * 0.975);
    tp = Math.min(s.resistance * 1.002, price * 1.06);
    if ((tp - price) / Math.max(price - stop, 0.0001) < cfg.minRiskReward) {
      stop = price - (tp - price) / cfg.minRiskReward;
    }
  } else {
    stop = Math.min(s.resistance * 1.002, price * 1.025);
    tp = Math.max(s.support * 0.998, price * 0.94);
    if ((price - tp) / Math.max(stop - price, 0.0001) < cfg.minRiskReward) {
      stop = price + (price - tp) / cfg.minRiskReward;
    }
  }
  const stopPct = (Math.abs(price - stop) / price) * 100;
  const targetPct = (Math.abs(tp - price) / price) * 100;
  const riskReward = stopPct > 0 ? targetPct / stopPct : 0;
  if (stopPct < 0.35 || targetPct < 0.7 || riskReward < cfg.minRiskReward) {
    return {
      ok: false as const,
      reason: `فاصلهٔ حمایت/مقاومت بهگونهای است که نسبت سود به ریسک حداقل ۱ به ${pf(
        cfg.minRiskReward
      )} حاصل نمیشود؛ پیشنهادی ندادم.`,
      side,
    };
  }

  // --- اهرم پویا: تابع فاصلهٔ حد ضرر + سقف ریسک ریالی ---
  let leverage = stopPct <= 1 ? 5 : stopPct <= 2 ? 3 : 2;
  leverage = Math.min(leverage, cfg.maxLeverage);
  const riskAt1x = (cfg.maxPositionUsdt * stopPct) / 100;
  const capped = Math.floor(cfg.maxRiskUsdt / Math.max(riskAt1x, 0.0001));
  leverage = clamp(Math.min(leverage, capped), 1, cfg.maxLeverage);

  // --- امتیاز اطمینان (بدون هیجان، صرفاً وزن شواهد) ---
  let confidence = 50;
  confidence += clamp((Math.abs(s.ma20 - s.ma50) / price) * 400, 0, 12);
  confidence += s.macdHist > 0 ? 8 : -8;
  confidence += clamp(s.orderbookImbalance * 25, -12, 12);
  confidence += s.rsi >= 45 && s.rsi <= 65 ? 8 : 0;
  confidence += s.whaleFlowUsdt > 0 ? 6 : s.whaleFlowUsdt < 0 ? -6 : 0;
  confidence += s.fearGreed >= 35 && s.fearGreed <= 65 ? 6 : -4;
  confidence += s.sentiment * 10;
  confidence = clamp(Math.round(confidence), 1, 99);
  if (confidence < cfg.minConfidence) {
    return {
      ok: false as const,
      reason: `اطمینان تحلیل ${pf(confidence, 0)}٪ کمتر از آستانهٔ ${pf(
        cfg.minConfidence,
        0
      )}٪ است؛ ترجیح دادم بیکار بمانم تا هیجانی معامله کنم.`,
      side,
    };
  }

  const fast = s.volatilityPct > 2.5;
  const estimatedHoursMin = fast ? 1 : 4;
  const estimatedHoursMax = fast ? 6 : 24;
  const estimatedProfitUsdt =
    (cfg.maxPositionUsdt * leverage * targetPct) / 100;

  const reasonParts = [
    side === "LONG"
      ? "شکست کانال نزولی ۴ ساعته و تثبیت بالای میانگین متحرک ۲۰"
      : "شکست کانال صعودی ۴ ساعته و افت زیر میانگین متحرک ۲۰",
    `واگرایی ${s.rsi < 50 ? "مثبت" : "تأییدی"} در RSI(${pf(s.rsi, 0)})`,
    `هیستوگرام MACD ${s.macdHist > 0 ? "صعودی" : "نزولی"}`,
    s.orderbookImbalance >= 0
      ? "افزایش حجم خریداران در دفتر سفارشات صرافی"
      : "برتری سفارشات فروش در دفتر سفارشات",
  ];
  if (Math.abs(s.whaleFlowUsdt) > 100000) {
    reasonParts.push(
      s.whaleFlowUsdt > 0
        ? "ورود سفارشات بزرگ خرید (پروکسی نهنگ)"
        : "خروج سفارشات بزرگ فروش (پروکسی نهنگ)"
    );
  }

  return {
    ok: true as const,
    side,
    entryPrice: price,
    stopLoss: stop,
    takeProfit: tp,
    stopPct,
    targetPct,
    riskReward,
    leverage,
    confidence,
    estimatedHoursMin,
    estimatedHoursMax,
    estimatedProfitUsdt,
    analysisReason: reasonParts.join(" + ") + ".",
    riskNotes: `ریسک حداکثر ${pf(
      cfg.maxRiskUsdt,
      0
    )} USDT • سقف پوزیشن ${pf(cfg.maxPositionUsdt, 0)} USDT • اهرم مجاز ${pf(
      cfg.maxLeverage,
      0
    )}x • R/R ≥ ۱ به ${pf(cfg.minRiskReward)}`,
  };
}

/** اسکن بازار و ساخت پیشنهاد معامله (یا ثبت دلیل صرفنظر کردن). */
/** پیشنهادهای منقضیشده را بایگانی میکند تا صف تأیید قفل نشود. */
export async function expireStaleSignals(): Promise<number> {
  const rows = await db
    .select()
    .from(tradeSignals)
    .where(and(eq(tradeSignals.status, "pending"), lt(tradeSignals.expiresAt, new Date())));
  if (!rows.length) return 0;
  await db
    .update(tradeSignals)
    .set({ status: "expired", decidedBy: "انقضای خودکار", decidedAt: new Date() })
    .where(and(eq(tradeSignals.status, "pending"), lt(tradeSignals.expiresAt, new Date())));
  return rows.length;
}

export async function scanMarket(opts: { force?: boolean } = {}) {
  const cfg = await getTraderConfig();
  const agent = await getTraderAgent();
  if (!agent) return { ok: false, error: "ایجنت تریدر یافت نشد" };
  if (!cfg.enabled && !opts.force) {
    await addJournal(agent, "skip", "ایجنت در حالت استراحت است؛ اسکن بازار انجام نشد.", "idle");
    return { ok: false, skipped: true, reason: "ایجنت غیرفعال است" };
  }

  await expireStaleSignals();
  const snapshot = await getSnapshot(cfg.symbol, Boolean(opts.force));

  const [pending, open] = await Promise.all([
    db
      .select()
      .from(tradeSignals)
      .where(eq(tradeSignals.status, "pending"))
      .orderBy(desc(tradeSignals.id))
      .limit(1),
    db.select().from(tradePositions).where(eq(tradePositions.status, "open")),
  ]);
  if (pending.length && !opts.force) {
    return {
      ok: true,
      alreadyPending: true,
      signal: pending[0],
      snapshot,
      reason: "یک پیشنهاد معامله همچنان منتظر تأیید شماست",
    };
  }
  if (open.length >= cfg.maxOpenPositions && !opts.force) {
    await addJournal(
      agent,
      "skip",
      `در حال حاضر ${pf(open.length, 0)} پوزیشن باز دارم؛ تا بستهشدن آنها پیشنهاد جدیدی ارسال نکردم.`,
      "focused",
      { openPositions: open.length }
    );
    return { ok: false, skipped: true, reason: "سقف پوزیشنهای همزمان پر است", snapshot };
  }

  const decision = evaluate(snapshot, cfg);
  await addJournal(
    agent,
    decision.ok ? "signal" : "skip",
    decision.ok
      ? `ساعت ${new Date().toLocaleTimeString("fa-IR", {
          hour: "2-digit",
          minute: "2-digit",
        })} بازار ${cfg.symbol} رصد شد. ${decision.analysisReason} پیشنهاد ${decision.side} با اهرم ${pf(
          decision.leverage,
          0
        )}x و R/R ${pf(decision.riskReward)} ارسال کردم.`
      : `ساعت ${new Date().toLocaleTimeString("fa-IR", {
          hour: "2-digit",
          minute: "2-digit",
        })} بازار ${cfg.symbol} رصد شد. ${decision.reason}`,
    decision.ok ? "confident" : "cautious",
    { source: snapshot.source, price: snapshot.price }
  );
  if (!decision.ok) {
    return { ok: false, skipped: true, reason: decision.reason, snapshot };
  }

  const values = {
    agentId: agent.id,
    agentName: agent.name,
    symbol: cfg.symbol,
    side: decision.side,
    entryPrice: decision.entryPrice,
    takeProfit: decision.takeProfit,
    stopLoss: decision.stopLoss,
    targetPct: decision.targetPct,
    stopPct: decision.stopPct,
    riskReward: decision.riskReward,
    leverage: decision.leverage,
    positionUsdt: cfg.maxPositionUsdt,
    estimatedProfitUsdt: decision.estimatedProfitUsdt,
    estimatedHoursMin: decision.estimatedHoursMin,
    estimatedHoursMax: decision.estimatedHoursMax,
    confidence: decision.confidence,
    rsi: snapshot.rsi,
    macdHist: snapshot.macdHist,
    ma20: snapshot.ma20,
    ma50: snapshot.ma50,
    support: snapshot.support,
    resistance: snapshot.resistance,
    fearGreed: snapshot.fearGreed,
    orderbookImbalance: snapshot.orderbookImbalance,
    whaleFlowUsdt: snapshot.whaleFlowUsdt,
    sentiment: snapshot.sentiment,
    volatilityPct: snapshot.volatilityPct,
    dataSource: snapshot.source,
    dataSources: JSON.stringify(snapshot.sources),
    analysisReason: decision.analysisReason,
    riskNotes: decision.riskNotes,
    status: "pending",
    expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
  };
  const [signal] = await db.insert(tradeSignals).values(values).returning();
  const message = formatSignalMessage({ ...signal, dataSources: snapshot.sources });
  await db
    .update(tradeSignals)
    .set({ telegramMessage: message })
    .where(eq(tradeSignals.id, signal.id));
  const telegram = await notify(message, tradeKeyboard(signal.id));

  return {
    ok: true,
    signal: { ...signal, telegramMessage: message },
    snapshot,
    telegram,
  };
}

/** تأیید / رد انسانی (از تلگرام یا میز کار). */
export async function decideSignal(
  id: number,
  decision: "approve" | "reject",
  by = "پنل مدیر"
) {
  const [signal] = await db.select().from(tradeSignals).where(eq(tradeSignals.id, id)).limit(1);
  if (!signal) return { ok: false, error: "پیشنهاد یافت نشد" };
  if (signal.status !== "pending") {
    return { ok: true, alreadyDecided: true, status: signal.status, signal };
  }
  if (signal.expiresAt && new Date(signal.expiresAt).getTime() < Date.now()) {
    await db.update(tradeSignals).set({ status: "expired" }).where(eq(tradeSignals.id, id));
    return { ok: false, error: "مهلت پیشنهاد به پایان رسیده است" };
  }

  const cfg = await getTraderConfig();
  const agent = await getTraderAgent();
  await db
    .update(tradeSignals)
    .set({ status: decision === "approve" ? "approved" : "rejected", decidedBy: by, decidedAt: new Date() })
    .where(eq(tradeSignals.id, id));

  if (decision === "reject") {
    await addJournal(
      agent,
      "review",
      `پیشنهاد ${signal.symbol} ${signal.side} توسط ${by} رد شد. بدون ایجاد پوزیشن، به رصد بازار ادامه میدهم.`,
      "cautious",
      { signalId: id }
    );
    await notify(
      `❌ <b>پیشنهاد معامله رد شد</b>\n${signal.symbol} • ${signal.side} • ${by}\nهیچ سفارشی ارسال نشد.`
    );
    return { ok: true, status: "rejected", signal };
  }

  // تأیید → اجرا (paper بهصورت پیشفرض؛ live فقط با کلید صرافی)
  const order = await placeOrder(
    {
      symbol: signal.symbol,
      side: signal.side as "LONG" | "SHORT",
      sizeUsdt: signal.positionUsdt,
      price: signal.entryPrice,
      leverage: signal.leverage,
    },
    cfg.mode
  );
  if (!order.ok) {
    await addJournal(
      agent,
      "review",
      `اجرای زندهٔ معامله ${signal.symbol} ناموفق بود: ${order.reason}. پوزیشنی باز نکردم.`,
      "alert",
      { signalId: id }
    );
    await notify(`⚠️ <b>خطای اجرای معامله</b>\n${order.reason}\nهیچ پوزیشنی باز نشد.`);
    return { ok: false, error: order.reason };
  }

  const [position] = await db
    .insert(tradePositions)
    .values({
      signalId: signal.id,
      agentId: signal.agentId,
      agentName: signal.agentName,
      symbol: signal.symbol,
      side: signal.side,
      entryPrice: signal.entryPrice,
      currentPrice: signal.entryPrice,
      takeProfit: signal.takeProfit,
      stopLoss: signal.stopLoss,
      sizeUsdt: signal.positionUsdt,
      leverage: signal.leverage,
      quantity: order.quantity,
      mode: order.mode,
      exchangeOrderId: order.orderId || "",
      status: "open",
    })
    .returning();

  await addJournal(
    agent,
    "trade",
    `پوزیشن ${signal.symbol} ${signal.side} با ${pf(signal.positionUsdt, 0)} USDT و اهرم ${pf(
      signal.leverage,
      0
    )}x باز شد (${order.mode === "live" ? "اجرای زنده صرافی" : "Paper / بدون ارسال سفارش"}). حد ضرر ${usd(
      signal.stopLoss
    )} و هدف ${usd(signal.takeProfit)} را بهصورت خودکار رصد میکنم.${order.reason ? ` ${order.reason}` : ""}`,
    "focused",
    { signalId: id, positionId: position.id, mode: order.mode }
  );
  await notify(
    `✅ <b>معامله تأیید و اجرا شد</b>\n${signal.symbol} • ${signal.side} • ${pf(
      signal.positionUsdt,
      0
    )} USDT × ${pf(signal.leverage, 0)}x\n🎯 ${usd(signal.takeProfit)} | 🛑 ${usd(
      signal.stopLoss
    )}\nحالت اجرا: ${order.mode === "live" ? "🔴 LIVE" : "📝 Paper"}\nتأییدکننده: ${by}`
  );

  return { ok: true, status: "approved", signal, position, mode: order.mode };
}

function pnlFor(p: any, price: number) {
  const diff = p.side === "LONG" ? price - p.entryPrice : p.entryPrice - price;
  const pnl = (diff / p.entryPrice) * p.sizeUsdt * p.leverage;
  const pnlPct = (pnl / Math.max(p.sizeUsdt, 1)) * 100;
  return { pnl, pnlPct };
}

/** بستن پوزیشن + گزارش نهایی + ثبت نتیجه در لیگ کارمندان. */
export async function closePosition(p: any, reason: string, price: number) {
  const [fresh] = await db
    .select()
    .from(tradePositions)
    .where(eq(tradePositions.id, p.id))
    .limit(1);
  if (!fresh || fresh.status !== "open") return { ok: false, error: "پوزیشن باز نیست" };

  const { pnl, pnlPct } = pnlFor(fresh, price);
  if (fresh.mode === "live") {
    const order = await placeOrder(
      {
        symbol: fresh.symbol,
        side: fresh.side === "SHORT" ? "SHORT" : "LONG",
        sizeUsdt: fresh.sizeUsdt,
        price,
        leverage: fresh.leverage,
        reduceOnly: true,
        quantity: fresh.quantity,
      },
      "live"
    );
    if (!order.ok) {
      await addJournal(
        null,
        "review",
        `بستن زندهٔ پوزیشن #${fresh.id} در صرافی ناموفق بود: ${order.reason}. وضعیت در سیستم بسته شد؛ لطفاً بهصورت دستی چک کنید.`,
        "alert"
      );
    }
  }

  const [updated] = await db
    .update(tradePositions)
    .set({
      currentPrice: price,
      unrealizedPnl: pnl,
      realizedPnl: pnl,
      pnlPct,
      status: "closed",
      closeReason: reason,
      closedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(tradePositions.id, fresh.id))
    .returning();

  const label =
    reason === "target"
      ? "🎯 رسیدن به حد سود (Take-Profit)"
      : reason === "stop"
      ? "🛑 برخورد به حد ضرر (Stop-Loss)"
      : reason === "emergency"
      ? "🚨 خروج اضطراری توسط مدیر"
      : reason === "timeout"
      ? "⏰ اتمام حداکثر زمان ماندگاری"
      : "بستن دستی";

  const agent = await getTraderAgent();
  const durationMinutes = Math.max(
    1,
    Math.round((Date.now() - new Date(fresh.openedAt || Date.now()).getTime()) / 60000)
  );
  await addJournal(
    agent,
    "close",
    `پوزیشن #${fresh.id} ${fresh.symbol} ${fresh.side} بسته شد: ${label}. نتیجهٔ نهایی ${
      pnl >= 0 ? "+" : ""
    }${pf(pnl)} USDT (${pf(pnlPct)}٪ روی سرمایه، ${fresh.mode === "live" ? "اجرای زنده" : "Paper"}).`,
    pnl >= 0 ? "satisfied" : "reflective",
    { positionId: fresh.id, pnl, reason }
  );

  // نتیجهٔ واقعی عملکرد به لیگ کارمندان (source_ref یکتا ⇒ بدون دوبارهشماری)
  if (agent) {
    await recordScoreEvent({
      agentId: agent.id,
      outcome: pnl > 0 ? "success" : "failure",
      projectTitle: `معامله ${fresh.symbol} ${fresh.side} #${fresh.id}`,
      durationMinutes,
      source: "trader",
      sourceRef: `trade:${fresh.id}:close`,
      note: `${label} • ${pnl >= 0 ? "+" : ""}${pf(pnl)} USDT • ${fresh.mode}`,
    }).catch(() => null);

    // فقط در اجرای زنده، سود واقعاً به کیف پول واحد واریز میشود.
    if (fresh.mode === "live" && pnl > 0) {
      await db.insert(transactions).values({
        title: `سود معامله ${fresh.symbol} (A1)`,
        projectTitle: `پوزیشن #${fresh.id}`,
        agentName: fresh.agentName,
        amountUsdt: pnl,
        kind: "income",
        status: "confirmed",
        network: "TRC20",
      });
      await db
        .update(agents)
        .set({ earnedUsdt: sql`${agents.earnedUsdt} + ${pnl}` })
        .where(eq(agents.id, agent.id));
    }
  }

  await notify(
    `${pnl >= 0 ? "🟢" : "🔴"} <b>گزارش نهایی معامله | ایجنت آریا (A1)</b>\n` +
      `${fresh.symbol} • ${fresh.side} • ${label}\n` +
      `ورود ${usd(fresh.entryPrice)} → خروج ${usd(price)}\n` +
      `سود/زیان: <b>${pnl >= 0 ? "+" : ""}${pf(pnl)} USDT</b> (${pf(pnlPct)}٪)\n` +
      `حالت اجرا: ${fresh.mode === "live" ? "🔴 LIVE" : "📝 Paper"}\n` +
      `🖥 میز کار: ${appUrl() || "/"} /agents/crypto-arya`
  );

  return { ok: true, position: updated, pnl, label };
}

/** Mark-to-Market + بستن خودکار TP/SL/زمان. */
export async function syncPositions() {
  const cfg = await getTraderConfig();
  const open = await db.select().from(tradePositions).where(eq(tradePositions.status, "open"));
  const results: any[] = [];
  for (const p of open) {
    const tick = await fetchPrice(p.symbol).catch(() => null);
    let price = tick?.price || 0;
    if (!price) {
      const snap = await getSnapshot(p.symbol).catch(() => null);
      price = snap?.price || p.currentPrice || p.entryPrice;
    }
    const { pnl, pnlPct } = pnlFor(p, price);
    await db
      .update(tradePositions)
      .set({ currentPrice: price, unrealizedPnl: pnl, pnlPct, updatedAt: new Date() })
      .where(eq(tradePositions.id, p.id));

    if (!cfg.autoClose) continue;
    const hitTP = p.side === "LONG" ? price >= p.takeProfit : price <= p.takeProfit;
    const hitSL = p.side === "LONG" ? price <= p.stopLoss : price >= p.stopLoss;
    const heldHours =
      (Date.now() - new Date(p.openedAt || Date.now()).getTime()) / 3_600_000;
    const reason = hitTP
      ? "target"
      : hitSL
      ? "stop"
      : heldHours > cfg.maxHoldHours
      ? "timeout"
      : "";
    if (reason) results.push(await closePosition(p, reason, price));
  }
  return { checked: open.length, closed: results.length, results };
}

export async function emergencyClose(id: number) {
  const [p] = await db.select().from(tradePositions).where(eq(tradePositions.id, id)).limit(1);
  if (!p || p.status !== "open") return { ok: false, error: "پوزیشن باز یافت نشد" };
  const tick = await fetchPrice(p.symbol).catch(() => null);
  const price = tick?.price || p.currentPrice || p.entryPrice;
  return closePosition(p, "emergency", price);
}

export async function getDeskData() {
  await expireStaleSignals().catch(() => 0);
  const cfg = await getTraderConfig();
  const agent = await getTraderAgent();
  const sync = await syncPositions().catch(() => ({ checked: 0, closed: 0, results: [] }));
  const snapshot = await getSnapshot(cfg.symbol);

  const [positions, signals, journal, leaderboard, masterRows] = await Promise.all([
    db.select().from(tradePositions).orderBy(desc(tradePositions.id)).limit(30),
    db.select().from(tradeSignals).orderBy(desc(tradeSignals.id)).limit(15),
    db.select().from(agentJournal).orderBy(desc(agentJournal.id)).limit(40),
    getLeaderboardData(periodKey()).catch(() => null),
    db.select().from(settings),
  ]);

  const closed = positions.filter((p) => p.status === "closed");
  const wins = closed.filter((p) => p.realizedPnl > 0);
  const netPnl = closed.reduce((s, p) => s + Number(p.realizedPnl || 0), 0);
  const openPnl = positions
    .filter((p) => p.status === "open")
    .reduce((s, p) => s + Number(p.unrealizedPnl || 0), 0);
  const openPositions = positions.filter((p) => p.status === "open");
  const pendingSignal = signals.find((s) => s.status === "pending") || null;

  const masterMap = new Map(masterRows.map((r) => [r.key, r.value]));
  const leagueRow = leaderboard?.rows.find((r) => r.agentId === agent?.id) || null;

  return {
    agent: agent
      ? {
          id: agent.id,
          name: agent.name,
          slug: agent.slug,
          avatar: agent.avatar,
          role: agent.role,
          status: agent.status,
          earnedUsdt: agent.earnedUsdt,
          tasksCompleted: agent.tasksCompleted,
        }
      : null,
    config: cfg,
    credentialsPresent: liveCredentialsPresent(),
    execution: cfg.mode === "live" && liveCredentialsPresent() ? "live" : "paper",
    status: !cfg.enabled
      ? "idle"
      : openPositions.length > 0
      ? "trading"
      : pendingSignal
      ? "review"
      : "scanning",
    masterWallet: {
      address:
        masterMap.get("master_wallet_address") ||
        process.env.MASTER_WALLET_ADDRESS ||
        "—",
      network:
        masterMap.get("master_wallet_network") ||
        process.env.MASTER_WALLET_NETWORK ||
        "USDT-TRC20",
    },
    snapshot,
    positions,
    signals,
    journal,
    pendingSignal: pendingSignal
      ? { ...pendingSignal, dataSources: JSON.parse(pendingSignal.dataSources || "[]") }
      : null,
    performance: {
      totalTrades: closed.length,
      wins: wins.length,
      losses: closed.length - wins.length,
      winRate: closed.length ? Math.round((wins.length / closed.length) * 100) : 0,
      netPnl: Math.round(netPnl * 100) / 100,
      avgPnl: closed.length ? Math.round((netPnl / closed.length) * 100) / 100 : 0,
      bestTrade: closed.length
        ? Math.max(...closed.map((p) => Number(p.realizedPnl || 0)))
        : 0,
      openPnl: Math.round(openPnl * 100) / 100,
      openPositions: openPositions.length,
      league: leagueRow
        ? { rank: leagueRow.rank, score: leagueRow.score, points: leagueRow.points }
        : null,
    },
    sync,
    generatedAt: new Date().toISOString(),
  };
}
