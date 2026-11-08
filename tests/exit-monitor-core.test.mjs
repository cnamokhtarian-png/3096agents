import test from 'node:test';
import assert from 'node:assert/strict';
import { monitorOneExit } from '../src/lib/exit-monitor-core.ts';
const p={id:'1',symbol:'BTCUSDT',remainingQuantity:'0.00002400',stopPrice:90,targetPrice:110};
function make(bid=90) {
  const calls=[];
  const deps={quote:async()=>({bid,requestStartedAt:1000}),now:()=>2000,maxQuoteAgeMs:2000,
    claim:async (i)=>{calls.push(['claim',i.clientOrderId]);return true;},
    submit:async(i)=>{calls.push(['submit',i.remainingQuantity]);return {orderId:'55',status:'PARTIALLY_FILLED'};},
    acknowledge:async()=>{calls.push(['ack']);},alertUnknown:async()=>{calls.push(['alert']);}};
  return {deps,calls};
}
test('threshold triggers only after the intent is persisted, preserves decimal quantity', async()=>{
  const {deps,calls}=make(); const r=await monitorOneExit(p,deps);
  assert.equal(r.status,'submitted'); assert.equal(r.exchangeStatus,'PARTIALLY_FILLED');
  assert.deepEqual(calls,[['claim','exit_1_1'],['submit','0.00002400'],['ack']]);
});
test('non-trigger, stale quote and losing a claim do not send a sell',async()=>{
  let x=make(100); assert.equal((await monitorOneExit(p,x.deps)).status,'hold');assert.equal(x.calls.length,0);
  x=make(); x.deps.now=()=>4000; await assert.rejects(monitorOneExit(p,x.deps),/stale_or_invalid_quote/); assert.equal(x.calls.length,0);
  x=make(); x.deps.claim=async()=>false;assert.equal((await monitorOneExit(p,x.deps)).status,'already_claimed');assert.equal(x.calls.length,0);
});
test('timeout after sending is unknown and is never automatically retried',async()=>{
  const {deps,calls}=make(); deps.submit=async()=>{calls.push(['submit']);throw new Error('timeout');};
  const r=await monitorOneExit(p,deps);assert.equal(r.status,'unknown');
  assert.deepEqual(calls,[['claim','exit_1_1'],['submit'],['alert']]);
});
test('a DB acknowledgement failure after a fill stays unknown and is never called a closed trade',async()=>{
  const {deps,calls}=make();deps.acknowledge=async()=>{throw new Error('connection lost');};
  assert.equal((await monitorOneExit(p,deps)).status,'unknown');assert.equal(calls.filter(x=>x[0]==='submit').length,1);
});

test('confirmed terminal partial exit continues even if price rebounds',async()=>{
 const {deps,calls}=make(100);
 const r=await monitorOneExit({...p,nextAttempt:2,exitReason:'stop_loss'},deps);
 assert.equal(r.status,'submitted');assert.deepEqual(calls[0],['claim','exit_1_2']);
});
