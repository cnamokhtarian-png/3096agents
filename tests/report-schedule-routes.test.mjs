import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('vercel.json no longer schedules the periodic reports cron', () => {
  const config = JSON.parse(read('vercel.json'));
  const crons = config.crons ?? [];
  assert.equal(
    crons.some((c) => String(c.path).includes('job=reports')),
    false,
    'the daily reports cron must stay disabled so Telegram only gets reports on demand',
  );
  assert.equal(
    crons.some((c) => String(c.path).includes('job=full')),
    true,
    'the single backup heartbeat cron should remain',
  );
});

test('cron tick gates the reports job and the fleet summary behind the manual/auto switch', () => {
  const route = read('src/app/api/cron/tick/route.ts');
  assert.match(route, /if \(job === "reports"\) \{[\s\S]*allowReportSend\(\{ periodic: true \}\)/);
  assert.match(route, /const reportGate = await allowReportSend\(\{ periodic: true \}\);\s*if \(!reportGate\.send\)/);
  assert.match(route, /steps\.reports = \{\s*sent: 0,\s*skipped: reportGate\.reason/);
});

test('daily reports and COO reports default to periodic (blocked) unless explicitly on-demand', () => {
  const jobs = read('src/lib/jobs.ts');
  assert.match(jobs, /sendDailyReports\(opts: \{ periodic\?: boolean; useAi\?: boolean \} = \{\}\)/);
  assert.match(jobs, /allowReportSend\(\{ periodic: opts\.periodic !== false \}\)/);

  const coo = read('src/lib/coo.ts');
  assert.match(coo, /periodic\?: boolean;/);
  assert.match(coo, /allowReportSend\(\{ periodic: options\?\.periodic !== false \}\)/);
});

test('manual report endpoints always mark requests as on-demand', () => {
  const reports = read('src/app/api/reports/route.ts');
  assert.match(reports, /generateCooExecutiveReport\(\{ sendTelegram: true, periodic: false \}\)/);
  assert.match(reports, /sendDailyReports\(\{ periodic: false, useAi \}\)/);

  const telegramSend = read('src/app/api/telegram/send/route.ts');
  assert.match(telegramSend, /sendDailyReports\(\{ periodic: false \}\)/);
  assert.match(telegramSend, /periodic: false/);
});
