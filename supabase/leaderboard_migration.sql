-- =========================================================================
-- مایگریشن افزایشی «لیگ کارمندان / کارمند برتر ماه» برای دیتابیسهای موجود
-- یکبار در SQL Editor سوپابیس Run کنید (کاملاً idempotent).
-- فایل کامل schema.sql هم شامل همین جداول است.
-- =========================================================================

CREATE SCHEMA IF NOT EXISTS agentos;

CREATE TABLE IF NOT EXISTS agentos.agent_score_events (
  id SERIAL PRIMARY KEY,
  agent_id INTEGER NOT NULL REFERENCES agentos.agents(id) ON DELETE CASCADE,
  agent_name TEXT NOT NULL,
  period TEXT NOT NULL,
  outcome TEXT NOT NULL,
  project_title TEXT NOT NULL DEFAULT '',
  duration_minutes REAL NOT NULL DEFAULT 0,
  points INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'manual',
  source_ref TEXT UNIQUE,
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS agent_score_events_period_idx
  ON agentos.agent_score_events (period, agent_id);

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

-- پیکربندی اولیهٔ فرمول (در صورت وجود دستکاری نمیشود)
INSERT INTO agentos.settings (key, value) VALUES
  ('leaderboard_weight_success', '60'),
  ('leaderboard_weight_revenue', '30'),
  ('leaderboard_weight_speed', '10'),
  ('leaderboard_revenue_target', '1000'),
  ('leaderboard_duration_target', '60'),
  ('leaderboard_boost_multiplier', '2')
ON CONFLICT (key) DO NOTHING;

-- دسترسی رول محدود اپ روی جداول و سکونسهای جدید
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agentos') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA agentos TO agentos';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA agentos TO agentos';
    EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA agentos TO agentos';
  END IF;
END
$$;
