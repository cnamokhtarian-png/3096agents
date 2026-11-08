import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileExitFills } from '../src/lib/reconcile-exit-core.ts';
const pos = { id: '1', symbol: 'BTCUSDT', exchangeOrderId: '123', quoteAsset: 'USDT', baseAsset: 'BTC' };
const fill = (id) => ({ tradeId: id, orderId:'123', symbol:'BTCUSDT', side:'SELL', quantity:'0.001', quoteQuantity:'90', commission:'0.1', commissionAsset:'USDT' });
test('passes each source fill once in deterministic order and tolerates already recorded', async () => {
  const ids=[];
  const result = await reconcileExitFills(pos, { fetchFills: async () => [fill('11'),fill('9')], recordFill: async (_, f) => { ids.push(f.tradeId); return {status: f.tradeId === '9' ? 'already_recorded' : 'recorded', remaining:'0.001', pnl:'2'}; } });
  assert.deepEqual(ids,['9','11']); assert.equal(result.fills.length,2);
});
test('rejects wrong order and duplicate fill before recording anything', async () => {
  for (const items of [[{...fill('1'),orderId:'999'}], [fill('1'),fill('1')]]) {
    let count=0;
    await assert.rejects(reconcileExitFills(pos, {fetchFills:async()=>items,recordFill:async()=>{count++;return {status:'recorded',remaining:'0',pnl:'0'};}}));
    assert.equal(count,0);
  }
});
test('a full history page is rejected instead of silently skipping older fills', async () => {
  await assert.rejects(reconcileExitFills(pos,{fetchFills:async()=>Array.from({length:1000},(_,i)=>fill(String(i))),recordFill:async()=>({status:'recorded',remaining:'0',pnl:'0'})}), /trade_history_may_be_truncated/);
});
