import test from 'node:test';
import assert from 'node:assert/strict';
import { submitOneApprovedEntry } from '../src/lib/entry-order-core.ts';
const intent={jobId:88,symbol:'ETHUSDT',baseAsset:'ETH',quoteAsset:'USDT',quantity:'0.001',price:'2000',budget:'2',stopPrice:'1900',targetPrice:'2200',clientOrderId:'entry_88'};
test('claim persists before submit and concurrent duplicate never sends twice',async()=>{
 let claimed=false, sent=0; const events=[];
 const deps={claim:async()=>{events.push('claim');if(claimed)return false;claimed=true;return true},submit:async()=>{events.push('submit');sent++;return {orderId:'7',status:'FILLED'}},acknowledge:async()=>events.push('ack'),alertUnknown:async()=>events.push('alert')};
 const first=await submitOneApprovedEntry(intent,deps);const second=await submitOneApprovedEntry(intent,deps);
 assert.equal(first.status,'submitted');assert.equal(second.status,'already_claimed');assert.equal(sent,1);assert.deepEqual(events,['claim','submit','ack','claim']);
});
test('lost response or database acknowledgement failure returns unknown without another submission',async()=>{
 let sent=0,alerts=0;
 const deps={claim:async()=>true,submit:async()=>{sent++;return {orderId:'7',status:'FILLED'}},acknowledge:async()=>{throw Error('database unavailable')},alertUnknown:async()=>{alerts++}};
 const r=await submitOneApprovedEntry(intent,deps);assert.equal(r.status,'unknown');assert.equal(sent,1);assert.equal(alerts,1);
});
