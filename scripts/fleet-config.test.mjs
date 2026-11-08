import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSettings } from './fleet-config.mjs';

test('configuration precedence and reload without printing secrets', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fleet-config-'));
  try {
    writeFileSync(join(dir, '.env'), 'CRON_SECRET=envfile\n');
    writeFileSync(join(dir, '.env.local'), 'CRON_SECRET="local"\n');
    assert.equal(loadSettings({}, dir)('CRON_SECRET'), 'local');
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ cron: { CRON_SECRET: 'config' } }));
    assert.equal(loadSettings({}, dir)('CRON_SECRET'), 'config');
    assert.equal(loadSettings({ CRON_SECRET: 'shell' }, dir)('CRON_SECRET'), 'shell');
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ cron: { CRON_SECRET: 'new' } }));
    assert.equal(loadSettings({}, dir)('CRON_SECRET'), 'new');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
