import test from 'node:test';
import assert from 'node:assert/strict';
import { renderCloseReport } from '../src/lib/trade-close-report-core.ts';
test('report includes recorded fees and actual net result and escapes fields',()=>{
 const text=renderCloseReport({positionId:'1',symbol:'ETH<USDT',baseAsset:'ETH',filledBase:'0.9',entryCost:'100.1',exitGross:'109',realized:'8.8',hasUnvaluedFees:false,entryFees:[{asset:'USDT',amount:'0.1'}],exitFees:[{asset:'USDT',amount:'0.1'}]});
 assert.match(text,/ETH&lt;USDT/);assert.match(text,/8\.8 USDT/);assert.match(text,/کارمزد ورود: 0\.1 USDT/);
});

test('third-asset fee never appears as a final net USDT result',()=>{
 const text=renderCloseReport({positionId:'1',symbol:'ETHUSDT',baseAsset:'ETH',filledBase:'1',entryCost:'100',exitGross:'110',realized:'10',hasUnvaluedFees:true,entryFees:[{asset:'BNB',amount:'0.01'}],exitFees:[]});
 assert.match(text,/پیش از کارمزد ارز سوم/);assert.doesNotMatch(text,/سود\/زیان خالص/);assert.match(text,/0\.01 BNB/);
});
