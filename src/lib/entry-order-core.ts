/** Entry order orchestration. The caller's atomic claim stores the client ID
 * before submission. A lost response is reconciled, never retried here. */
export type EntryIntent = { jobId: number; symbol: string; baseAsset: string; quoteAsset: string; quantity: string; price: string; budget: string; stopPrice: string; targetPrice: string; clientOrderId: string };
export async function submitOneApprovedEntry(intent: EntryIntent, deps: {
  claim: (intent: EntryIntent) => Promise<boolean>;
  submit: (intent: EntryIntent) => Promise<{ orderId: string; status: string }>;
  acknowledge: (intent: EntryIntent, order: { orderId: string; status: string }) => Promise<void>;
  alertUnknown: (intent: EntryIntent) => Promise<void>;
}) {
  if (!Number.isSafeInteger(intent.jobId) || intent.jobId <= 0 || !/^[A-Z0-9]{2,30}$/.test(intent.symbol) ||
      !/^[A-Z0-9]{2,15}$/.test(intent.baseAsset) || intent.quoteAsset !== 'USDT' ||
      intent.clientOrderId !== `entry_${intent.jobId}`) throw new Error('invalid_entry_intent');
  if (!await deps.claim(intent)) return { status:'already_claimed' as const };
  try {
    const order = await deps.submit(intent);
    if (!/^\d{1,30}$/.test(order.orderId) || !['NEW','PARTIALLY_FILLED','FILLED','CANCELED','REJECTED','EXPIRED'].includes(order.status)) throw new Error('ambiguous_entry_response');
    await deps.acknowledge(intent,order);
    return { status:'submitted' as const,orderId:order.orderId,exchangeStatus:order.status };
  } catch {
    await deps.alertUnknown(intent).catch(()=>{});
    return { status:'unknown' as const,clientOrderId:intent.clientOrderId };
  }
}
