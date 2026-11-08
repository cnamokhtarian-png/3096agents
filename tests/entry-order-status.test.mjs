import test from 'node:test';
import assert from 'node:assert/strict';
import { settleEntryOrderStatus } from '../src/lib/entry-order-status.ts';
const decide=(status,now,deps)=>settleEntryOrderStatus({order:{status},createdAtMs:1000,nowMs:now,maxOpenMs:60000},deps);
test('new entry remains open until timeout; partial is canceled immediately',async()=>{
 let canceled=0,lookups=0;const deps={cancel:async()=>{canceled++},lookup:async()=>{lookups++;return {status:'CANCELED'}}};
 assert.equal((await decide('NEW',2000,deps)).status,'NEW');assert.equal(canceled,0);
 assert.equal((await decide('PARTIALLY_FILLED',2000,deps)).status,'CANCELED');assert.equal(canceled,1);assert.equal(lookups,1);
});
test('lost cancellation response is reconciled; still-open response is not final',async()=>{
 const deps={cancel:async()=>{throw Error('timeout')},lookup:async()=>({status:'CANCELED'})};
 assert.equal((await decide('NEW',62000,deps)).status,'CANCELED');
 await assert.rejects(decide('NEW',62000,{...deps,lookup:async()=>({status:'NEW'})}),/entry_cancel_pending/);
});
test('terminal orders are never canceled',async()=>{
 let calls=0;const deps={cancel:async()=>{calls++},lookup:async()=>{calls++;return {status:'FILLED'}}};
 assert.equal((await decide('FILLED',80000,deps)).status,'FILLED');assert.equal(calls,0);
});
