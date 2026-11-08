import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTabdealMarket, planTabdealMarketBuy, validateTabdealLimitBuy, planTabdealMarketSell } from '../src/lib/tabdeal-market.ts';
const market = { symbol: 'BTCUSDT', status: 'TRADING', baseAsset: 'BTC', quoteAsset: 'USDT', isSpotTradingAllowed: true, ocoAllowed: true, quoteOrderQtyMarketAllowed: false, orderTypes: ['MARKET', 'LIMIT', 'STOP_LOSS_LIMIT'], filters: [
  { filterType: 'PRICE_FILTER', minPrice: '0.01', maxPrice: '1000000', tickSize: '0.01' },
  { filterType: 'LOT_SIZE', minQty: '0.00000100', stepSize: '0.00000100' },
  { filterType: 'MARKET_LOT_SIZE', minQty: '0.00000100', maxQty: '7.02492200', stepSize: '0.00000100' },
  { filterType: 'MIN_NOTIONAL', minNotional: '1.00', applyToMarket: false },
] };
const rules = parseTabdealMarket(market, 'BTCUSDT');
test('uses base quantity and exchange step for the documented BTC market', () => {
  const plan = planTabdealMarketBuy({ budget: '1.87', ask: '75995.45', stopLimitPrice: '75126.94', rules });
  assert.equal(plan.quantity, '0.00002400');
  assert.equal(plan.quoteOrderQtyMarketAllowed, false);
});
test('prevents proposals whose exit is below exchange minimum', () => {
  assert.throws(() => planTabdealMarketBuy({ budget: '0.04', ask: '75995.45', stopLimitPrice: '75126.94', rules }), /market_quantity_out_of_range/);
  assert.throws(() => planTabdealMarketBuy({ budget: '0.95', ask: '75995.45', stopLimitPrice: '75126.94', rules }), /exit_notional_below_minimum/);
});
test('accepts both documented array and single-market response, preserving OCO capability', () => {
  assert.equal(parseTabdealMarket([market], 'BTCUSDT').ocoAllowed, true);
  assert.equal(parseTabdealMarket({ ...market, ocoAllowed: false }, 'BTCUSDT').ocoAllowed, false);
  assert.throws(() => parseTabdealMarket([market,market], 'BTCUSDT'), /market_unavailable/);
  assert.throws(() => parseTabdealMarket({ ...market, ocoAllowed: undefined }, 'BTCUSDT'), /market_unavailable/);
});

test('price-capped limit buy respects approved budget and exchange filters',()=>{
 const input={quantity:'0.00002400',price:'75995.45',budget:'1.87',stopPrice:'75126.94',targetPrice:'77800.82',rules};
 assert.equal(validateTabdealLimitBuy(input).quantity,input.quantity);
 assert.throws(()=>validateTabdealLimitBuy({...input,budget:'1.80'}),/budget_exceeded/);
 assert.throws(()=>validateTabdealLimitBuy({...input,price:'75995.451'}),/invalid_limit_price/);
 assert.throws(()=>validateTabdealLimitBuy({...input,quantity:'0.00002401'}),/invalid_limit_quantity/);
 assert.throws(()=>validateTabdealLimitBuy({...input,stopPrice:'80000'}),/invalid_limits/);
});

test('sell sizing floors to allowed step and detects unsellable dust',()=>{
 assert.equal(planTabdealMarketSell({available:'0.00002455',bid:'75995.45',rules}).quantity,'0.00002400');
 assert.throws(()=>planTabdealMarketSell({available:'0.00000055',bid:'75995.45',rules}),/unsellable_market_dust/);
});
