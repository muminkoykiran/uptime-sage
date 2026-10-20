import { mkdirSync, openSync, closeSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function acquireLock(path) {
  mkdirSync(dirname(path), { recursive: true });
  const fd = openSync(path, 'wx', 0o600);
  writeFileSync(fd, String(process.pid));
  closeSync(fd);
  return () => unlinkSync(path);
}
