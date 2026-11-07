-- =========================================================================
-- Freelance & Crypto Agent OS — Supabase PostgreSQL / production schema
-- =========================================================================
-- این فایل «واقعی» است: هیچ داده‌ی ساختگی در آن درج نمی‌شود. فقط ساختار
-- جدول‌ها، ایندکس‌ها و توابع دیتابیس ساخته می‌شوند. درآمد، تراکنش و لاگ
-- تنها زمانی ثبت می‌شود که یک رویداد واقعی (پاسخ صرافی، تأیید مدیر یا
-- وبهوک تلگرام) رخ دهد.
--
-- اسکیمای public متعلق به اپ دیگری است؛ همه‌چیز داخل اسکیمای `agentos`.
--
-- نحوه استفاده (یک‌بار در SQL Editor سوپابیس، idempotent است):
--   ۱. (اختیاری) CREATE ROLE agentos WITH LOGIN PASSWORD '...';
--   ۲. کل این فایل را Run کنید.
--   ۳. DATABASE_URL را با یوزر agentos.<ref> روی پولر پورت 6543 ست کنید.
-- =========================================================================

CREATE SCHEMA IF NOT EXISTS agentos;

-- -------------------------------------------------------------------------
-- ۱) جدول‌های پایه (نسخه اولیه — برای سازگاری با نصب‌های موجود)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agentos.users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agentos.agents (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL,
  specialty TEXT NOT NULL DEFAULT 'crypto',
  avatar TEXT NOT NULL DEFAULT '🤖',
  status TEXT NOT NULL DEFAULT 'active',
  api_endpoint TEXT NOT NULL DEFAULT '/api/agents/ingest',
  api_key TEXT NOT NULL,
  earned_usdt REAL NOT NULL DEFAULT 0,
  tasks_completed INTEGER NOT NULL DEFAULT 0,
  payout_mode TEXT NOT NULL DEFAULT 'auto_unified',
  strategy TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agentos.projects (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  client_name TEXT NOT NULL,
  telegram_user TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'تلگرام',
  type TEXT NOT NULL DEFAULT 'nextjs',
  status TEXT NOT NULL DEFAULT 'new',
  priority TEXT NOT NULL DEFAULT 'medium',
  budget_usdt REAL NOT NULL DEFAULT 0,
  received_usdt REAL NOT NULL DEFAULT 0,
  wallet TEXT NOT NULL DEFAULT '',
  deadline TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agentos.tasks (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  agent TEXT NOT NULL DEFAULT 'ایجنت مذاکره',
  action_type TEXT NOT NULL DEFAULT 'send_message',
  description TEXT NOT NULL DEFAULT '',
  project_title TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  risk TEXT NOT NULL DEFAULT 'medium',
  payload TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agentos.messages (
  id SERIAL PRIMARY KEY,
  chat_id TEXT NOT NULL DEFAULT '',
  client_name TEXT NOT NULL,
  username TEXT NOT NULL DEFAULT '',
  direction TEXT NOT NULL DEFAULT 'in',
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'read',
  source TEXT NOT NULL DEFAULT 'telegram',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agentos.transactions (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  project_title TEXT NOT NULL DEFAULT '',
  agent_name TEXT NOT NULL DEFAULT 'سیستم مرکزی',
  destination_wallet TEXT NOT NULL DEFAULT '',
  amount_usdt REAL NOT NULL DEFAULT 0,
  network TEXT NOT NULL DEFAULT 'TRC20',
  tx_hash TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'income',
  status TEXT NOT NULL DEFAULT 'confirmed',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agentos.agent_logs (
  id SERIAL PRIMARY KEY,
  agent TEXT NOT NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'success',
  detail TEXT NOT NULL DEFAULT '',
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agentos.tool_runs (
  id SERIAL PRIMARY KEY,
  tool TEXT NOT NULL,
  input TEXT NOT NULL DEFAULT '',
  output TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'done',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agentos.settings (
  id SERIAL PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  value TEXT NOT NULL DEFAULT ''
);

-- -------------------------------------------------------------------------
-- ۲) ستون‌های جدید: هدف هر کارمند، اتاق اداری، شمارنده موفقیت/خطا
-- -------------------------------------------------------------------------
ALTER TABLE agentos.agents ADD COLUMN IF NOT EXISTS department TEXT NOT NULL DEFAULT '';
ALTER TABLE agentos.agents ADD COLUMN IF NOT EXISTS goal_title TEXT NOT NULL DEFAULT '';
ALTER TABLE agentos.agents ADD COLUMN IF NOT EXISTS goal_target_usdt REAL NOT NULL DEFAULT 0;
ALTER TABLE agentos.agents ADD COLUMN IF NOT EXISTS office_floor TEXT NOT NULL DEFAULT '1';
ALTER TABLE agentos.agents ADD COLUMN IF NOT EXISTS office_room TEXT NOT NULL DEFAULT '';
ALTER TABLE agentos.agents ADD COLUMN IF NOT EXISTS current_focus TEXT NOT NULL DEFAULT '';
ALTER TABLE agentos.agents ADD COLUMN IF NOT EXISTS success_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agentos.agents ADD COLUMN IF NOT EXISTS error_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agentos.agents ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ;

ALTER TABLE agentos.transactions ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE agentos.transactions ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE agentos.transactions ADD COLUMN IF NOT EXISTS reference TEXT NOT NULL DEFAULT '';
ALTER TABLE agentos.transactions ADD COLUMN IF NOT EXISTS job_id INTEGER;

-- -------------------------------------------------------------------------
-- ۳) دفتر رویدادهای واقعی ایجنت (Revenue & Execution Ledger)
--    هر ردیف = یک اجرای واقعی که یا پاداش واقعی دارد یا خطای واقعی.
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agentos.agent_activity_logs (
  id BIGSERIAL PRIMARY KEY,
  agent_id INTEGER,
  agent_name TEXT NOT NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'success',       -- success | failed | pending | skipped
  detail TEXT NOT NULL DEFAULT '',
  reward_usdt REAL NOT NULL DEFAULT 0,          -- فقط مبلغِ واقعاً محقق‌شده
  tx_hash TEXT NOT NULL DEFAULT '',
  job_id INTEGER,
  source TEXT NOT NULL DEFAULT 'system',        -- panel | telegram | ingest | exchange | cron
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS agent_activity_logs_agent_idx
  ON agentos.agent_activity_logs (agent_name, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_activity_logs_job_idx
  ON agentos.agent_activity_logs (job_id);

-- -------------------------------------------------------------------------
-- ۴) صف واقعی کار (Job Queue) + گردش‌کار تایید انسانی
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agentos.agent_jobs (
  id SERIAL PRIMARY KEY,
  agent_id INTEGER,
  agent_name TEXT NOT NULL,
  kind TEXT NOT NULL,                            -- trade | confirm_deposit | tool_run | status_report | withdraw
  title TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'queued',         -- queued | awaiting_approval | approved | running | succeeded | failed | rejected
  risk TEXT NOT NULL DEFAULT 'medium',
  requires_approval BOOLEAN NOT NULL DEFAULT TRUE,
  attempts INTEGER NOT NULL DEFAULT 0,
  result JSONB,
  error TEXT NOT NULL DEFAULT '',
  approved_by TEXT NOT NULL DEFAULT '',
  approved_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  telegram_message_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS agent_jobs_status_idx ON agentos.agent_jobs (status, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_jobs_agent_idx ON agentos.agent_jobs (agent_id, created_at DESC);

-- -------------------------------------------------------------------------
-- ۵) سفارش‌های واقعی صرافی و اسنپ‌شات قیمت
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agentos.exchange_orders (
  id SERIAL PRIMARY KEY,
  exchange TEXT NOT NULL DEFAULT 'binance',
  testnet BOOLEAN NOT NULL DEFAULT FALSE,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  order_type TEXT NOT NULL DEFAULT 'MARKET',
  quantity NUMERIC(28, 12),
  quote_qty NUMERIC(28, 12),
  price NUMERIC(28, 12),
  status TEXT NOT NULL DEFAULT 'NEW',            -- پاسخ واقعی صرافی
  client_order_id TEXT NOT NULL UNIQUE,
  exchange_order_id TEXT NOT NULL DEFAULT '',
  agent_name TEXT NOT NULL DEFAULT '',
  job_id INTEGER,
  raw JSONB,
  error TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- market_snapshots ممکن است از قبل با اسکیمای قدیمی‌تر وجود داشته باشد؛
-- در آن صورت فقط ستون‌های لازم به آن اضافه می‌شود (idempotent).
CREATE TABLE IF NOT EXISTS agentos.market_snapshots (
  id BIGSERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  price NUMERIC(28, 8) NOT NULL,
  change_pct NUMERIC(12, 4),
  source TEXT NOT NULL DEFAULT 'binance',
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE agentos.market_snapshots ADD COLUMN IF NOT EXISTS change_pct NUMERIC(12, 4);
ALTER TABLE agentos.market_snapshots ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'binance';
ALTER TABLE agentos.market_snapshots ADD COLUMN IF NOT EXISTS fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- ستون‌های تکنیکال (RSI/MACD/MA/حمایت/مقاومت/نوسان). اگر این‌ها نباشند،
-- ثبت اسنپ‌شات آریا و خواندن وضعیت بازار با خطای «column does not exist»
-- شکست می‌خورد و حلقهٔ خودکار بی‌دلیل خطا می‌دهد. این بلوک idempotent است.
ALTER TABLE agentos.market_snapshots ADD COLUMN IF NOT EXISTS rsi REAL NOT NULL DEFAULT 0;
ALTER TABLE agentos.market_snapshots ADD COLUMN IF NOT EXISTS macd_hist REAL NOT NULL DEFAULT 0;
ALTER TABLE agentos.market_snapshots ADD COLUMN IF NOT EXISTS ma20 REAL NOT NULL DEFAULT 0;
ALTER TABLE agentos.market_snapshots ADD COLUMN IF NOT EXISTS ma50 REAL NOT NULL DEFAULT 0;
ALTER TABLE agentos.market_snapshots ADD COLUMN IF NOT EXISTS support REAL NOT NULL DEFAULT 0;
ALTER TABLE agentos.market_snapshots ADD COLUMN IF NOT EXISTS resistance REAL NOT NULL DEFAULT 0;
ALTER TABLE agentos.market_snapshots ADD COLUMN IF NOT EXISTS volume_usdt REAL NOT NULL DEFAULT 0;
ALTER TABLE agentos.market_snapshots ADD COLUMN IF NOT EXISTS volatility_pct REAL NOT NULL DEFAULT 0;
ALTER TABLE agentos.market_snapshots ADD COLUMN IF NOT EXISTS candles INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS market_snapshots_symbol_idx
  ON agentos.market_snapshots (symbol, fetched_at DESC);

-- -------------------------------------------------------------------------
-- ۵.۱) سیگنال‌های معاملهٔ آریا (trade_signals)
-- این جدول پیش‌تر در فایل اسکیما نبود و روی دیتابیس تازه ساخته نمی‌شد؛
-- نتیجه: چرخهٔ آریا و حلقهٔ خودکار با خطای «relation does not exist»
-- شکست می‌خوردند. اکنون به‌صورت idempotent ساخته می‌شود.
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agentos.trade_signals (
  id SERIAL PRIMARY KEY,
  agent_id INTEGER NOT NULL,
  agent_name TEXT NOT NULL,
  symbol TEXT NOT NULL DEFAULT 'BTCUSDT',
  side TEXT NOT NULL,
  entry_price REAL NOT NULL,
  take_profit REAL NOT NULL,
  stop_loss REAL NOT NULL,
  target_pct REAL NOT NULL DEFAULT 0,
  stop_pct REAL NOT NULL DEFAULT 0,
  risk_reward REAL NOT NULL DEFAULT 0,
  leverage INTEGER NOT NULL DEFAULT 2,
  position_usdt REAL NOT NULL DEFAULT 50,
  estimated_profit_usdt REAL NOT NULL DEFAULT 0,
  estimated_hours_min INTEGER NOT NULL DEFAULT 4,
  estimated_hours_max INTEGER NOT NULL DEFAULT 12,
  confidence REAL NOT NULL DEFAULT 0,
  rsi REAL NOT NULL DEFAULT 0,
  macd_hist REAL NOT NULL DEFAULT 0,
  ma20 REAL NOT NULL DEFAULT 0,
  ma50 REAL NOT NULL DEFAULT 0,
  support REAL NOT NULL DEFAULT 0,
  resistance REAL NOT NULL DEFAULT 0,
  volatility_pct REAL NOT NULL DEFAULT 0,
  data_source TEXT NOT NULL DEFAULT 'binance',
  analysis_reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS trade_signals_created_idx
  ON agentos.trade_signals (created_at DESC);
CREATE INDEX IF NOT EXISTS trade_signals_symbol_idx
  ON agentos.trade_signals (symbol, created_at DESC);

-- -------------------------------------------------------------------------
-- ۶) وبهوک تلگرام (بدون تکرار) + اجرای کرون + رویدادهای سیستم/خطا
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agentos.telegram_updates (
  update_id BIGINT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'message',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  processed BOOLEAN NOT NULL DEFAULT FALSE,
  error TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agentos.cron_runs (
  id SERIAL PRIMARY KEY,
  job TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ok',
  detail TEXT NOT NULL DEFAULT '',
  duration_ms INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS agentos.system_events (
  id BIGSERIAL PRIMARY KEY,
  level TEXT NOT NULL DEFAULT 'info',            -- info | warn | error
  scope TEXT NOT NULL DEFAULT 'app',
  message TEXT NOT NULL,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS system_events_created_idx
  ON agentos.system_events (created_at DESC);

-- -------------------------------------------------------------------------
-- ۷) توابع دیتابیس (RPC)
-- -------------------------------------------------------------------------

-- افزایش شمارنده موفقیت کارمند + لمس زمان فعالیت (همان چیزی که در کد
-- با supabase.rpc('increment_agent_success') صدا زده می‌شود).
CREATE OR REPLACE FUNCTION agentos.increment_agent_success(agent_name TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE agentos.agents
     SET success_count = success_count + 1,
         last_active_at = NOW()
   WHERE name = agent_name OR slug = agent_name;

  IF NOT FOUND THEN
    RAISE NOTICE 'agent not found: %', agent_name;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION agentos.increment_agent_error(agent_name TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE agentos.agents
     SET error_count = error_count + 1,
         last_active_at = NOW()
   WHERE name = agent_name OR slug = agent_name;
END;
$$;

-- ثبت اتمیک اجرای واقعی: افزایش درآمد کارمند + تعداد تسک، فقط اگر
-- رویداد درآمدی با همین هش قبلاً در دفتر فعالیت ثبت نشده باشد
-- (ضد تکرار / idempotent).
CREATE OR REPLACE FUNCTION agentos.record_agent_revenue(
  p_agent_name TEXT,
  p_agent_id INTEGER,
  p_amount REAL,
  p_tx_hash TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  already BOOLEAN;
BEGIN
  IF p_tx_hash <> '' THEN
    SELECT EXISTS (
      SELECT 1 FROM agentos.agent_activity_logs
       WHERE tx_hash = p_tx_hash AND status = 'success' AND reward_usdt > 0
    ) INTO already;
    IF already THEN
      RETURN FALSE;
    END IF;
  END IF;

  IF p_agent_id IS NOT NULL THEN
    UPDATE agentos.agents
       SET earned_usdt = earned_usdt + COALESCE(p_amount, 0),
           tasks_completed = tasks_completed + 1,
           last_active_at = NOW()
     WHERE id = p_agent_id;
  ELSE
    UPDATE agentos.agents
       SET earned_usdt = earned_usdt + COALESCE(p_amount, 0),
           tasks_completed = tasks_completed + 1,
           last_active_at = NOW()
     WHERE name = p_agent_name OR slug = p_agent_name;
  END IF;

  RETURN TRUE;
END;
$$;

-- یک هش تراکنش نمی‌تواند دو بار به‌عنوان درآمد ثبت شود (ضد تقلب)
CREATE UNIQUE INDEX IF NOT EXISTS transactions_income_txhash_uidx
  ON agentos.transactions (tx_hash)
  WHERE kind = 'income' AND tx_hash <> '';

-- -------------------------------------------------------------------------
-- ۷.۵) کتابخانهٔ مالی داخلی + لایهٔ پاداش (Ledger & Reward Layer)
--      دفتر دوطرفه برای سرمایهٔ اولیه، سود/زیان معاملات، پاداش کارمندان و
--      سود مرکب. هیچ موجودی‌ای ذخیره نمی‌شود؛ همیشه از SUM محاسبه می‌شود.
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agentos.ledger_accounts (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,             -- capital | exchange | wallet | rewards | profit | fees | profit_share
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'asset',    -- asset | equity | revenue | expense
  asset TEXT NOT NULL DEFAULT 'USDT',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agentos.ledger_entries (
  id BIGSERIAL PRIMARY KEY,
  entry_group TEXT NOT NULL,
  account_code TEXT NOT NULL,
  agent_id INTEGER,
  agent_name TEXT NOT NULL DEFAULT '',
  debit_usdt REAL NOT NULL DEFAULT 0,
  credit_usdt REAL NOT NULL DEFAULT 0,
  kind TEXT NOT NULL,                    -- capital_in | revenue | trade_pnl | reward | withdraw | fee | profit_share | adjustment
  memo TEXT NOT NULL DEFAULT '',
  ref_type TEXT NOT NULL DEFAULT '',     -- transaction | exchange_order | job | manual
  ref_id TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT NOT NULL UNIQUE,  -- ضدتکرار: هر رویداد فقط یک‌بار
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ledger_entries_account_idx
  ON agentos.ledger_entries (account_code, created_at DESC);
CREATE INDEX IF NOT EXISTS ledger_entries_group_idx
  ON agentos.ledger_entries (entry_group);

CREATE TABLE IF NOT EXISTS agentos.reward_rules (
  id SERIAL PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  value TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agentos.agent_rewards (
  id BIGSERIAL PRIMARY KEY,
  agent_id INTEGER,
  agent_name TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'trade',  -- trade | bounty | mission | revenue
  job_id INTEGER,
  trade_profit_usdt REAL NOT NULL DEFAULT 0,
  rule_key TEXT NOT NULL DEFAULT 'default',
  reward_usdt REAL NOT NULL DEFAULT 0,
  points INTEGER NOT NULL DEFAULT 0,
  compounded BOOLEAN NOT NULL DEFAULT FALSE,
  ledger_group TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT NOT NULL UNIQUE,
  detail TEXT NOT NULL DEFAULT '',
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS agent_rewards_agent_idx
  ON agentos.agent_rewards (agent_name, created_at DESC);

-- حساب‌های پایهٔ دفتر (idempotent)
INSERT INTO agentos.ledger_accounts (code, name, kind) VALUES
  ('capital',      'سرمایهٔ مالک (موجودی اولیهٔ خرد)', 'equity'),
  ('exchange',     'موجودی در صرافی',                  'asset'),
  ('wallet',       'کیف پول واحد USDT',                'asset'),
  ('rewards',      'صندوق پاداش کارمندان',             'asset'),
  ('profit',       'سود محقق‌شدهٔ معاملات',            'revenue'),
  ('fees',         'کارمزد صرافی',                     'expense'),
  ('profit_share', 'سهم کارمند از سود (پاداش مرکب)',   'expense')
ON CONFLICT (code) DO NOTHING;

-- ── توابع اتمیک دفتر ─────────────────────────────────────────────────────

-- ثبت یک سند دوطرفه با کنترل تراز و ضدتکرار. اگر کلید قبلاً ثبت شده باشد
-- FALSE برمی‌گرداند (یعنی تغییری اعمال نشد).
CREATE OR REPLACE FUNCTION agentos.post_ledger_entry(
  p_group TEXT,
  p_kind TEXT,
  p_idempotency_key TEXT,
  p_legs JSONB,                     -- [{"account":"wallet","amount":50}, ...]
  p_memo TEXT DEFAULT '',
  p_ref_type TEXT DEFAULT '',
  p_ref_id TEXT DEFAULT '',
  p_meta JSONB DEFAULT '{}'::jsonb
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  leg JSONB;
  debit_total NUMERIC := 0;
  credit_total NUMERIC := 0;
  idx INT := 0;
BEGIN
  IF EXISTS (SELECT 1 FROM agentos.ledger_entries WHERE idempotency_key = p_idempotency_key || ':0') THEN
    RETURN FALSE;
  END IF;

  FOR leg IN SELECT * FROM jsonb_array_elements(p_legs) LOOP
    IF (leg->>'amount')::NUMERIC > 0 THEN
      debit_total := debit_total + (leg->>'amount')::NUMERIC;
    ELSE
      credit_total := credit_total - (leg->>'amount')::NUMERIC;
    END IF;
  END LOOP;

  IF ABS(debit_total - credit_total) > 0.000001 THEN
    RAISE EXCEPTION 'سند مالی متوازن نیست (بدهکار % ≠ بستانکار %)', debit_total, credit_total;
  END IF;

  FOR leg IN SELECT * FROM jsonb_array_elements(p_legs) LOOP
    INSERT INTO agentos.ledger_entries
      (entry_group, account_code, agent_id, agent_name, debit_usdt, credit_usdt,
       kind, memo, ref_type, ref_id, idempotency_key, meta)
    VALUES (
      p_group,
      leg->>'account',
      NULLIF(leg->>'agent_id','')::INTEGER,
      COALESCE(leg->>'agent_name',''),
      GREATEST((leg->>'amount')::REAL, 0),
      GREATEST(-1 * (leg->>'amount')::REAL, 0),
      p_kind, p_memo, p_ref_type, p_ref_id,
      p_idempotency_key || ':' || idx,
      p_meta
    );
    idx := idx + 1;
  END LOOP;

  RETURN TRUE;
END;
$$;

-- موجودی خالص یک حساب (بدهکار − بستانکار)
CREATE OR REPLACE FUNCTION agentos.ledger_balance(p_account TEXT)
RETURNS NUMERIC
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(SUM(debit_usdt - credit_usdt), 0)
    FROM agentos.ledger_entries
   WHERE account_code = p_account;
$$;

-- کنترل یکپارچگی: مجموع کل دفتر باید صفر باشد (دفتر دوطرفه سالم)
CREATE OR REPLACE FUNCTION agentos.ledger_integrity()
RETURNS TABLE (total_debit NUMERIC, total_credit NUMERIC, balanced BOOLEAN)
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(SUM(debit_usdt),0),
         COALESCE(SUM(credit_usdt),0),
         COALESCE(SUM(debit_usdt),0) = COALESCE(SUM(credit_usdt),0)
    FROM agentos.ledger_entries;
$$;

-- -------------------------------------------------------------------------
-- ۸) دسترسی رول محدود (فقط اگر رول وجود داشته باشد)
-- -------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agentos') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA agentos TO agentos';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA agentos TO agentos';
    EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA agentos TO agentos';
    EXECUTE 'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA agentos TO agentos';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA agentos GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO agentos';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA agentos GRANT USAGE, SELECT ON SEQUENCES TO agentos';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA agentos GRANT EXECUTE ON FUNCTIONS TO agentos';
    EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA agentos TO agentos';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA agentos GRANT USAGE, SELECT ON SEQUENCES TO agentos';
  END IF;
END
$$;
