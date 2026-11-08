import test from 'node:test';
import assert from 'node:assert/strict';
import { tickPaper,validatePaperState } from '../src/lib/paper-monitor-core.ts';
import { readFileSync } from 'node:fs';
import Decimal from 'decimal.js';
const initial={status:'pending',budget:'1.8',stop:'90',target:'110',feeBps:'10',slippageBps:'20'};
const quote=(bid,ask=bid)=>({bid,ask,startedAt:1000});
test('virtual fee is included in budget; close nets both fees and slippage',()=>{
 const open=tickPaper(initial,quote('99','100'),2000);
 assert.equal(open.status,'open');assert.ok(new Decimal(open.entryCost).lte('1.8'));
 assert.equal(open.entry,'100.2');
 assert.equal(tickPaper(open,quote('105','106'),2000).status,'open');
 const close=tickPaper(open,quote('110','111'),2000);
 assert.equal(close.status,'closed');assert.equal(close.exit,'109.78');
 assert.ok(new Decimal(close.pnl).gt(0));
 assert.deepEqual(tickPaper(close,quote('120'),2000),close);
});
test('stop closes at observed bid not guaranteed stop price',()=>{
 const open=tickPaper(initial,quote('99','100'),2000);
 const close=tickPaper(open,quote('80','81'),2000);
 assert.equal(close.exit,'79.84');assert.ok(new Decimal(close.pnl).lt(0));
});
test('bad, crossed, stale or future quotes cannot open a position',()=>{
 for(const q of [quote('101','100'),quote('NaN'),{...quote('100'),startedAt:2100}]) assert.throws(()=>tickPaper(initial,q,2000));
 assert.throws(()=>tickPaper(initial,quote('100'),17000));
 for(const budget of ['NaN','1e2','-1',undefined]) assert.throws(()=>validatePaperState({...initial,budget}));
 assert.throws(()=>validatePaperState({...initial,feeBps:'1001'}));
});
test('paper path has no signed client or real lifecycle dependency',()=>{
 for(const file of ['src/app/api/paper/tick/route.ts','src/lib/paper-market.ts','src/lib/paper-monitor-core.ts']) {
  const source=readFileSync(file,'utf8');
  assert.doesNotMatch(source,/from\s+['"]@\/lib\/(?:exchange|jobs|exit-monitor|entry-order|coo)['"]/);
  assert.doesNotMatch(source,/placeRealOrder|signedRequest/);
 }
});
test('paper migration is isolated, RLS enabled and tick identity is unique',async()=>{
 const {PGlite}=await import('@electric-sql/pglite');
 const db=new PGlite();
 try {
  await db.exec('CREATE SCHEMA agentos');
  await db.exec(readFileSync('supabase/migrations/20261111_paper_monitor.sql','utf8'));
  await db.query('INSERT INTO agentos.paper_monitor_sessions(symbol,state) VALUES($1,$2::jsonb)',['ETHUSDT',JSON.stringify(initial)]);
  await db.exec("INSERT INTO agentos.paper_monitor_ticks(session_id,revision,observation,state) VALUES(1,1,'{}','{}')");
  await assert.rejects(db.exec("INSERT INTO agentos.paper_monitor_ticks(session_id,revision,observation,state) VALUES(1,1,'{}','{}')"),/unique/);
  const tables=await db.query("SELECT tablename,rowsecurity FROM pg_tables WHERE schemaname='agentos'");
  assert.equal(tables.rows.length,2);assert.ok(tables.rows.every(r=>r.rowsecurity));
 } finally {await db.close();}
});
