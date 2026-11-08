import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTechnicalSetup } from '../src/lib/indicators.ts';
import { protectedTradeBlocker } from '../src/lib/trade-protection.ts';

const candles = Array.from({ length: 80 }, (_, i) => {
  const close = 100 + i * 0.1;
  return { openTime: i * 3600000, open: close - 0.1, high: close + 0.5, low: close - 0.5, close, volume: 1 };
});

test('proposal reflects spot execution rather than leveraged returns', () => {
  const setup = buildTechnicalSetup({ symbol: 'BTCUSDT', candles, livePrice: 108, changePct24h: 1, source: 'test', availableUsdt: 100, maxLeverage: 3 });
  assert.equal(setup.leverage, 1);
  assert.match(setup.directionLabel, /نقدی/);
  assert.equal(setup.positionUsdt, 2);
  assert.equal(setup.estimatedProfitUsdt, Math.round(setup.positionUsdt * setup.targetPct) / 100);
});

test('unavailable balance is not converted into a made-up order amount', () => {
  const setup = buildTechnicalSetup({ symbol: 'BTCUSDT', candles, livePrice: 108, changePct24h: null, source: 'test', availableUsdt: 0 });
  assert.equal(setup.positionUsdt, null);
  assert.equal(setup.estimatedProfitUsdt, null);
});

test('entry-only execution remains blocked until protected exits exist', () => {
  assert.equal(protectedTradeBlocker().code, 'protected_trade_unavailable');
});
