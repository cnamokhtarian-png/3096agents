import test from 'node:test';
import assert from 'node:assert/strict';
import { runAriaCycle } from '../src/lib/aria-cycle-core.ts';

test('Aria recovers exits before monitoring and reconciles new sells afterwards', async () => {
  const calls=[];
  const action=name=>async()=>{calls.push(name);return {ok:true};};
  const result=await runAriaCycle({entries:action('entries'),exits:action('exits'),monitor:action('monitor'),reports:action('reports')});
  assert.equal(result.ok,true);
  assert.deepEqual(calls,['entries','exits','monitor','exits','reports']);
});

test('entry or recovery errors do not disable monitoring or leak secrets', async () => {
  let monitored=false,reported=false;
  const fail=async()=>{throw new Error('postgres://secret:password@host');};
  const result=await runAriaCycle({entries:fail,exits:fail,
    monitor:async()=>{monitored=true;return {ok:true};},reports:async()=>{reported=true;return {ok:true};}});
  assert.equal(result.ok,false);
  assert.equal(monitored,true);assert.equal(reported,true);
  assert.ok(!JSON.stringify(result).includes('password'));
});

test('partial batch failure propagates to scheduler result',async()=>{
  const ok=async()=>({ok:true});
  const result=await runAriaCycle({entries:ok,exits:ok,monitor:async()=>({ok:false,checked:3}),reports:ok});
  assert.equal(result.ok,false);
});
