import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTabdealSpotOrder } from '../src/lib/tabdeal-order-input.ts';
const buy = {symbol:'BTCUSDT',side:'BUY',type:'MARKET',quantity:'0.00002400'};
test('Tabdeal requires base quantity and does not sanitize malformed symbols', () => {
  assert.doesNotThrow(()=>validateTabdealSpotOrder(buy));
  assert.throws(()=>validateTabdealSpotOrder({...buy,quantity:undefined,quoteOrderQty:1.8}),/tabdeal_requires_base_quantity/);
  assert.throws(()=>validateTabdealSpotOrder({...buy,symbol:'BTC/USDT'}),/invalid_symbol/);
  assert.throws(()=>validateTabdealSpotOrder({...buy,quantity:'1e-8'}),/invalid_quantity/);
});
test('limit requires a finite positive price', () => {
  assert.throws(()=>validateTabdealSpotOrder({...buy,type:'LIMIT',price:Infinity}),/invalid_limit_price/);
  assert.doesNotThrow(()=>validateTabdealSpotOrder({...buy,type:'LIMIT',price:75000}));
});
