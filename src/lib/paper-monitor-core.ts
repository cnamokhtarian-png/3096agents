import Decimal from 'decimal.js';
const D = Decimal.clone({ precision: 80, rounding: Decimal.ROUND_DOWN });
export type PaperState = {
  status: 'pending' | 'open' | 'closed'; budget: string; stop: string; target: string;
  feeBps: string; slippageBps: string;
  quantity?: string; entry?: string; entryCost?: string; exit?: string; proceeds?: string; pnl?: string;
};
function positive(s: string) {
  if (typeof s !== 'string' || s.length > 40 || !/^\d+(\.\d+)?$/.test(s)) throw new Error('invalid_paper_decimal');
  const n = new D(s); if (!n.isPositive()) throw new Error('invalid_paper_decimal'); return n;
}
export function validatePaperState(s: PaperState) {
  const budget = positive(s.budget), stop = positive(s.stop), target = positive(s.target);
  if (budget.gt('1000000') || target.lte(stop) || !['pending','open','closed'].includes(s.status)) throw new Error('invalid_paper_state');
  for (const value of [s.feeBps, s.slippageBps]) {
    if (typeof value !== 'string' || !/^\d+(\.\d+)?$/.test(value) || value.length > 12 || new D(value).gt(1000)) throw new Error('invalid_paper_cost');
  }
  if (s.status !== 'pending') {
    positive(s.quantity!); positive(s.entry!); positive(s.entryCost!);
  }
}
/** Hypothetical quote-fee model only. Does not model actual fills or exchange limits. */
export function tickPaper(s: PaperState, q: { bid: string; ask: string; startedAt: number }, now: number): PaperState {
  validatePaperState(s);
  const bid = positive(q.bid), ask = positive(q.ask);
  if (!Number.isFinite(now) || !Number.isFinite(q.startedAt) || now < q.startedAt || now - q.startedAt > 15000 || bid.gt(ask)) throw new Error('invalid_paper_quote');
  if (s.status === 'closed') return { ...s };
  const fee = new D(s.feeBps).div(10000), slip = new D(s.slippageBps).div(10000);
  if (s.status === 'pending') {
    const price = ask.mul(new D(1).plus(slip));
    if (new D(s.stop).gte(price) || new D(s.target).lte(price)) throw new Error('paper_limits_outside_entry');
    // Reserve fee inside the virtual budget, floor quantity and charge cost conservatively.
    const quantity = new D(s.budget).div(price.mul(new D(1).plus(fee))).toDecimalPlaces(18, Decimal.ROUND_DOWN);
    if (!quantity.isPositive()) throw new Error('paper_quantity_zero');
    const cost = quantity.mul(price).mul(new D(1).plus(fee)).toDecimalPlaces(18, Decimal.ROUND_UP);
    return { ...s, status:'open', quantity:quantity.toFixed(), entry:price.toFixed(), entryCost:cost.toFixed() };
  }
  if (bid.gt(s.stop) && bid.lt(s.target)) return { ...s };
  const price = bid.mul(new D(1).minus(slip));
  const proceeds = new D(s.quantity!).mul(price).mul(new D(1).minus(fee)).toDecimalPlaces(18, Decimal.ROUND_DOWN);
  return { ...s, status:'closed', exit:price.toFixed(), proceeds:proceeds.toFixed(), pnl:proceeds.minus(s.entryCost!).toFixed() };
}
