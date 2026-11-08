import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { reconcileExitFills } from '../src/lib/reconcile-exit-core.ts';

const load = (name) => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
async function setup() {
  const db = new PGlite();
  await db.exec(`CREATE SCHEMA agentos;
    CREATE TABLE agentos.agent_jobs(id integer PRIMARY KEY);
    CREATE TABLE agentos.ledger_accounts(code text PRIMARY KEY,name text NOT NULL,kind text NOT NULL,asset text NOT NULL);
    INSERT INTO agentos.agent_jobs VALUES (1);
    CREATE TABLE agentos.ledger_entries (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      entry_group text NOT NULL, account_code text NOT NULL, agent_name text NOT NULL DEFAULT '',
      debit_usdt real NOT NULL DEFAULT 0, credit_usdt real NOT NULL DEFAULT 0, kind text NOT NULL,
      ref_type text NOT NULL DEFAULT '', ref_id text NOT NULL DEFAULT '', idempotency_key text NOT NULL UNIQUE,
      meta jsonb NOT NULL DEFAULT '{}'::jsonb
    );`);
  await db.exec(await load('20261108_live_trade_positions.sql'));
  await db.exec('BEGIN');
  await db.exec(await load('20261109_trade_ledger_numeric.sql'));
  await db.exec('COMMIT');
  await db.exec(`INSERT INTO agentos.live_trade_positions(job_id,exchange,symbol,base_asset,quote_asset,state,requested_quote,filled_base,entry_quote,stop_price,target_price)
    VALUES (1,'tabdeal','BTCUSDT','BTC','USDT','exit_pending',100,'0.01',100,9000,11000);
    INSERT INTO agentos.live_trade_order_attempts(position_id,purpose,client_order_id,state,exchange_order_id) VALUES (1,'exit','exit_1','submitted','500');`);
  return db;
}
const call = (db, trade, qty, quote, fee='0.10', currency='USDT') => db.query(
  'SELECT agentos.record_tabdeal_exit_fill($1,$2,$3,$4::numeric,$5::numeric,$6::numeric,$7) AS result',
  [1,'500',trade,qty,quote,fee,currency]);

test('migration, partial fills, balanced entries and deterministic duplicate handling', async () => {
  const db = await setup();
  try {
    const type = await db.query("SELECT data_type,numeric_precision,numeric_scale FROM information_schema.columns WHERE table_schema='agentos' AND table_name='ledger_entries' AND column_name='debit_usdt'");
    assert.equal(type.rows[0].data_type, 'numeric');
    assert.equal(type.rows[0].numeric_precision, 20); assert.equal(type.rows[0].numeric_scale, 8);
    let a = await call(db,'11','0.004','44');
    assert.equal(a.rows[0].result.remaining, 0.006);
    assert.equal((await call(db,'11','0.004','44')).rows[0].result.status, 'already_recorded');
    await assert.rejects(call(db,'11','0.003','44'), /source trade identity conflict/);
    let pos = (await db.query('SELECT state,exit_base::text,realized_quote::text FROM agentos.live_trade_positions')).rows[0];
    assert.equal(pos.state, 'exit_pending'); assert.equal(pos.exit_base, '0.004');
    a = await call(db,'12','0.006','54'); assert.equal(a.rows[0].result.remaining, 0);
    pos = (await db.query('SELECT state,exit_base::text FROM agentos.live_trade_positions')).rows[0]; assert.equal(pos.state, 'closed');
    const totals = await db.query('SELECT count(*)::int AS count, sum(debit_usdt)::text AS debit, sum(credit_usdt)::text AS credit FROM agentos.ledger_entries');
    assert.equal(totals.rows[0].count,8); assert.equal(totals.rows[0].debit,totals.rows[0].credit);
    assert.equal((await call(db,'12','0.006','54')).rows[0].result.status, 'already_recorded');
  } finally { await db.close(); }
});

test('a failure after fill insertion rolls back fill, ledger and position together', async () => {
  const db = await setup();
  try {
    await db.exec(`CREATE FUNCTION agentos.fail_ledger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.account_code='profit' THEN RAISE EXCEPTION 'injected failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER fail_second BEFORE INSERT ON agentos.ledger_entries FOR EACH ROW EXECUTE FUNCTION agentos.fail_ledger();`);
    await assert.rejects(call(db,'20','0.004','44'), /injected failure/);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM agentos.trade_exit_fills')).rows[0].n,0);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM agentos.ledger_entries')).rows[0].n,0);
    assert.equal((await db.query('SELECT exit_base FROM agentos.live_trade_positions')).rows[0].exit_base,null);
  } finally { await db.close(); }
});

test('invalid or unrelated fills never update the position', async () => {
  const db = await setup();
  try {
    await assert.rejects(call(db,'33','0.02','220'), /fill exceeds position/);
    await assert.rejects(call(db,'33','0.001','11','0.1','!'), /invalid trade fill/);
    await assert.rejects(db.query("SELECT agentos.record_tabdeal_exit_fill(1,'999','34',0.001,11,0.1,'USDT')"), /exit order is not linked/);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM agentos.trade_exit_fills')).rows[0].n,0);
  } finally { await db.close(); }
});

test('committed fill with lost response is reconciled on retry without duplicate entries', async () => {
  const db = await setup();
  try {
    const pos = { id:'1', symbol:'BTCUSDT', exchangeOrderId:'500', quoteAsset:'USDT',baseAsset:'BTC' };
    const fill = {tradeId:'101', orderId:'500', symbol:'BTCUSDT', side:'SELL', quantity:'0.004', quoteQuantity:'44', commission:'0.10', commissionAsset:'USDT'};
    let first = true;
    const deps = { fetchFills:async()=>[fill], recordFill:async (_, f)=>{
      const result = (await call(db, f.tradeId, f.quantity, f.quoteQuantity, f.commission, f.commissionAsset)).rows[0].result;
      if (first) { first=false; throw new Error('simulated response lost after commit'); }
      return result;
    }};
    await assert.rejects(reconcileExitFills(pos,deps), /simulated response lost/);
    const retried = await reconcileExitFills(pos,deps);
    assert.equal(retried.fills[0].result.status,'already_recorded');
    assert.equal((await db.query('SELECT count(*)::int AS n FROM agentos.ledger_entries')).rows[0].n,4);
    assert.equal((await db.query('SELECT exit_base::text AS qty FROM agentos.live_trade_positions')).rows[0].qty,'0.004');
  } finally { await db.close(); }
});

test('refuses precision loss instead of silently rounding PnL', async () => {
  const db = await setup();
  try {
    await assert.rejects(call(db,'77','0.004','44.000000001','0'), /pnl requires a rounding policy/);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM agentos.trade_exit_fills')).rows[0].n,0);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM agentos.ledger_entries')).rows[0].n,0);
  } finally { await db.close(); }
});

test('entry and exit cost basis close to zero and exchange movement equals realized PnL',async()=>{
 const db=await setup();try {
  await db.exec(await load('20261110_trade_entry_fills.sql'));
  await db.exec(`UPDATE agentos.live_trade_positions SET state='entry_pending',filled_base=NULL,entry_quote=NULL WHERE id=1;
    INSERT INTO agentos.live_trade_order_attempts(position_id,purpose,client_order_id,state,exchange_order_id) VALUES (1,'entry','entry_1','confirmed','499');`);
  await db.query("SELECT agentos.record_tabdeal_entry_fill(1,'499','201',0.004,40,0.1,'USDT')");
  await db.query("SELECT agentos.record_tabdeal_entry_fill(1,'499','202',0.006,60,0.1,'USDT')");
  await db.query("SELECT agentos.finalize_tabdeal_entry(1,'499','FILLED',0.01)");
  await db.query("SELECT agentos.record_tabdeal_exit_fill(1,'500','203',0.004,44,0.1,'USDT')");
  await db.query("SELECT agentos.record_tabdeal_exit_fill(1,'500','204',0.006,54,0.1,'USDT')");
  const result=await db.query(`SELECT account_code,sum(debit_usdt-credit_usdt)::text balance FROM agentos.ledger_entries GROUP BY account_code ORDER BY account_code`);
  const accounts=Object.fromEntries(result.rows.map(r=>[r.account_code,Number(r.balance)]));
  assert.equal(accounts.trade_inventory,0); assert.equal(accounts.exchange,-2.4); assert.equal(accounts.profit,2.4);
  const balanced=await db.query('SELECT entry_group,sum(debit_usdt)::text debit,sum(credit_usdt)::text credit FROM agentos.ledger_entries GROUP BY entry_group');
  assert.ok(balanced.rows.every(row=>row.debit===row.credit));
  const p=(await db.query('SELECT state,realized_quote::text pnl FROM agentos.live_trade_positions')).rows[0];
  assert.equal(p.state,'closed');assert.equal(Number(p.pnl),-2.4);
 } finally {await db.close()}
});

test('mocked lifecycle sends approved entry once, settles partial fills, triggers exit and closes accounting',async()=>{
 const { submitOneApprovedEntry } = await import('../src/lib/entry-order-core.ts');
 const { monitorOneExit } = await import('../src/lib/exit-monitor-core.ts');
 const db=await setup();try {
  await db.exec(await load('20261110_trade_entry_fills.sql'));
  await db.exec(`DELETE FROM agentos.live_trade_order_attempts; UPDATE agentos.live_trade_positions SET state='entry_pending',filled_base=NULL,entry_quote=NULL WHERE id=1`);
  let entrySends=0,exitSends=0;
  const intent={jobId:1,symbol:'BTCUSDT',baseAsset:'BTC',quoteAsset:'USDT',quantity:'0.01',price:'10000',budget:'100',stopPrice:'9000',targetPrice:'11000',clientOrderId:'entry_1'};
  const entry=await submitOneApprovedEntry(intent,{
   claim:async i=>{await db.query("INSERT INTO agentos.live_trade_order_attempts(position_id,purpose,client_order_id,state) VALUES(1,'entry',$1,'unknown')",[i.clientOrderId]);return true},
   submit:async()=>{entrySends++;return {orderId:'499',status:'FILLED'}},
   acknowledge:async()=>{await db.exec("UPDATE agentos.live_trade_order_attempts SET state='confirmed',exchange_order_id='499' WHERE purpose='entry'")},alertUnknown:async()=>{}
  });
  assert.equal(entry.status,'submitted');assert.equal(entrySends,1);
  await db.query("SELECT agentos.record_tabdeal_entry_fill(1,'499','201',0.004,40,0.1,'USDT')");
  await db.query("SELECT agentos.record_tabdeal_entry_fill(1,'499','202',0.006,60,0.1,'USDT')");
  await db.query("SELECT agentos.finalize_tabdeal_entry(1,'499','FILLED',0.01)");
  const exit=await monitorOneExit({id:'1',symbol:'BTCUSDT',remainingQuantity:'0.01',stopPrice:9000,targetPrice:11000},{
   quote:async()=>({bid:11000,requestStartedAt:1000}),now:()=>1000,maxQuoteAgeMs:1000,
   claim:async i=>{await db.query("INSERT INTO agentos.live_trade_order_attempts(position_id,purpose,client_order_id,state) VALUES(1,'exit',$1,'unknown')",[i.clientOrderId]);await db.exec("UPDATE agentos.live_trade_positions SET state='exit_unknown' WHERE id=1");return true},
   submit:async()=>{exitSends++;return {orderId:'500',status:'FILLED'}},
   acknowledge:async()=>{await db.exec("UPDATE agentos.live_trade_order_attempts SET state='confirmed',exchange_order_id='500' WHERE purpose='exit'; UPDATE agentos.live_trade_positions SET state='exit_pending' WHERE id=1")},alertUnknown:async()=>{}
  });
  assert.equal(exit.status,'submitted');assert.equal(exitSends,1);
  await db.query("SELECT agentos.record_tabdeal_exit_fill(1,'500','203',0.004,44,0.1,'USDT')");
  await db.query("SELECT agentos.record_tabdeal_exit_fill(1,'500','204',0.006,66,0.1,'USDT')");
  const p=(await db.query('SELECT state,realized_quote::text pnl FROM agentos.live_trade_positions')).rows[0];
  assert.equal(p.state,'closed');assert.equal(Number(p.pnl),9.6);
  const inventory=(await db.query("SELECT sum(debit_usdt-credit_usdt)::numeric balance FROM agentos.ledger_entries WHERE account_code='trade_inventory'")).rows[0];
  assert.equal(Number(inventory.balance),0);
 } finally {await db.close()}
});
test('a close queues exactly one report atomically; partial fills and rollback queue none',async()=>{
 const db=await setup(); try {
  await call(db,'301','0.004','44');
  assert.equal((await db.query('SELECT count(*)::int n FROM agentos.trade_close_notifications')).rows[0].n,0);
  await db.exec(`CREATE FUNCTION agentos.reject_notification() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'outbox failed'; END $$;
    CREATE TRIGGER reject_notification BEFORE INSERT ON agentos.trade_close_notifications FOR EACH ROW EXECUTE FUNCTION agentos.reject_notification();`);
  await assert.rejects(call(db,'302','0.006','66'),/outbox failed/);
  assert.equal((await db.query('SELECT state FROM agentos.live_trade_positions')).rows[0].state,'exit_pending');
  assert.equal((await db.query('SELECT count(*)::int n FROM agentos.trade_exit_fills')).rows[0].n,1);
  await db.exec('DROP TRIGGER reject_notification ON agentos.trade_close_notifications');
  await call(db,'302','0.006','66');await call(db,'302','0.006','66');
  assert.equal((await db.query('SELECT count(*)::int n FROM agentos.trade_close_notifications')).rows[0].n,1);
 } finally {await db.close()}
});
test('base-denominated exit fee consumes additional inventory and its cost',async()=>{
 const db=await setup();try {
  const r=await call(db,'501','0.0099','110','0.0001','BTC');
  assert.equal(r.rows[0].result.remaining,0);assert.equal(Number(r.rows[0].result.pnl),10);
  const p=(await db.query('SELECT state,exit_base::text qty,realized_quote::text pnl FROM agentos.live_trade_positions')).rows[0];
  assert.equal(p.state,'closed');assert.equal(Number(p.qty),0.01);assert.equal(Number(p.pnl),10);
 } finally {await db.close()}
});
test('terminal partial sell reopens only the remainder for a new uniquely claimed attempt',async()=>{
 const db=await setup();try {
  await call(db,'601','0.004','44');
  const finish=(qty)=>db.query("SELECT agentos.finalize_tabdeal_exit_attempt(1,'500','CANCELED',$1::numeric) result",[qty]);
  await assert.rejects(finish('0.005'),/exit fills incomplete/);
  assert.equal((await db.query('SELECT state FROM agentos.live_trade_positions')).rows[0].state,'exit_pending');
  assert.equal((await finish('0.004')).rows[0].result.position_state,'open');
  assert.equal((await finish('0.004')).rows[0].result.status,'already_settled');
  await db.exec("INSERT INTO agentos.live_trade_order_attempts(position_id,purpose,client_order_id,state,exchange_order_id) VALUES (1,'exit','exit_1_2','confirmed','501'); UPDATE agentos.live_trade_positions SET state='exit_pending' WHERE id=1;");
  await assert.rejects(db.exec("INSERT INTO agentos.live_trade_order_attempts(position_id,purpose,client_order_id,state) VALUES (1,'exit','exit_1_3','unknown')"),/unique/);
  await db.query("SELECT agentos.record_tabdeal_exit_fill(1,'501','602',0.006,66,0.1,'USDT')");
  const final=await db.query("SELECT agentos.finalize_tabdeal_exit_attempt(1,'501','FILLED',0.006) result");
  assert.equal(final.rows[0].result.position_state,'closed');
  assert.equal((await db.query('SELECT count(*)::int n FROM agentos.trade_close_notifications')).rows[0].n,1);
 } finally {await db.close()}
});
test('rejected zero-fill sell never triggers a retry storm',async()=>{
 const db=await setup();try {
  const r=await db.query("SELECT agentos.finalize_tabdeal_exit_attempt(1,'500','REJECTED',0) result");
  assert.equal(r.rows[0].result.position_state,'requires_attention');
 } finally {await db.close()}
});
test('third asset fees are posted in original units and never falsely converted to zero USDT',async()=>{
 const db=await setup();try {
  await db.exec(await load('20261110_trade_entry_fills.sql'));
  await db.exec("UPDATE agentos.live_trade_positions SET state='entry_pending',filled_base=NULL,entry_quote=NULL WHERE id=1; INSERT INTO agentos.live_trade_order_attempts(position_id,purpose,client_order_id,state,exchange_order_id) VALUES (1,'entry','entry_1','confirmed','499')");
  const buy=()=>db.query("SELECT agentos.record_tabdeal_entry_fill(1,'499','701',0.01,100,0.002,'BNB') result");
  assert.equal((await buy()).rows[0].result.status,'recorded');assert.equal((await buy()).rows[0].result.status,'already_recorded');
  await db.query("SELECT agentos.finalize_tabdeal_entry(1,'499','FILLED',0.01)");
  await db.query("SELECT agentos.record_tabdeal_exit_fill(1,'500','702',0.01,110,0.003,'BNB')");
  const p=(await db.query('SELECT state,has_unvalued_fees,realized_quote::text pnl FROM agentos.live_trade_positions')).rows[0];
  assert.equal(p.state,'closed');assert.equal(p.has_unvalued_fees,true);assert.equal(Number(p.pnl),10);
  const rows=(await db.query('SELECT asset,sum(debit)::text debit,sum(credit)::text credit,count(*)::int n FROM agentos.trade_external_fee_ledger GROUP BY asset')).rows;
  assert.equal(rows[0].asset,'BNB');assert.equal(rows[0].debit,rows[0].credit);assert.equal(Number(rows[0].debit),0.005);assert.equal(rows[0].n,4);
 } finally {await db.close()}
});
