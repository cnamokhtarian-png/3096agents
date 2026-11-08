import Decimal from 'decimal.js';
/**
 * Monitor one pre-approved, persisted long position. The caller must provide an
 * atomic database claim that stores a unique client ID before returning true.
 * The claim must never be reset automatically after a timeout or crash.
 */
export type ExitCandidate = {
  id: string; symbol: string; remainingQuantity: string;
  stopPrice: number; targetPrice: number;
  nextAttempt?: number; exitReason?: ExitTrigger | null;
};
export type ExitTrigger = 'stop_loss' | 'take_profit';
export type ExitIntent = ExitCandidate & { clientOrderId: string; reason: ExitTrigger; sellQuantity: string };
export async function monitorOneExit(position: ExitCandidate, deps: {
  quote: (symbol: string) => Promise<{ bid: number; requestStartedAt: number }>;
  prepareQuantity?: (position: ExitCandidate, bid: number) => Promise<string>;
  claim: (intent: ExitIntent) => Promise<boolean>;
  submit: (intent: ExitIntent) => Promise<{ orderId: string; status: string }>;
  acknowledge: (intent: ExitIntent, result: { orderId: string; status: string }) => Promise<void>;
  alertUnknown: (intent: ExitIntent) => Promise<void>;
  now: () => number;
  maxQuoteAgeMs: number;
}) {
  if (!/^\d{1,18}$/.test(position.id) || !/^[A-Z0-9]{2,30}$/.test(position.symbol) ||
      !/^\d+(?:\.\d+)?$/.test(position.remainingQuantity) || !/[1-9]/.test(position.remainingQuantity) ||
      !Number.isFinite(position.stopPrice) || !Number.isFinite(position.targetPrice) ||
      position.stopPrice <= 0 || position.targetPrice <= position.stopPrice ||
      !Number.isInteger(position.nextAttempt ?? 1) || (position.nextAttempt ?? 1) < 1 || (position.nextAttempt ?? 1) > 99999 ||
      (position.exitReason != null && !['stop_loss','take_profit'].includes(position.exitReason))) throw new Error('invalid_position');
  const quote = await deps.quote(position.symbol);
  const now = deps.now();
  if (!Number.isFinite(quote.bid) || quote.bid <= 0 || !Number.isFinite(quote.requestStartedAt) ||
      !Number.isFinite(deps.maxQuoteAgeMs) || deps.maxQuoteAgeMs <= 0 ||
      !Number.isFinite(now) || quote.requestStartedAt > now || now - quote.requestStartedAt > deps.maxQuoteAgeMs) throw new Error('stale_or_invalid_quote');
  const reason: ExitTrigger | null = position.exitReason ?? (quote.bid <= position.stopPrice ? 'stop_loss' : quote.bid >= position.targetPrice ? 'take_profit' : null);
  if (!reason) return { status: 'hold' as const };
  const sellQuantity = deps.prepareQuantity ? await deps.prepareQuantity(position,quote.bid) : position.remainingQuantity;
  if (!/^\d+(?:\.\d+)?$/.test(sellQuantity) || !/[1-9]/.test(sellQuantity) || new Decimal(sellQuantity).gt(position.remainingQuantity)) throw new Error('invalid_sell_quantity');
  if (deps.now() - quote.requestStartedAt > deps.maxQuoteAgeMs) throw new Error('stale_or_invalid_quote');
  const intent: ExitIntent = { ...position, reason, sellQuantity, clientOrderId: `exit_${position.id}_${position.nextAttempt ?? 1}` };
  // This must atomically record an UNKNOWN attempt and take ownership of the
  // position. A competing poller or an existing attempt must return false.
  if (!await deps.claim(intent)) return { status: 'already_claimed' as const };
  try {
    const result = await deps.submit(intent);
    if (!/^\d{1,30}$/.test(result.orderId) || !['NEW','PARTIALLY_FILLED','FILLED','CANCELED','REJECTED','EXPIRED'].includes(result.status)) throw new Error('ambiguous_order_response');
    // Acceptance or even FILLED is not a settled ledger. Reconciliation of
    // each exchange trade must happen separately after acknowledgement.
    await deps.acknowledge(intent, result);
    return { status: 'submitted' as const, orderId: result.orderId, exchangeStatus: result.status };
  } catch {
    // Could have reached exchange. Do not issue a second order. Query by the
    // stored client ID and alert instead; even an alert failure is not a retry.
    await deps.alertUnknown(intent).catch(() => {});
    return { status: 'unknown' as const, clientOrderId: intent.clientOrderId };
  }
}
