/**
 * Codex CLI saglayicisi — codex exec --json ile yapisal analiz uretir.
 */

import { join } from 'path';
import { readFileSync, unlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawnAsync } from '../util.js';
import { logOperational } from '../logger.js';

const ROOT = join(import.meta.dirname, '..', '..');
const SCHEMA_PATH = join(ROOT, 'config', 'analysis-schema.json');
const _isDebug = process.argv.includes('--debug');
const log = (message, level = 'log') => logOperational(`[CODEX] ${message}`, level);

// --json modunda JSONL event stream'den structured output'u parse eder.
// turn.completed event'indeki output alani JSON schema ciktiyi icerir.
function parseJsonlOutput(stdout, isValid) {
  const lines = stdout.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.startsWith('{')) continue;
    try {
      const event = JSON.parse(line);
      if (event.type === 'item.completed' && event.item?.type === 'agent_message') {
        try {
          const parsed = JSON.parse(event.item.text);
          if (isValid(parsed)) return parsed;
        } catch { /* Continue to other supported event shapes. */ }
      }
      // turn.completed → output field contains the schema-validated JSON string
      if (event.type === 'turn.completed' && event.output) {
        try {
          const parsed = JSON.parse(event.output);
          if (isValid(parsed)) return parsed;
        } catch { /* output might not be JSON directly */ }
      }
      // item.completed with assistant message content
      if (event.type === 'item.completed' && event.item?.content) {
        for (const block of (Array.isArray(event.item.content) ? event.item.content : [])) {
          if (block.type === 'text' || block.type === 'output_text') {
            try {
              const parsed = JSON.parse(block.text ?? block.value ?? '');
              if (isValid(parsed)) return parsed;
            } catch { /* not JSON */ }
          }
        }
      }
      // Direct JSON object in event stream (--output-schema response)
      if (isValid(event)) return event;
    } catch { /* not valid JSON */ }
  }
  return null;
}

function failureDetail(err) {
  for (const line of (err.stdout ?? '').split('\n').reverse()) {
    try {
      const event = JSON.parse(line);
      if (!['error', 'turn.failed'].includes(event.type)) continue;
      const detail = event.error?.message ?? event.error?.error?.message ?? event.error?.detail ?? event.message ?? event.error;
      if (detail) return String(detail).replace(/[\r\n]+/g, ' ').slice(0, 500);
    } catch { /* Ignore non-JSON event lines. */ }
  }
  return '';
}

function cleanupTmpFile(path) {
  try { if (existsSync(path)) unlinkSync(path); } catch { /* sessizce gec */ }
}

// Tek bir Codex denemesi: spawn → parse → result veya null (spawn hatası fırlatır)
async function run(prompt, { timeout, isValid }) {
  const codexBin = process.env.CODEX_BIN || 'codex';
  const codexModel = process.env.CODEX_MODEL || 'gpt-5.6-terra';
  const outFile = join(tmpdir(), `codex-analysis-${randomUUID()}.json`);
  const spawnMs = Date.now();
  let lastEventMs = spawnMs;
  const progressTimer = setInterval(() => {
    const now = Date.now();
    const quietSec = Math.round((now - lastEventMs) / 1000);
    if (quietSec >= 25) log(`Muhakeme yapılıyor... (${Math.round((now - spawnMs) / 1000)}s)`);
  }, 30_000);
  const clearProgress = () => clearInterval(progressTimer);

  const onStderr = (chunk) => {
    for (const line of chunk.split('\n')) {
      if (line.trim()) log(`stderr: ${line.trim()}`, 'error');
    }
  };

  const _JBUF_MAX = 512 * 1024;
  let _jBuf = '';
  const onStdout = (chunk) => {
    lastEventMs = Date.now();
    _jBuf += chunk;
    if (_jBuf.length > _JBUF_MAX) _jBuf = _jBuf.slice(-_JBUF_MAX);
    const lines = _jBuf.split('\n');
    _jBuf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      let ev;
      try { ev = JSON.parse(line); } catch { continue; }
      const t = ev.type;
      const item = ev.item ?? {};
      if (t === 'turn.started') {
        log('Analiz başladı');
      } else if (t === 'item.started' && item.type === 'command_execution') {
        const cmd = String(item.command ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
        if (_isDebug && cmd) log(`$ ${cmd}`);
      } else if (t === 'item.completed' && item.type === 'command_execution') {
        if (_isDebug) log(`exit=${item.exit_code ?? '?'}`);
      } else if (t === 'item.completed' && item.type === 'agent_message') {
        log('Yanıt oluşturuldu');
      } else if (t === 'turn.completed') {
        log('Analiz tamamlandı');
      } else if (t === 'error' || t === 'turn.failed') {
        const detail = ev.error?.message ?? ev.error?.error?.message ?? ev.error?.detail ?? ev.message ?? ev.error;
        log(`${t}: ${String(detail || 'ayrıntı yok').replace(/[\r\n]+/g, ' ').slice(0, 500)}`, 'error');
      } else if (_isDebug && t && t !== 'thread.started') {
        log(`event=${t}`);
      }
    }
  };

  let stdout;
  try {
    ({ stdout } = await spawnAsync(
      codexBin,
      ['exec', '--model', codexModel, '--json', '--ephemeral', '--skip-git-repo-check', '--disable', 'codex_hooks',
       '--sandbox', 'read-only', '--output-schema', SCHEMA_PATH,
       '--output-last-message', outFile, prompt],
      { cwd: ROOT, timeout, killSignal: 'SIGKILL', onStdout, onStderr }
    ));
    clearProgress();
  } catch (err) {
    clearProgress();
    cleanupTmpFile(outFile);
    throw err;
  }

  if (existsSync(outFile)) {
    try {
      const fileContent = readFileSync(outFile, 'utf8').trim();
      cleanupTmpFile(outFile);
      if (fileContent) {
        const parsed = JSON.parse(fileContent);
        if (isValid(parsed)) return parsed;
      }
    } catch { /* JSONL'e geç */ }
  }

  cleanupTmpFile(outFile);

  const raw = stdout.trim();
  return raw ? parseJsonlOutput(raw, isValid) : null;
}

export default { name: 'codex', run, failureDetail, backoffMinutes: () => Number(process.env.CODEX_FAILURE_BACKOFF_MINUTES) || 60 };
