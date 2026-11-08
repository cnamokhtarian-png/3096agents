import { pool } from '@/db';
import { notifyAdmin } from '@/lib/telegram';
import { renderCloseReport, type CloseReport } from '@/lib/trade-close-report-core';

/** At-most-once notification dispatch. Lost responses remain unknown for review. */
export async function sendPendingTradeCloseReports(limit = 3) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 5) throw new Error('invalid_batch_size');
  const claimed=await pool.query<{position_id:string}>(`WITH picked AS (
      SELECT position_id FROM agentos.trade_close_notifications WHERE state='pending'
      ORDER BY created_at,position_id FOR UPDATE SKIP LOCKED LIMIT $1
    ) UPDATE agentos.trade_close_notifications n SET state='sending',updated_at=now()
      FROM picked WHERE n.position_id=picked.position_id AND n.state='pending' RETURNING n.position_id::text`,[limit]);
  const results:Array<{positionId:string;status:string}>=[];
  for(const {position_id:id} of claimed.rows) {
    try {
      const data=await pool.query<{id:string;symbol:string;base_asset:string;filled_base:string;entry_quote:string;exit_quote:string;realized_quote:string;has_unvalued_fees:boolean}>(
        `SELECT id::text,symbol,base_asset,filled_base::text,entry_quote::text,exit_quote::text,realized_quote::text,has_unvalued_fees
         FROM agentos.live_trade_positions WHERE id=$1 AND state='closed'`,[id]);
      if(data.rows.length!==1) throw new Error('closed_position_not_found');
      const feeQuery=async(table:'trade_entry_fills'|'trade_exit_fills')=>{
        const r=await pool.query<{asset:string;amount:string}>(`SELECT fee_currency AS asset,sum(fee)::text amount FROM agentos.${table} WHERE position_id=$1 GROUP BY fee_currency ORDER BY fee_currency`,[id]);
        return r.rows;
      };
      const [entryFees,exitFees]=await Promise.all([feeQuery('trade_entry_fills'),feeQuery('trade_exit_fills')]);
      const r=data.rows[0]; const report:CloseReport={positionId:r.id,symbol:r.symbol,baseAsset:r.base_asset,filledBase:r.filled_base,
        entryCost:r.entry_quote,exitGross:r.exit_quote,realized:r.realized_quote,hasUnvaluedFees:r.has_unvalued_fees,entryFees,exitFees};
      const sent=await notifyAdmin(renderCloseReport(report));
      if(!sent.ok) throw new Error('notification_unconfirmed');
      await pool.query("UPDATE agentos.trade_close_notifications SET state='sent',updated_at=now(),last_error=NULL WHERE position_id=$1 AND state='sending'",[id]);
      results.push({positionId:id,status:'sent'});
    } catch {
      await pool.query("UPDATE agentos.trade_close_notifications SET state='unknown',updated_at=now(),last_error='notification_unconfirmed' WHERE position_id=$1 AND state='sending'",[id]);
      results.push({positionId:id,status:'unknown'});
    }
  }
  return {ok:results.every(r=>r.status==='sent'),checked:results.length,results};
}
