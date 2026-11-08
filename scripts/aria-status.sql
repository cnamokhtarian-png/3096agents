-- Read-only production health report. No secret values or outbound requests.
SELECT j.jobname,j.schedule,j.active,
 (SELECT max(dispatched_at) FROM agentos.aria_scheduler_dispatches) AS last_dispatch,
 (SELECT max(finished_at) FROM agentos.cron_runs WHERE job='aria' AND status='ok') AS last_success,
 (SELECT count(*) FROM agentos.live_trade_positions WHERE state='requires_attention') AS needs_attention
FROM cron.job j WHERE j.jobname='aria-minute';
SELECT d.dispatched_at,r.status_code,r.timed_out,r.error_msg
 FROM agentos.aria_scheduler_dispatches d LEFT JOIN net._http_response r ON r.id=d.request_id
 ORDER BY d.dispatched_at DESC LIMIT 10;
-- pg_net responses have limited retention. Persistent application outcomes are
-- in cron_runs; pg_cron dispatch success alone does not certify HTTP success.
SELECT id,status,duration_ms,finished_at FROM agentos.cron_runs
 WHERE job='aria' ORDER BY id DESC LIMIT 10;
