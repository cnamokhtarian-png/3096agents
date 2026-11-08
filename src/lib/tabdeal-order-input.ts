/** Tabdeal Spot order fields documented at https://docs.tabdeal.org/. */
export function validateTabdealSpotOrder(input: { symbol: string; side: string; type: string; quantity?: string; quoteOrderQty?: number; price?: number | string }) {
  if (!/^[A-Z0-9]{2,30}$/.test(input.symbol)) throw new Error('invalid_symbol');
  if (input.side !== 'BUY' && input.side !== 'SELL') throw new Error('invalid_order_side');
  if (input.type !== 'MARKET' && input.type !== 'LIMIT') throw new Error('invalid_order_type');
  if (input.quoteOrderQty !== undefined) throw new Error('tabdeal_requires_base_quantity');
  const qty = input.quantity ?? '';
  if (!/^\d+(?:\.\d+)?$/.test(qty) || qty.length > 64 || !/[1-9]/.test(qty)) throw new Error('invalid_quantity');
  if (input.type === 'LIMIT' && (!Number.isFinite(Number(input.price)) || Number(input.price) <= 0)) throw new Error('invalid_limit_price');
}
