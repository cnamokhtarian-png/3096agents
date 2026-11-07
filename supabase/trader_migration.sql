-- =========================================================================
-- 🪙 مایگریشن افزایشی «میز کار ایجنت تریدر آریا (A1)»
-- یکبار در SQL Editor سوپابیس Run کنید (idempotent). فایل کامل schema.sql هم
-- شامل همین جداول است. اسکیمای جدا شدهٔ agentos را حفظ میکند.
-- =========================================================================

CREATE SCHEMA IF NOT EXISTS agentos;

CREATE TABLE IF NOT EXISTS agentos.trade_signals (
  id SERIAL PRIMARY KEY,
  agent_id INTEGER NOT NULL REFERENCES agentos.agents(id) ON DELETE CASCADE,
  agent_name TEXT NOT NULL,
  symbol TEXT NOT NULL DEFAULT 'BTC/USDT',
  side TEXT NOT NULL,
  entry_price REAL NOT NULL,
  take_profit REAL NOT NULL,
  stop_loss REAL NOT NULL,
  target_pct REAL NOT NULL DEFAULT 0,
  stop_pct REAL NOT NULL DEFAULT 0,
  risk_reward REAL NOT NULL DEFAULT 0,
  leverage INTEGER NOT NULL DEFAULT 3,
  position_usdt REAL NOT NULL DEFAULT 500,
  estimated_profit_usdt REAL NOT NULL DEFAULT 0,
  estimated_hours_min INTEGER NOT NULL DEFAULT 1,
  estimated_hours_max INTEGER NOT NULL DEFAULT 6,
  confidence REAL NOT NULL DEFAULT 0,
  rsi REAL NOT NULL DEFAULT 0,
  macd_hist REAL NOT NULL DEFAULT 0,
  ma20 REAL NOT NULL DEFAULT 0,
  ma50 REAL NOT NULL DEFAULT 0,
  support REAL NOT NULL DEFAULT 0,
  resistance REAL NOT NULL DEFAULT 0,
  fear_greed INTEGER NOT NULL DEFAULT 50,
  orderbook_imbalance REAL NOT NULL DEFAULT 0,
  whale_flow_usdt REAL NOT NULL DEFAULT 0,
  sentiment REAL NOT NULL DEFAULT 0,
  volatility_pct REAL NOT NULL DEFAULT 0,
  data_source TEXT NOT NULL DEFAULT 'fallback',
  data_sources TEXT NOT NULL DEFAULT '[]',
  analysis_reason TEXT NOT NULL DEFAULT '',
  risk_notes TEXT NOT NULL DEFAULT '',
  telegram_message TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  decided_by TEXT NOT NULL DEFAULT '',
  decided_at TIMESTAMP,
  expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS trade_signals_status_idx ON agentos.trade_signals (status, id DESC);

CREATE TABLE IF NOT EXISTS agentos.trade_positions (
  id SERIAL PRIMARY KEY,
  signal_id INTEGER,
  agent_id INTEGER NOT NULL,
  agent_name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  entry_price REAL NOT NULL,
  current_price REAL NOT NULL DEFAULT 0,
  take_profit REAL NOT NULL,
  stop_loss REAL NOT NULL,
  size_usdt REAL NOT NULL,
  leverage INTEGER NOT NULL DEFAULT 3,
  quantity REAL NOT NULL DEFAULT 0,
  unrealized_pnl REAL NOT NULL DEFAULT 0,
  realized_pnl REAL NOT NULL DEFAULT 0,
  pnl_pct REAL NOT NULL DEFAULT 0,
  mode TEXT NOT NULL DEFAULT 'paper',
  status TEXT NOT NULL DEFAULT 'open',
  close_reason TEXT NOT NULL DEFAULT '',
  exchange_order_id TEXT NOT NULL DEFAULT '',
  opened_at TIMESTAMP DEFAULT NOW(),
  closed_at TIMESTAMP,
  updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS trade_positions_status_idx ON agentos.trade_positions (status, id DESC);

CREATE TABLE IF NOT EXISTS agentos.agent_journal (
  id SERIAL PRIMARY KEY,
  agent_id INTEGER NOT NULL,
  agent_name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'scan',
  mood TEXT NOT NULL DEFAULT 'focused',
  text TEXT NOT NULL,
  meta TEXT NOT NULL DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS agent_journal_agent_idx ON agentos.agent_journal (agent_id, id DESC);

CREATE TABLE IF NOT EXISTS agentos.market_snapshots (
  id SERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  price REAL NOT NULL,
  rsi REAL NOT NULL DEFAULT 0,
  macd_hist REAL NOT NULL DEFAULT 0,
  ma20 REAL NOT NULL DEFAULT 0,
  ma50 REAL NOT NULL DEFAULT 0,
  support REAL NOT NULL DEFAULT 0,
  resistance REAL NOT NULL DEFAULT 0,
  fear_greed INTEGER NOT NULL DEFAULT 50,
  orderbook_imbalance REAL NOT NULL DEFAULT 0,
  whale_flow_usdt REAL NOT NULL DEFAULT 0,
  sentiment REAL NOT NULL DEFAULT 0,
  volume_usdt REAL NOT NULL DEFAULT 0,
  volatility_pct REAL NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'fallback',
  sources TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '[]',
  candles INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS market_snapshots_symbol_idx ON agentos.market_snapshots (symbol, id DESC);

INSERT INTO agentos.settings (key, value) VALUES
  ('trader_enabled', 'true'),
  ('trader_symbol', 'BTC/USDT'),
  ('trader_capital_usdt', '2500'),
  ('trader_max_position_usdt', '500'),
  ('trader_max_leverage', '5'),
  ('trader_min_rr', '2'),
  ('trader_min_confidence', '65'),
  ('trader_max_risk_usdt', '50'),
  ('trader_min_fear_greed', '15'),
  ('trader_max_fear_greed', '80'),
  ('trader_max_volatility_pct', '4'),
  ('trader_auto_close', 'true'),
  ('trader_max_hold_hours', '24'),
  ('trader_max_open_positions', '1'),
  ('trader_mode', 'paper')
ON CONFLICT (key) DO NOTHING;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agentos') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA agentos TO agentos';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA agentos TO agentos';
    EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA agentos TO agentos';
  END IF;
END
$$;
