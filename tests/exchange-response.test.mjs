import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAccountBalances, parseOrderAcknowledgement } from '../src/lib/exchange-response.ts';
test('Tabdeal freeze and Binance locked balances are handled independently', () => {
  const a = normalizeAccountBalances({canTrade:true, balances:[{asset:'USDT',free:'1.87',freeze:'0.2'},{asset:'BTC',free:'0',locked:'0.1'}]}, ['BTC','USDT']);
  assert.equal(a.balances[0].locked,0.2); assert.equal(a.balances[1].locked,0.1); assert.equal(a.canTrade,true);
  assert.throws(() => normalizeAccountBalances({balances:[{asset:'USDT',free:'x',freeze:'0'}]}, ['USDT']), /invalid_balance_response/);
  assert.throws(() => normalizeAccountBalances({balances:[{asset:'USDT',free:'1'}]}, ['USDT']), /invalid_balance_response/);
});
test('a missing or partial exchange acknowledgement is never invented as FILLED', () => {
  assert.throws(() => parseOrderAcknowledgement({}), /order_response_ambiguous/);
  assert.throws(() => parseOrderAcknowledgement({orderId:1,status:'FILLED'}), /order_response_ambiguous/);
  assert.equal(parseOrderAcknowledgement({orderId:1,status:'PARTIALLY_FILLED',executedQty:'0.2',cumulativeQuoteQty:'20'}).status,'PARTIALLY_FILLED');
});
