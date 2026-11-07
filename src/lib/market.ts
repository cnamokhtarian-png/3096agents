import { db } from "@/db";
import { marketSnapshots, systemEvents } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { fetchPublicPrices, type PriceQuote } from "@/lib/exchange";

/**
 * قیمت بازار: همیشه واقعی.
 * ۱. آخرین اسنپ‌شات ذخیره‌شده در Supabase خوانده می‌شود.
 * ۲. اگر قدیمی‌تر از TTL باشد، از صرافی خوانده و ذخیره می‌شود.
 * ۳. اگر صرافی در دسترس نباشد، همان قیمت واقعیِ قبلی با برچسب «قدیمی»
 *    برگردانده می‌شود — هیچ عدد تصادفی جای قیمت واقعی نمی‌نشیند.
 */

export const TRACKED_SYMBOLS = ["BTCUSDT", "ETHUSDT", "TONUSDT"] as const;
const TTL_MS = 60_000;

type SnapshotRow = {
  symbol: string;
  price: string | number;
  changePct: string | number | null;
  source: string;
  fetchedAt: Date | string | null;
};

export type MarketEntry = {
  symbol: string;
  price: number;
  changePct: number | null;
  source: string;
  fetchedAt: string;
  ageSeconds: number;
  stale: boolean;
};

export type MarketOverview = {
  available: boolean;
  entries: MarketEntry[];
  error: string | null;
  fetchedAt: string | null;
  source: string | null;
};

function toEntry(row: SnapshotRow): MarketEntry {
  const fetchedAt = row.fetchedAt ? new Date(row.fetchedAt) : new Date(0);
  const ageSeconds = Math.max(0, Math.round((Date.now() - fetchedAt.getTime()) / 1000));
  return {
    symbol: row.symbol,
    price: Number(row.price),
    changePct: row.changePct === null || row.changePct === undefined ? null : Number(row.changePct),
    source: row.source,
    fetchedAt: fetchedAt.toISOString(),
    ageSeconds,
    stale: ageSeconds * 1000 > TTL_MS,
  };
}

/** آخرین ردیف هر نماد از دیتابیس */
export async function latestSnapshots(symbols: readonly string[] = TRACKED_SYMBOLS) {
  const out: MarketEntry[] = [];
  for (const symbol of symbols) {
    const rows = await db
      .select()
      .from(marketSnapshots)
      .where(eq(marketSnapshots.symbol, symbol))
      .orderBy(desc(marketSnapshots.fetchedAt), desc(marketSnapshots.id))
      .limit(1);
    if (rows[0]) out.push(toEntry(rows[0] as any));
  }
  return out;
}

async function persistQuotes(quotes: PriceQuote[]) {
  if (!quotes.length) return;
  await db.insert(marketSnapshots).values(
    quotes.map((q) => ({
      symbol: q.symbol,
      price: String(q.price),
      changePct: q.changePct === null ? null : String(q.changePct),
      source: q.source,
      fetchedAt: new Date(q.fetchedAt),
    }))
  );
}

/** به‌روزرسانی اجباری قیمت‌ها از صرافی (برای کرون یا دکمه‌ی رفرش) */
export async function refreshMarket(symbols: readonly string[] = TRACKED_SYMBOLS) {
  const started = Date.now();
  try {
    const quotes = await fetchPublicPrices([...symbols]);
    await persistQuotes(quotes);
    return {
      ok: true as const,
      quotes,
      entries: quotes.map(toEntry),
      durationMs: Date.now() - started,
    };
  } catch (e: any) {
    const message = e?.message || "market refresh failed";
    await db
      .insert(systemEvents)
      .values({ level: "warn", scope: "market", message, meta: { symbols } })
      .catch(() => {});
    return { ok: false as const, error: message, durationMs: Date.now() - started };
  }
}

/**
 * نمای بازار برای داشبورد. اگر آخرین اسنپ‌شات تازه باشد همان را می‌دهد،
 * وگرنه تلاش می‌کند قیمت واقعی جدید بگیرد.
 */
export async function getMarketOverview(
  symbols: readonly string[] = TRACKED_SYMBOLS,
  opts: { allowFetch?: boolean } = {}
): Promise<MarketOverview> {
  let entries = await latestSnapshots(symbols).catch(() => [] as MarketEntry[]);
  const allFresh = entries.length === symbols.length && entries.every((e) => !e.stale);

  if (!allFresh && opts.allowFetch !== false) {
    const refreshed = await refreshMarket(symbols);
    if (refreshed.ok) {
      entries = await latestSnapshots(symbols).catch(() => entries);
    } else if (!entries.length) {
      return {
        available: false,
        entries: [],
        error: refreshed.error,
        fetchedAt: null,
        source: null,
      };
    }
  }

  return {
    available: entries.length > 0,
    entries,
    error: entries.length ? null : "هیچ قیمت واقعی ثبت نشده است",
    fetchedAt: entries[0]?.fetchedAt ?? null,
    source: entries[0]?.source ?? null,
  };
}
