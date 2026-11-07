/**
 * موتور تحلیل تکنیکال و مدیریت ریسک ایجنت آریا (A1 — Crypto Trader)
 * تمامی محاسبات روی کندل‌های واقعی OHLCV صرافی (Binance / OKX) انجام می‌شود.
 * هیچ عدد تصادفی یا ساختگی تولید نمی‌شود.
 */

export type Candle = {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export function sma(values: number[], period: number): number {
  if (values.length === 0) return 0;
  const slice = values.length < period ? values : values.slice(-period);
  return slice.reduce((s, v) => s + v, 0) / slice.length;
}

export function emaSeries(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const out: number[] = [];
  let e = values[0];
  for (let i = 0; i < values.length; i++) {
    e = i === 0 ? values[0] : values[i] * k + e * (1 - k);
    out.push(e);
  }
  return out;
}

/** RSI استاندارد ۱۴ دوره‌ای وایلدر */
export function rsi(closes: number[], period = 14): number {
  if (closes.length <= period) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function macd(closes: number[]): {
  macd: number;
  signal: number;
  histogram: number;
} {
  if (closes.length < 35) return { macd: 0, signal: 0, histogram: 0 };
  const fast = emaSeries(closes, 12);
  const slow = emaSeries(closes, 26);
  const line = closes.map((_, i) => fast[i] - slow[i]);
  const sigSeries = emaSeries(line.slice(25), 9);
  const m = line[line.length - 1];
  const s = sigSeries[sigSeries.length - 1] ?? m;
  return { macd: m, signal: s, histogram: m - s };
}

export function atr(candles: Candle[], period = 14): number {
  if (candles.length < period + 1) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prev = candles[i - 1].close;
    trs.push(
      Math.max(
        c.high - c.low,
        Math.abs(c.high - prev),
        Math.abs(c.low - prev),
      ),
    );
  }
  let a = trs.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < trs.length; i++) {
    a = (a * (period - 1) + trs[i]) / period;
  }
  return a;
}

export function supportResistance(candles: Candle[], lookback = 24): {
  support: number;
  resistance: number;
} {
  const slice = candles.slice(-lookback);
  if (slice.length === 0) return { support: 0, resistance: 0 };
  return {
    support: Math.min(...slice.map((c) => c.low)),
    resistance: Math.max(...slice.map((c) => c.high)),
  };
}

export type TechnicalSetup = {
  symbol: string;
  actionable: boolean;
  side: "BUY" | "SELL";
  directionLabel: string;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  stopPct: number;
  targetPct: number;
  riskReward: number;
  leverage: number;
  /** مبلغ پیشنهادی سفارش — فقط اگر موجودی واقعی صرافی خوانده شده باشد */
  positionUsdt: number | null;
  maxLossUsdt: number | null;
  estimatedProfitUsdt: number | null;
  /** منبع مبلغ: موجودی واقعی صرافی یا نامشخص */
  sizingSource: "exchange_balance" | "unavailable";
  /** چرا مبلغ مشخص نشده (برای نمایش به مدیرعامل) */
  sizingNote: string;
  estimatedDuration: string;
  confidence: number;
  rsi: number;
  macdHist: number;
  ma20: number;
  ma50: number;
  support: number;
  resistance: number;
  volatilityPct: number;
  changePct24h: number | null;
  analysisReason: string;
  source: string;
};

function roundPrice(p: number): number {
  if (p >= 1000) return Math.round(p * 100) / 100;
  if (p >= 10) return Math.round(p * 1000) / 1000;
  return Math.round(p * 10000) / 10000;
}

export function buildTechnicalSetup(input: {
  symbol: string;
  candles: Candle[];
  livePrice: number;
  changePct24h: number | null;
  source: string;
  maxLeverage?: number;
  /** موجودی واقعی USDT قابل استفاده در صرافی (اگر خوانده شده باشد) */
  availableUsdt?: number | null;
  /** حداکثر درصد سرمایه برای هر معامله (پیش‌فرض ۲٪) */
  riskPct?: number;
}): TechnicalSetup {
  const { symbol, candles, livePrice, changePct24h, source } = input;
  const closes = candles.map((c) => c.close);
  const price = livePrice > 0 ? livePrice : closes[closes.length - 1] || 0;

  const rsiVal = Math.round(rsi(closes, 14) * 10) / 10;
  const macdVal = macd(closes);
  const ma20 = sma(closes, 20);
  const ma50 = sma(closes, 50);
  const { support, resistance } = supportResistance(candles, 24);
  const atrVal = atr(candles, 14) || price * 0.012;
  const volatilityPct = price > 0 ? Math.round((atrVal / price) * 10000) / 100 : 1.2;

  // امتیازدهی جهت‌دار بر اساس سیگنال‌های تکنیکال و ساختار بازار
  let bullScore = 0;
  let bearScore = 0;
  const reasons: string[] = [];

  if (rsiVal < 38) {
    bullScore += 28;
    reasons.push(`اشباع فروش نسبی در RSI (${rsiVal})`);
  } else if (rsiVal >= 38 && rsiVal <= 58 && macdVal.histogram >= 0) {
    bullScore += 18;
    reasons.push(`مومنتوم متعادل صعودی در RSI (${rsiVal})`);
  } else if (rsiVal > 68) {
    bearScore += 28;
    reasons.push(`اشباع خرید در RSI (${rsiVal})`);
  } else if (rsiVal > 58 && macdVal.histogram < 0) {
    bearScore += 16;
    reasons.push(`ضعف مومنتوم در RSI (${rsiVal})`);
  }

  if (macdVal.histogram > 0) {
    bullScore += 22;
    reasons.push("فاز مثبت هیستوگرام MACD");
  } else if (macdVal.histogram < 0) {
    bearScore += 22;
    reasons.push("فاز منفی هیستوگرام MACD");
  }

  if (price > ma20 && ma20 >= ma50) {
    bullScore += 25;
    reasons.push(`تثبیت بالای میانگین‌های MA20 (${roundPrice(ma20)}) و MA50 (${roundPrice(ma50)})`);
  } else if (price < ma20 && ma20 < ma50) {
    bearScore += 25;
    reasons.push(`قرارگیری زیر MA20 (${roundPrice(ma20)}) و MA50 (${roundPrice(ma50)})`);
  } else if (price >= ma50) {
    bullScore += 12;
    reasons.push(`حفظ حمایت میانگین ۵۰ دوره‌ای (${roundPrice(ma50)})`);
  } else {
    bearScore += 12;
    reasons.push(`فشار فروش زیر میانگین ۵۰ دوره‌ای (${roundPrice(ma50)})`);
  }

  if (support > 0 && (price - support) / price <= 0.018) {
    bullScore += 18;
    reasons.push(`واکنش نزدیک کف حمایتی ۲۴ ساعته ($${roundPrice(support)})`);
  }
  if (resistance > 0 && (resistance - price) / price <= 0.015) {
    bearScore += 15;
    reasons.push(`برخورد به سقف مقاومتی ۲۴ ساعته ($${roundPrice(resistance)})`);
  }

  if (changePct24h !== null) {
    reasons.push(
      `تغییرات ۲۴ ساعته بازار: ${changePct24h >= 0 ? "+" : ""}${changePct24h.toFixed(2)}٪`,
    );
  }

  const side: "BUY" | "SELL" = bullScore >= bearScore ? "BUY" : "SELL";
  const rawScore = Math.max(bullScore, bearScore);
  const edge = Math.abs(bullScore - bearScore);
  const confidence = Math.min(92, Math.max(52, Math.round(50 + rawScore * 0.42 + edge * 0.2)));

  // محاسبه حد ضرر (SL) و حد سود (TP) دقیق بر اساس ATR و سطوح کلیدی با نسبت R:R حداقل ۲.۲
  const stopDist = Math.max(atrVal * 1.5, price * 0.011);
  const rrTarget = 2.2;
  const targetDist = stopDist * rrTarget;

  const stopLoss = roundPrice(side === "BUY" ? price - stopDist : price + stopDist);
  const takeProfit = roundPrice(side === "BUY" ? price + targetDist : price - targetDist);

  const stopPct = Math.round((Math.abs(price - stopLoss) / price) * 10000) / 100;
  const targetPct = Math.round((Math.abs(takeProfit - price) / price) * 10000) / 100;
  const riskReward = stopPct > 0 ? Math.round((targetPct / stopPct) * 100) / 100 : 2.2;

  // کنترل سخت‌گیرانه اهرم بر اساس نوسان ATR
  const capLev = Math.max(1, Math.min(5, Math.round(input.maxLeverage ?? 3)));
  const safeLev = volatilityPct > 2.5 ? 1 : volatilityPct > 1.5 ? Math.min(2, capLev) : Math.min(3, capLev);
  const leverage = Math.max(1, safeLev);

  // ⛔ هیچ مبلغ ساختگی: اندازهٔ پوزیشن فقط از موجودی واقعی صرافی و
  // درصد ریسک تنظیم‌شده محاسبه می‌شود. اگر موجودی خوانده نشده باشد،
  // مبلغ null می‌ماند تا مدیرعامل خودش آن را وارد کند.
  const available =
    input.availableUsdt !== undefined && input.availableUsdt !== null
      ? Number(input.availableUsdt)
      : null;
  const riskPct = Math.min(20, Math.max(0.1, Number(input.riskPct ?? 2)));
  const positionUsdt =
    available !== null && Number.isFinite(available) && available > 0
      ? Math.round(available * (riskPct / 100) * 100) / 100
      : null;
  const sizingSource: "exchange_balance" | "unavailable" =
    positionUsdt !== null ? "exchange_balance" : "unavailable";
  const sizingNote =
    positionUsdt !== null
      ? `${riskPct}٪ از موجودی واقعی صرافی (${available} USDT)`
      : "موجودی واقعی صرافی در دسترس نیست (کلید API صرافی ست نشده)؛ مبلغ را خودتان تعیین کنید.";

  const maxLossUsdt =
    positionUsdt !== null
      ? Math.round(positionUsdt * (stopPct / 100) * leverage * 100) / 100
      : null;
  const estimatedProfitUsdt =
    positionUsdt !== null
      ? Math.round(positionUsdt * (targetPct / 100) * leverage * 100) / 100
      : null;

  // تخمین زمان رسیدن به تارگت بر اساس میانگین دامنه کندل یک‌ساعته (ATR)
  const estHours = Math.max(2, Math.min(24, Math.round(targetDist / Math.max(atrVal * 0.55, price * 0.003))));
  const minH = Math.max(2, estHours - 2);
  const maxH = estHours + 2;
  const estimatedDuration = `${minH} الی ${maxH} ساعت`;

  // شرط عملیاتی بودن پیشنهاد: اطمینان >= 62% و R:R >= 1.8 و نوسان کنترل‌شده <= 4.5%
  const actionable = confidence >= 62 && riskReward >= 1.8 && volatilityPct <= 4.5 && candles.length >= 20;

  return {
    symbol,
    actionable,
    side,
    directionLabel: side === "BUY" ? "خرید / LONG" : "فروش / SHORT",
    entryPrice: roundPrice(price),
    stopLoss,
    takeProfit,
    stopPct,
    targetPct,
    riskReward,
    leverage,
    positionUsdt,
    maxLossUsdt,
    estimatedProfitUsdt,
    sizingSource,
    sizingNote,
    estimatedDuration,
    confidence,
    rsi: rsiVal,
    macdHist: Math.round(macdVal.histogram * 1000) / 1000,
    ma20: roundPrice(ma20),
    ma50: roundPrice(ma50),
    support: roundPrice(support),
    resistance: roundPrice(resistance),
    volatilityPct,
    changePct24h,
    analysisReason: reasons.join(" + "),
    source,
  };
}
