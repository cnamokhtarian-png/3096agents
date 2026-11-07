-- =========================================================================
-- Freelance Agent OS & Unified Crypto Vault — Supabase PostgreSQL Schema
-- =========================================================================
-- نحوه استفاده:
-- ۱. وارد پنل Supabase شوید -> بخش SQL Editor
-- ۲. تمام این فایل را کپی و Run کنید (یا از ترمینال دستور npx drizzle-kit push بزنید)
-- =========================================================================

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agents (
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

CREATE TABLE IF NOT EXISTS projects (
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

CREATE TABLE IF NOT EXISTS tasks (
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

CREATE TABLE IF NOT EXISTS messages (
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

CREATE TABLE IF NOT EXISTS transactions (
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

CREATE TABLE IF NOT EXISTS agent_logs (
  id SERIAL PRIMARY KEY,
  agent TEXT NOT NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'success',
  detail TEXT NOT NULL DEFAULT '',
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tool_runs (
  id SERIAL PRIMARY KEY,
  tool TEXT NOT NULL,
  input TEXT NOT NULL DEFAULT '',
  output TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'done',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settings (
  id SERIAL PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  value TEXT NOT NULL DEFAULT ''
);

-- =========================================================================
-- نکته مهم: داده‌های اولیه (ادمین، کارمند رمزارز، ناوگان ایجنت‌ها و کیف پول واحد)
-- هنگام اولین باز شدن سایت یا فراخوانی API به صورت خودکار (Auto-Seed) ایجاد می‌شوند.
-- =========================================================================
