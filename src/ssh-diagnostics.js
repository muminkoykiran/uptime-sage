/**
 * SSH Diagnostics — DOWN monitor'ler icin sunucu tarafı tanı toplama.
 *
 * Sunucu bilgisi YALNIZCA Uptime Kuma monitor tag'larindan okunur:
 *   ssh-host      → baglanti adresi (zorunlu)
 *   ssh-user      → kullanici adi (opsiyonel, SSH_USER env veya mevcut kullanici)
 *   ssh-port      → port (opsiyonel, varsayilan 22)
 *   ssh-type      → 'systemd' | 'docker' | 'http' (opsiyonel, varsayilan: general)
 *   ssh-service   → servis/container/port adı (ssh-type ile birlikte kullanilir)
 *
 * Guvenlik:
 *   - Yalnizca config/ssh-diagnostics.json whitelist'indeki komutlar calistirilir
 *   - Template degiskenleri substitusyon oncesi strict regex ile dogrulanir
 *   - Cikti Codex'e gitmeden once secret pattern'lari temizlenir
 *   - StrictHostKeyChecking=yes — known_hosts onceden doldurulmali
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { spawnAsync } from './util.js';

const CONFIG_PATH = join(import.meta.dirname, '..', 'config', 'ssh-diagnostics.json');
const _isDebug = process.argv.includes('--debug');
const dbg = _isDebug ? (...a) => console.log(...a) : () => {};

// Cikti sanitize — SSH loglarindan Codex prompt'una gecmeden once sifre/token temizle
const SCRUB_PATTERNS = [
  [/Bearer\s+[A-Za-z0-9\-_\.~+/]{20,}/gi,                              'Bearer [REDACTED]'],
  [/Authorization:\s*[^\r\n]+/gi,                                        'Authorization: [REDACTED]'],
  [/eyJ[A-Za-z0-9\-_]+\.eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/g,       '[JWT_REDACTED]'],
  [/postgresql:\/\/[^:]+:[^@]+@\S+/gi,                                  'postgresql://[REDACTED]'],
  [/mysql:\/\/[^:]+:[^@]+@\S+/gi,                                       'mysql://[REDACTED]'],
  [/mongodb(\+srv)?:\/\/[^:]+:[^@]+@\S+/gi,                            'mongodb://[REDACTED]'],
  [/redis:\/\/[^:@\s]+:[^@\s]+@\S+/gi,                                 'redis://[REDACTED]'],
  [/(password|passwd|secret|api[_-]?key|access[_-]?key)\s*[=:]\s*["']?\S{6,}["']?/gi, '$1=[REDACTED]'],
  [/AKIA[0-9A-Z]{16}/g,                                                 '[AWS_KEY_REDACTED]'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[PRIVATE_KEY_REDACTED]'],
  [/sk_live_[A-Za-z0-9]{24,}/g,                                         '[STRIPE_KEY_REDACTED]'],
  [/sk_test_[A-Za-z0-9]{24,}/g,                                         '[STRIPE_TEST_KEY_REDACTED]'],
  [/ghp_[A-Za-z0-9]{36}/g,                                              '[GH_TOKEN_REDACTED]'],
];

function scrubSecrets(text) {
  let result = text;
  for (const [pattern, replacement] of SCRUB_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

function loadConfig() {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  } catch (err) {
    throw new Error(`ssh-diagnostics.json okunamadi: ${err.message}`);
  }
}

// Monitor tag array'inden {name: value} map'i olusturur
function tagMap(tags) {
  const map = {};
  for (const t of (tags || [])) {
    if (t && typeof t.name === 'string' && t.value !== undefined) {
      map[t.name] = String(t.value).trim();
    }
  }
  return map;
}

// Template degiskenini whitelist regex'e gore dogrula
function validateVar(name, value, rules) {
  const pattern = rules[name];
  if (!pattern) return false; // bilinmeyen degisken — reddet
  const re = new RegExp(pattern);
  if (!re.test(value)) return false;
  if (name === 'port') {
    const n = Number(value);
    if (n < 1 || n > 65535) return false;
  }
  return true;
}

// Template string'ini dogrulanmis degiskenlerle doldurur
function substituteTemplate(tmpl, vars, rules) {
  return tmpl.replace(/\{(\w+)\}/g, (match, name) => {
    const value = vars[name];
    if (!value) throw new Error(`Eksik template degiskeni: ${name}`);
    if (!validateVar(name, value, rules)) {
      throw new Error(`Gecersiz deger '${value}' (${name}) — whitelist'e uymayan karakter`);
    }
    return value;
  });
}

// Known_hosts'ta host var mi kontrolu (StrictHostKeyChecking=yes gerektiriyor)
function isHostKnown(host, port) {
  const lookup = port === '22' || port === 22 ? host : `[${host}]:${port}`;
  const result = spawnSync('ssh-keygen', ['-F', lookup], { encoding: 'utf8' });
  return result.status === 0;
}

// Tek komut calistir, ciktiyi temizle ve kisalt
async function runRemoteCommand(sshArgs, cmd, maxChars, timeout) {
  try {
    const { stdout, stderr } = await spawnAsync('ssh', [...sshArgs, cmd], { timeout: timeout * 1000 });
    const raw = (stdout + (stderr ? `\n[stderr] ${stderr}` : '')).trim();
    const cleaned = scrubSecrets(raw);
    return cleaned.length > maxChars
      ? cleaned.slice(0, maxChars) + `\n... [${cleaned.length - maxChars} karakter kesildi]`
      : cleaned;
  } catch (err) {
    if (err.signal === 'SIGKILL') return `[TIMEOUT: ${timeout}s asimi]`;
    return `[SSH_CMD_ERROR: ${err.message.slice(0, 200)}]`;
  }
}

// Bir host icin tum diagnostic'leri topla
async function diagnoseHost(hostInfo, config) {
  const { host, port, user, keyPath, type, serviceId, monitors } = hostInfo;
  const sshUser = user || process.env.SSH_USER || process.env.USER || 'ubuntu';
  const sshPort = String(port || 22);
  const sshKey  = keyPath || process.env.SSH_KEY_PATH || `${process.env.HOME}/.ssh/id_rsa`;

  dbg(`[SSH] Baglanti: ${sshUser}@${host}:${sshPort} — monitor(ler): ${monitors.join(', ')} — tip: ${type || 'general'}`);

  // Known hosts kontrolu
  if (!isHostKnown(host, sshPort)) {
    dbg(`[SSH] HATA: ${host} known_hosts'ta bulunamadi`);
    return {
      host, monitors, status: 'error',
      reason: `Host known_hosts'ta bulunamadi. Eklemek icin: ssh-keyscan -H -p ${sshPort} ${host} >> ~/.ssh/known_hosts`,
    };
  }
  dbg(`[SSH] ${host} known_hosts'ta mevcut — komutlar calistiriliyor`);

  const sshFlags = [
    '-i', sshKey,
    '-p', sshPort,
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=10',
    '-o', 'StrictHostKeyChecking=yes',
    '-o', 'PasswordAuthentication=no',
    '-o', 'ServerAliveInterval=10',
    '-o', 'ServerAliveCountMax=2',
    `${sshUser}@${host}`,
  ];

  const { templates, var_rules, timeout_seconds, max_output_chars } = config;
  const vars = { service: serviceId, container: serviceId, port: serviceId };

  // Her zaman 'general' template calisir
  const typesToRun = ['general'];
  if (type && templates[type]) typesToRun.unshift(type);

  const commands = [];
  for (const ttype of typesToRun) {
    for (const entry of (templates[ttype] || [])) {
      let cmd;
      try {
        cmd = substituteTemplate(entry.cmd, vars, var_rules);
      } catch (err) {
        commands.push({ type: ttype, label: entry.label, output: `[VALIDATION_ERROR: ${err.message}]` });
        continue;
      }
      dbg(`[SSH] ${host} → [${ttype}] ${entry.label}`);
      const t0 = Date.now();
      const output = await runRemoteCommand(sshFlags, cmd, max_output_chars, timeout_seconds);
      const elapsed = Date.now() - t0;
      dbg(`[SSH] ${host} → ${output.startsWith('[') ? output.split('\n')[0] : `OK (${elapsed}ms)`}`);
      commands.push({ type: ttype, label: entry.label, output });
    }
  }

  return { host, monitors, status: 'ok', commands };
}

/**
 * DOWN monitor'ler icin SSH diagnostic verisini toplar.
 *
 * @param {Array} downMonitors - status===0 olan monitor'ler (tags[] icermeli)
 * @returns {Promise<Array>} - DiagnosticResult[]
 */
export async function collectDiagnostics(downMonitors) {
  if (!process.env.SSH_DIAGNOSTICS_ENABLED || process.env.SSH_DIAGNOSTICS_ENABLED !== 'true') {
    return [];
  }

  let config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error(`[ssh-diagnostics] Config hatasi: ${err.message}`);
    return [];
  }

  // ssh-host tag'i olan monitor'leri grupla (host bazinda dedup)
  const hostMap = new Map(); // host → hostInfo
  for (const m of downMonitors) {
    const tags = tagMap(m.tags);
    if (!tags['ssh-host']) continue; // tag yoksa atla

    const host = tags['ssh-host'];
    if (!hostMap.has(host)) {
      hostMap.set(host, {
        host,
        port:      tags['ssh-port'] || '22',
        user:      tags['ssh-user'] || null,
        keyPath:   null,
        type:      tags['ssh-type'] || null,
        serviceId: tags['ssh-service'] || null,
        monitors:  [],
      });
    }
    hostMap.get(host).monitors.push(m.name);
    // İlk DOWN monitor'un type/service'ini kullan (daha fazlasi varsa genel diagnostic yeterli)
    const info = hostMap.get(host);
    if (!info.type && tags['ssh-type']) info.type = tags['ssh-type'];
    if (!info.serviceId && tags['ssh-service']) info.serviceId = tags['ssh-service'];
  }

  if (hostMap.size === 0) return [];

  dbg(`[SSH] ${hostMap.size} unique host bulundu: ${[...hostMap.keys()].join(', ')}`);

  // Hostlari paralel isle, hata varsa devam et
  const results = await Promise.allSettled(
    [...hostMap.values()].map(h => diagnoseHost(h, config))
  );

  return results.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    const info = [...hostMap.values()][i];
    return {
      host: info.host,
      monitors: info.monitors,
      status: 'error',
      reason: r.reason?.message || String(r.reason),
    };
  });
}
