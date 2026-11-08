/** Cancel a partial or stale entry, then read the exchange again. A failed or
 * lost cancellation response is never treated as proof of cancellation. */
export async function settleEntryOrderStatus<T extends { status: string }>(input: {
  order: T; createdAtMs: number; nowMs: number; maxOpenMs: number;
}, deps: { cancel: () => Promise<unknown>; lookup: () => Promise<T> }) {
  const { order,createdAtMs,nowMs,maxOpenMs }=input;
  if (![createdAtMs,nowMs,maxOpenMs].every(Number.isFinite) || maxOpenMs <= 0 || createdAtMs > nowMs) throw new Error('invalid_entry_clock');
  if (['FILLED','CANCELED','REJECTED','EXPIRED'].includes(order.status)) return order;
  if (!['NEW','PARTIALLY_FILLED'].includes(order.status)) throw new Error('invalid_entry_order');
  if (order.status === 'NEW' && nowMs-createdAtMs < maxOpenMs) return order;
  // Even if cancellation errors, a fresh lookup may prove it actually succeeded.
  await deps.cancel().catch(()=>{});
  const actual = await deps.lookup();
  if (!['FILLED','CANCELED','REJECTED','EXPIRED'].includes(actual.status)) throw new Error('entry_cancel_pending');
  return actual;
}
