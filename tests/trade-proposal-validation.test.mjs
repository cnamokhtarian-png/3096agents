import test from 'node:test';
import assert from 'node:assert/strict';
import { tradeProposalErrors } from '../src/lib/trade-proposal.ts';
const valid = { symbol: 'BTCUSDT', side: 'BUY', quoteOrderQty: 1.87, entryPrice: 100, stopLoss: 90, takeProfit: 110 };
test('accepts a complete proposal, but not missing or non-finite values', () => {
  assert.deepEqual(tradeProposalErrors(valid), []);
  for (const value of [null, undefined, 0, -1, NaN, Infinity, '']) assert.ok(tradeProposalErrors({ ...valid, quoteOrderQty: value }).length);
  assert.ok(tradeProposalErrors({ ...valid, stopLoss: 0 }).length);
  assert.ok(tradeProposalErrors({ ...valid, takeProfit: 99 }).length);
  assert.ok(tradeProposalErrors({ ...valid, symbol: 'BTC_USDT' }).length);
});
test('checks the order of sell targets independently', () => {
  assert.deepEqual(tradeProposalErrors({ ...valid, side: 'SELL', stopLoss: 110, takeProfit: 90 }), []);
  assert.ok(tradeProposalErrors({ ...valid, side: 'SELL' }).length);
});
