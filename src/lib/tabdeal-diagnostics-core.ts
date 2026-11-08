/** Read-only candidate matching; a time/symbol match is not proof of identity. */
export function summarizeOrderCandidates(value: unknown, symbol: string, startMs: number, endMs: number) {
  if (!Array.isArray(value) || !Number.isSafeInteger(startMs) || !Number.isSafeInteger(endMs) || startMs >= endMs) throw new Error('invalid_order_history');
  let malformed=0;
  const candidates=[];
  for (const raw of value) {
    const row=raw && typeof raw==='object' ? raw as Record<string,unknown> : null;
    const time=Number(row?.time ?? row?.transactTime ?? row?.updateTime);
    if (!row || !Number.isSafeInteger(time) || typeof row.symbol!=='string' || typeof row.side!=='string') {malformed++;continue;}
    if (row.symbol!==symbol || row.side!=='BUY' || time<startMs || time>endMs) continue;
    const id=row.orderId;
    if ((typeof id==='number' && !Number.isSafeInteger(id)) || !/^\d{1,30}$/.test(String(id ?? ''))) {malformed++;continue;}
    candidates.push({orderId:String(id),time,status:String(row.status ?? ''),executedQty:String(row.executedQty ?? ''),quoteQty:String(row.cummulativeQuoteQty ?? row.cumulativeQuoteQty ?? '')});
  }
  return {candidateOrders:candidates.slice(0,20),candidateCount:candidates.length,truncated:value.length>=1000||candidates.length>20,malformed,identityConfirmed:false};
}
