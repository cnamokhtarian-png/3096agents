import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { pool } from '@/db';
import { guardAdmin } from '@/lib/auth';
import { ENV } from '@/lib/env';
import { readPaperBook } from '@/lib/paper-market';
import { tickPaper, validatePaperState, type PaperState } from '@/lib/paper-monitor-core';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

function enabled() { return process.env.PAPER_MONITOR_ENABLED === 'true'; }
function cronAllowed(req: NextRequest) {
  const secret = ENV.cronSecret();
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i,'') ?? '';
  return Boolean(secret && token && Buffer.byteLength(secret) === Buffer.byteLength(token) && timingSafeEqual(Buffer.from(secret),Buffer.from(token)));
}
/** Explicit admin-only virtual setup. Does not create a real job or approval. */
export async function POST(req: NextRequest) {
  const denied = guardAdmin(req); if (denied) return denied;
  if (!enabled()) return NextResponse.json({ok:false,error:'paper_monitor_disabled'},{status:409});
  try {
    const body = await req.json();
    const symbol = body.symbol;
    if (typeof symbol !== 'string' || !/^[A-Z0-9]{2,25}USDT$/.test(symbol)) throw new Error('invalid_symbol');
    const state: PaperState = {status:'pending',budget:body.budget,stop:body.stop,target:body.target,feeBps:body.feeBps,slippageBps:body.slippageBps};
    validatePaperState(state);
    const {rows} = await pool.query('INSERT INTO agentos.paper_monitor_sessions(symbol,state) VALUES($1,$2::jsonb) RETURNING id::text',[symbol,JSON.stringify(state)]);
    return NextResponse.json({ok:true,paperOnly:true,id:rows[0].id},{status:201});
  } catch { return NextResponse.json({ok:false,error:'paper_setup_failed'},{status:400}); }
}
/** Dedicated paper-only cron. Never calls the real cron/queue/fleet or order client. */
export async function GET(req: NextRequest) {
  if (!cronAllowed(req)) return NextResponse.json({ok:false,error:'unauthorized'},{status:401});
  if (!enabled()) return NextResponse.json({ok:false,error:'paper_monitor_disabled'},{status:409});
  try {
    const {rows} = await pool.query<{id:string;symbol:string;state:PaperState;revision:number}>(`
      SELECT id::text,symbol,state,revision FROM agentos.paper_monitor_sessions
      WHERE state->>'status' IN ('pending','open')
        AND (last_tick IS NULL OR last_tick < now()-interval '50 seconds')
      ORDER BY last_tick ASC NULLS FIRST,id LIMIT 2`);
    const results: Array<{id:string;ok:boolean;status?:string;error?:string}> = [];
    for (const row of rows) {
      try {
        const quote = await readPaperBook(row.symbol);
        const state = tickPaper(row.state,quote,Date.now());
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const changed = await client.query(`UPDATE agentos.paper_monitor_sessions SET state=$1::jsonb,revision=revision+1,last_tick=now()
            WHERE id=$2 AND revision=$3 AND (last_tick IS NULL OR last_tick<now()-interval '50 seconds') RETURNING revision`,[JSON.stringify(state),row.id,row.revision]);
          if (changed.rowCount === 1) await client.query('INSERT INTO agentos.paper_monitor_ticks(session_id,revision,observation,state) VALUES($1,$2,$3::jsonb,$4::jsonb)',[row.id,changed.rows[0].revision,JSON.stringify({...quote,source:'tabdeal-public-depth',feeModel:'hypothetical-quote-fee',exchangeLimitsChecked:false}),JSON.stringify(state)]);
          await client.query('COMMIT');
          results.push({id:row.id,ok:true,status:changed.rowCount === 1 ? state.status : 'concurrent_tick_skipped'});
        } catch (e) { await client.query('ROLLBACK').catch(()=>{}); throw e; }
        finally {client.release();}
      } catch {
        // Persist a bounded failure event and move the session to the back of the
        // queue. A permanently bad symbol must not starve other sessions.
        await pool.query(`WITH changed AS (
          UPDATE agentos.paper_monitor_sessions SET revision=revision+1,last_tick=now()
          WHERE id=$1 AND revision=$2 RETURNING id,revision,state
        ) INSERT INTO agentos.paper_monitor_ticks(session_id,revision,observation,state)
          SELECT id,revision,'{"error":"paper_tick_failed"}'::jsonb,state FROM changed`,[row.id,row.revision]);
        results.push({id:row.id,ok:false,error:'paper_tick_failed'});
      }
    }
    const ok = results.every(r=>r.ok);
    return NextResponse.json({ok,paperOnly:true,actualOrders:0,results},{status:ok?200:503});
  } catch { return NextResponse.json({ok:false,paperOnly:true,error:'paper_database_unavailable'},{status:503}); }
}
