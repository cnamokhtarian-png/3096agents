/** Parse exchange responses without assuming an order filled or a balance is zero. */
export function normalizeAccountBalances(raw: unknown, assets: string[]) {
  const account = raw as { balances?: unknown; canTrade?: unknown; accountType?: unknown } | null;
  if (!account || !Array.isArray(account.balances)) throw new Error('invalid_account_response');
  const wanted = new Set(assets.map(a => a.toUpperCase()));
  const balances = account.balances.filter((b: unknown) => {
    const row = b as { asset?: unknown } | null;
    return row && typeof row.asset === 'string' && wanted.has(row.asset.toUpperCase());
  }).map((b: { asset: string; free?: unknown; locked?: unknown; freeze?: unknown }) => {
    const rawFree = b.free;
    const rawLocked = b.locked ?? b.freeze;
    if (rawFree === undefined || rawFree === null || rawFree === '' || rawLocked === undefined || rawLocked === null || rawLocked === '') throw new Error('invalid_balance_response');
    const free = Number(rawFree), locked = Number(rawLocked);
    if (!Number.isFinite(free) || !Number.isFinite(locked) || free < 0 || locked < 0) throw new Error('invalid_balance_response');
    return { asset: b.asset.toUpperCase(), free, locked, total: free + locked };
  });
  return { canTrade: account.canTrade === true, balances, accountType: typeof account.accountType === 'string' ? account.accountType : null };
}

export function parseOrderAcknowledgement(raw: unknown): { status: string; orderId: string; executedQty: string; cummulativeQuoteQty: string } {
  const r = raw as Record<string, unknown> | null;
  if (!r || r.orderId == null || !['NEW', 'PARTIALLY_FILLED', 'FILLED', 'CANCELED', 'REJECTED', 'EXPIRED'].includes(String(r.status))) throw new Error('order_response_ambiguous');
  const qty = r.executedQty, quote = r.cummulativeQuoteQty ?? r.cumulativeQuoteQty;
  if (qty == null || quote == null || !/^\d+(?:\.\d+)?$/.test(String(qty)) || !/^\d+(?:\.\d+)?$/.test(String(quote))) throw new Error('order_response_ambiguous');
  return { status: String(r.status), orderId: String(r.orderId), executedQty: String(qty), cummulativeQuoteQty: String(quote) };
}
