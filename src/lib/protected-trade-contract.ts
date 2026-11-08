import Decimal from 'decimal.js';
const D = Decimal.clone({precision: 100});
export type ProtectedTrade = {
  symbol: string; side: 'BUY'; type: 'LIMIT'; leverage: 1;
  quantity: string; price: string; entryPrice: string;
  budgetUsdt: string; stopLoss: string; takeProfit: string;
};
function decimal(value: unknown) {
  const text = typeof value === 'number' && Number.isFinite(value) ? new D(value).toFixed() : value;
  if (typeof text !== 'string' || text.length > 64 || !/^\d+(?:\.\d+)?$/.test(text) || !new D(text).gt(0)) return null;
  return new D(text).toFixed();
}
/** Shared by panel, API, preflight and Telegram. Does not submit or enqueue. */
export function protectedTradeErrors(p: Record<string, unknown>): string[] {
  const errors: string[] = [];
  if (!/^[A-Z0-9]{2,25}USDT$/.test(String(p.symbol ?? ''))) errors.push('نماد بازار نقدی USDT معتبر نیست');
  if (p.side !== 'BUY' || p.type !== 'LIMIT') errors.push('فقط خرید نقدی BUY با سفارش LIMIT پشتیبانی می‌شود');
  if (p.leverage != null && String(p.leverage) !== '1') errors.push('اهرم مجاز نیست؛ ضریب باید ۱ باشد');
  if (p.quoteOrderQty !== undefined) errors.push('مقدار ارز پایه و سقف بودجه لازم است؛ quoteOrderQty پشتیبانی نمی‌شود');
  const qty=decimal(p.quantity), price=decimal(p.price), budget=decimal(p.budgetUsdt), stop=decimal(p.stopLoss), target=decimal(p.takeProfit);
  if (!qty) errors.push('مقدار ارز پایه معتبر نیست');
  if (!budget) errors.push('سقف بودجه USDT معتبر نیست');
  if (!price || !stop || !target) errors.push('قیمت ورود و حد سود و ضرر معتبر نیست');
  else if (!new D(stop).lt(price) || !new D(price).lt(target)) errors.push('باید حد ضرر < قیمت ورود < حد سود باشد');
  if (qty && price && budget && new D(qty).mul(price).gt(budget)) errors.push('ارزش خرید از سقف بودجه بیشتر است');
  if (p.entryPrice !== undefined && (!decimal(p.entryPrice) || !price || !new D(decimal(p.entryPrice)!).eq(price))) errors.push('قیمت نمایشی ورود با قیمت سفارش یکسان نیست');
  return errors;
}
export function normalizeProtectedTrade(p: Record<string, unknown>): ProtectedTrade {
  const errors=protectedTradeErrors(p);
  if (errors.length) throw new Error(errors.join('؛ '));
  return {symbol:String(p.symbol),side:'BUY',type:'LIMIT',leverage:1,
    quantity:decimal(p.quantity)!,price:decimal(p.price)!,entryPrice:decimal(p.price)!,
    budgetUsdt:decimal(p.budgetUsdt)!,stopLoss:decimal(p.stopLoss)!,takeProfit:decimal(p.takeProfit)!};
}
/** Plain text; callers must HTML-escape for Telegram. Invalid legacy cards fail closed. */
export function protectedTradeSummary(p: Record<string, unknown>) {
  const errors=protectedTradeErrors(p);
  if (errors.length) return {valid:false,text:['⛔ درخواست قدیمی یا ناقص؛ قابل تأیید نیست.',...errors.map(x=>`• ${x}`)].join('\n')};
  const t=normalizeProtectedTrade(p);
  return {valid:true,text:[
    `بازار: ${t.symbol} | خرید نقدی بدون اهرم`,
    `نوع سفارش: LIMIT | مقدار ارز پایه: ${t.quantity}`,
    `قیمت ورود: ${t.price} USDT`,
    `ارزش خرید در قیمت محدود: ${new D(t.quantity).mul(t.price).toFixed()} USDT`,
    `سقف بودجه خرید: ${t.budgetUsdt} USDT (کارمزد ممکن است جداگانه کسر شود)`,
    `حد ضرر: ${t.stopLoss} | حد سود: ${t.takeProfit}`,
    'حدها با پایش نرم‌افزاری دنبال می‌شوند؛ قیمت خروج و اجرای کامل تضمین نیست.',
  ].join('\n')};
}
