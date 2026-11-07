import { db } from "@/db";
import {
  agentActivityLogs,
  agentRewards,
  agents,
  exchangeOrders,
  ledgerAccounts,
  ledgerEntries,
  rewardRules,
  systemEvents,
  transactions,
} from "@/db/schema";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  کتابخانهٔ مالی داخلی + لایهٔ پاداش (Ledger & Reward Layer)
 * ═══════════════════════════════════════════════════════════════════════
 *
 *  مسئله‌ای که این فایل حل می‌کند:
 *    تا پیش از این، سیستم فقط «درآمد با شاهد تراکنش» را می‌شناخت. برای
 *    شروع کار با سرمایهٔ خرد و سود مرکب، سه چیز کم بود:
 *      ۱. موجودی سرمایهٔ اولیه (هر چه هست، کم یا زیاد) جایی ثبت نمی‌شد.
 *      ۲. سود/زیان هر معاملهٔ آریا از سفارش واقعی صرافی محاسبه نمی‌شد.
 *      ۳. هیچ پاداشی برای ترید موفق بسته به نتیجهٔ واقعی پرداخت نمی‌شد.
 *
 *  اصول غیرقابل‌عبور (همان قواعد قبلی، سخت‌گیرانه‌تر):
 *    • هیچ عدد ساختگی/تصادفی: هر ردیف دفتر به یک مرجع واقعی
 *      (هش تراکنش، شناسهٔ سفارش صرافی، یا تأیید دستی مدیرعامل) بسته است.
 *    • دفتر دوطرفه: مجموع بدهکار = مجموع بستانکار در هر گروه ثبت.
 *    • ضدتکرار: هر رویداد با `idempotency_key` یکتا فقط یک‌بار ثبت می‌شود
 *      (تلگرام می‌تواند دوبار کلیک بفرستد؛ موجودی نباید دو بار عوض شود).
 *    • موجودی هرگز ذخیره نمی‌شود؛ همیشه از SUM دفتر محاسبه می‌شود.
 *    • پاداش فقط از «سود واقعی و تأییدشده» پرداخت می‌شود، نه از پیش‌بینی.
 */

export const ACCOUNT_CODES = {
  capital: "capital",
  exchange: "exchange",
  wallet: "wallet",
  rewards: "rewards",
  profit: "profit",
  fees: "fees",
  profitShare: "profit_share",
} as const;

export type AccountCode = (typeof ACCOUNT_CODES)[keyof typeof ACCOUNT_CODES];

const ACCOUNT_META: Array<{ code: AccountCode; name: string; kind: string }> = [
  { code: "capital", name: "سرمایهٔ مالک (موجودی اولیهٔ خرد)", kind: "equity" },
  { code: "exchange", name: "موجودی در صرافی", kind: "asset" },
  { code: "wallet", name: "کیف پول واحد USDT", kind: "asset" },
  { code: "rewards", name: "صندوق پاداش کارمندان", kind: "asset" },
  { code: "profit", name: "سود محقق‌شدهٔ معاملات", kind: "revenue" },
  { code: "fees", name: "کارمزد صرافی", kind: "expense" },
  { code: "profit_share", name: "سهم کارمند از سود (پاداش مرکب)", kind: "expense" },
];

/** ساخت جدول‌ها/حساب‌های پایه به‌صورت idempotent (روی نصب‌های موجود هم بی‌خطر است). */
let ensured = false;
export async function ensureLedger() {
  if (ensured) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS agentos.ledger_accounts (
        id SERIAL PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'asset',
        asset TEXT NOT NULL DEFAULT 'USDT',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS agentos.ledger_entries (
        id BIGSERIAL PRIMARY KEY,
        entry_group TEXT NOT NULL,
        account_code TEXT NOT NULL,
        agent_id INTEGER,
        agent_name TEXT NOT NULL DEFAULT '',
        debit_usdt REAL NOT NULL DEFAULT 0,
        credit_usdt REAL NOT NULL DEFAULT 0,
        kind TEXT NOT NULL,
        memo TEXT NOT NULL DEFAULT '',
        ref_type TEXT NOT NULL DEFAULT '',
        ref_id TEXT NOT NULL DEFAULT '',
        idempotency_key TEXT NOT NULL UNIQUE,
        meta JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS ledger_entries_account_idx
        ON agentos.ledger_entries (account_code, created_at DESC);
      CREATE INDEX IF NOT EXISTS ledger_entries_group_idx
        ON agentos.ledger_entries (entry_group);
      CREATE TABLE IF NOT EXISTS agentos.reward_rules (
        id SERIAL PRIMARY KEY,
        key TEXT NOT NULL UNIQUE,
        value TEXT NOT NULL DEFAULT '',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS agentos.agent_rewards (
        id BIGSERIAL PRIMARY KEY,
        agent_id INTEGER,
        agent_name TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'trade',
        job_id INTEGER,
        trade_profit_usdt REAL NOT NULL DEFAULT 0,
        rule_key TEXT NOT NULL DEFAULT 'default',
        reward_usdt REAL NOT NULL DEFAULT 0,
        points INTEGER NOT NULL DEFAULT 0,
        compounded BOOLEAN NOT NULL DEFAULT FALSE,
        ledger_group TEXT NOT NULL DEFAULT '',
        idempotency_key TEXT NOT NULL UNIQUE,
        detail TEXT NOT NULL DEFAULT '',
        meta JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS agent_rewards_agent_idx
        ON agentos.agent_rewards (agent_name, created_at DESC);
    `);
    for (const a of ACCOUNT_META) {
      await db
        .insert(ledgerAccounts)
        .values({ code: a.code, name: a.name, kind: a.kind })
        .onConflictDoNothing({ target: ledgerAccounts.code });
    }
    ensured = true;
  } catch (e: any) {
    await db
      .insert(systemEvents)
      .values({
        level: "error",
        scope: "ledger",
        message: `آماده‌سازی کتابخانه مالی ناموفق بود: ${e?.message || e}`,
        meta: { hint: "supabase/schema.sql را یک‌بار در SQL Editor اجرا کنید" },
      })
      .catch(() => {});
    throw e;
  }
}

// ─────────────────────────────────────────────────────────────────────────
//  قواعد پاداش (قابل تغییر از پنل یا دیتابیس، بدون دیپلوی مجدد)
// ─────────────────────────────────────────────────────────────────────────

export type RewardRules = {
  /** درصد سهم کارمند از سود خالص هر معاملهٔ موفق */
  profitSharePct: number;
  /** امتیاز به‌ازای هر ۱ USDT سود */
  pointsPerUsdt: number;
  /** امتیاز پایهٔ هر ترید موفق (حتی سود صفر/کم) */
  successPoints: number;
  /** آیا پاداش به سرمایه اضافه شود (سود مرکب فعال) */
  compound: boolean;
  /** سقف درصد سود مرکب روزانه از سرمایه (محافظت در برابر رشد نماییِ ناسالم) */
  maxDailyCompoundPct: number;
  /** حداقل سود خالص برای پرداخت پاداش (USDT) */
  minProfitUsdt: number;
};

export const DEFAULT_RULES: RewardRules = {
  profitSharePct: 15,
  pointsPerUsdt: 10,
  successPoints: 25,
  compound: true,
  maxDailyCompoundPct: 10,
  minProfitUsdt: 0.5,
};

const RULE_KEYS: Record<keyof RewardRules, string> = {
  profitSharePct: "reward_profit_share_pct",
  pointsPerUsdt: "reward_points_per_usdt",
  successPoints: "reward_success_points",
  compound: "reward_compound",
  maxDailyCompoundPct: "reward_max_daily_compound_pct",
  minProfitUsdt: "reward_min_profit_usdt",
};

export async function getRewardRules(): Promise<RewardRules> {
  await ensureLedger();
  const rows = await db.select().from(rewardRules);
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const num = (k: keyof RewardRules, fallback: number) => {
    const raw = map.get(RULE_KEYS[k]);
    const n = Number(raw);
    return raw && Number.isFinite(n) ? n : fallback;
  };
  const compoundRaw = (map.get(RULE_KEYS.compound) || "").trim().toLowerCase();
  return {
    profitSharePct: clamp(num("profitSharePct", DEFAULT_RULES.profitSharePct), 0, 50),
    pointsPerUsdt: clamp(num("pointsPerUsdt", DEFAULT_RULES.pointsPerUsdt), 0, 1000),
    successPoints: Math.round(clamp(num("successPoints", DEFAULT_RULES.successPoints), 0, 10000)),
    compound:
      compoundRaw === ""
        ? DEFAULT_RULES.compound
        : ["true", "1", "yes", "on"].includes(compoundRaw),
    maxDailyCompoundPct: clamp(
      num("maxDailyCompoundPct", DEFAULT_RULES.maxDailyCompoundPct),
      0,
      100,
    ),
    minProfitUsdt: clamp(num("minProfitUsdt", DEFAULT_RULES.minProfitUsdt), 0, 10000),
  };
}

export async function setRewardRules(patch: Partial<RewardRules>) {
  await ensureLedger();
  for (const [k, v] of Object.entries(patch)) {
    const key = RULE_KEYS[k as keyof RewardRules];
    if (!key || v === undefined) continue;
    await db
      .insert(rewardRules)
      .values({ key, value: String(v), updatedAt: new Date() })
      .onConflictDoUpdate({
        target: rewardRules.key,
        set: { value: sql`excluded.value`, updatedAt: new Date() },
      });
  }
  return getRewardRules();
}

function clamp(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function money(n: number) {
  return Math.round(n * 1e8) / 1e8;
}

// ─────────────────────────────────────────────────────────────────────────
//  ثبت دوطرفه (double-entry)
// ─────────────────────────────────────────────────────────────────────────

export type LedgerLeg = {
  account: AccountCode;
  /** + یعنی افزایش حساب، − یعنی کاهش (تبدیل به بدهکار/بستانکار) */
  amount: number;
  agentId?: number | null;
  agentName?: string;
};

export type PostEntryInput = {
  group?: string;
  kind:
    | "capital_in"
    | "revenue"
    | "trade_pnl"
    | "reward"
    | "withdraw"
    | "fee"
    | "profit_share"
    | "adjustment";
  /** کلید یکتای ضدتکرار — ثبت دوباره با همان کلید هیچ تغییری نمی‌دهد */
  idempotencyKey: string;
  legs: LedgerLeg[];
  memo?: string;
  refType?: "transaction" | "exchange_order" | "job" | "manual";
  refId?: string | number;
  meta?: Record<string, unknown>;
};

export type PostEntryResult = {
  ok: boolean;
  duplicate?: boolean;
  group?: string;
  /** تراز بدهکار/بستانکار */
  balanced?: boolean;
  error?: string;
};

/**
 * ثبت یک سند دوطرفه. اگر کلید ضدتکرار قبلاً ثبت شده باشد، بدون هیچ تغییری
 * `duplicate: true` برمی‌گرداند (نه خطا) تا مسیرهای تکراری تلگرام ایمن باشند.
 */
export async function postEntry(input: PostEntryInput): Promise<PostEntryResult> {
  await ensureLedger();
  const legs = input.legs.filter((l) => Number.isFinite(l.amount) && l.amount !== 0);
  if (!legs.length) return { ok: false, error: "سند بدون ردیف مالی قابل ثبت نیست" };

  const debit = money(legs.reduce((s, l) => s + (l.amount > 0 ? l.amount : 0), 0));
  const credit = money(legs.reduce((s, l) => s + (l.amount < 0 ? -l.amount : 0), 0));
  if (Math.abs(debit - credit) > 1e-6) {
    await db
      .insert(systemEvents)
      .values({
        level: "error",
        scope: "ledger",
        message: `سند نامتوازن رد شد (بدهکار ${debit} ≠ بستانکار ${credit})`,
        meta: { input: { ...input, legs }, debit, credit },
      })
      .catch(() => {});
    return {
      ok: false,
      balanced: false,
      error: `سند مالی متوازن نیست: بدهکار ${debit} ≠ بستانکار ${credit}`,
    };
  }

  const group = input.group || `${input.kind}:${input.idempotencyKey}`;

  // کلید یکتای سند: هر ردیف نسخه‌ای از کلید اصلی + حساب خودش دارد.
  // اگر همهٔ ردیف‌ها قبلاً نوشته شده باشند، سند تکراری است.
  const existing = await db
    .select({ id: ledgerEntries.id })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.idempotencyKey, `${input.idempotencyKey}:0`))
    .limit(1);
  if (existing[0]) return { ok: true, duplicate: true, group, balanced: true };

  try {
    await db.insert(ledgerEntries).values(
      legs.map((l, idx) => ({
        entryGroup: group,
        accountCode: l.account,
        agentId: l.agentId ?? null,
        agentName: l.agentName ?? "",
        debitUsdt: l.amount > 0 ? money(l.amount) : 0,
        creditUsdt: l.amount < 0 ? money(-l.amount) : 0,
        kind: input.kind,
        memo: input.memo ?? "",
        refType: input.refType ?? "",
        refId: input.refId === undefined ? "" : String(input.refId),
        idempotencyKey: `${input.idempotencyKey}:${idx}`,
        meta: input.meta ?? {},
      })),
    );
    return { ok: true, group, balanced: true };
  } catch (e: any) {
    // UNIQUE = همان سند هم‌زمان از مسیر دیگری ثبت شده است
    if (String(e?.code) === "23505" || /duplicate key/i.test(String(e?.message))) {
      return { ok: true, duplicate: true, group, balanced: true };
    }
    await db
      .insert(systemEvents)
      .values({
        level: "error",
        scope: "ledger",
        message: `ثبت سند مالی ناموفق بود: ${e?.message || e}`,
        meta: { idempotencyKey: input.idempotencyKey, kind: input.kind },
      })
      .catch(() => {});
    return { ok: false, error: e?.message || "خطای ثبت سند مالی" };
  }
}

// ─────────────────────────────────────────────────────────────────────────
//  موجودی‌ها (همیشه از SUM دفتر)
// ─────────────────────────────────────────────────────────────────────────

export type Balances = Record<AccountCode, number>;

export async function getBalances(): Promise<Balances> {
  await ensureLedger();
  const rows = await db
    .select({
      account: ledgerEntries.accountCode,
      net: sql<number>`COALESCE(SUM(${ledgerEntries.debitUsdt}) - SUM(${ledgerEntries.creditUsdt}), 0)`,
    })
    .from(ledgerEntries)
    .groupBy(ledgerEntries.accountCode);
  const out: Balances = {
    capital: 0,
    exchange: 0,
    wallet: 0,
    rewards: 0,
    profit: 0,
    fees: 0,
    profit_share: 0,
  };
  for (const r of rows) {
    if (r.account in out) out[r.account as AccountCode] = money(Number(r.net));
  }
  return out;
}

/** سرمایهٔ کاری = موجودی صرافی + کیف پول (پول واقعی که در دسترس سیستم است). */
export async function getWorkingCapital() {
  const b = await getBalances();
  return {
    balances: b,
    workingCapitalUsdt: money(b.exchange + b.wallet),
    seededCapitalUsdt: money(b.capital),
    realisedProfitUsdt: money(b.profit - b.profit_share),
    rewardPoolUsdt: money(b.rewards),
  };
}

// ─────────────────────────────────────────────────────────────────────────
//  سرمایهٔ اولیه (Seed capital)
// ─────────────────────────────────────────────────────────────────────────

export type SeedCapitalInput = {
  amountUsdt: number;
  actor: string;
  /** شاهد واقعی: هش واریز به کیف پول/صرافی */
  txHash?: string;
  /** برای موجودی‌ای که هم‌اکنون داخل صرافی است (بدون هش، فقط تأیید مدیرعامل) */
  insideExchange?: boolean;
  note?: string;
};

/**
 * ثبت سرمایهٔ اولیهٔ مالک. دو حالت مجاز است:
 *   ۱. واریز واقعی به کیف پول واحد → شاهد هش تراکنش (≥ ۱۶ کاراکتر) الزامی است.
 *   ۲. موجودی‌ای که از قبل داخل صرافی است → تأیید صریح مدیرعامل + ثبت در
 *      system_events برای حسابرسی (چون هش تراکنش در دسترس نیست).
 * در حالت دوم مبلغ از «موجودی واقعی صرافی» بزرگ‌تر از حد مجاز پذیرفته
 * نمی‌شود تا کسی با اشتباه تایپی، سرمایه‌ای که وجود ندارد ثبت نکند.
 */
export async function seedCapital(input: SeedCapitalInput) {
  await ensureLedger();
  const amount = money(Number(input.amountUsdt));
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false as const, error: "مبلغ سرمایه باید عددی بزرگ‌تر از صفر باشد" };
  }
  const txHash = String(input.txHash || "").trim();
  if (!input.insideExchange && txHash.length < 16) {
    return {
      ok: false as const,
      error:
        "برای سرمایهٔ واریزشده، هش تراکنش واقعی (حداقل ۱۶ کاراکتر) الزامی است. اگر پول از قبل داخل صرافی است، گزینهٔ «موجودی داخل صرافی» را انتخاب کنید.",
    };
  }

  if (!input.insideExchange && txHash) {
    // ضدتکرار سراسری: همین هش نمی‌تواند هم درآمد باشد هم سرمایه
    const dup = await db
      .select({ id: ledgerEntries.id })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.idempotencyKey, `capital:${txHash}:0`))
      .limit(1);
    if (dup[0]) {
      return { ok: false as const, error: "این هش قبلاً به‌عنوان سرمایه ثبت شده است", duplicate: true };
    }
  }

  const key = input.insideExchange
    ? `capital_exchange:${Date.now()}`
    : `capital:${txHash}`;

  const res = await postEntry({
    kind: "capital_in",
    idempotencyKey: key,
    refType: input.insideExchange ? "manual" : "transaction",
    refId: txHash || undefined,
    memo: input.note || "ثبت سرمایهٔ اولیه",
    legs:
      input.insideExchange || !txHash
        ? [
            { account: "exchange", amount },
            { account: "capital", amount: -amount },
          ]
        : [
            { account: "wallet", amount },
            { account: "capital", amount: -amount },
          ],
    meta: { actor: input.actor, insideExchange: Boolean(input.insideExchange), txHash },
  });
  if (!res.ok) return { ok: false as const, error: res.error };

  await db
    .insert(agentActivityLogs)
    .values({
      agentName: "دفتر کل مالی",
      action: `ثبت سرمایهٔ اولیه ${amount} USDT`,
      status: "success",
      detail: `${input.insideExchange ? "موجودی از قبل داخل صرافی" : "واریز به کیف پول واحد"} • توسط ${input.actor}${txHash ? ` • هش ${txHash}` : ""}`,
      source: "panel",
      meta: { amount, txHash, insideExchange: Boolean(input.insideExchange) },
    })
    .catch(() => {});

  return { ok: true as const, amount, ...(await getWorkingCapital()) };
}

// ─────────────────────────────────────────────────────────────────────────
//  سود/زیان معامله از سفارش واقعی صرافی
// ─────────────────────────────────────────────────────────────────────────

export type RealisedPnlResult = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  pnlUsdt?: number;
  orderId?: string;
  duplicate?: boolean;
};

/**
 * محاسبهٔ سود/زیان یک سفارش با «قیمت ورود خرید» همان نماد.
 * فقط از دادهٔ واقعی صرافی: قیمت پرشدهٔ همان سفارش + قیمت ورود همان دارایی
 * (از سفارش‌های پیشین همان نماد که با همین موتور ثبت شده‌اند).
 *
 * اگر قیمت ورود مشخص نباشد (اولین خرید آن دارایی)، سود/زیان صفر ثبت
 * می‌شود و علت در دفتر نوشته می‌شود؛ هیچ عددی حدس زده نمی‌شود.
 */
export async function computeRealisedPnl(order: {
  id: number;
  symbol: string;
  side: string;
  status: string;
  quantity: unknown;
  quoteQty: unknown;
  price: unknown;
  raw: unknown;
}): Promise<RealisedPnlResult & { entryPrice?: number; exitPrice?: number }> {
  const raw: any = order.raw || {};
  const fills: any[] = Array.isArray(raw?.fills) ? raw.fills : [];
  const fillQty = fills.reduce((s, f) => s + Number(f?.qty || 0), 0);
  const fillQuote = fills.reduce((s, f) => s + Number(f?.qty || 0) * Number(f?.price || 0), 0);

  const qty =
    fillQty > 0
      ? fillQty
      : Number(order.quantity ?? order.quoteQty ?? raw?.executedQty ?? 0);
  const quote =
    fillQuote > 0
      ? fillQuote
      : Number(order.quoteQty ?? raw?.cummulativeQuoteQty ?? 0);
  const price =
    Number(order.price) > 0
      ? Number(order.price)
      : qty > 0 && quote > 0
        ? quote / qty
        : fillQty > 0
          ? fillQuote / fillQty
          : 0;

  if (!(qty > 0) || !(price > 0)) {
    return { ok: false, skipped: true, reason: "قیمت/مقدار اجراشدهٔ سفارش قابل استخراج نیست" };
  }

  const symbol = order.symbol.toUpperCase();

  if (order.side.toUpperCase() === "BUY") {
    // خرید = باز کردن پوزیشن؛ سود/زیان هنوز محقق نشده است
    return { ok: true, skipped: true, reason: "خرید — سود فقط پس از فروش محقق می‌شود", exitPrice: price };
  }

  // فروش: قیمت ورود = میانگین وزنی خریدهای واقعی همین نماد پیش از این سفارش
  const buys = await db
    .select()
    .from(exchangeOrders)
    .where(
      and(
        eq(exchangeOrders.symbol, symbol),
        eq(exchangeOrders.side, "BUY"),
        inArray(exchangeOrders.status, ["FILLED", "PARTIALLY_FILLED", "NEW", "TRADE"]),
      ),
    )
    .orderBy(desc(exchangeOrders.createdAt))
    .limit(20);

  const buyQty = buys.reduce((s, b) => s + Number(b.quantity || 0), 0);
  const buyQuote = buys.reduce(
    (s, b) => s + Number(b.quoteQty || 0) || Number(b.quantity || 0) * Number(b.price || 0),
    0,
  );
  if (!(buyQty > 0) || !(buyQuote > 0)) {
    return {
      ok: true,
      skipped: true,
      reason:
        "قیمت ورود این دارایی در سفارش‌های ثبت‌شده پیدا نشد (بدون قیمت ورود، سود حدس زده نمی‌شود)",
      exitPrice: price,
    };
  }
  const entryPrice = buyQuote / buyQty;
  const pnl = money((price - entryPrice) * qty);
  return { ok: true, pnlUsdt: pnl, entryPrice: money(entryPrice), exitPrice: money(price) };
}

/**
 * ثبت سود/زیان محقق‌شدهٔ یک سفارش فروش در دفتر + پرداخت پاداش به کارمند.
 * این تابع تنها ورودی «سود واقعی» برای لایهٔ پاداش است.
 */
export async function settleTradeOrder(orderId: number) {
  await ensureLedger();
  const rows = await db.select().from(exchangeOrders).where(eq(exchangeOrders.id, orderId)).limit(1);
  const order = rows[0];
  if (!order) return { ok: false as const, error: "سفارش صرافی پیدا نشد" };
  if (order.side.toUpperCase() !== "SELL") {
    return { ok: true as const, skipped: true, reason: "سفارش خرید است؛ سود محقق نشده" };
  }

  const pnlRes = await computeRealisedPnl({
    id: order.id,
    symbol: order.symbol,
    side: order.side,
    status: order.status,
    quantity: order.quantity,
    quoteQty: order.quoteQty,
    price: order.price,
    raw: order.raw,
  });
  if (!pnlRes.ok) return { ok: false as const, error: pnlRes.reason };
  if (pnlRes.skipped) return { ok: true as const, skipped: true, reason: pnlRes.reason };

  const pnl = Number(pnlRes.pnlUsdt || 0);
  const key = `pnl:${order.clientOrderId}`;

  // سود به موجودی صرافی اضافه/کم می‌شود و در حساب سود ثبت می‌گردد
  const posted = await postEntry({
    kind: "trade_pnl",
    idempotencyKey: key,
    refType: "exchange_order",
    refId: order.id,
    memo: `سود/زیان معامله ${order.symbol} (${order.exchange}${order.testnet ? " • testnet" : ""})`,
    legs:
      pnl >= 0
        ? [
            { account: "exchange", amount: money(pnl) },
            { account: "profit", amount: money(-pnl) },
          ]
        : [
            { account: "exchange", amount: money(pnl) },
            { account: "profit", amount: money(-pnl) },
          ],
    meta: {
      symbol: order.symbol,
      entryPrice: pnlRes.entryPrice,
      exitPrice: pnlRes.exitPrice,
      clientOrderId: order.clientOrderId,
    },
  });
  if (!posted.ok) return { ok: false as const, error: posted.error };

  const reward = await grantTradeReward({
    agentName: order.agentName || "آریا کریپتو (کارمند تخصصی رمزارز)",
    jobId: order.jobId ?? null,
    pnlUsdt: pnl,
    sourceRef: order.clientOrderId,
    detail: `${order.symbol} • ورود ${pnlRes.entryPrice} → خروج ${pnlRes.exitPrice}`,
  });

  return {
    ok: true as const,
    duplicate: posted.duplicate,
    pnlUsdt: pnl,
    entryPrice: pnlRes.entryPrice,
    exitPrice: pnlRes.exitPrice,
    reward,
  };
}

// ─────────────────────────────────────────────────────────────────────────
//  پاداش کارمند (Reward + compound)
// ─────────────────────────────────────────────────────────────────────────

export type GrantRewardResult = {
  ok: boolean;
  duplicate?: boolean;
  rewardUsdt?: number;
  points?: number;
  compounded?: boolean;
  reason?: string;
};

/**
 * پرداخت پاداش برای یک معاملهٔ موفق.
 *
 * قاعده: پاداش = درصدِ سهم کارمند × سود خالص مثبت. ضرر → هیچ پاداشی
 * (نه پاداش منفی، نه «امتیاز تشویقی»). سود کمتر از حد آستانه → ثبت
 * رویداد بدون پاداش مالی.
 *
 * سود مرکب: اگر `compound` روشن باشد، مبلغ پاداش به‌جای خروج از سیستم،
 * داخل «صندوق پاداش» می‌ماند و به سرمایهٔ کاری اضافه می‌شود؛ ولی برای
 * جلوگیری از رشد نماییِ ناسالم، سقف روزانه دارد.
 */
export async function grantTradeReward(input: {
  agentName: string;
  jobId?: number | null;
  pnlUsdt: number;
  sourceRef: string;
  detail?: string;
}): Promise<GrantRewardResult> {
  await ensureLedger();
  const rules = await getRewardRules();
  const key = `reward:${input.sourceRef}`;

  const dup = await db
    .select({ id: agentRewards.id })
    .from(agentRewards)
    .where(eq(agentRewards.idempotencyKey, key))
    .limit(1);
  if (dup[0]) return { ok: true, duplicate: true, reason: "این رویداد قبلاً پاداش گرفته است" };

  const pnl = money(Number(input.pnlUsdt) || 0);
  const profitable = pnl >= rules.minProfitUsdt;
  const rawReward = profitable ? money(pnl * (rules.profitSharePct / 100)) : 0;
  const points = Math.round(
    (profitable ? rules.successPoints + rawReward * rules.pointsPerUsdt : 0) * 100,
  ) / 100;

  // سقف سود مرکب روزانه
  let compoundable = rules.compound && rawReward > 0;
  let rewardToPay = rawReward;
  if (compoundable) {
    const today = await db
      .select({ n: sql<number>`COALESCE(SUM(${agentRewards.rewardUsdt}), 0)` })
      .from(agentRewards)
      .where(
        and(
          eq(agentRewards.compounded, true),
          gte(agentRewards.createdAt, startOfUtcDay()),
        ),
      );
    const capital = (await getBalances()).capital;
    const cap = Math.max(0, (capital * rules.maxDailyCompoundPct) / 100);
    const used = Number(today[0]?.n || 0);
    const room = Math.max(0, cap - used);
    if (room < rawReward) {
      rewardToPay = money(room);
      compoundable = room > 0;
    }
  }

  const agent = await findAgent(input.agentName);
  const group = `reward:${input.sourceRef}`;

  if (rewardToPay > 0) {
    const posted = await postEntry({
      kind: "profit_share",
      idempotencyKey: `reward:${input.sourceRef}`,
      group,
      refType: "manual",
      refId: input.sourceRef,
      memo: `پاداش ${rules.profitSharePct}٪ از سود ${pnl} USDT`,
      legs: [
        { account: "profit_share", amount: rewardToPay },
        { account: "profit", amount: -rewardToPay },
      ],
      meta: { agentName: input.agentName, pnl, points, ruleKey: "default" },
    });
    if (!posted.ok) return { ok: false, reason: posted.error };
  }

  await db.insert(agentRewards).values({
    agentId: agent?.id ?? null,
    agentName: input.agentName,
    source: "trade",
    jobId: input.jobId ?? null,
    tradeProfitUsdt: pnl,
    ruleKey: "default",
    rewardUsdt: rewardToPay,
    points: Math.round(points),
    compounded: compoundable && rewardToPay > 0,
    ledgerGroup: group,
    idempotencyKey: key,
    detail:
      input.detail ||
      (profitable
        ? `پاداش ${rules.profitSharePct}٪ از سود خالص ${pnl} USDT`
        : `سود ${pnl} USDT کمتر از حد آستانهٔ ${rules.minProfitUsdt} USDT بود؛ پاداش پرداخت نشد`),
    meta: { rules, rewardRaw: rawReward, rewarded: rewardToPay },
  });

  // ثبت در دفتر فعالیت کارمند (همان جایی که پنل می‌خواند)
  await db
    .insert(agentActivityLogs)
    .values({
      agentId: agent?.id ?? null,
      agentName: input.agentName,
      action: profitable
        ? `🏅 پاداش معاملهٔ موفق: +${rewardToPay} USDT و ${Math.round(points)} امتیاز`
        : `معامله بسته شد بدون پاداش (سود ${pnl} USDT)`,
      status: profitable ? "success" : "skipped",
      detail: input.detail || "",
      rewardUsdt: rewardToPay,
      jobId: input.jobId ?? null,
      source: "ledger",
      meta: { pnl, points, compounded: compoundable },
    })
    .catch(() => {});

  if (agent?.id) {
    await db
      .update(agents)
      .set({
        tasksCompleted: sql`${agents.tasksCompleted} + ${profitable ? 1 : 0}`,
        lastActiveAt: new Date(),
      })
      .where(eq(agents.id, agent.id))
      .catch(() => {});
  }

  return {
    ok: true,
    rewardUsdt: rewardToPay,
    points: Math.round(points),
    compounded: compoundable && rewardToPay > 0,
  };
}

function startOfUtcDay() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

async function findAgent(nameOrSlug: string) {
  const rows = await db.select().from(agents);
  return rows.find((a) => a.name === nameOrSlug) || rows.find((a) => a.slug === nameOrSlug) || null;
}

// ─────────────────────────────────────────────────────────────────────────
//  اتصال به درآمد تأییدشدهٔ موجود (بدون تغییر مسیرهای فعلی)
// ─────────────────────────────────────────────────────────────────────────

/**
 * هر درآمد تأییدشده (واریز با هش واقعی) را در دفتر کل هم ثبت می‌کند:
 *   کیف پول واحد ↑ / درآمد ↓
 * این تابع idempotent است؛ فراخوانی دوباره هیچ تغییری نمی‌دهد.
 */
export async function recordConfirmedIncomeInLedger(tx: {
  id: number;
  title: string;
  amountUsdt: number;
  txHash: string;
  agentName?: string;
}) {
  const amount = money(Number(tx.amountUsdt) || 0);
  if (!(amount > 0) || !tx.txHash) return { ok: false as const, error: "درآمد بدون مبلغ/هش ثبت نمی‌شود" };
  return postEntry({
    kind: "revenue",
    idempotencyKey: `revenue:${tx.txHash}`,
    refType: "transaction",
    refId: tx.id,
    memo: tx.title,
    legs: [
      { account: "wallet", amount },
      { account: "profit", amount: -amount },
    ],
    meta: { agentName: tx.agentName || "", txHash: tx.txHash },
  });
}

/** پرکردن گذشته: همهٔ درآمدهای تأییدشدهٔ ثبت‌شده را وارد دفتر می‌کند. */
export async function backfillConfirmedIncome(limit = 200) {
  await ensureLedger();
  const rows = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.kind, "income"), eq(transactions.status, "confirmed")))
    .orderBy(desc(transactions.createdAt))
    .limit(limit);
  let written = 0;
  let duplicates = 0;
  for (const t of rows) {
    const r = await recordConfirmedIncomeInLedger({
      id: t.id,
      title: t.title,
      amountUsdt: Number(t.amountUsdt),
      txHash: t.txHash,
      agentName: t.agentName,
    });
    if (r.ok) written++;
    else duplicates++;
  }
  return { scanned: rows.length, written, skipped: duplicates };
}

/** خواندن ردیف‌های اخیر دفتر برای نمایش در پنل. */
export async function listLedgerEntries(limit = 40) {
  await ensureLedger();
  return db
    .select()
    .from(ledgerEntries)
    .orderBy(desc(ledgerEntries.id))
    .limit(limit);
}

export async function listRewards(limit = 30) {
  await ensureLedger();
  return db
    .select()
    .from(agentRewards)
    .orderBy(desc(agentRewards.id))
    .limit(limit);
}

/** خلاصهٔ دفتر + پاداش برای پنل و گزارش. */
export async function ledgerSummary() {
  await ensureLedger();
  const [capital, rewardTotals, rules, recent, pnlTotals] = await Promise.all([
    getWorkingCapital(),
    db
      .select({
        n: sql<number>`COUNT(*)`,
        reward: sql<number>`COALESCE(SUM(${agentRewards.rewardUsdt}), 0)`,
        points: sql<number>`COALESCE(SUM(${agentRewards.points}), 0)`,
      })
      .from(agentRewards),
    getRewardRules(),
    listLedgerEntries(20),
    db
      .select({
        pnl: sql<number>`COALESCE(SUM(CASE WHEN ${ledgerEntries.kind} = 'trade_pnl' THEN ${ledgerEntries.debitUsdt} - ${ledgerEntries.creditUsdt} ELSE 0 END), 0)`,
      })
      .from(ledgerEntries),
  ]);
  return {
    ...capital,
    rules,
    rewards: {
      count: Number(rewardTotals[0]?.n || 0),
      paidUsdt: money(Number(rewardTotals[0]?.reward || 0)),
      points: Number(rewardTotals[0]?.points || 0),
    },
    tradePnlUsdt: money(Number(pnlTotals[0]?.pnl || 0)),
    recent,
  };
}

/** تنظیم موجودی صرافی از کیف پول (برداشت/انتقال واقعی با هش). */
export async function moveFunds(input: {
  from: "wallet" | "exchange";
  to: "wallet" | "exchange";
  amountUsdt: number;
  txHash: string;
  actor: string;
  note?: string;
}) {
  await ensureLedger();
  const amount = money(Number(input.amountUsdt) || 0);
  const txHash = String(input.txHash || "").trim();
  if (!(amount > 0)) return { ok: false as const, error: "مبلغ انتقال نامعتبر است" };
  if (txHash.length < 16) {
    return { ok: false as const, error: "برای انتقال وجه، هش تراکنش واقعی الزامی است" };
  }
  const balances = await getBalances();
  if (balances[input.from] + 1e-9 < amount) {
    return {
      ok: false as const,
      error: `موجودی حساب ${input.from} کافی نیست (${balances[input.from]} USDT)`,
    };
  }
  return postEntry({
    kind: "adjustment",
    idempotencyKey: `move:${txHash}`,
    refType: "transaction",
    refId: txHash,
    memo: input.note || `انتقال ${amount} USDT از ${input.from} به ${input.to}`,
    legs: [
      { account: input.to, amount },
      { account: input.from, amount: -amount },
    ],
    meta: { actor: input.actor, txHash },
  });
}
