import { pool } from '@/db';
import { fetchTabdealMarketRules, placeRealOrder } from '@/lib/exchange';
import { validateTabdealLimitBuy } from '@/lib/tabdeal-market';
import { submitOneApprovedEntry, type EntryIntent } from '@/lib/entry-order-core';
import { escapeHtml, notifyAdmin } from '@/lib/telegram';

/** Send only the exact price-capped LIMIT intent in an individually approved
 * job. A DB claim persists an unknown attempt before the exchange call. */
export async function submitApprovedTabdealEntry(jobId: number) {
  if (!Number.isSafeInteger(jobId) || jobId <= 0) throw new Error('invalid_job_id');
  const data = await pool.query<{ payload: Record<string, unknown> }>(
    `SELECT payload FROM agentos.agent_jobs WHERE id=$1 AND kind='trade' AND requires_approval=true AND approved_at IS NOT NULL AND status='running'`, [jobId]);
  if (data.rows.length !== 1) throw new Error('approved_trade_not_found');
  const p = data.rows[0].payload;
  const text = (key: string) => String(p?.[key] ?? '');
  if (text('side') !== 'BUY' || text('type') !== 'LIMIT') throw new Error('approved_limit_buy_required');
  const symbol = text('symbol');
  const rules = await fetchTabdealMarketRules(symbol);
  const quantity=text('quantity'),price=text('price'),budget=text('budgetUsdt'),stopPrice=text('stopLoss'),targetPrice=text('takeProfit');
  validateTabdealLimitBuy({quantity,price,budget,stopPrice,targetPrice,rules});
  const intent: EntryIntent = {jobId,symbol,baseAsset:rules.baseAsset,quoteAsset:rules.quoteAsset,quantity,price,budget,stopPrice,targetPrice,clientOrderId:`entry_${jobId}`};
  return submitOneApprovedEntry(intent, {
    claim: async i => {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        // Match the persisted approval payload, not just values passed by the caller.
        const inserted = await c.query<{id:string}>(`INSERT INTO agentos.live_trade_positions(job_id,exchange,symbol,base_asset,quote_asset,state,requested_quote,stop_price,target_price)
          SELECT j.id,'tabdeal',$2,$3,$4,'entry_unknown',$5::numeric,$6::numeric,$7::numeric FROM agentos.agent_jobs j
          WHERE j.id=$1 AND j.kind='trade' AND j.status='running' AND j.requires_approval=true AND j.approved_at IS NOT NULL
            AND j.payload->>'symbol'=$2 AND j.payload->>'side'='BUY' AND j.payload->>'type'='LIMIT'
            AND j.payload->>'quantity'=$8 AND j.payload->>'price'=$9 AND j.payload->>'budgetUsdt'=$5
            AND j.payload->>'stopLoss'=$6 AND j.payload->>'takeProfit'=$7
          ON CONFLICT (job_id) DO NOTHING RETURNING id::text`,
          [i.jobId,i.symbol,i.baseAsset,i.quoteAsset,i.budget,i.stopPrice,i.targetPrice,i.quantity,i.price]);
        if (inserted.rows.length !== 1) { await c.query('ROLLBACK'); return false; }
        await c.query(`INSERT INTO agentos.live_trade_order_attempts(position_id,purpose,client_order_id,state) VALUES ($1,'entry',$2,'unknown')`,[inserted.rows[0].id,i.clientOrderId]);
        await c.query('COMMIT'); return true;
      } catch (e) { await c.query('ROLLBACK').catch(()=>{}); throw e; }
      finally { c.release(); }
    },
    submit: async i => {
      const order = await placeRealOrder({ symbol:i.symbol,side:'BUY',type:'LIMIT',quantity:i.quantity,price:i.price,clientOrderId:i.clientOrderId,exchangeOnly:'tabdeal' });
      return {orderId:order.orderId,status:order.status};
    },
    acknowledge: async (i,order) => {
      const c=await pool.connect();
      try {
        await c.query('BEGIN');
        const changed=await c.query(`UPDATE agentos.live_trade_order_attempts a SET exchange_order_id=$1,state='confirmed',updated_at=now()
          FROM agentos.live_trade_positions p WHERE a.position_id=p.id AND p.job_id=$2 AND a.purpose='entry'
            AND a.client_order_id=$3 AND a.state='unknown' AND a.exchange_order_id IS NULL RETURNING p.id`,[order.orderId,i.jobId,i.clientOrderId]);
        if (changed.rowCount !== 1) throw new Error('entry_order_changed');
        await c.query(`UPDATE agentos.live_trade_positions SET state='entry_pending',updated_at=now() WHERE job_id=$1 AND state='entry_unknown'`,[i.jobId]);
        await c.query('COMMIT');
      } catch(e) { await c.query('ROLLBACK').catch(()=>{}); throw e; }
      finally {c.release();}
    },
    alertUnknown: async i => { await notifyAdmin(`⚠️ نتیجه سفارش ورود #${i.jobId} نامشخص است. شناسه ${escapeHtml(i.clientOrderId)} در تبدیل استعلام می‌شود و سفارش دوباره ارسال نخواهد شد.`); },
  });
}
