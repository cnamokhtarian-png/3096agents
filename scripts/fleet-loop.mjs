// Local, non-overlapping scheduler. Start the app separately with npm run dev.
import { loadSettings } from './fleet-config.mjs';
const url = new URL(process.env.FLEET_LOCAL_URL || 'http://127.0.0.1:3000');
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.protocol !== 'http:') {
  throw new Error('FLEET_LOCAL_URL must be a local HTTP address');
}
const interval = Number(process.env.FLEET_INTERVAL_MS || 1800000);
if (!Number.isFinite(interval) || interval < 60000) throw new Error('FLEET_INTERVAL_MS must be at least 60000');
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
async function reportFailure(message, setting) {
  console.error(`[fleet-loop] ${message}`);
  const token = setting('TELEGRAM_BOT_TOKEN');
  const chat = setting('TELEGRAM_ADMIN_CHAT_ID');
  if (!token || !chat) {
    console.error('[fleet-loop] Telegram unavailable: TELEGRAM_BOT_TOKEN or TELEGRAM_ADMIN_CHAT_ID missing');
    return;
  }
  try {
    const send = () => fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: `خطای چرخه محلی: ${message}` }),
      signal: AbortSignal.timeout(8000),
    });
    let response = await send();
    // Only retry an explicit rate-limit rejection; timeouts may have delivered the message.
    if (response.status === 429) { await delay(2000); response = await send(); }
    if (!response.ok) console.error(`[fleet-loop] Telegram send failed: HTTP ${response.status}`);
  } catch { console.error('[fleet-loop] Telegram send failed: network or timeout (delivery unknown)'); }
}
async function tick() {
  const setting = loadSettings();
  const secret = setting('CRON_SECRET');
  if (!secret) { await reportFailure('CRON_SECRET تنظیم نشده است', setting); return false; }
  try {
    const response = await fetch(new URL('/api/cron/tick', url), {
      method: 'POST', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ job: 'full' }), signal: AbortSignal.timeout(240000),
    });
    const result = await response.json().catch(() => ({}));
    console.log(`[fleet-loop] ${new Date().toISOString()} ${JSON.stringify(result)}`);
    if (!response.ok || !result.ok) {
      await reportFailure(`کرون ناموفق: HTTP ${response.status}؛ ${result.error || 'خطای نامشخص'}`, setting);
      return true; // The server may have executed some jobs; do not immediately repeat.
    }
    // A partial run already sends its own detailed fleet report. Avoid immediate
    // re-running jobs that may have succeeded before the failure.
    return true;
  } catch (e) {
    await reportFailure(`ارتباط با سرور محلی کرون ناموفق است: ${e.name === 'TimeoutError' ? 'timeout؛ وضعیت اجرای کرون نامشخص است' : 'network error؛ وضعیت اجرا نامشخص است'}`, setting);
    // Do not immediately repeat an ambiguous request that may have executed jobs.
    return true;
  }
}
while (true) {
  const completed = await tick();
  await delay(completed ? interval : Math.min(interval, 60000));
}
