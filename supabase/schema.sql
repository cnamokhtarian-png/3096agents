-- =========================================================================
-- Freelance Agent OS & Unified Crypto Vault — Supabase PostgreSQL Schema
-- =========================================================================
-- نکته مهم: این دیتابیس با یک اپ دیگر مشترک است و اسکیمای public متعلق
-- به آن است (جدول‌های فروشگاه). پس جدول‌های این پروژه در اسکیمای ایزوله
-- `agentos` ساخته می‌شوند تا هیچ تداخلی پیش نیاید.
--
-- نحوه استفاده (یک‌بار):
-- ۱. یک رول اختصاصی با دسترسی محدود بسازید (پسورد را امن نگه دارید):
--      CREATE ROLE agentos WITH LOGIN PASSWORD 'STRONG_RANDOM_PASSWORD';
-- ۲. تمام این فایل را در SQL Editor سوپابیس Run کنید.
-- ۳. در Vercel مقدار DATABASE_URL را با یوزر agentos.<project-ref> روی
--    پولر (پورت 6543) ست کنید. سطر AUTH اختیاری است.
-- =========================================================================

CREATE SCHEMA IF NOT EXISTS agentos;

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

-- =========================================================================
-- 🏆 لیگ کارمندان / کارمند برتر ماه (Agent Leaderboard)
-- =========================================================================
-- دفترچهٔ نتایج پروژهها. source_ref کلید یکتای idempotency است: تأیید تکراری
-- یک تسک (از پنل یا تلگرام) دوبار امتیاز نمیدهد.
CREATE TABLE IF NOT EXISTS agentos.agent_score_events (
  id SERIAL PRIMARY KEY,
  agent_id INTEGER NOT NULL REFERENCES agentos.agents(id) ON DELETE CASCADE,
  agent_name TEXT NOT NULL,
  period TEXT NOT NULL,                       -- YYYY-MM (UTC)
  outcome TEXT NOT NULL,                      -- success | failure | error
  project_title TEXT NOT NULL DEFAULT '',
  duration_minutes REAL NOT NULL DEFAULT 0,  -- پیشنهاد → تأیید نهایی
  points INTEGER NOT NULL DEFAULT 0,         -- +10 / -5 / -8
  source TEXT NOT NULL DEFAULT 'manual',     -- manual | hitl | ingest | api | seed
  source_ref TEXT UNIQUE,
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS agent_score_events_period_idx
  ON agentos.agent_score_events (period, agent_id);

-- اسنپشات برندهٔ هر دوره (یک ردیف برای هر ماه) + وضعیت ارسال گزارش تلگرام
CREATE TABLE IF NOT EXISTS agentos.agent_monthly_awards (
  id SERIAL PRIMARY KEY,
  period TEXT NOT NULL UNIQUE,
  agent_id INTEGER NOT NULL,
  agent_name TEXT NOT NULL,
  avatar TEXT NOT NULL DEFAULT '🤖',
  score REAL NOT NULL DEFAULT 0,
  success_rate REAL NOT NULL DEFAULT 0,
  total_projects INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  revenue_usdt REAL NOT NULL DEFAULT 0,
  avg_duration_minutes REAL NOT NULL DEFAULT 0,
  points INTEGER NOT NULL DEFAULT 0,
  runners_up TEXT NOT NULL DEFAULT '[]',
  telegram_message TEXT NOT NULL DEFAULT '',
  telegram_sent BOOLEAN NOT NULL DEFAULT FALSE,
  boost_multiplier REAL NOT NULL DEFAULT 2,
  created_at TIMESTAMP DEFAULT NOW()
);

-- دسترسی حداقلی رول اختصاصی (فقط اگر رول وجود داشته باشد)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agentos') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA agentos TO agentos';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA agentos TO agentos';
    EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA agentos TO agentos';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA agentos GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO agentos';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA agentos GRANT USAGE, SELECT ON SEQUENCES TO agentos';
  END IF;
END
$$;
