/** Normalize individual exchange trade records; does not write to the ledger. */
export type TabdealFill = {
  tradeId: string; orderId: string; symbol: string; side: 'BUY' | 'SELL';
  quantity: string; quoteQuantity: string; commission: string; commissionAsset: string;
};
function decimal(value: unknown, allowZero = false) {
  const s = typeof value === 'string' ? value : '';
  if (!/^\d+(?:\.\d+)?$/.test(s) || s.length > 64 || (!allowZero && !/[1-9]/.test(s))) throw new Error('invalid_fill_decimal');
  return s;
}
function id(value: unknown) {
  // The provider can serialize integer identifiers as numbers or strings.
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) throw new Error('invalid_fill_id');
  const s = String(value ?? '');
  if (!/^\d{1,30}$/.test(s)) throw new Error('invalid_fill_id');
  return s;
}
/** Reject inconsistent trade totals rather than posting fabricated PnL.
 * Tabdeal documentation contains at least one example with inconsistent
 * quoteQty; do not assume it is gross unless it matches price × quantity.
 */
function validateQuoteTotal(quantity: string, price: string, quoteQuantity: string) {
  const unpack = (v: string) => {
    const [a, b = ''] = v.split('.'); return { value: BigInt(a + b), scale: b.length };
  };
  const q = unpack(quantity), p = unpack(price), total = unpack(quoteQuantity);
  const product = q.value * p.value, productScale = q.scale + p.scale;
  const scale = Math.max(productScale, total.scale, 8);
  const gross = product * BigInt(10) ** BigInt(scale - productScale);
  const reported = total.value * BigInt(10) ** BigInt(scale - total.scale);
  const difference = gross >= reported ? gross - reported : reported - gross;
  if (difference > BigInt(10) ** BigInt(scale - 8)) throw new Error('inconsistent_quote_total');
}
export function parseTabdealTrades(value: unknown, expected: { symbol: string; orderId: string; side: 'BUY' | 'SELL' }): TabdealFill[] {
  if (!/^[A-Z0-9]{2,30}$/.test(expected.symbol) || !Array.isArray(value)) throw new Error('invalid_trade_response');
  const expectedOrder = id(expected.orderId);
  const seen = new Set<string>();
  return value.map((raw: unknown) => {
    const t = raw as Record<string, unknown> | null;
    if (!t || t.symbol !== expected.symbol || id(t.orderId) !== expectedOrder || typeof t.isBuyer !== 'boolean' || t.isBuyer !== (expected.side === 'BUY')) throw new Error('trade_mismatch');
    const tradeId = id(t.id);
    if (seen.has(tradeId)) throw new Error('duplicate_trade_id');
    seen.add(tradeId);
    const commissionAsset = t.commissionAsset;
    if (typeof commissionAsset !== 'string' || !/^[A-Z0-9]{2,15}$/.test(commissionAsset)) throw new Error('invalid_commission_asset');
    const quantity = decimal(t.qty), price = decimal(t.price), quoteQuantity = decimal(t.quoteQty);
    validateQuoteTotal(quantity, price, quoteQuantity);
    return { tradeId, orderId: expectedOrder, symbol: expected.symbol, side: expected.side,
      quantity, quoteQuantity, commission: decimal(t.commission, true), commissionAsset };
  });
}
/** Globally stable per exchange and symbol; no clock-derived IDs. */
export function fillIdempotencyKey(fill: TabdealFill) {
  return `tabdeal:${fill.symbol}:${fill.tradeId}`;
}
