/**
 * SessionStart hook — Codex oturumu baslarken monitor state'i context'e inject eder.
 * Codex bu scriptin stdout'unu ek baglamsal bilgi olarak sistem mesajina ekler.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const STATE_PATH = join(ROOT, 'data', 'state.json');

let output = {};

if (existsSync(STATE_PATH)) {
  try {
    const state = JSON.parse(readFileSync(STATE_PATH, 'utf8'));
    const downMonitors = Object.values(state).filter(m => m.status === 0);

    if (downMonitors.length > 0) {
      const items = downMonitors.map(m => {
        const sinceMs = Date.now() - new Date(m.firstDownAt).getTime();
        const sinceMin = Math.round(sinceMs / 60_000);
        return `${m.name} (${sinceMin} dakikadır DOWN, alert sayisi: ${m.alertCount})`;
      });
      output.systemMessage = `Aktif DOWN monitorler: ${items.join(' | ')}`;
    } else {
      output.systemMessage = 'Tum monitorler UP durumunda (state dosyasina gore).';
    }
  } catch {
    output.systemMessage = 'Monitor state okunamadi.';
  }
} else {
  output.systemMessage = 'Henuz monitor state dosyasi yok — ilk calistirma.';
}

process.stdout.write(JSON.stringify(output) + '\n');
