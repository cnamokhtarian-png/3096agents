// تغییر حالت گزارش دوره‌ای تلگرام بدون باز کردن پنل.
//
//   node scripts/reports-mode.mjs           → وضعیت فعلی
//   node scripts/reports-mode.mjs manual    → توقف گزارش دوره‌ای (پیش‌فرض سیستم)
//   node scripts/reports-mode.mjs auto      → روشن کردن گزارش دوره‌ای
//
// کلیدهای دیتابیس مثل بقیه اسکریپت‌ها از env / config.json / .env.local خوانده
// می‌شوند (همان منطق scripts/fleet-config.mjs).
import pg from 'pg';
import { loadSettings } from './fleet-config.mjs';

const KEY = 'periodic_reports_enabled';
const arg = String(process.argv[2] || '').trim().toLowerCase();
if (arg && !['manual', 'auto', 'off', 'on'].includes(arg)) {
  console.error('usage: node scripts/reports-mode.mjs [manual|auto]');
  process.exit(2);
}

const setting = loadSettings();
const databaseUrl = setting('DATABASE_URL');
if (!databaseUrl) {
  console.error('[reports-mode] DATABASE_URL not found in env, config.json or .env.local');
  process.exit(1);
}

const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: /localhost|127\.0\.0\.1/.test(databaseUrl) ? undefined : { rejectUnauthorized: false },
});

try {
  await client.connect();
  if (!arg) {
    const r = await client.query('select value from agentos.settings where key = $1', [KEY]);
    const mode = String(r.rows[0]?.value ?? '').trim().toLowerCase() === 'true' ? 'auto' : 'manual';
    console.log(`periodic telegram reports: ${mode}${mode === 'manual' ? ' (only on demand)' : ''}`);
  } else {
    const mode = ['auto', 'on'].includes(arg) ? 'auto' : 'manual';
    const value = mode === 'auto' ? 'true' : 'false';
    await client.query(
      `insert into agentos.settings (key, value) values ($1, $2)
       on conflict (key) do update set value = excluded.value`,
      [KEY, value],
    );
    console.log(
      mode === 'manual'
        ? '✅ periodic telegram reports disabled — reports only on demand'
        : '⚠️ periodic telegram reports enabled — cron/fleet may send reports again',
    );
  }
} finally {
  await client.end().catch(() => {});
}
