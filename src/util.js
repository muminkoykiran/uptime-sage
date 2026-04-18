/**
 * Paylasilan yardimci fonksiyonlar.
 * Tum modullerin kullanabilecegi domain-agnostik araçlar.
 */

import { spawn } from 'child_process';

/**
 * spawn() sarmalayicisi — stdin: ignore, timeout: SIGKILL.
 *
 * execFile/execFileAsync kullanilmamali: Node 22'de `input` seceneginin
 * falsy-check'i stdin pipe'ini kapatmiyor, alt surecin stdin beklemesine
 * yol aciyor. stdio: ['ignore', 'pipe', 'pipe'] bu sorunu kokten cozuyor.
 *
 * @param {string} bin
 * @param {string[]} args
 * @param {{ cwd?: string, timeout?: number, killSignal?: string, onStdout?: (chunk: string) => void, onStderr?: (chunk: string) => void }} opts
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
export function spawnAsync(bin, args, {
  cwd,
  timeout = 120_000,
  killSignal = 'SIGKILL',
  onStdout,
  onStderr,
} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d; onStdout?.(d.toString()); });
    child.stderr.on('data', d => { stderr += d; onStderr?.(d.toString()); });
    const timer = setTimeout(() => child.kill(killSignal), timeout);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (signal) {
        const err = new Error(`Process killed by signal ${signal}`);
        err.signal = signal;
        err.stderr = stderr;
        reject(err);
      } else {
        resolve({ stdout, stderr });
      }
    });
    child.on('error', err => { clearTimeout(timer); reject(err); });
  });
}
