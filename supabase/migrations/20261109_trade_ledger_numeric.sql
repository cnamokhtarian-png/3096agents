-- Review and apply only after testing against a copy of the target database.
-- NUMERIC(20,8) cannot restore precision already lost in REAL. Abort rather
-- than silently round an existing value or overflow the target precision.
-- ALTER TABLE takes a lock; fail instead of waiting indefinitely.
SET LOCAL lock_timeout = '5s';
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM agentos.ledger_entries
    WHERE debit_usdt::text IN ('NaN','Infinity','-Infinity') OR credit_usdt::text IN ('NaN','Infinity','-Infinity')) THEN
    RAISE EXCEPTION 'ledger contains non-finite amounts';
  END IF;
  IF EXISTS (SELECT 1 FROM agentos.ledger_entries WHERE
      abs(debit_usdt::numeric) >= 1000000000000 OR abs(credit_usdt::numeric) >= 1000000000000 OR
      debit_usdt::numeric <> round(debit_usdt::numeric, 8) OR credit_usdt::numeric <> round(credit_usdt::numeric, 8)) THEN
    RAISE EXCEPTION 'ledger amount would overflow or require rounding';
  END IF;
END $$;
ALTER TABLE agentos.ledger_entries
  ALTER COLUMN debit_usdt TYPE numeric(20,8) USING debit_usdt::numeric(20,8),
  ALTER COLUMN credit_usdt TYPE numeric(20,8) USING credit_usdt::numeric(20,8);

-- A USDT cost-basis account for assets held in open trade positions.
INSERT INTO agentos.ledger_accounts(code,name,kind,asset)
VALUES ('trade_inventory','بهای تمام‌شده موقعیت‌های معاملاتی','asset','USDT')
ON CONFLICT (code) DO NOTHING;

-- Stable source-trade identities for reconciled exit fills. No execution
-- order is sent by this migration. A position tracks entry cost including any
-- quote-denominated entry fees; other fee currencies require reconciliation.
CREATE TABLE agentos.trade_exit_fills (
  exchange text NOT NULL CHECK (exchange = 'tabdeal'),
  symbol text NOT NULL,
  trade_id text NOT NULL CHECK (trade_id ~ '^[0-9]{1,30}$'),
  order_id text NOT NULL CHECK (order_id ~ '^[0-9]{1,30}$'),
  position_id bigint NOT NULL REFERENCES agentos.live_trade_positions(id),
  quantity numeric NOT NULL CHECK (quantity > 0),
  quote_amount numeric NOT NULL CHECK (quote_amount > 0),
  fee numeric NOT NULL CHECK (fee >= 0),
  fee_currency text NOT NULL,
  allocated_cost numeric NOT NULL,
  pnl numeric NOT NULL,
  remaining numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (exchange, symbol, trade_id)
);

-- Exact, balanced units for fees charged in a third asset. No USDT conversion
-- is invented: positions with these fees remain explicitly unvalued.
CREATE TABLE agentos.trade_external_fee_ledger (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  position_id bigint NOT NULL REFERENCES agentos.live_trade_positions(id),
  entry_group text NOT NULL, asset text NOT NULL CHECK (asset ~ '^[A-Z0-9]{2,15}$'),
  account_code text NOT NULL CHECK (account_code IN ('exchange_asset','fee_expense')),
  debit numeric NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit numeric NOT NULL DEFAULT 0 CHECK (credit >= 0),
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Persistent outbox. A claimed send is not blindly retried if its response is lost.
CREATE TABLE agentos.trade_close_notifications (
  position_id bigint PRIMARY KEY REFERENCES agentos.live_trade_positions(id),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','sending','sent','unknown')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_error text
);

-- Application must verify the trade with the exchange before calling this
-- invoker-only database function. One source fill yields two balanced entries.
CREATE OR REPLACE FUNCTION agentos.record_tabdeal_exit_fill(
  p_position_id bigint, p_order_id text, p_trade_id text,
  p_quantity numeric, p_quote_amount numeric, p_fee numeric, p_fee_currency text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, agentos AS $$
DECLARE
  pos agentos.live_trade_positions%ROWTYPE;
  prior agentos.trade_exit_fills%ROWTYPE;
  v_prev numeric; v_next numeric; v_cost_before numeric; v_cost_after numeric;
  v_alloc numeric; v_pnl numeric; v_rem numeric; v_key text; v_group text;
BEGIN
  IF p_order_id IS NULL OR p_order_id !~ '^[0-9]{1,30}$' OR p_trade_id IS NULL OR p_trade_id !~ '^[0-9]{1,30}$'
     OR p_quantity IS NULL OR p_quote_amount IS NULL OR p_fee IS NULL
     OR p_quantity::text IN ('NaN','Infinity','-Infinity') OR p_quote_amount::text IN ('NaN','Infinity','-Infinity') OR p_fee::text IN ('NaN','Infinity','-Infinity')
     OR p_quantity <= 0 OR p_quote_amount <= 0 OR p_fee < 0 OR p_fee_currency IS NULL OR p_fee_currency !~ '^[A-Z0-9]{2,15}$' THEN
    RAISE EXCEPTION 'invalid trade fill';
  END IF;
  SELECT * INTO pos FROM agentos.live_trade_positions WHERE id = p_position_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'position not found'; END IF;
  SELECT * INTO prior FROM agentos.trade_exit_fills
    WHERE exchange = 'tabdeal' AND symbol = pos.symbol AND trade_id = p_trade_id;
  IF FOUND THEN
    IF prior.position_id <> p_position_id OR prior.order_id <> p_order_id OR prior.quantity <> p_quantity
       OR prior.quote_amount <> p_quote_amount OR prior.fee <> p_fee OR prior.fee_currency <> p_fee_currency THEN
      RAISE EXCEPTION 'source trade identity conflict';
    END IF;
    RETURN jsonb_build_object('status','already_recorded','remaining',prior.remaining,'pnl',prior.pnl);
  END IF;
  IF pos.exchange <> 'tabdeal' OR pos.quote_asset <> 'USDT' THEN
    RAISE EXCEPTION 'fee or quote currency requires reconciliation';
  END IF;
  IF pos.state NOT IN ('open','exit_pending','exit_unknown','requires_attention') OR pos.filled_base IS NULL OR pos.filled_base <= 0
     OR pos.entry_quote IS NULL OR pos.entry_quote <= 0 THEN RAISE EXCEPTION 'position is not ready for settlement'; END IF;
  IF NOT EXISTS (SELECT 1 FROM agentos.live_trade_order_attempts a WHERE a.position_id = pos.id
      AND a.purpose = 'exit' AND a.exchange_order_id = p_order_id AND a.state IN ('submitted','confirmed','unknown')) THEN
    RAISE EXCEPTION 'exit order is not linked to position';
  END IF;
  IF p_fee_currency=pos.quote_asset AND p_fee > p_quote_amount THEN RAISE EXCEPTION 'fee exceeds proceeds'; END IF;
  v_prev := coalesce(pos.exit_base, 0);
  v_next := v_prev + p_quantity + CASE WHEN p_fee_currency=pos.base_asset THEN p_fee ELSE 0 END;
  IF v_prev < 0 OR v_next > pos.filled_base THEN RAISE EXCEPTION 'fill exceeds position'; END IF;
  v_cost_before := CASE WHEN v_prev = pos.filled_base THEN pos.entry_quote ELSE round(pos.entry_quote * v_prev / pos.filled_base, 8) END;
  v_cost_after := CASE WHEN v_next = pos.filled_base THEN pos.entry_quote ELSE round(pos.entry_quote * v_next / pos.filled_base, 8) END;
  v_alloc := v_cost_after - v_cost_before;
  v_pnl := p_quote_amount - CASE WHEN p_fee_currency=pos.quote_asset THEN p_fee ELSE 0 END - v_alloc;
  -- Do not silently truncate PnL to fit the existing 8-decimal ledger.
  IF abs(v_pnl) >= 1000000000000 OR v_pnl <> round(v_pnl, 8) THEN
    RAISE EXCEPTION 'pnl requires a rounding policy or exceeds ledger precision';
  END IF;
  v_rem := pos.filled_base - v_next;
  v_key := 'tabdeal:' || pos.symbol || ':' || p_trade_id;
  v_group := v_key;
  INSERT INTO agentos.trade_exit_fills(exchange,symbol,trade_id,order_id,position_id,quantity,quote_amount,fee,fee_currency,allocated_cost,pnl,remaining)
    VALUES ('tabdeal',pos.symbol,p_trade_id,p_order_id,pos.id,p_quantity,p_quote_amount,p_fee,p_fee_currency,v_alloc,v_pnl,v_rem);
  -- The disposal of cost basis and realized PnL are two separately balanced
  -- postings (two rows each); together they yield the actual net proceeds.
  INSERT INTO agentos.ledger_entries(entry_group,account_code,agent_name,debit_usdt,credit_usdt,kind,ref_type,ref_id,idempotency_key,meta)
    VALUES
      (v_group||':cost','exchange','Aria',v_alloc,0,'trade_cost_disposal','position',pos.id::text,v_key||':cost_cash',jsonb_build_object('trade_id',p_trade_id)),
      (v_group||':cost','trade_inventory','Aria',0,v_alloc,'trade_cost_disposal','position',pos.id::text,v_key||':cost_inventory',jsonb_build_object('trade_id',p_trade_id));
  INSERT INTO agentos.ledger_entries(entry_group,account_code,agent_name,debit_usdt,credit_usdt,kind,ref_type,ref_id,idempotency_key,meta)
    VALUES
      (v_group,'exchange','Aria',greatest(v_pnl,0),greatest(-v_pnl,0),'trade_realized_pnl','position',pos.id::text,v_key||':asset',jsonb_build_object('trade_id',p_trade_id,'fee',p_fee,'fee_currency',p_fee_currency,'allocated_cost',v_alloc)),
      (v_group,'profit','Aria',greatest(-v_pnl,0),greatest(v_pnl,0),'trade_realized_pnl','position',pos.id::text,v_key||':pnl',jsonb_build_object('trade_id',p_trade_id));
  IF p_fee > 0 AND p_fee_currency NOT IN (pos.base_asset,pos.quote_asset) THEN
    INSERT INTO agentos.trade_external_fee_ledger(position_id,entry_group,asset,account_code,debit,credit,idempotency_key)
    VALUES (pos.id,v_key||':external_fee',p_fee_currency,'fee_expense',p_fee,0,v_key||':fee_expense'),
           (pos.id,v_key||':external_fee',p_fee_currency,'exchange_asset',0,p_fee,v_key||':fee_asset');
  END IF;
  UPDATE agentos.live_trade_positions SET has_unvalued_fees = has_unvalued_fees OR (p_fee > 0 AND p_fee_currency NOT IN (pos.base_asset,pos.quote_asset)),
    exit_base = v_next, exit_quote = coalesce(exit_quote,0) + p_quote_amount,
    realized_quote = coalesce(realized_quote,0) + v_pnl, state = CASE WHEN v_rem = 0 THEN 'closed' ELSE 'exit_pending' END,
    closed_at = CASE WHEN v_rem = 0 THEN now() ELSE NULL END, updated_at = now() WHERE id = pos.id;
  IF v_rem = 0 THEN
    INSERT INTO agentos.trade_close_notifications(position_id) VALUES (pos.id) ON CONFLICT DO NOTHING;
  END IF;
  RETURN jsonb_build_object('status','recorded','remaining',v_rem,'pnl',v_pnl);
END $$;
-- No unauthenticated access to accounting writes. Explicit grants must be
-- reviewed against the actual application role before deployment.
REVOKE ALL ON FUNCTION agentos.record_tabdeal_exit_fill(bigint,text,text,numeric,numeric,numeric,text) FROM PUBLIC;

-- A new exit attempt may only be created after the prior exchange order is
-- terminal and every execution in that order was reconciled exactly once.
CREATE OR REPLACE FUNCTION agentos.finalize_tabdeal_exit_attempt(
 p_position_id bigint, p_order_id text, p_status text, p_executed numeric
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, agentos AS $$
DECLARE pos agentos.live_trade_positions%ROWTYPE; attempt agentos.live_trade_order_attempts%ROWTYPE; gross numeric; next_state text;
BEGIN
 IF p_order_id IS NULL OR p_order_id !~ '^[0-9]{1,30}$' OR p_status IS NULL OR p_status NOT IN ('FILLED','CANCELED','REJECTED','EXPIRED')
   OR p_executed IS NULL OR p_executed::text IN ('NaN','Infinity','-Infinity') OR p_executed < 0 OR (p_status='FILLED' AND p_executed=0) THEN RAISE EXCEPTION 'invalid terminal exit'; END IF;
 SELECT * INTO pos FROM agentos.live_trade_positions WHERE id=p_position_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'position not found'; END IF;
 SELECT * INTO attempt FROM agentos.live_trade_order_attempts WHERE position_id=pos.id AND purpose='exit' AND exchange_order_id=p_order_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'exit order is not linked to position'; END IF;
 SELECT coalesce(sum(quantity),0) INTO gross FROM agentos.trade_exit_fills WHERE position_id=pos.id AND order_id=p_order_id;
 IF gross <> p_executed THEN RAISE EXCEPTION 'exit fills incomplete'; END IF;
 IF attempt.state='settled' THEN RETURN jsonb_build_object('status','already_settled','position_state',pos.state); END IF;
 IF attempt.state NOT IN ('submitted','confirmed','unknown') OR pos.state NOT IN ('exit_pending','exit_unknown','requires_attention','closed') THEN RAISE EXCEPTION 'exit is not pending'; END IF;
 IF pos.state='closed' THEN next_state:='closed';
 ELSIF p_executed>0 AND p_status IN ('FILLED','CANCELED','EXPIRED') THEN next_state:='open';
 ELSE next_state:='requires_attention'; END IF;
 UPDATE agentos.live_trade_order_attempts SET state='settled',updated_at=now() WHERE id=attempt.id;
 UPDATE agentos.live_trade_positions SET state=next_state,last_error=CASE WHEN next_state='requires_attention' THEN 'exit_not_executed' ELSE NULL END,updated_at=now() WHERE id=pos.id;
 RETURN jsonb_build_object('status','settled','position_state',next_state);
END $$;
REVOKE ALL ON FUNCTION agentos.finalize_tabdeal_exit_attempt(bigint,text,text,numeric) FROM PUBLIC;
