// End-to-end check of the reporting gate against a real Postgres (PGlite, WASM).
// Run: node --experimental-strip-types scripts/verify-report-gate.ts
//
// It exercises src/lib/report-schedule-core.ts + the SQL behaviour behind
// src/lib/report-schedule.ts (settings upsert + default = manual) so we know the
// app really stops periodic Telegram reports, not just in unit tests.
import { PGlite } from '@electric-sql/pglite';
import {
  PERIODIC_REPORTS_SETTING_KEY,
  periodicReportDecision,
  reportModeFromSetting,
  settingValueForMode,
} from '../src/lib/report-schedule-core.ts';

const pg = new PGlite();
let failures = 0;
function check(name: string, cond: boolean) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) failures++;
}

await pg.exec(`
  create schema if not exists agentos;
  create table if not exists agentos.settings (
    id serial primary key,
    key text not null unique,
    value text not null default ''
  );
`);

// Exactly the query used by reportMode(): no row => manual.
async function reportMode(): Promise<'manual' | 'auto'> {
  const r = await pg.query<{ value: string }>(
    'select value from agentos.settings where key = $1 limit 1',
    [PERIODIC_REPORTS_SETTING_KEY],
  );
  return reportModeFromSetting(r.rows[0]?.value);
}

// Exactly the upsert used by setReportMode().
async function setReportMode(mode: 'manual' | 'auto') {
  await pg.query(
    `insert into agentos.settings (key, value) values ($1, $2)
     on conflict (key) do update set value = excluded.value`,
    [PERIODIC_REPORTS_SETTING_KEY, settingValueForMode(mode)],
  );
}

check('no settings row yet → manual (nothing scheduled is sent)', (await reportMode()) === 'manual');
check(
  'cron "reports" job in manual mode is skipped',
  periodicReportDecision({ mode: await reportMode(), periodic: true }).send === false,
);
check(
  'manager on-demand report still passes in manual mode',
  periodicReportDecision({ mode: await reportMode(), periodic: false }).send === true,
);

await setReportMode('auto');
check('after switching to auto the row says true', (await reportMode()) === 'auto');
check(
  'scheduled cron report is allowed in auto mode',
  periodicReportDecision({ mode: await reportMode(), periodic: true }).send === true,
);

await setReportMode('manual');
check('switching back to manual persists false', (await reportMode()) === 'manual');
check(
  'only one settings row exists (upsert, not duplicate)',
  Number((await pg.query<{ n: string }>('select count(*) as n from agentos.settings')).rows[0].n) === 1,
);
check(
  'cron report is blocked again',
  periodicReportDecision({ mode: await reportMode(), periodic: true }).send === false,
);

await pg.close();
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
