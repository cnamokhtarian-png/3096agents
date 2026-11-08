/** Read-only market constraints and exact-decimal spot BUY planning. */
type Decimal = { n: bigint; scale: number };
function parse(s: string): Decimal {
  if (!/^\d+(\.\d+)?$/.test(s) || s.length > 64) throw new Error('invalid_decimal');
  const [a, b = ''] = s.split('.');
  return { n: BigInt(a + b), scale: b.length };
}
function power(n: number) { return BigInt(10) ** BigInt(n); }
function compare(a: Decimal, b: Decimal) { const s = Math.max(a.scale, b.scale); const x = a.n * power(s - a.scale), y = b.n * power(s - b.scale); return x < y ? -1 : x > y ? 1 : 0; }
function multiply(a: Decimal, b: Decimal): Decimal { return { n: a.n * b.n, scale: a.scale + b.scale }; }
function format(value: bigint, scale: number): string {
  const raw = value.toString().padStart(scale + 1, '0');
  return scale ? `${raw.slice(0, -scale)}.${raw.slice(-scale)}` : raw;
}

type Filter = { filterType?: string; [key: string]: unknown };
export type TabdealMarketRules = {
  symbol: string; baseAsset: string; quoteAsset: string; ocoAllowed: boolean;
  tickSize: string; minPrice: string; maxPrice: string;
  minQty: string; maxQty: string; stepSize: string;
  marketMinQty: string; marketMaxQty: string; marketStepSize: string;
  minNotional: string; marketMinNotional: boolean; quoteOrderQtyMarketAllowed: boolean;
};
export function parseTabdealMarket(value: unknown, symbol: string): TabdealMarketRules {
  const candidates = Array.isArray(value) ? value : [value];
  const matches = candidates.filter((v): v is Record<string, unknown> => Boolean(v && typeof v === 'object' && (v as Record<string, unknown>).symbol === symbol));
  if (matches.length !== 1) throw new Error('market_unavailable');
  const m = matches[0];
  if (m.status !== 'TRADING' || m.isSpotTradingAllowed !== true || typeof m.ocoAllowed !== 'boolean' || !Array.isArray(m.filters) || !Array.isArray(m.orderTypes) || !m.orderTypes.includes('MARKET')) throw new Error('market_unavailable');
  const filters = m.filters as Filter[];
  const filter = (name: string) => { const x = filters.find(f => f?.filterType === name); if (!x) throw new Error('market_filter_missing'); return x; };
  const field = (f: Filter, key: string, fallback?: string) => { const x = f[key] ?? fallback; if (typeof x !== 'string') throw new Error('market_filter_invalid'); parse(x); return x; };
  const price = filter('PRICE_FILTER'), lot = filter('LOT_SIZE'), marketLot = filter('MARKET_LOT_SIZE'), notional = filter('MIN_NOTIONAL');
  if (typeof m.baseAsset !== 'string' || typeof m.quoteAsset !== 'string') throw new Error('market_assets_missing');
  return {
    symbol, baseAsset: m.baseAsset, quoteAsset: m.quoteAsset, ocoAllowed: m.ocoAllowed,
    tickSize: field(price, 'tickSize'), minPrice: field(price, 'minPrice'), maxPrice: field(price, 'maxPrice', '0'),
    minQty: field(lot, 'minQty'), maxQty: field(lot, 'maxQty', '0'), stepSize: field(lot, 'stepSize'),
    marketMinQty: field(marketLot, 'minQty'), marketMaxQty: field(marketLot, 'maxQty', '0'), marketStepSize: field(marketLot, 'stepSize'),
    minNotional: field(notional, 'minNotional'), marketMinNotional: notional.applyToMarket === true,
    quoteOrderQtyMarketAllowed: m.quoteOrderQtyMarketAllowed === true,
  };
}
/** Floor the quantity to the market lot step; no automatic fee or price assumptions. */
export function planTabdealMarketBuy(input: { budget: string; ask: string; stopLimitPrice: string; rules: TabdealMarketRules }) {
  const budget = parse(input.budget), ask = parse(input.ask), stop = parse(input.stopLimitPrice);
  const step = parse(input.rules.marketStepSize);
  if (budget.n <= BigInt(0) || ask.n <= BigInt(0) || stop.n <= BigInt(0) || step.n <= BigInt(0)) throw new Error('invalid_sizing_input');
  // floor((budget / ask) / step), retaining exact decimal precision.
  const steps = budget.n * power(ask.scale + step.scale) / (ask.n * step.n * power(budget.scale));
  const quantity: Decimal = { n: steps * step.n, scale: step.scale };
  const min = parse(input.rules.marketMinQty), max = parse(input.rules.marketMaxQty);
  if (quantity.n <= BigInt(0) || compare(quantity, min) < 0 || (max.n > BigInt(0) && compare(quantity, max) > 0)) throw new Error('market_quantity_out_of_range');
  const lot = parse(input.rules.stepSize);
  const lotScale = Math.max(quantity.scale, lot.scale);
  if (lot.n <= BigInt(0) || (quantity.n * power(lotScale - quantity.scale)) % (lot.n * power(lotScale - lot.scale)) !== BigInt(0) || compare(quantity, parse(input.rules.minQty)) < 0) throw new Error('exit_lot_invalid');
  const maxExit = parse(input.rules.maxQty);
  if (maxExit.n > BigInt(0) && compare(quantity, maxExit) > 0) throw new Error('exit_lot_invalid');
  if (compare(multiply(quantity, stop), parse(input.rules.minNotional)) < 0) throw new Error('exit_notional_below_minimum');
  if (input.rules.marketMinNotional && compare(multiply(quantity, ask), parse(input.rules.minNotional)) < 0) throw new Error('entry_notional_below_minimum');
  return { quantity: format(quantity.n, quantity.scale), quoteOrderQtyMarketAllowed: input.rules.quoteOrderQtyMarketAllowed, warning: 'مقدار نهایی فروش به کارمزد و مقدار واقعاً خریداری‌شده وابسته است؛ این محاسبه اجرای سفارش را تضمین نمی‌کند.' };
}

/** Validate a price-capped BUY against current exchange filters with exact decimals. */
export function validateTabdealLimitBuy(input: { quantity: string; price: string; budget: string; stopPrice: string; targetPrice: string; rules: TabdealMarketRules }) {
  const { rules } = input;
  if (rules.quoteAsset !== 'USDT') throw new Error('unsupported_quote_asset');
  const quantity = parse(input.quantity), price = parse(input.price), budget = parse(input.budget), stop = parse(input.stopPrice), target = parse(input.targetPrice);
  const step = parse(rules.stepSize), tick = parse(rules.tickSize);
  const multiple = (a: Decimal, b: Decimal) => {
    const scale = Math.max(a.scale,b.scale);
    return b.n > BigInt(0) && (a.n * power(scale-a.scale)) % (b.n * power(scale-b.scale)) === BigInt(0);
  };
  if (quantity.n <= BigInt(0) || compare(quantity,parse(rules.minQty)) < 0 ||
      (parse(rules.maxQty).n > BigInt(0) && compare(quantity,parse(rules.maxQty)) > 0) || !multiple(quantity,step)) throw new Error('invalid_limit_quantity');
  if (price.n <= BigInt(0) || compare(price,parse(rules.minPrice)) < 0 ||
      (parse(rules.maxPrice).n > BigInt(0) && compare(price,parse(rules.maxPrice)) > 0) || !multiple(price,tick)) throw new Error('invalid_limit_price');
  if (stop.n <= BigInt(0) || compare(stop,price) >= 0 || compare(price,target) >= 0) throw new Error('invalid_limits');
  const gross = multiply(quantity,price);
  if (budget.n <= BigInt(0) || compare(gross,budget) > 0) throw new Error('budget_exceeded');
  if (compare(gross,parse(rules.minNotional)) < 0 || compare(multiply(quantity,stop),parse(rules.minNotional)) < 0) throw new Error('notional_below_minimum');
  return { quantity:input.quantity,price:input.price };
}

/** Floor a held amount to the market step without ever increasing it. */
export function planTabdealMarketSell(input: { available:string; bid:string; rules:TabdealMarketRules }) {
  const held=parse(input.available),bid=parse(input.bid),step=parse(input.rules.marketStepSize);
  if(held.n<=BigInt(0)||bid.n<=BigInt(0)||step.n<=BigInt(0)) throw new Error('invalid_sell_sizing');
  const max=parse(input.rules.marketMaxQty);
  const capped=max.n>BigInt(0)&&compare(held,max)>0 ? max : held;
  const scale=Math.max(capped.scale,step.scale);
  const steps=(capped.n*power(scale-capped.scale))/(step.n*power(scale-step.scale));
  const quantity:Decimal={n:steps*step.n,scale:step.scale};
  if(quantity.n<=BigInt(0)||compare(quantity,parse(input.rules.marketMinQty))<0) throw new Error('unsellable_market_dust');
  if(input.rules.marketMinNotional&&compare(multiply(quantity,bid),parse(input.rules.minNotional))<0) throw new Error('unsellable_market_dust');
  return {quantity:format(quantity.n,quantity.scale)};
}
