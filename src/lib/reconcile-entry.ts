import { pool } from '@/db';
import { fetchTabdealOrderTrades, findTabdealOrder, cancelTabdealOrder } from '@/lib/exchange';
import { settleEntryOrderStatus } from '@/lib/entry-order-status';
import { reconcileEntryFills, type EntryPosition } from '@/lib/reconcile-entry-core';

/** Reconcile linked BUY fills; cancel stale or partly-filled entries before opening the actual position. */
export async function reconcileTabdealEntry(positionId: string) {
  if (!/^\d{1,18}$/.test(positionId)) throw new Error('invalid_position_id');
  const { rows } = await pool.query<{ id: string; symbol: string; exchange_order_id: string; client_order_id: string; quote_asset: string; base_asset: string; created_at: Date }>(
    `SELECT p.id::text,p.symbol,a.exchange_order_id,a.client_order_id,p.quote_asset,p.base_asset,a.created_at
     FROM agentos.live_trade_positions p JOIN agentos.live_trade_order_attempts a ON a.position_id=p.id
     WHERE p.id=$1 AND p.exchange='tabdeal' AND a.purpose='entry'
     AND a.state IN ('submitted','confirmed','unknown') AND a.exchange_order_id IS NOT NULL`, [positionId]);
  if (rows.length !== 1 || !/^\d{1,30}$/.test(rows[0].exchange_order_id)) throw new Error('entry_order_not_linked');
  const p: EntryPosition = { id:rows[0].id, symbol:rows[0].symbol, exchangeOrderId:rows[0].exchange_order_id,
    quoteAsset:rows[0].quote_asset, baseAsset:rows[0].base_asset };
  const lookup = async () => {
    const order = await findTabdealOrder(p.symbol, rows[0].client_order_id);
    if (String(order?.symbol || '') !== p.symbol || String(order?.side || '') !== 'BUY' ||
        String(order?.clientOrderId || '') !== rows[0].client_order_id || String(order?.orderId ?? '') !== p.exchangeOrderId) throw new Error('entry_order_mismatch');
    if (!/^[0-9]+(?:\.[0-9]+)?$/.test(String(order.executedQty ?? ''))) throw new Error('invalid_entry_order');
    return order as { status: string; executedQty: string };
  };
  const order = await settleEntryOrderStatus({order:await lookup(), createdAtMs:new Date(rows[0].created_at).getTime(), nowMs:Date.now(), maxOpenMs:60000}, {
    cancel:()=>cancelTabdealOrder(p.symbol,rows[0].client_order_id), lookup,
  });
  const status = String(order.status || '');
  const executed = String(order.executedQty ?? '');
  const result = await reconcileEntryFills(p, {
    fetchFills: position => fetchTabdealOrderTrades(position.symbol, position.exchangeOrderId, 'BUY'),
    recordFill: async (position, fill) => {
      const result = await pool.query<{ result: { status: 'recorded' | 'already_recorded' } }>(
        'SELECT agentos.record_tabdeal_entry_fill($1::bigint,$2::text,$3::text,$4::numeric,$5::numeric,$6::numeric,$7::text) AS result',
        [position.id,fill.orderId,fill.tradeId,fill.quantity,fill.quoteQuantity,fill.commission,fill.commissionAsset]);
      if (result.rows.length !== 1) throw new Error('ambiguous_settlement_result');
      return result.rows[0].result;
    },
  });
  if (!['FILLED','CANCELED','REJECTED','EXPIRED'].includes(status)) {
    if (!['NEW','PARTIALLY_FILLED'].includes(status)) throw new Error('invalid_entry_order');
    return { ...result, state: 'entry_pending' };
  }
  const finalized = await pool.query<{ result: { status: string } }>(
    'SELECT agentos.finalize_tabdeal_entry($1::bigint,$2::text,$3::text,$4::numeric) AS result',
    [p.id,p.exchangeOrderId,status,executed]);
  if (finalized.rows.length !== 1) throw new Error('ambiguous_entry_finalization');
  return { ...result, state: finalized.rows[0].result.status };
}

/** Reconcile existing entry attempts, including an ambiguous submission, without resending a buy. */
export async function reconcilePendingTabdealEntries(limit = 3) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 5) throw new Error('invalid_batch_size');
  const { rows } = await pool.query<{ id: string; client_order_id: string; exchange_order_id: string | null; symbol: string }>(
    `SELECT p.id::text,a.client_order_id,a.exchange_order_id,p.symbol
       FROM agentos.live_trade_positions p JOIN agentos.live_trade_order_attempts a ON a.position_id=p.id
      WHERE p.exchange='tabdeal' AND p.state IN ('entry_pending','entry_unknown','requires_attention')
        AND a.purpose='entry' AND a.state IN ('submitted','confirmed','unknown')
        AND (p.last_error IS NULL OR p.last_error <> 'entry_without_fills')
      ORDER BY p.last_checked_at ASC NULLS FIRST,p.id ASC LIMIT $1`, [limit]);
  const results: Array<{ positionId: string; ok: boolean; state?: string; error?: string }> = [];
  for (const row of rows) {
    try {
      if (!row.exchange_order_id) {
        const order = await findTabdealOrder(row.symbol,row.client_order_id);
        if (String(order?.symbol || '') !== row.symbol || String(order?.clientOrderId || '') !== row.client_order_id ||
            String(order?.side || '') !== 'BUY' || !/^\d{1,30}$/.test(String(order?.orderId ?? ''))) throw new Error('unknown_entry_order');
        const updated = await pool.query(`UPDATE agentos.live_trade_order_attempts SET exchange_order_id=$1,state='confirmed',updated_at=now()
          WHERE position_id=$2 AND purpose='entry' AND client_order_id=$3 AND exchange_order_id IS NULL`,
          [String(order.orderId),row.id,row.client_order_id]);
        if (updated.rowCount !== 1) throw new Error('entry_order_changed');
      }
      const result = await reconcileTabdealEntry(row.id);
      await pool.query("UPDATE agentos.live_trade_positions SET last_checked_at=now(),last_error=CASE WHEN state='requires_attention' THEN last_error ELSE NULL END WHERE id=$1", [row.id]);
      results.push({ positionId:row.id,ok:true,state:result.state });
    } catch (error) {
      const code = error instanceof Error && /^[a-z0-9_]{1,80}$/.test(error.message) ? error.message : 'entry_reconcile_failed';
      await pool.query('UPDATE agentos.live_trade_positions SET last_checked_at=now(),last_error=$2 WHERE id=$1', [row.id,code]).catch(()=>{});
      results.push({ positionId:row.id,ok:false,error:code });
    }
  }
  return { ok:results.every(r=>r.ok),checked:results.length,results };
}
