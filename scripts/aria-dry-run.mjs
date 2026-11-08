/** Deterministic offline regression simulation, NOT a profitability backtest. */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
if (args.length > 1 || (args[0] !== undefined && !/^(?:[1-9]|1[0-9]|20)$/.test(args[0]))) {
  console.error('Usage: npm run aria:dry-run -- [1..20 repetitions]');
  process.exit(2);
}
const repetitions = Number(args[0] ?? 1);
const suites = [
  'aria-cycle', 'entry-order-core', 'exit-monitor-core', 'reconcile-exit',
  'trade-entry-migration', 'trade-ledger-migration', 'tabdeal-market', 'trade-settlement',
  'paper-monitor',
].map(name => `tests/${name}.test.mjs`);
const output = path.join(root, 'reports/aria-dry-run');
mkdirSync(output, { recursive: true });
const runs = [];
for (let i = 1; i <= repetitions; i++) {
  console.log(`Offline Aria regression ${i}/${repetitions}`);
  // Do not inherit production keys, NODE_OPTIONS, database URLs or dotenv config.
  const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'TEMP', 'SystemRoot']
    .filter(key => process.env[key]).map(key => [key, process.env[key]]));
  env.AGENT_TRADING_ENABLED = 'false';
  env.TRADE_LIFECYCLE_ENABLED = 'false';
  const result = spawnSync(process.execPath, [
    '--require', './scripts/testing/offline-guard.cjs',
    '--experimental-strip-types', '--test', ...suites,
  ], { cwd: root, env, encoding: 'utf8', timeout: 180000, maxBuffer: 8 * 1024 * 1024 });
  const passed = result.status === 0 && !result.error;
  writeFileSync(path.join(output, `run-${i}.tap`), `${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  runs.push({ iteration: i, passed, exitCode: result.status, error: result.error?.code ?? null });
  if (!passed) break;
}
const report = {
  mode: 'offline-regression', generatedAt: new Date().toISOString(),
  passed: runs.length === repetitions && runs.every(run => run.passed),
  requestedRepetitions: repetitions, suites, runs,
  database: 'ephemeral in-memory PGlite; discarded after tests',
  network: 'blocked by preload guard; production environment not inherited',
  actualOrders: 0, productionChanges: false,
  limitations: [
    'Not a market backtest or paper trading with live prices.',
    'Fixture amounts and symbols vary; this is not an ETHUSDT 1.8 USDT execution.',
    'Does not validate exchange minimums, production permissions, scheduler or connectivity.',
    'Repeated deterministic tests do not establish profitability or eliminate bugs.',
  ],
};
writeFileSync(path.join(output, 'summary.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
