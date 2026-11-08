-- Runtime role is explicitly named: never grant accounting writes to anon/authenticated.
GRANT USAGE ON SCHEMA agentos TO agentos;
GRANT SELECT,INSERT,UPDATE ON agentos.live_trade_positions,agentos.live_trade_order_attempts,
 agentos.trade_entry_fills,agentos.trade_exit_fills,agentos.trade_external_fee_ledger,
 agentos.trade_close_notifications,agentos.paper_monitor_sessions,agentos.paper_monitor_ticks TO agentos;
GRANT SELECT,INSERT ON agentos.ledger_entries TO agentos;
GRANT SELECT ON agentos.ledger_accounts TO agentos;
GRANT USAGE,SELECT ON SEQUENCE agentos.live_trade_positions_id_seq,
 agentos.live_trade_order_attempts_id_seq,agentos.ledger_entries_id_seq,
 agentos.trade_external_fee_ledger_id_seq,agentos.paper_monitor_sessions_id_seq TO agentos;
GRANT EXECUTE ON FUNCTION agentos.record_tabdeal_entry_fill(bigint,text,text,numeric,numeric,numeric,text),
 agentos.finalize_tabdeal_entry(bigint,text,text,numeric),
 agentos.record_tabdeal_exit_fill(bigint,text,text,numeric,numeric,numeric,text),
 agentos.finalize_tabdeal_exit_attempt(bigint,text,text,numeric) TO agentos;
ALTER TABLE agentos.trade_entry_fills ENABLE ROW LEVEL SECURITY;
ALTER TABLE agentos.trade_exit_fills ENABLE ROW LEVEL SECURITY;
ALTER TABLE agentos.trade_external_fee_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE agentos.trade_close_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY aria_runtime ON agentos.trade_entry_fills TO agentos USING(true) WITH CHECK(true);
CREATE POLICY aria_runtime ON agentos.trade_exit_fills TO agentos USING(true) WITH CHECK(true);
CREATE POLICY aria_runtime ON agentos.trade_external_fee_ledger TO agentos USING(true) WITH CHECK(true);
CREATE POLICY aria_runtime ON agentos.trade_close_notifications TO agentos USING(true) WITH CHECK(true);
CREATE POLICY aria_runtime ON agentos.paper_monitor_sessions TO agentos USING(true) WITH CHECK(true);
CREATE POLICY aria_runtime ON agentos.paper_monitor_ticks TO agentos USING(true) WITH CHECK(true);
REVOKE ALL ON agentos.trade_entry_fills,agentos.trade_exit_fills,
 agentos.trade_external_fee_ledger,agentos.trade_close_notifications FROM PUBLIC;
