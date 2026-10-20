import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnAsync } from '../src/util.js';
import { updateMonitorState, loadState, saveState } from '../src/state.js';
import { matchesSchema } from '../src/schema.js';
import { assessHealth, shouldNotifyHealth, decideNotification } from '../src/health.js';
import { acquireLock } from '../src/lock.js';
import { parseSocketMonitors } from '../src/uptime.js';
import { circuitRetryAt, classifyFailure, isCircuitOpen } from '../src/ai-circuit.js';

test('nonzero exit preserves diagnostics', async () => {
  await assert.rejects(spawnAsync(process.execPath, ['--input-type=module', '-e', 'import {writeSync} from "node:fs";writeSync(2,"failed");process.exitCode=7']), e => e.exitCode === 7 && e.stderr.includes('failed'));
});
test('timeout and output bounds terminate children', async () => {
  await assert.rejects(spawnAsync(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeout: 100 }), { code: 'TIMEOUT' });
  await assert.rejects(spawnAsync(process.execPath, ['--input-type=module', '-e', 'import {writeSync} from "node:fs";writeSync(1,"x".repeat(10000))'], { maxBuffer: 100 }), { code: 'MAX_BUFFER' });
});
test('DOWN through PENDING still recovers', () => {
  const state = {};
  for (const status of [0, 2]) updateMonitorState(state, { id: 1, name: 'fixture', status });
  assert.equal(updateMonitorState(state, { id: 1, status: 1 }).isRecovered, true);
});
test('state persists and corruption is not silently discarded', () => {
  const dir = mkdtempSync(join(tmpdir(), 'uptime-test-'));
  try {
    const path = join(dir, 'state.json');
    assert.deepEqual(loadState(path), {});
    saveState({ example: 1 }, path);
    assert.deepEqual(loadState(path), { example: 1 });
    writeFileSync(path, '{');
    assert.throws(() => loadState(path));
  } finally { rmSync(dir, { recursive: true }); }
});
test('schema enforces nested types and unknown fields', () => {
  const schema = { type: 'object', required: ['score'], additionalProperties: false, properties: { score: { type: 'integer', minimum: 0, maximum: 100 } } };
  assert.equal(matchesSchema({ score: 50 }, schema), true);
  for (const value of [{}, { score: '50' }, { score: 101 }, { score: 50, extra: true }]) assert.equal(matchesSchema(value, schema), false);
});
test('health catches warning-only conditions and missing data', () => {
  assert.equal(assessHealth([{ id: 1, status: 1, ping: 1001 }]).severity, 'OK');
  assert.equal(assessHealth([{ id: 1, status: 1, uptime24h: 98 }]).severity, 'WARNING');
  assert.equal(assessHealth([{ id: 1, status: -1 }]).severity, 'WARNING');
  assert.equal(assessHealth([{ id: 1, status: 0 }]).severity, 'CRITICAL');
  assert.equal(assessHealth([{ id: 1, status: 1, ping: 10 }]).severity, 'OK');
});
test('warning monitor churn waits for the repeat interval', () => {
  const previous = { severity: 'WARNING', fingerprint: '1:slow', sentAt: 1_000 };
  const current = { severity: 'WARNING', fingerprint: '2:slow' };
  assert.equal(shouldNotifyHealth(current, previous, 2_000, 10_000), false);
  assert.equal(shouldNotifyHealth(current, previous, 11_001, 10_000), true);
  assert.equal(shouldNotifyHealth({ severity: 'CRITICAL' }, previous, 2_000, 10_000), true);
});
test('run lock excludes concurrent processes and releases', () => {
  const dir = mkdtempSync(join(tmpdir(), 'uptime-lock-test-'));
  try {
    const path = join(dir, 'run.lock');
    const release = acquireLock(path);
    assert.throws(() => acquireLock(path), { code: 'EEXIST' });
    release();
    acquireLock(path)();
  } finally { rmSync(dir, { recursive: true }); }
});
test('short heartbeat history does not invent SLA uptime', () => {
  const now = new Date().toISOString();
  const [monitor] = parseSocketMonitors({ 1: { name: 'fixture', type: 'http', active: true } }, { 1: [{ status: 1, time: now }] });
  assert.equal(monitor.uptime24h, null);
  assert.equal(monitor.uptime30d, null);
});
test('Codex permanent failures open a bounded circuit', () => {
  const now = new Date('2026-09-09T10:00:00').getTime();
  const detail = "You've hit your usage limit. Try again at 11:15 AM.";
  const retryAt = circuitRetryAt(detail, now, 60);
  assert.equal(classifyFailure(detail), 'permanent');
  assert.equal(isCircuitOpen({ retryAt }, now), true);
  assert.equal(new Date(retryAt).getHours(), 11);
  assert.equal(new Date(retryAt).getMinutes(), 15);
});
test('Codex transient failures do not open a circuit', () => {
  assert.equal(classifyFailure('Process timed out'), 'transient');
  assert.equal(isCircuitOpen({ retryAt: 1 }, 2), false);
});
test('high ping alone does not affect health', () => {
  const beats = [{ status: 1 }, { status: 1 }];
  const health = assessHealth([{ id: 1, status: 1, ping: 5000, recentStatuses: beats }]);
  assert.equal(health.severity, 'OK');
  assert.equal(health.fingerprint, '');
});
test('OK sends only genuine recovery messages', () => {
  const base = { severity: 'OK', recoveries: [], isPartial: false, needsAlert: true };
  assert.equal(decideNotification({ ...base, needsAlert: false }), 'skip');
  assert.equal(decideNotification(base), 'skip');
  assert.equal(decideNotification({ ...base, recoveries: ['api'] }), 'recovery');
  assert.equal(decideNotification({ ...base, isPartial: true }), 'full');
  assert.equal(decideNotification({ ...base, severity: 'WARNING' }), 'full');
});
