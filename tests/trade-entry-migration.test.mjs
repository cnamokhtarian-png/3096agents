import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { reconcileEntryFills } from '../src/lib/reconcile-entry-core.ts';
const load = name => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
async function setup() {
  const db = new PGlite();
  await db.exec(`CREATE SCHEMA agentos; CREATE TABLE agentos.agent_jobs(id integer PRIMARY KEY); INSERT INTO agentos.agent_jobs VALUES (1);
    CREATE TABLE agentos.ledger_entries(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,entry_group text NOT NULL,account_code text NOT NULL,agent_name text NOT NULL DEFAULT '',debit_usdt numeric(20,8) NOT NULL DEFAULT 0,credit_usdt numeric(20,8) NOT NULL DEFAULT 0,kind text NOT NULL,ref_type text NOT NULL DEFAULT '',ref_id text NOT NULL DEFAULT '',idempotency_key text NOT NULL UNIQUE,meta jsonb NOT NULL DEFAULT '{}'::jsonb);`);
  await db.exec(await load('20261108_live_trade_positions.sql'));
  await db.exec(`CREATE TABLE agentos.trade_external_fee_ledger(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,position_id bigint NOT NULL,entry_group text NOT NULL,asset text NOT NULL,account_code text NOT NULL,debit numeric NOT NULL DEFAULT 0,credit numeric NOT NULL DEFAULT 0,idempotency_key text NOT NULL UNIQUE);`);
  await db.exec(await load('20261110_trade_entry_fills.sql'));
  await db.exec(`INSERT INTO agentos.live_trade_positions(job_id,exchange,symbol,base_asset,quote_asset,state,requested_quote,stop_price,target_price)
    VALUES (1,'tabdeal','BTCUSDT','BTC','USDT','entry_pending',100,9000,11000);
    INSERT INTO agentos.live_trade_order_attempts(position_id,purpose,client_order_id,state,exchange_order_id) VALUES (1,'entry','entry_1','confirmed','500');`);
  return db;
}
const call = (db,id,qty,quote,fee,currency='USDT',order='500') => db.query(
  'SELECT agentos.record_tabdeal_entry_fill(1,$1,$2,$3::numeric,$4::numeric,$5::numeric,$6) AS result', [order,id,qty,quote,fee,currency]);
test('partial BUY fills record real quote and base fees exactly and idempotently', async () => {
  const db=await setup();
  try {
    assert.equal((await call(db,'11','0.004','40','0.1')).rows[0].result.status,'recorded');
    assert.equal((await call(db,'11','0.004','40','0.1')).rows[0].result.status,'already_recorded');
    await assert.rejects(call(db,'11','0.003','40','0.1'),/source trade identity conflict/);
    await call(db,'12','0.006','60','0.0001','BTC');
    const p=(await db.query('SELECT state,filled_base::text,entry_quote::text FROM agentos.live_trade_positions')).rows[0];
    assert.equal(p.state,'entry_pending');assert.equal(p.filled_base,'0.0099');assert.equal(p.entry_quote,'100.1');
    const ledger=(await db.query('SELECT count(*)::int n,sum(debit_usdt)::text debit,sum(credit_usdt)::text credit FROM agentos.ledger_entries')).rows[0]; assert.equal(ledger.n,4);assert.equal(ledger.debit,ledger.credit);
  } finally { await db.close(); }
});
test('unlinked, unsupported, and invalid fees never mutate positions',async()=>{
  const db=await setup(); try {
    await assert.rejects(call(db,'13','0.01','100','0.1','USDT','999'),/entry order is not linked/);
    await assert.rejects(call(db,'13','0.01','100','0.1','!'),/invalid trade fill/);
    await assert.rejects(call(db,'13','0.01','100','0.01','BTC'),/invalid net quantity/);
    assert.equal((await db.query('SELECT count(*)::int n FROM agentos.trade_entry_fills')).rows[0].n,0);
    assert.equal((await db.query('SELECT filled_base FROM agentos.live_trade_positions')).rows[0].filled_base,null);
  } finally { await db.close(); }
});
test('failure after fill insertion rolls back the source and position atomically',async()=>{
  const db=await setup();try {
    await db.exec(`CREATE FUNCTION agentos.fail_position() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected failure'; END $$;
      CREATE TRIGGER fail BEFORE UPDATE ON agentos.live_trade_positions FOR EACH ROW EXECUTE FUNCTION agentos.fail_position();`);
    await assert.rejects(call(db,'17','0.01','100','0'),/injected failure/);
    assert.equal((await db.query('SELECT count(*)::int n FROM agentos.trade_entry_fills')).rows[0].n,0);
    assert.equal((await db.query('SELECT count(*)::int n FROM agentos.ledger_entries')).rows[0].n,0);
  } finally { await db.close(); }
});
test('lost response after commit is reconciled without double counting',async()=>{
 const db=await setup(); try {
  const p={id:'1',symbol:'BTCUSDT',exchangeOrderId:'500',quoteAsset:'USDT',baseAsset:'BTC'};
  const f={tradeId:'21',orderId:'500',symbol:'BTCUSDT',side:'BUY',quantity:'0.004',quoteQuantity:'40',commission:'0.1',commissionAsset:'USDT'};
  let first=true;
  const deps={fetchFills:async()=>[f],recordFill:async(_,x)=>{const r=(await call(db,x.tradeId,x.quantity,x.quoteQuantity,x.commission,x.commissionAsset)).rows[0].result;if(first){first=false;throw Error('response lost')}return r}};
  await assert.rejects(reconcileEntryFills(p,deps),/response lost/);
  assert.equal((await reconcileEntryFills(p,deps)).fills[0].status,'already_recorded');
  assert.equal((await db.query('SELECT filled_base::text qty FROM agentos.live_trade_positions')).rows[0].qty,'0.004');
 } finally {await db.close()}
});
test('position opens only after terminal order and all executed fills reconcile',async()=>{
 const db=await setup();try {
  await call(db,'31','0.004','40','0.1');
  const finish=(status,qty)=>db.query('SELECT agentos.finalize_tabdeal_entry(1,\'500\',$1,$2::numeric) AS result',[status,qty]);
  await assert.rejects(finish('NEW','0.004'),/invalid terminal entry/);
  await assert.rejects(finish('FILLED','0.01'),/entry fills incomplete/);
  assert.equal((await db.query('SELECT state FROM agentos.live_trade_positions')).rows[0].state,'entry_pending');
  await call(db,'32','0.006','60','0.1');
  assert.equal((await finish('FILLED','0.010')).rows[0].result.status,'open');
  assert.equal((await finish('FILLED','0.010')).rows[0].result.status,'already_open');
 } finally {await db.close()}
});
test('a canceled partially filled order opens only the actual net position',async()=>{
 const db=await setup();try {
  await call(db,'41','0.004','40','0.0001','BTC');
  const r=await db.query("SELECT agentos.finalize_tabdeal_entry(1,'500','CANCELED',0.004) AS result");
  assert.equal(r.rows[0].result.status,'open');
  const p=(await db.query('SELECT filled_base::text qty,entry_quote::text cost FROM agentos.live_trade_positions')).rows[0];
  assert.equal(p.qty,'0.0039');assert.equal(p.cost,'40');
 } finally {await db.close()}
});
