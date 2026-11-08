/** Basic proposal completeness only; exchange market filters are a separate check. */
export function tradeProposalErrors(p: {
  side?: unknown;
  symbol?: unknown;
  quoteOrderQty?: unknown;
  quantity?: unknown;
  entryPrice?: unknown;
  stopLoss?: unknown;
  takeProfit?: unknown;
}): string[] {
  const errors: string[] = [];
  const number = (v: unknown) => v === null || v === undefined || v === '' ? NaN : Number(v);
  const positive = (v: unknown) => Number.isFinite(number(v)) && number(v) > 0;
  if (!/^[A-Z0-9]{2,30}$/.test(String(p.symbol ?? ''))) errors.push('نماد معتبر نیست');
  if (p.side !== 'BUY' && p.side !== 'SELL') errors.push('جهت معامله مشخص نیست');
  if (!positive(p.quoteOrderQty) && !positive(p.quantity)) errors.push('مبلغ یا مقدار معتبر نیست');
  if (![p.entryPrice, p.stopLoss, p.takeProfit].every(positive)) {
    errors.push('قیمت ورود و حد سود و ضرر معتبر نیست');
  } else if (p.side === 'BUY' && !(number(p.stopLoss) < number(p.entryPrice) && number(p.entryPrice) < number(p.takeProfit))) {
    errors.push('ترتیب حد سود و ضرر برای خرید معتبر نیست');
  } else if (p.side === 'SELL' && !(number(p.takeProfit) < number(p.entryPrice) && number(p.entryPrice) < number(p.stopLoss))) {
    errors.push('ترتیب حد سود و ضرر برای فروش معتبر نیست');
  }
  return errors;
}
