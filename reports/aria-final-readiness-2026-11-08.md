# Aria final technical readiness — 2026-11-08

Supersedes the pending-migration statements in earlier readiness reports.

## Production database changes verified
- Private, same-database pre-migration snapshots of ledger/positions/attempts and
  column metadata created in `aria_recovery_20261108`. All three source tables were empty.
  This is not an offsite backup or a tested disaster recovery procedure.
- Ledger debit/credit migrated to NUMERIC(20,8), checked via information_schema.
- Entry/exit fill tables, third-asset fee ledger and close outbox installed.
- All four SECURITY INVOKER accounting/finalization functions installed.
- Explicit agentos runtime EXECUTE and table/sequence permissions verified.
- RLS enabled for new fill/fee/outbox tables with agentos-only policies.
- Base-asset quantities and third-asset fees remain unconstrained exact NUMERIC
  so sub-1e-8 units cannot silently round away.

## Safety and code
- Dedicated Aria lifecycle, step isolation, per-position error isolation.
- Exact-decimal exit balance comparison replaces lossy JS Number comparison.
- Persisted client IDs and unique execution identities; ambiguous requests are
  queried by identity and never blindly resubmitted.
- Scoped cron credential created in Vercel and Supabase Vault, without rotating
  existing shared credentials or reading exchange secret values.
- Production defaults: ARIA_EXECUTION_MODE=observe; TRADE_LIFECYCLE_ENABLED=false.
- Independent minute pg_cron scheduler installed initially inactive; activation
  requires a successful intended-release probe.

## Verification and explicit limits
- Full offline verification (tests, TypeScript, lint, build) passed.
- No real exchange order or cancellation sent by this work.
- An attempted rollback-only accounting check using SET LOCAL ROLE agentos was
  rejected by the connector DB role. It was not retried under a more privileged
  role. Runtime grants were inspected; this is not a successful role-level test.
- Exchange connectivity, live account permissions, exchange minimums and real
  execution are not certified by offline tests or schema checks.
- Deployment/scheduler result is recorded below only after tool verification.

## Verified release and scheduler
- Full verification result: **73 tests passed, 0 failed**, plus TypeScript, lint and build.
- Separate network-blocked dry-run rerun: **44 tests passed, 0 failed**.
- Production deployment `dpl_ACe6H5LKBHLSxLAPAL46K3j1xha5` is READY/PROMOTED,
  serving commit `1bbe6f689328731ada2f581fa8e9607297ebab98` from the Arena branch.
- Signed scheduler probe request 77 returned HTTP 200, ok=true, mode=observe,
  actualOrders=0, intended commit SHA. Persistent application cron run ID: 73.
- Enabled pg_cron job `aria-minute`, jobid 1, schedule `* * * * *`, only after
  verifying that response. This uses external Supabase scheduling, not a claimed
  minute-level Vercel Hobby Cron entitlement.
- Production counts after probe: positions=0, entry_fills=0, exit_fills=0.
- No new exchange credentials are needed for the completed observation test;
  exchange-side credential validity/trade permissions remain untested.
- `scripts/aria-status.sql` provides read-only dispatch/HTTP/application checks.
- Autonomous minute execution verified after activation: request 78 dispatched at
  2026-11-08 16:38:00 UTC, HTTP 200, not timed out, mode=observe. This is a real
  scheduled tick, distinct from the manual probe; not evidence of live trading.
