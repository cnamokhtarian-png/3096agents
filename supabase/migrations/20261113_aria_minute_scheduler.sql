-- Independent external scheduler for deployments without minute-level Vercel Cron.
-- Provision aria_minute_cron_token in Vault and ARIA_CRON_SECRET in the deployment
-- through secret managers; never put their value in this migration or cron text.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE TABLE agentos.aria_scheduler_dispatches (
 request_id bigint PRIMARY KEY, dispatched_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON agentos.aria_scheduler_dispatches FROM PUBLIC;
CREATE FUNCTION agentos.dispatch_aria_minute() RETURNS bigint
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,agentos AS $$
DECLARE token text; request bigint;
BEGIN
 SELECT decrypted_secret INTO token FROM vault.decrypted_secrets WHERE name='aria_minute_cron_token';
 IF token IS NULL OR length(token)<32 THEN RAISE EXCEPTION 'aria scheduler credential unavailable'; END IF;
 SELECT net.http_get(url:='https://freelance-agent-os.vercel.app/api/cron/tick?job=aria',
  headers:=jsonb_build_object('x-aria-cron-secret',token),timeout_milliseconds:=110000) INTO request;
 INSERT INTO agentos.aria_scheduler_dispatches(request_id) VALUES(request);
 RETURN request;
END $$;
REVOKE ALL ON FUNCTION agentos.dispatch_aria_minute() FROM PUBLIC;
DO $$ DECLARE job bigint; BEGIN
 job:=cron.schedule('aria-minute','* * * * *','SELECT agentos.dispatch_aria_minute()');
 PERFORM cron.alter_job(job,active:=false);
END $$;
-- Only activate after a signed probe confirms the intended production release
-- and observation mode. Enable live execution separately, never by deployment.
