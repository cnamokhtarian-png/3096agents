import { pool } from '@/db';
import { fetchTabdealTopOfBook, fetchTabdealMarketRules, placeRealOrder } from '@/lib/exchange';
import { monitorOneExit, type ExitCandidate, type ExitIntent } from '@/lib/exit-monitor-core';
import { planTabdealMarketSell } from '@/lib/tabdeal-market';
import { escapeHtml, notifyAdmin } from '@/lib/telegram';

/**
 * Server-side monitor for explicitly approved, persisted positions.
 * It only considers positions created from an explicitly approved trade job.
 * The database claim and unique client ID are saved before any network call.
 */
export async function monitorApprovedTabdealPosition(positionId: string) {
  if (!/^\d{1,18}$/.test(positionId)) throw new Error('invalid_position_id');
  const { rows } = await pool.query<{ id: string; symbol: string; remaining: string; stop_price: string; target_price: string; exit_reason: 'stop_loss' | 'take_profit' | null; next_attempt: number }>(
    `SELECT p.id::text,p.symbol,(p.filled_base-coalesce(p.exit_base,0))::text AS remaining,p.stop_price::text,p.target_price::text,p.exit_reason,
       (1+(SELECT count(*) FROM agentos.live_trade_order_attempts a WHERE a.position_id=p.id AND a.purpose='exit'))::int AS next_attempt
     FROM agentos.live_trade_positions p JOIN agentos.agent_jobs j ON j.id=p.job_id
     WHERE p.id=$1 AND p.exchange='tabdeal' AND p.quote_asset='USDT' AND p.state='open'
       AND p.filled_base > coalesce(p.exit_base,0) AND p.entry_quote > 0
       AND j.kind='trade' AND j.requires_approval=true AND j.approved_at IS NOT NULL`, [positionId]);
  if (rows.length !== 1) throw new Error('position_not_ready');
  const position: ExitCandidate = { id:rows[0].id, symbol:rows[0].symbol, remainingQuantity:rows[0].remaining,
    stopPrice:Number(rows[0].stop_price), targetPrice:Number(rows[0].target_price), exitReason:rows[0].exit_reason, nextAttempt:rows[0].next_attempt };
  const claim = async (intent: ExitIntent) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const updated = await client.query(`UPDATE agentos.live_trade_positions p SET state='exit_unknown',exit_reason=$5,updated_at=now()
         WHERE p.id=$1 AND p.state='open' AND p.filled_base-coalesce(p.exit_base,0)=$2::numeric
           AND p.stop_price=$3::numeric AND p.target_price=$4::numeric
           AND EXISTS (SELECT 1 FROM agentos.agent_jobs j WHERE j.id=p.job_id AND j.kind='trade' AND j.requires_approval=true AND j.approved_at IS NOT NULL)
           AND NOT EXISTS (SELECT 1 FROM agentos.live_trade_order_attempts a WHERE a.position_id=p.id AND a.purpose='exit' AND a.state NOT IN ('settled','rejected'))
           AND (SELECT count(*) FROM agentos.live_trade_order_attempts a WHERE a.position_id=p.id AND a.purpose='exit')=$6-1`,
        [intent.id,intent.remainingQuantity,String(intent.stopPrice),String(intent.targetPrice),intent.reason,intent.nextAttempt ?? 1]);
      if (updated.rowCount !== 1) { await client.query('ROLLBACK'); return false; }
      await client.query(`INSERT INTO agentos.live_trade_order_attempts(position_id,purpose,client_order_id,state)
        VALUES ($1,'exit',$2,'unknown')`, [intent.id,intent.clientOrderId]);
      await client.query('COMMIT');
      return true;
    } catch (error) { await client.query('ROLLBACK').catch(()=>{}); throw error; }
    finally { client.release(); }
  };
  return monitorOneExit(position, {
    quote: async symbol => { const book = await fetchTabdealTopOfBook(symbol); return { bid:book.bid,requestStartedAt:book.requestStartedAt }; },
    prepareQuantity: async (p,bid) => planTabdealMarketSell({available:p.remainingQuantity,bid:String(bid),rules:await fetchTabdealMarketRules(p.symbol)}).quantity,
    claim,
    submit: async intent => {
      const order = await placeRealOrder({ symbol:intent.symbol, side:'SELL', type:'MARKET', quantity:intent.sellQuantity,
        clientOrderId:intent.clientOrderId, exchangeOnly:'tabdeal' });
      return { orderId:order.orderId, status:order.status };
    },
    acknowledge: async (intent,result) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const updated = await client.query(`UPDATE agentos.live_trade_order_attempts SET exchange_order_id=$1,state='confirmed',updated_at=now()
          WHERE position_id=$2 AND purpose='exit' AND client_order_id=$3 AND state='unknown' AND exchange_order_id IS NULL`,
          [result.orderId,intent.id,intent.clientOrderId]);
        if (updated.rowCount !== 1) throw new Error('exit_order_changed');
        await client.query(`UPDATE agentos.live_trade_positions SET state=$2,updated_at=now() WHERE id=$1 AND state='exit_unknown'`,
          [intent.id,['REJECTED','CANCELED','EXPIRED'].includes(result.status) ? 'requires_attention' : 'exit_pending']);
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK').catch(()=>{}); throw error; }
      finally { client.release(); }
    },
    alertUnknown: async intent => {
      await notifyAdmin(`⚠️ نتیجه سفارش خروج پوزیشن #${escapeHtml(intent.id)} نامشخص است. شناسه ${escapeHtml(intent.clientOrderId)} باید در تبدیل بررسی شود؛ سفارش تکرار نمی‌شود.`);
    },
    now:()=>Date.now(), maxQuoteAgeMs:15000,
  });
}

/** Explicit opt-in batch; each position is atomically claimed before any sell. */
export async function monitorApprovedTabdealPositions(limit = 3) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 3) throw new Error('invalid_batch_size');
  const { rows } = await pool.query<{ id: string }>(
    `SELECT p.id::text FROM agentos.live_trade_positions p JOIN agentos.agent_jobs j ON j.id=p.job_id
      WHERE p.exchange='tabdeal' AND p.quote_asset='USDT' AND p.state='open'
        AND p.filled_base > coalesce(p.exit_base,0) AND p.entry_quote > 0
        AND j.kind='trade' AND j.requires_approval=true AND j.approved_at IS NOT NULL
      ORDER BY p.last_checked_at ASC NULLS FIRST, p.id ASC LIMIT $1`, [limit]);
  const results: Array<{ positionId:string; status:string }> = [];
  for (const row of rows) {
    try {
      const result = await monitorApprovedTabdealPosition(row.id);
      await pool.query('UPDATE agentos.live_trade_positions SET last_checked_at=now() WHERE id=$1', [row.id]);
      results.push({ positionId:row.id, status:result.status });
    } catch (error) {
      const code=error instanceof Error && error.message==='unsellable_market_dust' ? 'unsellable_market_dust' : 'monitor_failed';
      await pool.query(`UPDATE agentos.live_trade_positions SET last_checked_at=now(),last_error=$2,state=CASE WHEN $2='unsellable_market_dust' AND exit_reason IS NOT NULL THEN 'requires_attention' ELSE state END WHERE id=$1`, [row.id,code]).catch(()=>{});
      if (code==='unsellable_market_dust') await notifyAdmin(`⚠️ باقی‌مانده پوزیشن #${escapeHtml(row.id)} کمتر از حد مجاز فروش در تبدیل است و بسته‌شده محسوب نمی‌شود.`).catch(()=>{});
      results.push({ positionId:row.id, status:'error' });
    }
  }
  return { ok:results.every(r => !['error','unknown'].includes(r.status)), checked:results.length, results };
}
