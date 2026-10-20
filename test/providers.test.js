import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeMonitors, resolveProviders } from '../src/analyzer.js';
import { parseAgyOutput } from '../src/providers/agy.js';
import { classifyFailure } from '../src/ai-circuit.js';
import { aggregateStats } from '../src/uptime.js';

const valid = a => Boolean(a?.telegramMessage);
const analysis = { severity: 'OK', healthScore: 100, summary: 's', criticalIssues: [], warnings: [], actions: [], telegramMessage: 'ok', detailedReport: 'r' };
const monitors = [
  { id: 1, name: 'up', status: 1, statusText: 'UP', ping: 5000, recentStatuses: [] },
  { id: 2, name: 'wait', status: 2, statusText: 'PENDING', ping: null, recentStatuses: [] },
];
const stats = aggregateStats(monitors, 'test');
const fake = (name, run, extra = {}) => ({ name, run, failureDetail: e => e.message, backoffMinutes: () => 60, ...extra });
const call = options => analyzeMonitors(monitors, stats, 'now', 'UTC', [], options);

test('parseAgyOutput reads structured output, response fallback and errors', () => {
  const ok = JSON.stringify({ status: 'SUCCESS', structured_output: analysis });
  assert.deepEqual(parseAgyOutput(ok, valid), analysis);
  const viaResponse = JSON.stringify({ status: 'SUCCESS', response: `text\n${JSON.stringify(analysis)}\n` });
  assert.deepEqual(parseAgyOutput(viaResponse, valid), analysis);
  assert.equal(parseAgyOutput(JSON.stringify({ status: 'SUCCESS', structured_output: {} }), valid), null);
  assert.equal(parseAgyOutput('not json', valid), null);
  assert.throws(() => parseAgyOutput(JSON.stringify({ status: 'ERROR', error: 'invalid model selection' }), valid), /invalid model selection/);
});

test('agy failure patterns are permanent', () => {
  assert.equal(classifyFailure('invalid model selection (--model "x")'), 'permanent');
  assert.equal(classifyFailure('RESOURCE_EXHAUSTED'), 'permanent');
  assert.equal(classifyFailure('Process timed out'), 'transient');
});

test('permanent agy failure opens its circuit and falls through to codex', async () => {
  const calls = [];
  const agy = fake('agy', async () => { calls.push('agy'); throw new Error('invalid model selection'); });
  const codex = fake('codex', async () => { calls.push('codex'); return { ...analysis }; });
  const result = await call({ providers: [agy, codex], now: 1000 });
  assert.deepEqual(calls, ['agy', 'codex']);
  const [first, second] = result._aiOutcomes;
  assert.equal(first.status, 'open');
  assert.ok(first.retryAt > 1000);
  assert.equal(second.status, 'success');
});

test('open circuit skips provider without calling it', async () => {
  let called = false;
  const agy = fake('agy', async () => { called = true; return { ...analysis }; });
  const codex = fake('codex', async () => ({ ...analysis }));
  const result = await call({ providers: [agy, codex], circuits: { agy: { retryAt: 5000, reason: 'x' } }, now: 1000 });
  assert.equal(called, false);
  assert.equal(result._aiOutcomes[0].status, 'skipped');
  assert.equal(result._aiOutcomes[1].status, 'success');
});

test('all providers failing yields fallback without ping warning but with PENDING', async () => {
  const bad = name => fake(name, async () => { throw new Error('boom'); });
  const result = await call({ providers: [bad('agy'), bad('codex')], now: 1000 });
  assert.equal(result.severity, 'WARNING');
  assert.match(result.telegramMessage, /wait/);
  assert.doesNotMatch(result.telegramMessage, /yüksek ping/);
  assert.equal(result._aiOutcomes.length, 2);
});

test('resolveProviders honours order and drops unknown names', () => {
  assert.deepEqual(resolveProviders('codex, agy').map(p => p.name), ['codex', 'agy']);
  assert.deepEqual(resolveProviders('agy,nope').map(p => p.name), ['agy']);
});
