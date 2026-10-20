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
  maxBuffer = 8 * 1024 * 1024,
} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let failure;
    let bytes = 0;
    const receive = (stream, callback) => d => {
      bytes += d.length;
      if (bytes > maxBuffer) {
        failure = new Error('Process output limit exceeded');
        failure.code = 'MAX_BUFFER';
        child.kill(killSignal);
        return;
      }
      if (stream === 'stdout') stdout += d;
      else stderr += d;
      callback?.(d.toString());
    };
    child.stdout.on('data', receive('stdout', onStdout));
    child.stderr.on('data', receive('stderr', onStderr));
    const timer = setTimeout(() => {
      failure = new Error('Process timed out');
      failure.code = 'TIMEOUT';
      child.kill(killSignal);
    }, timeout);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (failure || signal || code !== 0) {
        const err = failure || new Error(`Process failed: exit=${code}, signal=${signal}`);
        err.exitCode = code;
        err.signal = signal;
        err.stderr = stderr;
        err.stdout = stdout;
        reject(err);
      } else {
        resolve({ stdout, stderr, exitCode: code });
      }
    });
    child.on('error', err => { clearTimeout(timer); reject(err); });
  });
}
