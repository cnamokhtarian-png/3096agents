/** Read-only exchange reconciliation; recording is delegated to an atomic DB function. */
export type EntryFill = { tradeId: string; orderId: string; symbol: string; side: 'BUY' | 'SELL'; quantity: string; quoteQuantity: string; commission: string; commissionAsset: string };
export type EntryPosition = { id: string; symbol: string; exchangeOrderId: string; quoteAsset: string; baseAsset: string };
export async function reconcileEntryFills(position: EntryPosition, deps: {
  fetchFills: (p: EntryPosition) => Promise<EntryFill[]>;
  recordFill: (p: EntryPosition, fill: EntryFill) => Promise<{ status: 'recorded' | 'already_recorded' }>;
}) {
  const fills = await deps.fetchFills(position);
  if (!Array.isArray(fills) || fills.length >= 1000) throw new Error('trade_history_incomplete');
  const ids = new Set<string>();
  for (const f of fills) {
    if (f.symbol !== position.symbol || f.orderId !== position.exchangeOrderId || f.side !== 'BUY' || !/^\d{1,30}$/.test(f.tradeId)) throw new Error('trade_mismatch');
    if (ids.has(f.tradeId)) throw new Error('duplicate_trade_id');
    ids.add(f.tradeId);
  }
  const ordered = [...fills].sort((a, b) => BigInt(a.tradeId) < BigInt(b.tradeId) ? -1 : BigInt(a.tradeId) > BigInt(b.tradeId) ? 1 : 0);
  const results: Array<{ tradeId: string; status: string }> = [];
  for (const fill of ordered) {
    const r = await deps.recordFill(position, fill);
    if (!r || !['recorded', 'already_recorded'].includes(r.status)) throw new Error('ambiguous_settlement_result');
    results.push({ tradeId: fill.tradeId, status: r.status });
  }
  return { positionId: position.id, fills: results };
}
