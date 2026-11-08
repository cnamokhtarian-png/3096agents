/** A read-only trigger decision; this function never sends an order. */
export type PositionTrigger = 'take_profit' | 'stop_loss' | 'hold';
export function positionTrigger(input: {
  state: string;
  bestBid: number;
  bidTimeMs: number;
  nowMs: number;
  maxAgeMs: number;
  stopPrice: number;
  targetPrice: number;
}): PositionTrigger {
  const { state, bestBid, bidTimeMs, nowMs, maxAgeMs, stopPrice, targetPrice } = input;
  if (state !== 'open') throw new Error('position_not_open');
  if (![bestBid, bidTimeMs, nowMs, maxAgeMs, stopPrice, targetPrice].every(Number.isFinite) || bestBid <= 0 || maxAgeMs <= 0 || stopPrice <= 0 || targetPrice <= stopPrice) throw new Error('invalid_monitor_input');
  if (bidTimeMs > nowMs || nowMs - bidTimeMs > maxAgeMs) throw new Error('stale_market_data');
  if (bestBid <= stopPrice) return 'stop_loss';
  if (bestBid >= targetPrice) return 'take_profit';
  return 'hold';
}

/** Parse one level of Tabdeal's order book; an absent/crossed book is unusable. */
export function parseTabdealTopOfBook(value: unknown): { bid: number; ask: number } {
  const book = value as { bids?: unknown; asks?: unknown } | null;
  if (!book || !Array.isArray(book.bids) || !Array.isArray(book.asks) || !Array.isArray(book.bids[0]) || !Array.isArray(book.asks[0])) throw new Error('invalid_order_book');
  const bid = Number(book.bids[0][0]);
  const ask = Number(book.asks[0][0]);
  const bidQty = Number(book.bids[0][1]);
  const askQty = Number(book.asks[0][1]);
  if (![bid, ask, bidQty, askQty].every(Number.isFinite) || bid <= 0 || ask <= 0 || bidQty <= 0 || askQty <= 0 || bid > ask) throw new Error('invalid_order_book');
  return { bid, ask };
}
