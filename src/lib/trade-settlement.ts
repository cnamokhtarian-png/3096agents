/** Conservative accounting for a fully reconciled spot long, quote-currency fees only. */
type Fill = { qty: string; quoteQty: string; commission: string; commissionAsset: string };
type TradeSide = { status: string; fills: Fill[] };
function decimal(s: string) {
  if (typeof s !== 'string' || !/^\d+(?:\.\d+)?$/.test(s) || s.length > 64) throw new Error('invalid_fill_decimal');
  const [a, b = ''] = s.split('.'); return { n: BigInt(a + b), scale: b.length };
}
function power(n: number) { return BigInt(10) ** BigInt(n); }
function sum(values: string[]) {
  const parsed = values.map(decimal), scale = Math.max(0, ...parsed.map(x => x.scale));
  return { n: parsed.reduce((a, x) => a + x.n * power(scale - x.scale), BigInt(0)), scale };
}
function compare(a: {n: bigint; scale: number}, b: {n: bigint; scale: number}) {
  const scale = Math.max(a.scale, b.scale);
  return a.n * power(scale - a.scale) - b.n * power(scale - b.scale);
}
function format(n: bigint, scale: number) {
  const sign = n < BigInt(0) ? '-' : ''; const s = (n < BigInt(0) ? -n : n).toString().padStart(scale + 1, '0');
  return sign + (scale ? `${s.slice(0, -scale)}.${s.slice(-scale)}` : s);
}
export function calculateSpotSettlement(input: { quoteAsset: string; entry: TradeSide; exit: TradeSide }) {
  const { quoteAsset, entry, exit } = input;
  if (!/^[A-Z0-9]{2,15}$/.test(quoteAsset) || entry.status !== 'FILLED' || exit.status !== 'FILLED' || !entry.fills.length || !exit.fills.length) throw new Error('settlement_incomplete');
  const fills = [...entry.fills, ...exit.fills];
  if (fills.some(f => f.commissionAsset !== quoteAsset)) throw new Error('fee_asset_requires_reconciliation');
  const bought = sum(entry.fills.map(f => f.qty)); const sold = sum(exit.fills.map(f => f.qty));
  if (bought.n <= BigInt(0) || compare(bought, sold) !== BigInt(0)) throw new Error('quantity_requires_reconciliation');
  const cost = sum(entry.fills.map(f => f.quoteQty)); const proceeds = sum(exit.fills.map(f => f.quoteQty));
  const fees = sum(fills.map(f => f.commission));
  if (cost.n <= BigInt(0) || proceeds.n <= BigInt(0)) throw new Error('settlement_incomplete');
  const scale = Math.max(cost.scale, proceeds.scale, fees.scale);
  const result = proceeds.n * power(scale - proceeds.scale) - cost.n * power(scale - cost.scale) - fees.n * power(scale - fees.scale);
  return { quoteAsset, pnl: format(result, scale), entryQuote: format(cost.n, cost.scale), exitQuote: format(proceeds.n, proceeds.scale), feesQuote: format(fees.n, fees.scale) };
}
