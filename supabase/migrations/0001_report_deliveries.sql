-- Anti-duplicate Telegram report delivery ledger.
-- Additive migration; safe to run multiple times.
CREATE TABLE IF NOT EXISTS agentos.report_deliveries (
  id SERIAL PRIMARY KEY,
  delivery_key TEXT NOT NULL UNIQUE,
  chat_id TEXT NOT NULL,
  agent_id INTEGER,
  scope TEXT NOT NULL DEFAULT 'daily',
  status TEXT NOT NULL DEFAULT 'sending',
  telegram_message_id BIGINT,
  error TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS report_deliveries_chat_idx
  ON agentos.report_deliveries (chat_id, created_at DESC);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agentos') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON agentos.report_deliveries TO agentos';
    EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE agentos.report_deliveries_id_seq TO agentos';
  END IF;
END
$$;
