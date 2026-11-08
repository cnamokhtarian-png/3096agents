/** Produce a report from recorded exchange fills, not an estimated order. */
export type CloseReport = { positionId:string; symbol:string; baseAsset:string; filledBase:string; entryCost:string; exitGross:string; realized:string; hasUnvaluedFees:boolean; entryFees:Array<{asset:string; amount:string}>; exitFees:Array<{asset:string; amount:string}> };
function escape(s:string) { return s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'); }
export function renderCloseReport(p:CloseReport) {
  const fees=(xs:CloseReport['entryFees']) => xs.length ? xs.map(x=>`${escape(x.amount)} ${escape(x.asset)}`).join('، ') : 'نامشخص';
  return [`✅ <b>پوزیشن #${escape(p.positionId)} بسته شد</b>`,
    `بازار: <code>${escape(p.symbol)}</code>`,
    `مقدار ورودی خالص: ${escape(p.filledBase)} ${escape(p.baseAsset)}`,
    `بهای ورود با کارمزد: ${escape(p.entryCost)} USDT`,
    `مبلغ فروش پیش از کارمزد: ${escape(p.exitGross)} USDT`,
    `کارمزد ورود: ${fees(p.entryFees)}`,
    `کارمزد خروج: ${fees(p.exitFees)}`,
    p.hasUnvaluedFees ? `<b>سود/زیان پیش از کارمزد ارز سوم: ${escape(p.realized)} USDT</b>\nسود/زیان نهایی تا تعیین ارزش کارمزد ارز سوم مشخص نیست.` : `<b>سود/زیان خالص: ${escape(p.realized)} USDT</b>`,
  ].join('\n');
}
