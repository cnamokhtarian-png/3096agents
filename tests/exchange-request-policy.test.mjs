import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedSignedRequest } from '../src/lib/exchange-request-policy.ts';

test('only explicit account read and order endpoints are allowed', () => {
  for (const p of ['/api/v3/account', '/api/v1/account']) assert.equal(isAllowedSignedRequest('GET', p), true);
  for (const p of ['/api/v3/order', '/api/v1/order']) assert.equal(isAllowedSignedRequest('POST', p), true);
  assert.equal(isAllowedSignedRequest('POST', '/api/v1/order/oco'), true);
  assert.equal(isAllowedSignedRequest('GET', '/r/api/v1/orderList'), true);
  assert.equal(isAllowedSignedRequest('DELETE', '/api/v1/order'), true);
  assert.equal(isAllowedSignedRequest('DELETE', '/api/v1/openOrders'), false);
  assert.equal(isAllowedSignedRequest('GET', '/r/api/v1/order'), true);
  assert.equal(isAllowedSignedRequest('GET', '/r/api/v1/myTrades'), true);
  assert.equal(isAllowedSignedRequest('POST', '/r/api/v1/myTrades'), false);
  assert.equal(isAllowedSignedRequest('GET', '/r/api/v1/account'), true);
  for (const p of ['/sapi/v1/capital/withdraw/apply', '/api/v1/withdraw', '/api/v1/order/../withdraw', '/api/v1/order?x=1']) {
    assert.equal(isAllowedSignedRequest('POST', p), false);
  }
  assert.equal(isAllowedSignedRequest('POST', '/api/v1/account'), false);
});
