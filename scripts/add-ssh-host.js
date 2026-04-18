#!/usr/bin/env node
/**
 * Adds an SSH host to known_hosts.
 *
 * Usage:
 *   node scripts/add-ssh-host.js <host> [port]
 *
 * The fingerprint is displayed for verification before being added to known_hosts.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';

const [host, portArg] = process.argv.slice(2);
if (!host) {
  console.error('Kullanim: node scripts/add-ssh-host.js <host> [port]');
  process.exit(1);
}

const port = portArg || '22';
const knownHostsPath = join(homedir(), '.ssh', 'known_hosts');
const sshDir = join(homedir(), '.ssh');

if (!existsSync(sshDir)) mkdirSync(sshDir, { mode: 0o700, recursive: true });

// Zaten biliniyor mu?
const lookup = port === '22' ? host : `[${host}]:${port}`;
const existing = spawnSync('ssh-keygen', ['-F', lookup], { encoding: 'utf8' });
if (existing.status === 0) {
  console.log(`✓ ${host}:${port} zaten known_hosts'ta mevcut.`);
  process.exit(0);
}

// Fingerprint'i al
let scanOutput;
try {
  scanOutput = execFileSync(
    'ssh-keyscan',
    ['-H', '-p', port, '-T', '10', host],
    { encoding: 'utf8', timeout: 15_000, stdio: ['ignore', 'pipe', 'pipe'] }
  ).trim();
} catch (err) {
  console.error(`ssh-keyscan basarisiz: ${err.message}`);
  process.exit(1);
}

if (!scanOutput) {
  console.error(`Host'tan anahtar alinamadi: ${host}:${port}`);
  process.exit(1);
}

// Gorsel fingerprint goster
try {
  const keyLine = scanOutput.split('\n').find(l => !l.startsWith('#'));
  if (keyLine) {
    const [, , keyType, keyB64] = keyLine.split(' ');
    const fp = execFileSync(
      'ssh-keygen',
      ['-l', '-f', '/dev/stdin'],
      { input: `${host} ${keyType} ${keyB64}\n`, encoding: 'utf8' }
    ).trim();
    console.log(`\nHost    : ${host}:${port}`);
    console.log(`Parmak  : ${fp}`);
  }
} catch { /* fingerprint goruntuleme opsiyonel */ }

console.log('\nBu anahtari known_hosts\'a eklemek istiyor musunuz? [e/H]');

const rl = createInterface({ input: process.stdin, output: process.stdout });
rl.question('> ', (answer) => {
  rl.close();
  if (answer.toLowerCase() !== 'e') {
    console.log('İptal edildi.');
    process.exit(0);
  }
  appendFileSync(knownHostsPath, scanOutput + '\n');
  console.log(`✓ ${host}:${port} known_hosts'a eklendi.`);
});
