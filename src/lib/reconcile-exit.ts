import { pool } from '@/db';
import { fetchTabdealOrderTrades, findTabdealOrder, cancelTabdealOrder } from '@/lib/exchange';
import { settleEntryOrderStatus } from '@/lib/entry-order-status';
import { reconcileExitFills, type ExitPosition, type FillResult } from '@/lib/reconcile-exit-core';

/**
 * Reconcile a persisted exit order by position ID. No order submission and no
 * scheduling is performed here. Requires both live-trade migrations and a DB
 * role explicitly authorized to execute the invoker-only accounting function.
 */
export async function reconcileTabdealExit(positionId: string) {
  if (!/^\d{1,18}$/.test(positionId)) throw new Error('invalid_position_id');
  const { rows } = await pool.query<{ id: string; symbol: string; exchange_order_id: string; quote_asset: string; base_asset: string; client_order_id: string; created_at: Date }>(
    `SELECT p.id::text, p.symbol, a.exchange_order_id, p.quote_asset, p.base_asset, a.client_order_id, a.created_at
       FROM agentos.live_trade_positions p JOIN agentos.live_trade_order_attempts a ON a.position_id = p.id
      WHERE p.id = $1 AND p.exchange = 'tabdeal' AND a.purpose = 'exit'
        AND a.state IN ('submitted','confirmed','unknown') AND a.exchange_order_id IS NOT NULL`, [positionId]);
  if (rows.length !== 1 || !/^\d{1,30}$/.test(rows[0].exchange_order_id)) throw new Error('exit_order_not_linked');
  const position: ExitPosition = { id: rows[0].id, symbol: rows[0].symbol, exchangeOrderId: rows[0].exchange_order_id, quoteAsset: rows[0].quote_asset, baseAsset: rows[0].base_asset };
  const lookup = async () => {
    const order = await findTabdealOrder(position.symbol,rows[0].client_order_id);
    if (String(order?.symbol || '') !== position.symbol || String(order?.side || '') !== 'SELL' ||
        String(order?.clientOrderId || '') !== rows[0].client_order_id || String(order?.orderId ?? '') !== position.exchangeOrderId) throw new Error('exit_order_mismatch');
    if (!/^[0-9]+(?:\.[0-9]+)?$/.test(String(order.executedQty ?? ''))) throw new Error('invalid_exit_order');
    return order as {status:string;executedQty:string};
  };
  const order=await settleEntryOrderStatus({order:await lookup(),createdAtMs:new Date(rows[0].created_at).getTime(),nowMs:Date.now(),maxOpenMs:60000}, {
    cancel:()=>cancelTabdealOrder(position.symbol,rows[0].client_order_id),lookup,
  });
  const result = await reconcileExitFills(position, {
    fetchFills: p => fetchTabdealOrderTrades(p.symbol, p.exchangeOrderId, 'SELL'),
    recordFill: async (p, fill) => {
      const r = await pool.query<{ result: FillResult }>(
        'SELECT agentos.record_tabdeal_exit_fill($1::bigint,$2::text,$3::text,$4::numeric,$5::numeric,$6::numeric,$7::text) AS result',
        [p.id, fill.orderId, fill.tradeId, fill.quantity, fill.quoteQuantity, fill.commission, fill.commissionAsset]);
      if (r.rows.length !== 1) throw new Error('ambiguous_settlement_result');
      return r.rows[0].result;
    },
  });
  if (!['FILLED','CANCELED','REJECTED','EXPIRED'].includes(order.status)) return {...result,state:'exit_pending'};
  const finalized=await pool.query<{ result: { position_state: string } }>(
    'SELECT agentos.finalize_tabdeal_exit_attempt($1::bigint,$2::text,$3::text,$4::numeric) AS result',
    [position.id,position.exchangeOrderId,order.status,String(order.executedQty)]);
  if(finalized.rows.length!==1) throw new Error('ambiguous_exit_finalization');
  return {...result,state:finalized.rows[0].result.position_state};
}

/** Reconcile at most a small batch; never submits or retries any exchange sell. */
export async function reconcilePendingTabdealExits(limit = 3) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 5) throw new Error('invalid_batch_size');
  const { rows } = await pool.query<{ id: string; client_order_id: string; exchange_order_id: string | null; symbol: string }>(
    `SELECT p.id::text, a.client_order_id, a.exchange_order_id, p.symbol
       FROM agentos.live_trade_positions p JOIN agentos.live_trade_order_attempts a ON a.position_id = p.id
      WHERE p.exchange = 'tabdeal' AND p.state IN ('exit_pending','exit_unknown','requires_attention','closed')
        AND a.purpose = 'exit' AND a.state IN ('submitted','confirmed','unknown')
      ORDER BY p.last_checked_at ASC NULLS FIRST, p.id ASC LIMIT $1`, [limit]);
  const results: Array<{ positionId: string; ok: boolean; fills?: number; error?: string }> = [];
  for (const row of rows) {
    try {
      if (!row.exchange_order_id) {
        // A timeout is ambiguous. Query the persisted client ID instead of
        // submitting a second sell. No match remains unknown for review.
        const order = await findTabdealOrder(row.symbol, row.client_order_id);
        if (String(order?.symbol || '') !== row.symbol || String(order?.clientOrderId || '') !== row.client_order_id ||
            String(order?.side || '') !== 'SELL' || !/^\d{1,30}$/.test(String(order?.orderId ?? ''))) {
          throw new Error('unknown_exit_order');
        }
        const updated = await pool.query(
          `UPDATE agentos.live_trade_order_attempts SET exchange_order_id = $1, state = 'confirmed', updated_at = now()
            WHERE position_id = $2 AND purpose = 'exit' AND client_order_id = $3 AND exchange_order_id IS NULL`,
          [String(order.orderId), row.id, row.client_order_id]);
        if (updated.rowCount !== 1) throw new Error('exit_order_changed');
      }
      const result = await reconcileTabdealExit(row.id);
      await pool.query("UPDATE agentos.live_trade_positions SET last_checked_at=now(),last_error=CASE WHEN state='requires_attention' THEN last_error ELSE NULL END WHERE id=$1", [row.id]);
      results.push({ positionId: row.id, ok: true, fills: result.fills.length });
    } catch (error) {
      // Store bounded error codes only. A failure is not a closed position.
      const code = error instanceof Error && /^[a-z0-9_]{1,80}$/.test(error.message) ? error.message : 'reconcile_failed';
      await pool.query('UPDATE agentos.live_trade_positions SET last_checked_at = now(), last_error = $2 WHERE id = $1', [row.id, code]).catch(()=>{});
      results.push({ positionId: row.id, ok: false, error: code });
    }
  }
  return { ok: results.every(r => r.ok), checked: results.length, results };
}
