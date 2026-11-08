import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTabdealTrades, fillIdempotencyKey } from '../src/lib/tabdeal-fills.ts';
const raw = {id:123,orderId:42,symbol:'BTCUSDT',isBuyer:false,qty:'0.00001',price:'76000',quoteQty:'0.76',commission:'0.003',commissionAsset:'USDT'};
const expected = {symbol:'BTCUSDT',orderId:'42',side:'SELL'};
test('uses exchange trade identity, not a timestamp, across polls', () => {
  const a = parseTabdealTrades([raw], expected)[0];
  assert.equal(fillIdempotencyKey(a), 'tabdeal:BTCUSDT:123');
  assert.equal(fillIdempotencyKey(parseTabdealTrades([{...raw,id:'123'}], expected)[0]), fillIdempotencyKey(a));
  assert.equal(a.commission, '0.003');
});
test('rejects duplicates, unrelated orders, unsafe identifiers and absent fees', () => {
  assert.throws(() => parseTabdealTrades([raw,raw], expected), /duplicate_trade_id/);
  assert.throws(() => parseTabdealTrades([{...raw,orderId:43}], expected), /trade_mismatch/);
  assert.throws(() => parseTabdealTrades([{...raw,id:Number.MAX_SAFE_INTEGER+1}], expected), /invalid_fill_id/);
  assert.throws(() => parseTabdealTrades([{...raw,commission:undefined}], expected), /invalid_fill_decimal/);
});

test('rejects a quote amount inconsistent with actual quantity and price', () => {
  assert.throws(() => parseTabdealTrades([{...raw,quoteQty:'0.00001'}], expected), /inconsistent_quote_total/);
  assert.throws(() => parseTabdealTrades([{...raw,price:undefined}], expected), /invalid_fill_decimal/);
  assert.doesNotThrow(() => parseTabdealTrades([{...raw,quoteQty:'0.76000001'}], expected));
});
