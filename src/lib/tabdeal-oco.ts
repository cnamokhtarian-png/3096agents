/** Validation for a Tabdeal spot SELL OCO; values remain decimal strings. */
export type TabdealOcoPlan = {
  symbol: string;
  quantity: string;
  price: string;
  stopPrice: string;
  stopLimitPrice: string;
  referencePrice: string;
  listClientOrderId: string;
  limitClientOrderId: string;
  stopClientOrderId: string;
};
export type TabdealOcoFilters = {
  ocoAllowed: boolean;
  tickSize: string;
  minPrice: string;
  maxPrice: string;
  stepSize: string;
  minQty: string;
  maxQty: string;
  minNotional: string;
};

function decimal(value: string): { digits: bigint; scale: number } {
  if (!/^\d+(?:\.\d+)?$/.test(value) || value.length > 64) throw new Error("invalid_decimal");
  const [whole, fraction = ""] = value.split(".");
  return { digits: BigInt(whole + fraction), scale: fraction.length };
}
function aligned(a: string, b: string): [bigint, bigint] {
  const x = decimal(a), y = decimal(b), scale = Math.max(x.scale, y.scale);
  return [x.digits * BigInt(10) ** BigInt(scale - x.scale), y.digits * BigInt(10) ** BigInt(scale - y.scale)];
}
function cmp(a: string, b: string) { const [x, y] = aligned(a, b); return x < y ? -1 : x > y ? 1 : 0; }
function multiple(value: string, step: string) { const [x, y] = aligned(value, step); return y > BigInt(0) && x % y === BigInt(0); }
function notionalAtLeast(qty: string, price: string, minimum: string) {
  const q = decimal(qty), p = decimal(price), n = decimal(minimum);
  const lhs = q.digits * p.digits * BigInt(10) ** BigInt(n.scale);
  const rhs = n.digits * BigInt(10) ** BigInt(q.scale + p.scale);
  return lhs >= rhs;
}

export function validateTabdealSellOco(plan: TabdealOcoPlan, f: TabdealOcoFilters): void {
  if (!f.ocoAllowed) throw new Error("oco_not_supported");
  if (!/^[A-Z0-9]{2,30}$/.test(plan.symbol)) throw new Error("invalid_symbol");
  const ids = [plan.listClientOrderId, plan.limitClientOrderId, plan.stopClientOrderId];
  if (ids.some(id => !/^[A-Za-z0-9_-]{1,32}$/.test(id)) || new Set(ids).size !== 3) throw new Error("invalid_client_ids");
  for (const v of [plan.quantity, plan.price, plan.stopPrice, plan.stopLimitPrice, plan.referencePrice, f.tickSize, f.minPrice, f.maxPrice, f.stepSize, f.minQty, f.maxQty, f.minNotional]) decimal(v);
  if (cmp(plan.quantity, "0") <= 0 || cmp(plan.quantity, f.minQty) < 0 || (cmp(f.maxQty, "0") > 0 && cmp(plan.quantity, f.maxQty) > 0) || !multiple(plan.quantity, f.stepSize)) throw new Error("invalid_quantity");
  for (const price of [plan.price, plan.stopPrice, plan.stopLimitPrice]) {
    if (cmp(price, "0") <= 0 || cmp(price, f.minPrice) < 0 || (cmp(f.maxPrice, "0") > 0 && cmp(price, f.maxPrice) > 0) || !multiple(price, f.tickSize)) throw new Error("invalid_price");
  }
  if (cmp(plan.price, plan.referencePrice) <= 0 || cmp(plan.referencePrice, plan.stopPrice) <= 0 || cmp(plan.stopPrice, plan.stopLimitPrice) < 0 || cmp(plan.stopLimitPrice, "0") <= 0) throw new Error("invalid_price_order");
  if (!notionalAtLeast(plan.quantity, plan.price, f.minNotional) || !notionalAtLeast(plan.quantity, plan.stopLimitPrice, f.minNotional)) throw new Error("notional_too_small");
}
