import { readFileSync } from 'fs';
import { join } from 'path';

export function loadEnv() {
  const envPath = join(import.meta.dirname, '..', '.env');
  let content;
  try {
    content = readFileSync(envPath, 'utf8');
  } catch {
    return; // .env yok — ortam degiskenleri zaten set edilmis olmali
  }
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let rawValue = trimmed.slice(eqIdx + 1).trim();
    if (!rawValue.startsWith('"') && !rawValue.startsWith("'")) {
      const commentIdx = rawValue.indexOf(' #');
      if (commentIdx !== -1) rawValue = rawValue.slice(0, commentIdx).trim();
    }
    const value = rawValue.replace(/^["']|["']$/g, '');
    if (key && !process.env[key]) process.env[key] = value;
  }
}

export function requireEnv(keys) {
  const missing = keys.filter(k => !process.env[k]);
  if (missing.length) {
    throw new Error(
      `Eksik zorunlu ortam degiskenleri: ${missing.join(', ')}\n` +
      `Lutfen .env dosyasini kontrol edin (.env.example'a bakin)`
    );
  }
}
