import test from 'node:test';
import assert from 'node:assert/strict';
import { positionTrigger, parseTabdealTopOfBook } from '../src/lib/position-monitor.ts';
const base = { state: 'open', bestBid: 100, bidTimeMs: 1000, nowMs: 2000, maxAgeMs: 2000, stopPrice: 90, targetPrice: 110 };
test('triggers a spot long only when executable bid reaches the approved level', () => {
  assert.equal(positionTrigger(base), 'hold');
  assert.equal(positionTrigger({ ...base, bestBid: 90 }), 'stop_loss');
  assert.equal(positionTrigger({ ...base, bestBid: 110 }), 'take_profit');
});
test('rejects invalid, future, stale and already closed data', () => {
  assert.throws(() => positionTrigger({ ...base, nowMs: 4000 }), /stale_market_data/);
  assert.throws(() => positionTrigger({ ...base, bidTimeMs: 3000 }), /stale_market_data/);
  assert.throws(() => positionTrigger({ ...base, bestBid: NaN }), /invalid_monitor_input/);
  assert.throws(() => positionTrigger({ ...base, state: 'exit_pending' }), /position_not_open/);
});

test('rejects an empty, invalid or crossed Tabdeal order book', () => {
  assert.deepEqual(parseTabdealTopOfBook({ bids: [['99', '2']], asks: [['101', '3']] }), { bid: 99, ask: 101 });
  assert.throws(() => parseTabdealTopOfBook({ bids: [], asks: [] }), /invalid_order_book/);
  assert.throws(() => parseTabdealTopOfBook({ bids: [['102', '1']], asks: [['101', '1']] }), /invalid_order_book/);
  assert.throws(() => parseTabdealTopOfBook({ bids: [['99', '0']], asks: [['101', '1']] }), /invalid_order_book/);
});
