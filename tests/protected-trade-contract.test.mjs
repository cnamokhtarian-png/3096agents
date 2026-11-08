import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { protectedTradeErrors,normalizeProtectedTrade,protectedTradeSummary } from '../src/lib/protected-trade-contract.ts';
const good={symbol:'ETHUSDT',side:'BUY',type:'LIMIT',quantity:'0.0005',price:'3000',budgetUsdt:'1.8',stopLoss:'2700',takeProfit:'3300',leverage:1};
test('panel payload preserves exact strings and Telegram shows the same values',()=>{
 const p=normalizeProtectedTrade(good);
 assert.equal(p.entryPrice,p.price);assert.equal(p.budgetUsdt,'1.8');
 const card=protectedTradeSummary(p);assert.equal(card.valid,true);
 for(const text of ['ETHUSDT','0.0005','3000','1.8','2700','3300','LIMIT']) assert.ok(card.text.includes(text));
 assert.ok(card.text.includes('1.5 USDT'));
});
test('incomplete legacy MARKET card and leveraged or sell requests fail closed',()=>{
 for(const p of [{symbol:'ETHUSDT',side:'BUY',type:'MARKET',quoteOrderQty:1}, {...good,leverage:3},{...good,side:'SELL'},{...good,quoteOrderQty:1}]) {
  assert.ok(protectedTradeErrors(p).length);assert.equal(protectedTradeSummary(p).valid,false);assert.throws(()=>normalizeProtectedTrade(p));
 }
});
test('budget and price ordering use exact decimals, not rounded JS arithmetic',()=>{
 assert.ok(protectedTradeErrors({...good,quantity:'0.000600000000000000000001'}).length);
 for(const stopLoss of ['3000','3300','NaN','0','-1']) assert.ok(protectedTradeErrors({...good,stopLoss}).length);
 assert.ok(protectedTradeErrors({...good,entryPrice:'3001'}).length);
 assert.ok(protectedTradeErrors({...good,price:Infinity}).length);
 assert.ok(protectedTradeErrors({...good,budgetUsdt:'۱٫۸'}).length);
});
test('current generated proposal numeric metadata is accepted without mutating its fields',()=>{
 const mixed={...good,entryPrice:3000,stopLoss:2700,takeProfit:3300};
 assert.deepEqual(protectedTradeErrors(mixed),[]);assert.equal(normalizeProtectedTrade(mixed).stopLoss,'2700');
});
test('invalid payload checks precede queue persistence and route market reads',()=>{
 const jobs=readFileSync('src/lib/jobs.ts','utf8');
 assert.ok(jobs.indexOf('const errors = protectedTradeErrors')<jobs.indexOf('.insert(agentJobs)'));
 const route=readFileSync('src/app/api/agents/[id]/command/route.ts','utf8');
 assert.ok(route.indexOf('const errors = protectedTradeErrors(body)')<route.indexOf('fetchTabdealMarketRules(payload.symbol)'));
 assert.ok(!route.includes('type: "MARKET", quoteOrderQty'));
 const telegram=readFileSync('src/lib/telegram.ts','utf8');
 assert.ok(telegram.includes('job.canApprove === true && tradeSummary?.valid === true'));
});
