-- Isolated paper-only state. Never counted in real transaction/revenue tables.
-- No default wallet funding: a user must explicitly create a virtual balance.
CREATE TABLE IF NOT EXISTS agentos.paper_wallets (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  label text NOT NULL,
  cash_usdt numeric(38, 12) NOT NULL CHECK (cash_usdt >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS agentos.paper_positions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  wallet_id bigint NOT NULL REFERENCES agentos.paper_wallets(id),
  symbol text NOT NULL,
  status text NOT NULL CHECK (status IN ('proposed', 'open', 'closed', 'cancelled')),
  quote_budget_usdt numeric(38, 12) NOT NULL CHECK (quote_budget_usdt > 0),
  entry_price numeric(38, 12),
  quantity numeric(38, 12),
  stop_price numeric(38, 12) NOT NULL CHECK (stop_price > 0),
  target_price numeric(38, 12) NOT NULL CHECK (target_price > stop_price),
  exit_price numeric(38, 12),
  pnl_usdt numeric(38, 12),
  approved_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  opened_at timestamptz,
  closed_at timestamptz,
  CHECK (entry_price IS NULL OR entry_price > 0),
  CHECK (quantity IS NULL OR quantity > 0),
  CHECK (exit_price IS NULL OR exit_price > 0),
  CHECK (status NOT IN ('open', 'closed') OR (entry_price IS NOT NULL AND quantity IS NOT NULL AND approved_by IS NOT NULL AND opened_at IS NOT NULL)),
  CHECK (status <> 'closed' OR (exit_price IS NOT NULL AND pnl_usdt IS NOT NULL AND closed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS paper_positions_open_idx ON agentos.paper_positions (status, symbol);
CREATE TABLE IF NOT EXISTS agentos.paper_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  position_id bigint NOT NULL REFERENCES agentos.paper_positions(id),
  event_type text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
