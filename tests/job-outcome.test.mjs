import test from 'node:test';
import assert from 'node:assert/strict';
import { executionOutcome } from '../src/lib/job-outcome.ts';
test('approval consumers receive the real exchange error instead of unknown',()=>{
  const result=executionOutcome({ok:false,error:'صرافی (tabdeal) خطا برگرداند: Access denied.',code:'exchange_rejected'});
  assert.equal(result.ok,false);assert.equal(result.error,'صرافی (tabdeal) خطا برگرداند: Access denied.');assert.equal(result.code,'exchange_rejected');
});
test('successful execution remains successful and preserves result',()=>{
  const result=executionOutcome({ok:true,result:{orderId:'4'}});
  assert.equal(result.ok,true);assert.equal(result.execution.result.orderId,'4');
});
