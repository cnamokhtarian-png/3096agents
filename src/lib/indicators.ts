/**
 * اندیکاتورهای تکنیکال خالص TypeScript (بدون وابستگی بومی TA-Lib).
 * ورودیها کندلهای OHLCV صرافی هستند؛ خروجیها همان چیزی است که موتور ریسک
 * آریا (A1) برای تصمیمگیری استفاده میکند.
 */

export type Candle = {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  openTime: number;
};

export function sma(values: number[], period: number): number {
  if (values.length < period) return values[values.length - 1] ?? 0;
  const slice = values.slice(-period);
  return slice.reduce((s, v) => s + v, 0) / period;
}

export function ema(values: number[], period: number): number {
  if (values.length === 0) return 0;
  if (values.length < period) return sma(values, values.length);
  const k = 2 / (period + 1);
  let e = sma(values.slice(0, period), period);
  for (let i = period; i < values.length; i++) {
    e = values[i] * k + e * (1 - k);
  }
  return e;
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

/** RSI وایلدر (۱۴Periodهٔ استاندارد). */
export function rsi(closes: number[], period = 14): number {
  if (closes.length <= period) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gains += d;
    else losses -= d;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export type Macd = { macd: number; signal: number; histogram: number };

export function macd(closes: number[]): Macd {
  if (closes.length < 35) return { macd: 0, signal: 0, histogram: 0 };
  const fast = emaSeries(closes, 12);
  const slow = emaSeries(closes, 26);
  const line = closes.map((_, i) => fast[i] - slow[i]);
  const signal = emaSeries(line.slice(25), 9);
  const offset = line.length - signal.length;
  const m = line[line.length - 1];
  const s = signal[signal.length - 1];
  void offset;
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
        Math.abs(c.low - prev)
      )
    );
  }
  let a = trs.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < trs.length; i++) {
    a = (a * (period - 1) + trs[i]) / period;
  }
  return a;
}

export function supportResistance(candles: Candle[], lookback = 20) {
  const slice = candles.slice(-lookback);
  if (slice.length === 0) return { support: 0, resistance: 0 };
  return {
    support: Math.min(...slice.map((c) => c.low)),
    resistance: Math.max(...slice.map((c) => c.high)),
  };
}

export function technicalSummary(candles: Candle[], price: number) {
  const closes = candles.map((c) => c.close);
  const { macd: m, signal, histogram } = macd(closes);
  const { support, resistance } = supportResistance(candles);
  const a = atr(candles);
  return {
    rsi: rsi(closes),
    macd: m,
    macdSignal: signal,
    macdHist: histogram,
    ma20: sma(closes, 20),
    ma50: sma(closes, 50),
    support,
    resistance,
    atr: a,
    volatilityPct: price > 0 ? (a / price) * 100 : 0,
    volumeUsdt: candles.length
      ? candles[candles.length - 1].volume * price
      : 0,
  };
}
