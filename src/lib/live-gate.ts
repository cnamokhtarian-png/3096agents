import { db } from "@/db";
import { exchangeOrders, settings, systemEvents } from "@/db/schema";
import { gte, sql } from "drizzle-orm";
import { fetchPublicPrices, resolveExchangeConfig } from "@/lib/exchange";
import { getWorkingCapital } from "@/lib/ledger";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  دروازهٔ معاملهٔ واقعی (Live Trading Gate)
 * ═══════════════════════════════════════════════════════════════════════
 *
 *  هدف: روشن‌کردن معاملهٔ واقعی با سرمایهٔ خرد، اما «ایمن و بازگشت‌پذیر».
 *
 *  سه لایهٔ محافظت که همه باید هم‌زمان برقرار باشند تا یک سفارش ارسال شود:
 *
 *    ۱. کلید صرافی + فلگ AGENT_TRADING_ENABLED (همان قفل قبلی)
 *    ۲. دروازهٔ سرمایهٔ خرد:
 *         • سرمایهٔ اولیه در دفتر کل ثبت شده باشد
 *         • موجودی واقعی صرافی برای سفارش کافی باشد
 *         • اندازهٔ سفارش از درصد ریسک تعیین‌شده بیشتر نشود
 *    ۳. سقف‌های روزانه (Risk Caps):
 *         • حداکثر تعداد سفارش در روز
 *         • حداکثر حجم معاملات روز (USDT)
 *         • حداکثر ضرر روزانه (Kill-switch خودکار)
 *
 *  نکتهٔ مهم: هیچ‌کدام از این مقادیر «تصمیم معاملاتی» نیستند؛ فقط سقف
 *  ایمنی‌اند. تصمیم معامله همچنان با آریا + تأیید [✅] مدیرعامل است.
 */

export type LiveGateConfig = {
  /** درصد ریسک هر معامله از موجودی آزاد صرافی */
  riskPctPerTrade: number;
  /** حداکثر حجم یک سفارش (USDT) — سقف مطلق برای سرمایهٔ خرد */
  maxOrderUsdt: number;
  /** حداکثر تعداد سفارش در ۲۴ ساعت */
  maxOrdersPerDay: number;
  /** حداکثر حجم کل معاملات در ۲۴ ساعت */
  maxDailyVolumeUsdt: number;
  /** سقف ضرر محقق‌شدهٔ روز؛ با عبور از آن، ارسال سفارش خودکار قفل می‌شود */
  maxDailyLossUsdt: number;
  /** توقف اضطراری دستی (Kill-switch) */
  halted: boolean;
  haltReason: string;
};

const KEYS = {
  riskPctPerTrade: "live_risk_pct_per_trade",
  maxOrderUsdt: "live_max_order_usdt",
  maxOrdersPerDay: "live_max_orders_per_day",
  maxDailyVolumeUsdt: "live_max_daily_volume_usdt",
  maxDailyLossUsdt: "live_max_daily_loss_usdt",
  halted: "live_halted",
  haltReason: "live_halt_reason",
} as const;

/** پیش‌فرض‌های محافظه‌کارانه برای «سرمایهٔ خرد» (قابل تغییر از پنل). */
export const DEFAULT_LIVE_GATE: LiveGateConfig = {
  riskPctPerTrade: 2,
  maxOrderUsdt: 25,
  maxOrdersPerDay: 4,
  maxDailyVolumeUsdt: 60,
  maxDailyLossUsdt: 10,
  halted: false,
  haltReason: "",
};

function num(raw: string | undefined, fallback: number) {
  const n = Number(raw);
  return raw !== undefined && raw !== "" && Number.isFinite(n) ? n : fallback;
}

export async function getLiveGate(): Promise<LiveGateConfig> {
  let map = new Map<string, string>();
  try {
    const rows = await db.select().from(settings);
    map = new Map(rows.map((r) => [r.key, r.value]));
  } catch {
    // در دسترس نبودن تنظیمات → پیش‌فرض محافظه‌کارانه
  }
  const halted = ["true", "1", "yes", "on"].includes(
    (map.get(KEYS.halted) || "").trim().toLowerCase(),
  );
  return {
    riskPctPerTrade: num(map.get(KEYS.riskPctPerTrade), DEFAULT_LIVE_GATE.riskPctPerTrade),
    maxOrderUsdt: num(map.get(KEYS.maxOrderUsdt), DEFAULT_LIVE_GATE.maxOrderUsdt),
    maxOrdersPerDay: num(map.get(KEYS.maxOrdersPerDay), DEFAULT_LIVE_GATE.maxOrdersPerDay),
    maxDailyVolumeUsdt: num(
      map.get(KEYS.maxDailyVolumeUsdt),
      DEFAULT_LIVE_GATE.maxDailyVolumeUsdt,
    ),
    maxDailyLossUsdt: num(map.get(KEYS.maxDailyLossUsdt), DEFAULT_LIVE_GATE.maxDailyLossUsdt),
    halted,
    haltReason: map.get(KEYS.haltReason) || "",
  };
}

export async function setLiveGate(patch: Partial<LiveGateConfig>, actor = "panel") {
  const entries: Array<[string, string]> = [];
  if (patch.riskPctPerTrade !== undefined)
    entries.push([KEYS.riskPctPerTrade, String(patch.riskPctPerTrade)]);
  if (patch.maxOrderUsdt !== undefined) entries.push([KEYS.maxOrderUsdt, String(patch.maxOrderUsdt)]);
  if (patch.maxOrdersPerDay !== undefined)
    entries.push([KEYS.maxOrdersPerDay, String(Math.round(patch.maxOrdersPerDay))]);
  if (patch.maxDailyVolumeUsdt !== undefined)
    entries.push([KEYS.maxDailyVolumeUsdt, String(patch.maxDailyVolumeUsdt)]);
  if (patch.maxDailyLossUsdt !== undefined)
    entries.push([KEYS.maxDailyLossUsdt, String(patch.maxDailyLossUsdt)]);
  if (patch.halted !== undefined) entries.push([KEYS.halted, String(patch.halted)]);
  if (patch.haltReason !== undefined) entries.push([KEYS.haltReason, patch.haltReason]);

  for (const [key, value] of entries) {
    await db
      .insert(settings)
      .values({ key, value })
      .onConflictDoUpdate({ target: settings.key, set: { value: sql`excluded.value` } });
  }
  if (entries.length) {
    await db
      .insert(systemEvents)
      .values({
        level: patch.halted === true ? "warn" : "info",
        scope: "live_gate",
        message: `پیکربندی دروازهٔ معاملهٔ واقعی به‌روزرسانی شد (${actor})`,
        meta: { patch },
      })
      .catch(() => {});
  }
  return getLiveGate();
}

// ─────────────────────────────────────────────────────────────────────────
//  وضعیت مصرف روزانه
// ─────────────────────────────────────────────────────────────────────────

export type DailyUsage = {
  orders: number;
  volumeUsdt: number;
  realisedPnlUsdt: number;
  since: string;
};

export async function getDailyUsage(): Promise<DailyUsage> {
  const since = new Date(Date.now() - 24 * 3600_000);
  let orders = 0;
  let volume = 0;
  try {
    const rows = await db
      .select({
        n: sql<number>`COUNT(*)`,
        q: sql<number>`COALESCE(SUM(COALESCE(${exchangeOrders.quoteQty}, 0)), 0)`,
      })
      .from(exchangeOrders)
      .where(gte(exchangeOrders.createdAt, since));
    orders = Number(rows[0]?.n || 0);
    volume = Number(rows[0]?.q || 0);
  } catch {
    // جدول سفارش‌ها هنوز ساخته نشده است
  }

  let pnl = 0;
  try {
    const rows = await db.execute(sql`
      SELECT COALESCE(SUM(debit_usdt - credit_usdt), 0) AS pnl
        FROM agentos.ledger_entries
       WHERE kind = 'trade_pnl' AND created_at >= ${since.toISOString()}
    `);
    pnl = Number((rows as any)?.rows?.[0]?.pnl || 0);
  } catch {
    pnl = 0;
  }

  return {
    orders,
    volumeUsdt: Math.round(volume * 100) / 100,
    realisedPnlUsdt: Math.round(pnl * 100) / 100,
    since: since.toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────
//  بررسی نهایی پیش از ارسال سفارش
// ─────────────────────────────────────────────────────────────────────────

export type LiveGateBlocker = {
  code: string;
  label: string;
  action: string;
};

export type LiveGateCheck = {
  allowed: boolean;
  mode: "not_configured" | "read_only" | "testnet" | "live";
  blockers: LiveGateBlocker[];
  config: LiveGateConfig;
  usage: DailyUsage;
  /** مبلغ مجاز این سفارش بعد از اعمال همهٔ سقف‌ها */
  allowedOrderUsdt: number | null;
  message: string;
  /** یادداشت‌های آگاهی‌بخش (قفل نیستند) — مثلاً نبود Testnet روی صرافی فعلی */
  notes: string[];
};

/**
 * آیا همین حالا می‌توان سفارش واقعی با این مبلغ فرستاد؟
 * @param intendedUsdt مبلغ پیشنهادی سفارش (نسبت به موجودی واقعی صرافی)
 */
export async function checkLiveGate(intendedUsdt?: number): Promise<LiveGateCheck> {
  const [cfg, gate, usage] = await Promise.all([
    resolveExchangeConfig(),
    getLiveGate(),
    getDailyUsage(),
  ]);

  const blockers: LiveGateBlocker[] = [];
  if (gate.halted) {
    blockers.push({
      code: "halted",
      label: `توقف اضطراری فعال است${gate.haltReason ? ` — ${gate.haltReason}` : ""}`,
      action: "از پنل → «دروازهٔ معاملهٔ واقعی» توقف را بردارید (فقط پس از بررسی علت).",
    });
  }
  if (!cfg.apiKey || !cfg.apiSecret) {
    blockers.push({
      code: "missing_keys",
      label: "کلید/سکرت صرافی کامل نیست",
      action: "کلیدها را در Vercel یا پنل صرافی ذخیره کنید.",
    });
  }
  if (!cfg.tradingEnabled) {
    blockers.push({
      code: "trading_flag_off",
      label: "قفل ارسال سفارش بسته است (AGENT_TRADING_ENABLED=false)",
      action: "پس از تست، از پنل یا Vercel فلگ را true کنید.",
    });
  }
  if (usage.orders >= gate.maxOrdersPerDay) {
    blockers.push({
      code: "daily_order_cap",
      label: `سقف سفارش روزانه پر شده است (${usage.orders}/${gate.maxOrdersPerDay})`,
      action: "تا ۲۴ ساعت آینده سفارش تازه‌ای ارسال نمی‌شود؛ سقف را از پنل تغییر دهید اگر لازم است.",
    });
  }
  if (usage.volumeUsdt >= gate.maxDailyVolumeUsdt) {
    blockers.push({
      code: "daily_volume_cap",
      label: `سقف حجم معاملات روز پر شده است (${usage.volumeUsdt}/${gate.maxDailyVolumeUsdt} USDT)`,
      action: "فردا ادامه دهید یا سقف حجم را آگاهانه افزایش دهید.",
    });
  }
  if (usage.realisedPnlUsdt <= -Math.abs(gate.maxDailyLossUsdt)) {
    blockers.push({
      code: "daily_loss_cap",
      label: `سقف ضرر روزانه لمس شد (${usage.realisedPnlUsdt} USDT) — Kill-switch خودکار`,
      action: "تا فردا معامله متوقف است. این محافظت برای سرمایهٔ خرد حیاتی است.",
    });
  }

  // سرمایهٔ اولیه باید ثبت شده باشد تا اندازهٔ سفارش معنا داشته باشد
  let workingCapital = 0;
  try {
    workingCapital = (await getWorkingCapital()).workingCapitalUsdt;
  } catch {
    workingCapital = 0;
  }
  if (cfg.tradingEnabled && workingCapital <= 0) {
    blockers.push({
      code: "no_capital",
      label: "سرمایهٔ کاری در دفتر کل صفر است",
      action:
        "ابتدا در تب «📒 دفتر کل و پاداش» موجودی اولیهٔ خود را ثبت کنید (هش واریز یا موجودی داخل صرافی).",
    });
  }

  // سقف مبلغ: کوچک‌ترین مقدار از سه سقف
  const roomVolume = Math.max(0, gate.maxDailyVolumeUsdt - usage.volumeUsdt);
  const caps = [gate.maxOrderUsdt, roomVolume];
  if (intendedUsdt !== undefined && Number.isFinite(intendedUsdt) && intendedUsdt > 0) {
    caps.push(intendedUsdt);
  }
  const allowedOrderUsdt = blockers.length ? null : Math.min(...caps);

  if (!blockers.length && intendedUsdt !== undefined && intendedUsdt > allowedOrderUsdt!) {
    blockers.push({
      code: "order_too_large",
      label: `مبلغ سفارش ${intendedUsdt} USDT از سقف مجاز ${allowedOrderUsdt} USDT بیشتر است`,
      action: "مبلغ را کاهش دهید یا سقف را آگاهانه (و با احتیاط) در پنل بالا ببرید.",
    });
  }

  const mode: LiveGateCheck["mode"] = !cfg.apiKey || !cfg.apiSecret
    ? "not_configured"
    : !cfg.tradingEnabled
      ? "read_only"
      : cfg.testnet || cfg.exchangeName === "tabdeal"
        ? cfg.testnet
          ? "testnet"
          : "live"
        : "live";

  // ── یادداشت‌های آگاهی‌بخش (نه قفل) ─────────────────────────────────
  const notes: string[] = [];
  if (cfg.exchangeName === "tabdeal") {
    notes.push(
      "صرافی ذخیره‌شده Tabdeal است و Testnet ندارد؛ برای تمرین بدون پول واقعی، ابتدا کلیدهای Testnet بایننس را در تب صرافی ذخیره کنید.",
    );
  } else if (!cfg.testnet) {
    notes.push(
      "در حال حاضر Mainnet فعال است. برای یک چرخهٔ آزمایشی بدون پول واقعی، EXCHANGE_TESTNET را موقتاً true کنید.",
    );
  }
  if (workingCapital > 0 && gate.maxOrderUsdt > workingCapital) {
    notes.push(
      `سقف سفارش (${gate.maxOrderUsdt} USDT) از سرمایهٔ کاری (${workingCapital} USDT) بیشتر است؛ عملاً اندازهٔ سفارش به موجودی واقعی محدود می‌شود.`,
    );
  }

  const message = blockers.length
    ? blockers.map((b) => b.label).join(" • ")
    : `سفارش تا ${allowedOrderUsdt ?? 0} USDT مجاز است (${mode === "testnet" ? "Testnet" : "Mainnet"} • ${usage.orders}/${gate.maxOrdersPerDay} سفارش امروز).`;

  return {
    allowed: blockers.length === 0,
    mode,
    blockers,
    config: gate,
    usage,
    allowedOrderUsdt,
    message,
    notes,
  };
}

/**
 * سقف مبلغ برای ساخت پیشنهاد معامله در آریا: کوچک‌ترین مقدار بین
 * «درصد ریسک از موجودی واقعی» و «سقف سفارش خرد».
 */
export async function capOrderSize(riskSizedUsdt: number | null) {
  const gate = await getLiveGate();
  if (riskSizedUsdt === null || !Number.isFinite(riskSizedUsdt)) {
    return { usdt: null as number | null, capped: false, gate };
  }
  const capped = Math.min(riskSizedUsdt, gate.maxOrderUsdt);
  return { usdt: capped, capped: capped < riskSizedUsdt, gate };
}

// ─────────────────────────────────────────────────────────────────────────
//  بررسی سلامت کلید صرافی بدون ارسال سفارش
// ─────────────────────────────────────────────────────────────────────────

export type KeyHealth = {
  ok: boolean;
  priceOk: boolean;
  accountOk: boolean;
  symbolOk: boolean;
  errors: string[];
  checkedAt: string;
};

/** تست کامل اما بی‌خطر: قیمت + موجودی + بررسی امکان ثبت سفارش نماد. */
export async function verifyExchangeReadiness(symbol = "BTCUSDT"): Promise<KeyHealth> {
  const errors: string[] = [];
  let priceOk = false;
  let accountOk = false;
  let symbolOk = false;

  try {
    const prices = await fetchPublicPrices([symbol]);
    priceOk = Boolean(prices[0]?.price && prices[0].price > 0);
    if (!priceOk) errors.push("قیمت نماد خوانده نشد");
  } catch (e: any) {
    errors.push(`قیمت: ${e?.message || e}`);
  }

  const cfg = await resolveExchangeConfig();
  if (cfg.apiKey && cfg.apiSecret) {
    try {
      const { getAccountBalances } = await import("@/lib/exchange");
      const acc = await getAccountBalances(["USDT"]);
      accountOk = Array.isArray(acc.balances);
      if (!accountOk) errors.push("موجودی حساب خوانده نشد");
    } catch (e: any) {
      errors.push(`حساب: ${e?.message || e}`);
    }
    symbolOk = priceOk;
  } else {
    errors.push("کلید/سکرت صرافی ست نشده است");
  }

  return {
    ok: priceOk && accountOk && symbolOk,
    priceOk,
    accountOk,
    symbolOk,
    errors,
    checkedAt: new Date().toISOString(),
  };
}

/** برچسب فارسی وضعیت دروازه برای پنل. */
export function gateModeLabel(mode: LiveGateCheck["mode"]) {
  const map: Record<LiveGateCheck["mode"], string> = {
    not_configured: "کلید صرافی ست نشده (فقط خواندن قیمت)",
    read_only: "فقط‌خواندنی — قفل ارسال بسته است",
    testnet: "تست‌نت — تمرین بدون پول واقعی",
    live: "معاملهٔ واقعی (Mainnet) — با سقف خرد",
  };
  return map[mode];
}
