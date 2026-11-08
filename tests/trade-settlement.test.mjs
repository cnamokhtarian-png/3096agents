import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateSpotSettlement } from '../src/lib/trade-settlement.ts';
const entry = { status:'FILLED', fills:[{qty:'0.01',quoteQty:'100.00',commission:'0.10',commissionAsset:'USDT'}] };
const exit = { status:'FILLED', fills:[{qty:'0.01',quoteQty:'110.00',commission:'0.11',commissionAsset:'USDT'}] };
test('uses actual filled quote and both fees, not a quoted target price', () => {
  assert.equal(calculateSpotSettlement({quoteAsset:'USDT',entry,exit}).pnl, '9.79');
  assert.equal(calculateSpotSettlement({quoteAsset:'USDT',entry,exit:{...exit,fills:[{...exit.fills[0],quoteQty:'90.00'}]}}).pnl, '-10.21');
});
test('requires complete fills, matched quantities and known fee denomination', () => {
  assert.throws(() => calculateSpotSettlement({quoteAsset:'USDT',entry,exit:{...exit,status:'PARTIALLY_FILLED'}}), /settlement_incomplete/);
  assert.throws(() => calculateSpotSettlement({quoteAsset:'USDT',entry,exit:{...exit,fills:[{...exit.fills[0],qty:'0.009'}]}}), /quantity_requires_reconciliation/);
  assert.throws(() => calculateSpotSettlement({quoteAsset:'USDT',entry,exit:{...exit,fills:[{...exit.fills[0],commissionAsset:'BTC'}]}}), /fee_asset_requires_reconciliation/);
});
