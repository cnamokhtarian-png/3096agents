import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateTabdealSellOco } from '../src/lib/tabdeal-oco.ts';

const plan = { symbol: 'BTCIRT', quantity: '0.005', price: '100100000', stopPrice: '99899999', stopLimitPrice: '99890000', referencePrice: '100000000', listClientOrderId: 'o_1', limitClientOrderId: 'l_1', stopClientOrderId: 's_1' };
const filters = { ocoAllowed: true, tickSize: '1', minPrice: '300', maxPrice: '30000000000', stepSize: '0.00000001', minQty: '0.00005', maxQty: '1', minNotional: '99000' };
test('validates documented spot OCO parameters without float rounding', () => assert.doesNotThrow(() => validateTabdealSellOco(plan, filters)));
test('rejects unsupported and unaligned markets, quantities and prices', () => {
  assert.throws(() => validateTabdealSellOco(plan, { ...filters, ocoAllowed: false }), /oco_not_supported/);
  assert.throws(() => validateTabdealSellOco({ ...plan, quantity: '0.005000001' }, filters), /invalid_quantity/);
  assert.throws(() => validateTabdealSellOco({ ...plan, price: '100100000.5' }, filters), /invalid_price/);
  assert.throws(() => validateTabdealSellOco({ ...plan, stopLimitPrice: '99900000' }, filters), /invalid_price_order/);
  assert.throws(() => validateTabdealSellOco({ ...plan, quantity: '0.00005' }, filters), /notional_too_small/);
  assert.throws(() => validateTabdealSellOco({ ...plan, stopClientOrderId: 'o_1' }, filters), /invalid_client_ids/);
});
