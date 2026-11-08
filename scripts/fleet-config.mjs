import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const paths = { CRON_SECRET: 'cron', TELEGRAM_BOT_TOKEN: 'telegram', TELEGRAM_ADMIN_CHAT_ID: 'telegram', DATABASE_URL: 'database' };
// Read afresh each cycle; shell environment takes precedence, matching the app.
export function loadSettings(env = process.env, directory = root) {
  const read = (name) => {
    try { return readFileSync(resolve(directory, name), 'utf8'); }
    catch (e) { if (e.code !== 'ENOENT') console.error(`[fleet-loop] Cannot read ${name}: ${e.code}`); return ''; }
  };
  let file = {};
  const json = read('config.json');
  if (json) {
    try { file = JSON.parse(json); }
    catch { console.error('[fleet-loop] config.json is invalid JSON'); }
  }
  const local = parse(read('.env.local'));
  const fallback = parse(read('.env'));
  return (key) => String(env[key] || file?.[paths[key]]?.[key] || local[key] || fallback[key] || '').trim();
}
