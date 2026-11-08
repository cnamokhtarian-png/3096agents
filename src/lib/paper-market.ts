/** Deliberately independent of exchange.ts: no credentials or signed-order helpers. */
export async function readPaperBook(symbol: string) {
  if (!/^[A-Z0-9]{2,25}USDT$/.test(symbol)) throw new Error('invalid_paper_symbol');
  const startedAt = Date.now();
  const response = await fetch(`https://api1.tabdeal.org/r/api/v1/depth?symbol=${encodeURIComponent(symbol)}&limit=1`, {
    cache:'no-store', signal:AbortSignal.timeout(7000),
  });
  if (!response.ok) throw new Error('paper_market_unavailable');
  const raw = await response.json();
  const bid = raw?.bids?.[0]?.[0], ask = raw?.asks?.[0]?.[0];
  if (typeof bid !== 'string' || typeof ask !== 'string') throw new Error('paper_book_invalid');
  return {bid,ask,startedAt};
}
