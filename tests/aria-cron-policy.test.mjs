import test from 'node:test';
import assert from 'node:assert/strict';
import { ariaSchedulerAuthorized as allowed } from '../src/lib/aria-cron-policy.ts';
test('scoped scheduler only authorizes aria, never full/queue/manual aliases',()=>{
 assert.equal(allowed('aria','sample','sample'),true);
 for(const job of ['full','queue','fleet','trade_monitor','trade_reconcile','']) assert.equal(allowed(job,'sample','sample'),false);
 for(const value of ['',undefined,'wrong','sample-too-long']) assert.equal(allowed('aria','sample',value),false);
});
