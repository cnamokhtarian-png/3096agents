import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeReportMode,
  periodicReportDecision,
  reportModeFromSetting,
  settingValueForMode,
} from '../src/lib/report-schedule-core.ts';

test('default report mode is manual when the setting is missing or empty', () => {
  assert.equal(reportModeFromSetting(undefined), 'manual');
  assert.equal(reportModeFromSetting(null), 'manual');
  assert.equal(reportModeFromSetting(''), 'manual');
  assert.equal(reportModeFromSetting('false'), 'manual');
  assert.equal(reportModeFromSetting(' garbage '), 'manual');
});

test('only an explicit true turns periodic reports on', () => {
  assert.equal(reportModeFromSetting('true'), 'auto');
  assert.equal(reportModeFromSetting(' TRUE '), 'auto');
  assert.equal(settingValueForMode('manual'), 'false');
  assert.equal(settingValueForMode('auto'), 'true');
});

test('manual mode blocks every scheduled report', () => {
  assert.deepEqual(periodicReportDecision({ mode: 'manual', periodic: true }), {
    send: false,
    reason: 'manual_mode',
  });
});

test('manual mode still allows on-demand reports requested by the manager', () => {
  assert.deepEqual(periodicReportDecision({ mode: 'manual', periodic: false }), {
    send: true,
    reason: 'on_demand',
  });
});

test('auto mode allows scheduled and on-demand reports', () => {
  assert.deepEqual(periodicReportDecision({ mode: 'auto', periodic: true }), {
    send: true,
    reason: 'scheduled',
  });
  assert.deepEqual(periodicReportDecision({ mode: 'auto', periodic: false }), {
    send: true,
    reason: 'on_demand',
  });
});

test('mode parser accepts Persian and English aliases but rejects junk', () => {
  assert.equal(normalizeReportMode('خودکار'), 'auto');
  assert.equal(normalizeReportMode('AUTO'), 'auto');
  assert.equal(normalizeReportMode('دستی'), 'manual');
  assert.equal(normalizeReportMode('off'), 'manual');
  assert.equal(normalizeReportMode('whatever'), null);
  assert.equal(normalizeReportMode(undefined), null);
});
