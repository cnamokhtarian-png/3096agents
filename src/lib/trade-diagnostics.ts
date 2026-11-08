import { db } from '@/db';
import { agentJobs } from '@/db/schema';
import { inArray } from 'drizzle-orm';
import { findTabdealRecentOrders, getAccountBalances, fetchTabdealMarketRules, fetchTabdealTopOfBook, ExchangeError } from '@/lib/exchange';
import { summarizeOrderCandidates } from '@/lib/tabdeal-diagnostics-core';

/** Read-only account and legacy order history; never resubmits or cancels. */
export async function diagnoseLegacyTabdealOrders() {
  const errors:Array<{stage:string;code:string;status?:number}>=[];
  const failure=(stage:string,e:unknown)=>{const info=e instanceof ExchangeError ? e.detail as {status?:unknown}|undefined : undefined;
    errors.push({stage,code:e instanceof ExchangeError?e.code:'diagnostic_failed',...(typeof info?.status==='number'?{status:info.status}:{})});};
  let account:{canTrade:boolean;accountType:string|null;balances:Array<{asset:string;free:number;locked:number;total:number}>}|null=null;
  try { const result=await getAccountBalances(['USDT','BTC','ETH']); account={...result,balances:result.balances.filter(b=>b.free!==0 || b.locked!==0)}; } catch(e) { failure('account',e); }
  const markets:Array<{symbol:string;available:boolean}> = [];
  for (const symbol of ['BTCUSDT','ETHUSDT']) {
    try { await Promise.all([fetchTabdealMarketRules(symbol),fetchTabdealTopOfBook(symbol)]);markets.push({symbol,available:true}); }
    catch(e) { markets.push({symbol,available:false});failure(`market_${symbol}`,e); }
  }
  const jobs=await db.select({id:agentJobs.id,payload:agentJobs.payload,approvedAt:agentJobs.approvedAt}).from(agentJobs).where(inArray(agentJobs.id,[88,89,90]));
  const history:Array<Record<string,unknown>>=[];
  for(const job of jobs) {
    const symbol=String((job.payload as Record<string,unknown>)?.symbol ?? '');const timestamp=job.approvedAt?.getTime();
    if(!Number.isSafeInteger(timestamp)||!/^[A-Z0-9]{2,30}$/.test(symbol)) {history.push({jobId:job.id,status:'invalid_job'});continue;}
    const start=Number(timestamp)-120000,end=Number(timestamp)+120000;
    try {const response=await findTabdealRecentOrders(symbol,start,end);history.push({jobId:job.id,symbol,status:'queried',...summarizeOrderCandidates(response,symbol,start,end)});}
    catch(e) {failure(`history_${job.id}`,e);history.push({jobId:job.id,symbol,status:'unavailable'});}
  }
  return {ok:errors.length===0,account,markets,history,errors,notice:'تطبیق زمانی به‌تنهایی هویت سفارش قدیمی را اثبات نمی‌کند.'};
}
