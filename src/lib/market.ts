/**
 * 🌐 لایهٔ دادهٔ بازار آریا (A1)
 * ---------------------------------------------------------------------------
 * منابع REAL (بدون نیاز به کلید، قابل استفاده در Vercel Production):
 *   • Binance Spot /api/v3/klines      → OHLCV ۴ ساعته برای RSI/MACD/MA/ATR
 *   • Binance Spot /api/v3/ticker/price → قیمت لحظهای
 *   • Binance Spot /api/v3/depth        → عمق دفتر سفارشات (Order Book)
 *   • Binance Spot /api/v3/aggTrades    → جریان سفارشات بزرگ / نهنگهای صرافی
 *   • alternative.me/fng                → شاخص ترس و طمع
 *   • CryptoPanic (اختیاری، با کلید)   → احساسات اخبار
 *
 * قواعد صداقت داده:
 *   - هیچوقت دادهٔ ساختگی بهعنوان «زنده» برچسب نمیخورد. `source` و `notes`
 *     دقیقاً مشخص میکنند کدام منبع در دسترس بوده است.
 *   - اگر شبکه/محیط (مثلاً سندباکس یا تحریم IP صرافی) دسترسی ندهد، حالت
 *     `fallback` با مقدار مشخص و برچسب «آفلاین» برمیگردد تا اپ از کار نیفتد.
 *   - دادهٔ درونزنجیرهای واقعی (Whale Alert / Glassnode) نیازمند کلید API است؛
 *     تا آن زمان از «جریان سفارشات بزرگ صرافی» بهعنوان پروکسی استفاده میشود
 *     و در UI صریحاً با همین نام نمایش داده میشود.
 */

import { technicalSummary, type Candle } from "@/lib/indicators";

const DEFAULT_TIMEOUT = 3500;

export type DataSource = "live" | "partial" | "fallback";

export type MarketSnapshot = {
  symbol: string;
  price: number;
  rsi: number;
  macd: number;
  macdSignal: number;
  macdHist: number;
  ma20: number;
  ma50: number;
  support: number;
  resistance: number;
  fearGreed: number;
  fearGreedLabel: string;
  orderbookImbalance: number; // -1 (فروشندگان) تا +1 (خریداران)
  whaleFlowUsdt: number; // خالص سفارشات بزرگ صرافی
  sentiment: number; // -1 تا +1
  volumeUsdt: number;
  volatilityPct: number;
  source: DataSource;
  sources: string[];
  notes: string[];
  candles: number;
  fetchedAt: string;
};

function bases(): string[] {
  const custom = process.env.MARKET_API_BASE;
  return [
    ...(custom ? [custom.replace(/\/$/, "")] : []),
    "https://api.binance.com",
    "https://api.binance.us",
  ];
}

function symbolParam(symbol: string) {
  return symbol.replace("/", "").replace("-", "").toUpperCase();
}

async function fetchJSON<T = any>(url: string, timeout = DEFAULT_TIMEOUT): Promise<T> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeout),
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

async function tryBases<T>(path: string, timeout = DEFAULT_TIMEOUT): Promise<T | null> {
  for (const base of bases()) {
    try {
      return await fetchJSON<T>(`${base}${path}`, timeout);
    } catch {
      // base بعدی
    }
  }
  return null;
}

function offlineSnapshot(symbol: string, notes: string[]): MarketSnapshot {
  // مقدار پایدار و قابل ردیابی (بدون تظاهر به دادهٔ زنده)
  const base = Number(process.env.MARKET_FALLBACK_PRICE || 75800);
  const t = Date.now() / 3_600_000;
  const price = Math.round(base * (1 + Math.sin(t / 7) * 0.012));
  return {
    symbol,
    price,
    rsi: 54,
    macd: 38,
    macdSignal: 12,
    macdHist: 26,
    ma20: price * 0.994,
    ma50: price * 0.982,
    support: price * 0.979,
    resistance: price * 1.021,
    fearGreed: 55,
    fearGreedLabel: "خنثی (آفلاین)",
    orderbookImbalance: 0.08,
    whaleFlowUsdt: 420000,
    sentiment: 0,
    volumeUsdt: 1_250_000_000,
    volatilityPct: 1.4,
    source: "fallback",
    sources: [],
    notes: [
      ...notes,
      "اتصال به APIهای بازار در این محیط برقرار نشد → مقادیر آفلاین/نمونه با برچسب مشخص",
    ],
    candles: 0,
    fetchedAt: new Date().toISOString(),
  };
}

export async function fetchMarketSnapshot(
  symbol = "BTC/USDT"
): Promise<MarketSnapshot> {
  const s = symbolParam(symbol);
  const sources: string[] = [];
  const notes: string[] = [];

  const [klinesRaw, ticker, depth, aggTrades, fng, news] = await Promise.all([
    tryBases<any[]>(`/api/v3/klines?symbol=${s}&interval=4h&limit=120`),
    tryBases<any>(`/api/v3/ticker/price?symbol=${s}`),
    tryBases<any>(`/api/v3/depth?symbol=${s}&limit=50`),
    tryBases<any[]>(`/api/v3/aggTrades?symbol=${s}&limit=300`),
    fetchJSON<any>("https://api.alternative.me/fng/?limit=1").catch(() => null),
    fetchNewsSentiment(),
  ]);

  let candles: Candle[] = [];
  if (Array.isArray(klinesRaw) && klinesRaw.length >= 35) {
    candles = klinesRaw.map((k: any) => ({
      openTime: Number(k[0]),
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      close: Number(k[4]),
      volume: Number(k[5]),
    }));
    sources.push("Binance OHLCV 4h");
  } else {
    notes.push("کندلهای صرافی دریافت نشد");
  }

  const price =
    Number(ticker?.price) || (candles.length ? candles[candles.length - 1].close : 0);
  if (ticker?.price) sources.push("Binance Ticker");
  if (!price) return offlineSnapshot(symbol, notes);

  const tech = candles.length ? technicalSummary(candles, price) : null;

  let orderbookImbalance = 0;
  if (depth?.bids && depth?.asks) {
    const bid = depth.bids.reduce(
      (sum: number, row: any) => sum + Number(row[0]) * Number(row[1]),
      0
    );
    const ask = depth.asks.reduce(
      (sum: number, row: any) => sum + Number(row[0]) * Number(row[1]),
      0
    );
    if (bid + ask > 0) orderbookImbalance = (bid - ask) / (bid + ask);
    sources.push("Binance Order Book");
  } else {
    notes.push("عمق دفتر سفارشات دریافت نشد");
  }

  let whaleFlowUsdt = 0;
  if (Array.isArray(aggTrades)) {
    for (const t of aggTrades) {
      const quote = Number(t.p) * Number(t.q);
      if (quote < 100000) continue;
      // m=true یعنی خریدارِ maker بوده ⇒ فشار فروش (taker sell)
      whaleFlowUsdt += (t.m ? -1 : 1) * quote;
    }
    sources.push("Binance AggTrades (پروکسی نهنگ)");
  } else {
    notes.push("جریان معاملات بزرگ دریافت نشد");
  }

  let fearGreed = 50;
  let fearGreedLabel = "نامشخص";
  if (fng?.data?.[0]) {
    fearGreed = Number(fng.data[0].value) || 50;
    fearGreedLabel = String(fng.data[0].value_classification || "");
    sources.push("Fear & Greed Index");
  } else {
    notes.push("شاخص ترس و طمع دریافت نشد");
  }

  if (news.available) sources.push("CryptoPanic News");
  else notes.push("منبع اخبار تنظیم نشده (CRYPTOPANIC_API_KEY) → احساسات خنثی");

  if (!candles.length) {
    const off = offlineSnapshot(symbol, notes);
    return {
      ...off,
      price,
      fearGreed,
      fearGreedLabel,
      orderbookImbalance,
      whaleFlowUsdt,
      sentiment: news.score,
      sources,
      source: sources.length > 0 ? "partial" : "fallback",
    };
  }

  return {
    symbol,
    price,
    rsi: tech!.rsi,
    macd: tech!.macd,
    macdSignal: tech!.macdSignal,
    macdHist: tech!.macdHist,
    ma20: tech!.ma20,
    ma50: tech!.ma50,
    support: tech!.support,
    resistance: tech!.resistance,
    fearGreed,
    fearGreedLabel,
    orderbookImbalance,
    whaleFlowUsdt,
    sentiment: news.score,
    volumeUsdt: tech!.volumeUsdt,
    volatilityPct: tech!.volatilityPct,
    source: sources.length >= 4 ? "live" : "partial",
    sources,
    notes,
    candles: candles.length,
    fetchedAt: new Date().toISOString(),
  };
}

/** قیمت لحظهای سبک برای Mark-to-Market پوزیشنها. */
export async function fetchPrice(symbol: string): Promise<{
  price: number;
  source: string;
} | null> {
  const ticker = await tryBases<any>(
    `/api/v3/ticker/price?symbol=${symbolParam(symbol)}`,
    2500
  );
  const price = Number(ticker?.price);
  if (price > 0) return { price, source: "Binance Ticker" };
  return null;
}

async function fetchNewsSentiment(): Promise<{ score: number; available: boolean }> {
  const key = process.env.CRYPTOPANIC_API_KEY;
  if (!key) return { score: 0, available: false };
  try {
    const data = await fetchJSON<any>(
      `https://cryptopanic.com/api/v1/posts/?auth_token=${encodeURIComponent(
        key
      )}&currencies=BTC&public=true`,
      3000
    );
    const posts: any[] = Array.isArray(data?.results) ? data.results.slice(0, 20) : [];
    const bullish = ["rally", "surge", "breakout", "approval", "adoption", "inflow", "bullish"];
    const bearish = ["crash", "hack", "ban", "lawsuit", "outflow", "bearish", "liquidation"];
    let score = 0;
    for (const p of posts) {
      const title = String(p?.title || "").toLowerCase();
      if (bullish.some((w) => title.includes(w))) score += 1;
      if (bearish.some((w) => title.includes(w))) score -= 1;
    }
    return { score: Math.max(-1, Math.min(1, score / 10)), available: posts.length > 0 };
  } catch {
    return { score: 0, available: false };
  }
}
