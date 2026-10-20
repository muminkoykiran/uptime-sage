/**
 * agy (Antigravity) CLI saglayicisi — agy -p ile yapisal analiz uretir.
 * Bos gecici dizinde calisir: repo dosyalari ve .env agy'ye acilmaz.
 */

import { join } from 'path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnAsync } from '../util.js';
import { logOperational } from '../logger.js';

const ROOT = join(import.meta.dirname, '..', '..');
const SCHEMA_PATH = join(ROOT, 'config', 'analysis-schema.json');
const log = (message, level = 'log') => logOperational(`[AGY] ${message}`, level);

function lastJsonLine(text) {
  for (const line of String(text).split('\n').reverse()) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try { return JSON.parse(trimmed); } catch { /* sonraki satir */ }
  }
  return null;
}

// agy --output-format json ciktisini analiz nesnesine cevirir; ERROR durumunda hata firlatir.
export function parseAgyOutput(stdout, isValid) {
  let result;
  try { result = JSON.parse(stdout); } catch { return null; }
  if (result?.status === 'ERROR') throw new Error(result.error || 'agy hatasi');
  if (isValid(result?.structured_output)) return result.structured_output;
  const fromResponse = lastJsonLine(result?.response);
  return isValid(fromResponse) ? fromResponse : null;
}

function failureDetail(err) {
  try {
    const result = JSON.parse(err.stdout ?? '');
    if (result?.error) return String(result.error).replace(/[\r\n]+/g, ' ').slice(0, 500);
  } catch { /* JSON degil */ }
  return '';
}

async function run(prompt, { timeout, isValid }) {
  const bin = process.env.AGY_BIN || 'agy';
  const model = process.env.AGY_MODEL || 'gemini-3.8-flash-high';
  const workDir = mkdtempSync(join(tmpdir(), 'agy-analysis-'));
  log('Analiz başladı');
  try {
    const { stdout } = await spawnAsync(
      bin,
      ['-p', prompt, '--model', model, '--sandbox', '--disable-slash-commands',
       '--output-format', 'json', '--json-schema', SCHEMA_PATH,
       '--print-timeout', `${Math.round(timeout / 1000)}s`],
      {
        cwd: workDir,
        timeout: timeout + 15_000,
        killSignal: 'SIGKILL',
        onStderr: chunk => { for (const line of chunk.split('\n')) if (line.trim()) log(`stderr: ${line.trim()}`, 'error'); },
      }
    );
    const parsed = parseAgyOutput(stdout, isValid);
    if (parsed) log('Analiz tamamlandı');
    return parsed;
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

export default { name: 'agy', run, failureDetail, backoffMinutes: () => Number(process.env.AGY_FAILURE_BACKOFF_MINUTES) || 60 };
