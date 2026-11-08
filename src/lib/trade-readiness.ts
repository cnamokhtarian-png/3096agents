import { pool } from '@/db';
import { ENV } from '@/lib/env';
import { protectedTradeBlocker } from '@/lib/trade-protection';

/** Fail closed before accepting new exposure. Existing exits remain recoverable
 * even if new entries are disabled. This does not certify scheduler liveness. */
export async function protectedTradeReadiness() {
  if (process.env.TRADE_LIFECYCLE_ENABLED !== 'true') return protectedTradeBlocker();
  if (process.env.ARIA_EXECUTION_MODE !== 'live') return {
    code:'aria_observe_only', label:'آریا در حالت پایش بدون سفارش است',
    missing:['ARIA_EXECUTION_MODE=live'], action:'فعال‌سازی معامله واقعی مستقل از استقرار کد است.',
  };
  if (!ENV.cronSecret()) return {
    code: 'trade_scheduler_unconfigured', label: 'کلید زمان‌بند آریا تنظیم نشده است',
    missing: ['CRON_SECRET'], action: 'کلید امن و زمان‌بند بیرونی آریا را پیکربندی کنید.',
  };
  try {
    const { rows } = await pool.query<{ ready: boolean }>(`
      SELECT count(*)=4 AND bool_and(coalesce(has_function_privilege(current_user, oid, 'EXECUTE'),false)) AS ready
      FROM pg_proc WHERE oid IN (
        to_regprocedure('agentos.record_tabdeal_entry_fill(bigint,text,text,numeric,numeric,numeric,text)'),
        to_regprocedure('agentos.finalize_tabdeal_entry(bigint,text,text,numeric)'),
        to_regprocedure('agentos.record_tabdeal_exit_fill(bigint,text,text,numeric,numeric,numeric,text)'),
        to_regprocedure('agentos.finalize_tabdeal_exit_attempt(bigint,text,text,numeric)'))`);
    if (rows[0]?.ready === true) return null;
  } catch { /* Never expose connection strings or SQL errors to the caller. */ }
  return {
    code: 'trade_accounting_not_ready', label: 'توابع تسویه یا مجوز اجرای دیتابیس آماده نیست',
    missing: ['trade migrations / EXECUTE'], action: 'مهاجرت‌های ورود و خروج و مجوز نقش اجرایی را بررسی کنید.',
  };
}
