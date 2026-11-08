-- Prepared locally; requires the live positions migration and review before deployment.
-- An exchange order is never sent by this migration.
CREATE TABLE agentos.trade_entry_fills (
  exchange text NOT NULL CHECK (exchange = 'tabdeal'),
  symbol text NOT NULL,
  trade_id text NOT NULL CHECK (trade_id ~ '^[0-9]{1,30}$'),
  order_id text NOT NULL CHECK (order_id ~ '^[0-9]{1,30}$'),
  position_id bigint NOT NULL REFERENCES agentos.live_trade_positions(id),
  quantity numeric NOT NULL CHECK (quantity > 0),
  quote_amount numeric NOT NULL CHECK (quote_amount > 0),
  fee numeric NOT NULL CHECK (fee >= 0),
  fee_currency text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (exchange, symbol, trade_id)
);

-- The caller fetches each trade directly from the exchange. Position updates and
-- source identity are atomic; duplicates with different contents are rejected.
CREATE OR REPLACE FUNCTION agentos.record_tabdeal_entry_fill(
 p_position_id bigint, p_order_id text, p_trade_id text,
 p_quantity numeric, p_quote_amount numeric, p_fee numeric, p_fee_currency text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, agentos AS $$
DECLARE pos agentos.live_trade_positions%ROWTYPE; prior agentos.trade_entry_fills%ROWTYPE;
        v_base numeric; v_cost numeric;
BEGIN
 IF p_order_id IS NULL OR p_order_id !~ '^[0-9]{1,30}$' OR p_trade_id IS NULL OR p_trade_id !~ '^[0-9]{1,30}$'
    OR p_quantity IS NULL OR p_quote_amount IS NULL OR p_fee IS NULL OR p_fee_currency IS NULL
    OR p_quantity::text IN ('NaN','Infinity','-Infinity') OR p_quote_amount::text IN ('NaN','Infinity','-Infinity') OR p_fee::text IN ('NaN','Infinity','-Infinity')
    OR p_quantity <= 0 OR p_quote_amount <= 0 OR p_fee < 0 OR p_fee_currency !~ '^[A-Z0-9]{2,15}$' THEN RAISE EXCEPTION 'invalid trade fill'; END IF;
 SELECT * INTO pos FROM agentos.live_trade_positions WHERE id=p_position_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'position not found'; END IF;
 SELECT * INTO prior FROM agentos.trade_entry_fills WHERE exchange='tabdeal' AND symbol=pos.symbol AND trade_id=p_trade_id;
 IF FOUND THEN
   IF prior.position_id <> p_position_id OR prior.order_id <> p_order_id OR prior.quantity <> p_quantity OR prior.quote_amount <> p_quote_amount OR prior.fee <> p_fee OR prior.fee_currency <> p_fee_currency THEN
     RAISE EXCEPTION 'source trade identity conflict';
   END IF;
   RETURN jsonb_build_object('status','already_recorded');
 END IF;
 IF pos.exchange <> 'tabdeal' OR pos.quote_asset <> 'USDT' THEN
   RAISE EXCEPTION 'fee or quote currency requires reconciliation';
 END IF;
 IF pos.state NOT IN ('entry_pending','entry_unknown','requires_attention') THEN RAISE EXCEPTION 'entry is not pending'; END IF;
 IF NOT EXISTS (SELECT 1 FROM agentos.live_trade_order_attempts a WHERE a.position_id=pos.id AND a.purpose='entry'
   AND a.exchange_order_id=p_order_id AND a.state IN ('submitted','confirmed','unknown')) THEN RAISE EXCEPTION 'entry order is not linked to position'; END IF;
 v_base := p_quantity - CASE WHEN p_fee_currency=pos.base_asset THEN p_fee ELSE 0 END;
 v_cost := p_quote_amount + CASE WHEN p_fee_currency=pos.quote_asset THEN p_fee ELSE 0 END;
 IF v_base <= 0 THEN RAISE EXCEPTION 'invalid net quantity'; END IF;
 IF v_cost <> round(v_cost,8) OR abs(v_cost) >= 1000000000000 THEN RAISE EXCEPTION 'entry cost exceeds ledger precision'; END IF;
 INSERT INTO agentos.trade_entry_fills(exchange,symbol,trade_id,order_id,position_id,quantity,quote_amount,fee,fee_currency)
 VALUES ('tabdeal',pos.symbol,p_trade_id,p_order_id,pos.id,p_quantity,p_quote_amount,p_fee,p_fee_currency);
 INSERT INTO agentos.ledger_entries(entry_group,account_code,agent_name,debit_usdt,credit_usdt,kind,ref_type,ref_id,idempotency_key,meta)
 VALUES
   ('tabdeal:'||pos.symbol||':'||p_trade_id||':entry','trade_inventory','Aria',v_cost,0,'trade_entry_cost','position',pos.id::text,'tabdeal:'||pos.symbol||':'||p_trade_id||':entry_inventory',jsonb_build_object('fee',p_fee,'fee_currency',p_fee_currency,'gross_base',p_quantity)),
   ('tabdeal:'||pos.symbol||':'||p_trade_id||':entry','exchange','Aria',0,v_cost,'trade_entry_cost','position',pos.id::text,'tabdeal:'||pos.symbol||':'||p_trade_id||':entry_exchange',jsonb_build_object('fee',p_fee,'fee_currency',p_fee_currency));
 IF p_fee > 0 AND p_fee_currency NOT IN (pos.base_asset,pos.quote_asset) THEN
   INSERT INTO agentos.trade_external_fee_ledger(position_id,entry_group,asset,account_code,debit,credit,idempotency_key)
   VALUES (pos.id,'tabdeal:'||pos.symbol||':'||p_trade_id||':external_fee',p_fee_currency,'fee_expense',p_fee,0,'tabdeal:'||pos.symbol||':'||p_trade_id||':fee_expense'),
          (pos.id,'tabdeal:'||pos.symbol||':'||p_trade_id||':external_fee',p_fee_currency,'exchange_asset',0,p_fee,'tabdeal:'||pos.symbol||':'||p_trade_id||':fee_asset');
 END IF;
 UPDATE agentos.live_trade_positions SET has_unvalued_fees=has_unvalued_fees OR (p_fee > 0 AND p_fee_currency NOT IN (pos.base_asset,pos.quote_asset)),
   filled_base=coalesce(filled_base,0)+v_base, entry_quote=coalesce(entry_quote,0)+v_cost,
   updated_at=now() WHERE id=pos.id;
 RETURN jsonb_build_object('status','recorded');
END $$;
REVOKE ALL ON FUNCTION agentos.record_tabdeal_entry_fill(bigint,text,text,numeric,numeric,numeric,text) FROM PUBLIC;

-- Only open a position once a terminal order's gross executed quantity agrees
-- exactly with the sum of independently reconciled exchange trades.
CREATE OR REPLACE FUNCTION agentos.finalize_tabdeal_entry(
 p_position_id bigint, p_order_id text, p_status text, p_executed numeric
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, agentos AS $$
DECLARE pos agentos.live_trade_positions%ROWTYPE; v_gross numeric;
BEGIN
 IF p_order_id IS NULL OR p_order_id !~ '^[0-9]{1,30}$' OR p_status IS NULL OR p_status NOT IN ('FILLED','CANCELED','REJECTED','EXPIRED')
   OR p_executed IS NULL OR p_executed::text IN ('NaN','Infinity','-Infinity') OR p_executed < 0 THEN RAISE EXCEPTION 'invalid terminal entry'; END IF;
 SELECT * INTO pos FROM agentos.live_trade_positions WHERE id=p_position_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'position not found'; END IF;
 IF NOT EXISTS (SELECT 1 FROM agentos.live_trade_order_attempts a WHERE a.position_id=pos.id AND a.purpose='entry' AND a.exchange_order_id=p_order_id
   AND a.state IN ('submitted','confirmed','unknown')) THEN RAISE EXCEPTION 'entry order is not linked to position'; END IF;
 SELECT coalesce(sum(quantity),0) INTO v_gross FROM agentos.trade_entry_fills WHERE position_id=pos.id AND order_id=p_order_id;
 IF v_gross <> p_executed OR (p_status='FILLED' AND p_executed=0) THEN RAISE EXCEPTION 'entry fills incomplete'; END IF;
 IF pos.state = 'open' AND p_executed>0 THEN RETURN jsonb_build_object('status','already_open'); END IF;
 IF pos.state NOT IN ('entry_pending','entry_unknown','requires_attention') THEN RAISE EXCEPTION 'entry is not pending'; END IF;
 IF p_executed>0 AND (pos.filled_base IS NULL OR pos.filled_base<=0 OR pos.entry_quote IS NULL OR pos.entry_quote<=0) THEN RAISE EXCEPTION 'entry totals incomplete'; END IF;
 UPDATE agentos.live_trade_positions SET state=CASE WHEN p_executed>0 THEN 'open' ELSE 'requires_attention' END,
   opened_at=CASE WHEN p_executed>0 THEN now() ELSE NULL END, updated_at=now(),
   last_error=CASE WHEN p_executed=0 THEN 'entry_without_fills' ELSE NULL END WHERE id=pos.id;
 RETURN jsonb_build_object('status',CASE WHEN p_executed>0 THEN 'open' ELSE 'requires_attention' END);
END $$;
REVOKE ALL ON FUNCTION agentos.finalize_tabdeal_entry(bigint,text,text,numeric) FROM PUBLIC;
