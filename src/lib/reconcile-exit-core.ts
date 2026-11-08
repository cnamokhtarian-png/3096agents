/**
 * Reconcile already-submitted sells only; this module never submits orders.
 * The database function owns locking, accounting and deterministic idempotency.
 */
export type ExitFill = { tradeId: string; orderId: string; symbol: string; side: 'BUY' | 'SELL'; quantity: string; quoteQuantity: string; commission: string; commissionAsset: string };
export type ExitPosition = { id: string; symbol: string; exchangeOrderId: string; quoteAsset: string; baseAsset: string };
export type FillResult = { status: 'recorded' | 'already_recorded'; remaining: number | string; pnl: number | string };
export async function reconcileExitFills(position: ExitPosition, deps: {
  fetchFills: (p: ExitPosition) => Promise<ExitFill[]>;
  recordFill: (p: ExitPosition, fill: ExitFill) => Promise<FillResult>;
}) {
  const fills = await deps.fetchFills(position);
  if (!Array.isArray(fills)) throw new Error('invalid_trade_response');
  if (fills.length >= 1000) throw new Error('trade_history_may_be_truncated');
  const ids = new Set<string>();
  for (const f of fills) {
    if (f.symbol !== position.symbol || f.orderId !== position.exchangeOrderId || f.side !== 'SELL' || !/^\d{1,30}$/.test(f.tradeId)) throw new Error('trade_mismatch');
    if (ids.has(f.tradeId)) throw new Error('duplicate_trade_id');
    ids.add(f.tradeId);
  }
  const ordered = [...fills].sort((a, b) => BigInt(a.tradeId) < BigInt(b.tradeId) ? -1 : BigInt(a.tradeId) > BigInt(b.tradeId) ? 1 : 0);
  const results: Array<{ tradeId: string; result: FillResult }> = [];
  for (const fill of ordered) {
    const result = await deps.recordFill(position, fill);
    if (!result || !['recorded', 'already_recorded'].includes(result.status)) throw new Error('ambiguous_settlement_result');
    results.push({ tradeId: fill.tradeId, result });
  }
  return { positionId: position.id, fills: results };
}
