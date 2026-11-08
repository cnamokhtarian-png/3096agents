-- Separate hypothetical state. No foreign keys to wallets, real positions or ledger.
CREATE TABLE agentos.paper_monitor_sessions (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 symbol text NOT NULL CHECK (symbol ~ '^[A-Z0-9]{2,25}USDT$'),
 state jsonb NOT NULL,
 revision integer NOT NULL DEFAULT 0,
 last_tick timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE agentos.paper_monitor_ticks (
 session_id bigint NOT NULL REFERENCES agentos.paper_monitor_sessions(id),
 revision integer NOT NULL,
 observation jsonb NOT NULL,
 state jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(session_id,revision)
);
ALTER TABLE agentos.paper_monitor_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agentos.paper_monitor_ticks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON agentos.paper_monitor_sessions, agentos.paper_monitor_ticks FROM PUBLIC;
CREATE INDEX paper_monitor_poll_idx ON agentos.paper_monitor_sessions(last_tick,id)
 WHERE state->>'status' IN ('pending','open');
