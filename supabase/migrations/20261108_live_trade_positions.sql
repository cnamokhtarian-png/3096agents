-- Pending integration: never apply automatically. Position amounts are in the
-- named quote/base assets, not assumed to be USDT. External exchange effects
-- cannot share a SQL transaction; unknown submissions require reconciliation.
CREATE SCHEMA IF NOT EXISTS agentos;
CREATE TABLE IF NOT EXISTS agentos.live_trade_positions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id integer NOT NULL UNIQUE REFERENCES agentos.agent_jobs(id),
  exchange text NOT NULL CHECK (exchange = 'tabdeal'),
  symbol text NOT NULL,
  base_asset text NOT NULL,
  quote_asset text NOT NULL,
  state text NOT NULL CHECK (state IN ('entry_pending','entry_unknown','open','exit_pending','exit_unknown','closed','requires_attention')),
  requested_quote numeric NOT NULL CHECK (requested_quote > 0),
  filled_base numeric CHECK (filled_base >= 0),
  entry_quote numeric CHECK (entry_quote >= 0),
  stop_price numeric NOT NULL CHECK (stop_price > 0),
  target_price numeric NOT NULL CHECK (target_price > stop_price),
  exit_reason text CHECK (exit_reason IN ('stop_loss','take_profit')),
  exit_base numeric CHECK (exit_base >= 0),
  exit_quote numeric CHECK (exit_quote >= 0),
  realized_quote numeric,
  has_unvalued_fees boolean NOT NULL DEFAULT false,
  opened_at timestamptz,
  closed_at timestamptz,
  last_checked_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS agentos.live_trade_order_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  position_id bigint NOT NULL REFERENCES agentos.live_trade_positions(id),
  purpose text NOT NULL CHECK (purpose IN ('entry','exit')),
  client_order_id text NOT NULL UNIQUE,
  state text NOT NULL CHECK (state IN ('prepared','submitted','unknown','confirmed','rejected','settled')),
  exchange_order_id text,
  exchange_result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS live_trade_positions_state_idx ON agentos.live_trade_positions (state, last_checked_at);

CREATE UNIQUE INDEX live_trade_one_entry_attempt ON agentos.live_trade_order_attempts(position_id) WHERE purpose='entry';
CREATE UNIQUE INDEX live_trade_one_active_exit ON agentos.live_trade_order_attempts(position_id) WHERE purpose='exit' AND state NOT IN ('settled','rejected');
