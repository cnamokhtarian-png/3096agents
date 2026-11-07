-- =========================================================================
-- ریست کامل داده‌های نمایشی/آزمایشی (Mock) → شروع واقعی از صفر
-- =========================================================================
-- چه چیزی پاک می‌شود؟
--   • همه تراکنش‌های درآمد/برداشت با هش ساختگی یا مبلغ نمایشی
--   • همه لاگ‌ها و دفتر فعالیت (که از اجراهای تستی ساخته شده بودند)
--   • کل صف کار (Job Queue) شامل کارهای failed قدیمی
--   • امتیازها و جوایز لیدربورد (score events / monthly awards)
--   • سیگنال‌ها و پوزیشن‌های paper/تستی
--   • پروژه‌ها، تسک‌ها و پیام‌های نمونه
--   • آمار ایجنت‌ها → صفر (درآمد، تعداد تسک، موفق، خطا)
--
-- چه چیزی حفظ می‌شود؟
--   • ساختار جدول‌ها (DDL دست‌نخورده)
--   • کارمندان و دفترهایشان (فقط شمارنده‌ها صفر می‌شوند)
--   • کلیدها/تنظیمات واقعی: کیف پول واحد، کلید صرافی، جمینای، تلگرام
--     (تنظیمات نمایشی/orphan مثل trader_* و leaderboard_* حذف می‌شوند)
--   • اسنپ‌شات‌های قیمت بازار (داده واقعی بیرونی، نه درآمد)
--
-- اجرا: یک‌بار در SQL Editor سوپابیس. کل اسکریپت اتمیک (تراکنش) است.
-- =========================================================================

BEGIN;

-- ۰) حذف کارهای ناموفق/آزمایشی صف (با تریگر تلگرام هم همگام می‌شود)
DELETE FROM agentos.agent_jobs;

-- ۱) تراکنش‌ها: هیچ درآمد/برداشت قبلی معتبر نبود (همه هش کوتاه/نمایشی داشتند)
DELETE FROM agentos.transactions;

-- ۲) امتیازها و جوایز لیدربورد (اگر جدول‌ها وجود داشته باشند)
DO $$
BEGIN
  IF to_regclass('agentos.agent_score_events') IS NOT NULL THEN
    EXECUTE 'DELETE FROM agentos.agent_score_events';
  END IF;
  IF to_regclass('agentos.agent_monthly_awards') IS NOT NULL THEN
    EXECUTE 'DELETE FROM agentos.agent_monthly_awards';
  END IF;
  IF to_regclass('agentos.trade_signals') IS NOT NULL THEN
    EXECUTE 'DELETE FROM agentos.trade_signals';
  END IF;
  IF to_regclass('agentos.trade_positions') IS NOT NULL THEN
    EXECUTE 'DELETE FROM agentos.trade_positions';
  END IF;
  IF to_regclass('agentos.agent_journal') IS NOT NULL THEN
    EXECUTE 'DELETE FROM agentos.agent_journal';
  END IF;
END
$$;

-- ۳) سفارش‌های صرافی و لاگ‌های اجرا/ابزار
DELETE FROM agentos.exchange_orders;
DELETE FROM agentos.agent_activity_logs;
DELETE FROM agentos.agent_logs;
DELETE FROM agentos.tool_runs;
DELETE FROM agentos.cron_runs;
DELETE FROM agentos.system_events;
DELETE FROM agentos.telegram_updates;

-- ۴) داده‌های عملیاتی نمونه (پروژه/تسک/پیام)
DELETE FROM agentos.tasks;
DELETE FROM agentos.messages;
DELETE FROM agentos.projects;

-- ۵) شمارنده‌های هر کارمند → صفر (درآمد از این پس فقط از تراکنش تأییدشده)
UPDATE agentos.agents
   SET earned_usdt = 0,
       tasks_completed = 0,
       success_count = 0,
       error_count = 0,
       last_active_at = NULL;

-- ۶) حذف تنظیمات نمایشی/orphan — کلیدهای واقعی دست‌نخورده می‌مانند
DELETE FROM agentos.settings
 WHERE key IN (
   'hitl_financial_lock',      -- با هر استارت‌آپ دوباره ساخته می‌شود
   'trader_capital_usdt',      -- سرمایه‌ی نمایشی ۲۵۰۰ USDT
   'trader_mode',              -- paper
   'trader_enabled',
   'trader_auto_close',
   'trader_symbol',
   'trader_max_open_positions',
   'trader_max_position_usdt',
   'trader_max_risk_usdt',
   'trader_max_leverage',
   'trader_min_rr',
   'trader_min_confidence',
   'trader_min_fear_greed',
   'trader_max_fear_greed',
   'trader_max_hold_hours',
   'trader_max_volatility_pct',
   'trade_signal_drop_pct',
   'leaderboard_boost_multiplier',
   'leaderboard_duration_target',
   'leaderboard_revenue_target',
   'leaderboard_weight_revenue',
   'leaderboard_weight_speed',
   'leaderboard_weight_success',
   'a1_last_btc',
   'a6_last_alert',
   'bounty_seen',
   'bot_status',
   'ticker_at',
   'ticker_cache'
 );

COMMIT;

-- بررسی نتیجه (باید همه صفر باشند):
-- SELECT name, earned_usdt, tasks_completed, success_count, error_count FROM agentos.agents ORDER BY id;
-- SELECT (SELECT COUNT(*) FROM agentos.transactions) AS tx,
--        (SELECT COUNT(*) FROM agentos.agent_jobs) AS jobs,
--        (SELECT COUNT(*) FROM agentos.agent_activity_logs) AS activity,
--        (SELECT COALESCE(SUM(earned_usdt),0) FROM agentos.agents) AS fleet_total;
