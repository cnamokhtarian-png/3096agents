import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeOrderCandidates } from '../src/lib/tabdeal-diagnostics-core.ts';
test('history candidates do not claim exact identity and exclude other orders',()=>{
 const r=summarizeOrderCandidates([{symbol:'BTCUSDT',side:'BUY',time:1100,orderId:'10',status:'FILLED',executedQty:'0.01'},
  {symbol:'BTCUSDT',side:'SELL',time:1100,orderId:11},{symbol:'ETHUSDT',side:'BUY',time:1100,orderId:12}], 'BTCUSDT',1000,2000);
 assert.equal(r.candidateCount,1);assert.equal(r.candidateOrders[0].orderId,'10');assert.equal(r.identityConfirmed,false);assert.equal(r.truncated,false);
});
test('invalid rows and saturated pages are explicit, not evidence of absence',()=>{
 const r=summarizeOrderCandidates(Array(1000).fill({}), 'BTCUSDT',1000,2000);
 assert.equal(r.truncated,true);assert.equal(r.malformed,1000);assert.equal(r.identityConfirmed,false);
});
