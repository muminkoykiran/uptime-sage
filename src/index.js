/**
 * Uptime Resilience Agent — Ana Giris Noktasi
 *
 * Kullanim:
 *   node src/index.js          # Normal calistirma
 *   node src/index.js --dry    # Telegram gondermeden test
 *   node src/index.js --debug  # Detayli log
 */

import { loadEnv, requireEnv } from './env.js';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { acquireLock } from './lock.js';
import { assessHealth, shouldNotifyHealth, decideNotification } from './health.js';
import { configureLogger, logOperational } from './logger.js';
import { collectRuntimeHealth } from './runtime-health.js';
import {
  connectSocketIO,
  fetchAllMonitors,
  parseSocketMonitors,
  fetchStatusPageList,
  fetchPublicStatus,
  parsePublicMonitors,
  aggregateStats,
} from './uptime.js';
import { analyzeMonitors, resolveProviders } from './analyzer.js';
import { collectDiagnostics } from './ssh-diagnostics.js';
import { sendMessage, sendErrorAlert, getChatIdForSeverity } from './telegram.js';
import { loadState, saveState, updateMonitorState, shouldAlert, recordRepeatAlert } from './state.js';

loadEnv();

const isDry = process.argv.includes('--dry');
const isDebug = process.argv.includes('--debug');
const hasToken = Boolean(process.env.UPTIME_KUMA_TOKEN);

const TIMEZONE = process.env.TIMEZONE || 'UTC';
configureLogger({ timeZone: TIMEZONE });

function log(msg) {
  logOperational(msg);
}

function debug(label, data) {
  if (!isDebug) return;
  log(`[DEBUG] ${label}: ${JSON.stringify(data)}`);
}

async function fetchMonitorsViaSocket() {
  log('Socket.IO + JWT ile baglaniliyor...');
  const socket = await connectSocketIO();
  try {
    const { monitorList, heartbeatList } = await fetchAllMonitors(socket);
    const monitors = parseSocketMonitors(monitorList, heartbeatList);
    log(`Socket.IO: ${monitors.length} monitor alindi (aktif+pasif tumu)`);
    return { monitors, accessMode: 'socket.io+jwt', isPartial: false };
  } finally {
    socket.disconnect();
  }
}

async function fetchMonitorsViaHttp(accessMode = 'public-http') {
  log('Public HTTP API kullaniliyor (sadece public monitorler)...');
  let slugs = ['default'];

  try {
    // FIX: BASE_URL ve URL normalize uptime.js'deki fetchStatusPageList'e devredildi
    const listData = await fetchStatusPageList();
    const pages = listData.statusPageList || [];
    if (pages.length > 0) slugs = pages.map(p => p.slug);
  } catch {
    // varsayilan slug ile devam et
  }

  // FIX: sıralı await yerine paralel fetch
  const results = await Promise.allSettled(slugs.map(slug => fetchPublicStatus(slug)));

  const allMonitors = [];
  for (const [i, result] of results.entries()) {
    if (result.status === 'fulfilled') {
      allMonitors.push(...parsePublicMonitors(result.value));
    } else {
      log(`'${slugs[i]}' alinamadi: ${result.reason.message}`);
    }
  }

  // Tekrarlari temizle (ayni monitor birden fazla sayfada olabilir)
  const seen = new Set();
  const monitors = allMonitors.filter(m => { const nid = Number(m.id); return seen.has(nid) ? false : seen.add(nid); });
  return { monitors, accessMode, isPartial: true };
}

function isSocketTransportError(err) {
  return /Socket\.IO|Monitor list missing or empty|baglanti zaman asimi/i.test(err?.message || '');
}

function higherSeverity(a, b) {
  const rank = { OK: 0, WARNING: 1, CRITICAL: 2 };
  return rank[a] >= rank[b] ? a : b;
}

function shouldNotifyTransport(source, previous, nowMs, repeatMs, severity) {
  if (!previous || previous.accessMode !== source.accessMode) return true;
  if (higherSeverity(severity, previous.severity || 'OK') !== (previous.severity || 'OK')) return true;
  return severity !== 'OK' && nowMs - (previous.sentAt || 0) >= repeatMs;
}

function shouldNotifyRuntime(current, previous, nowMs, repeatMs) {
  if (!previous) return current.severity !== 'OK';
  if (current.severity !== previous.severity) return true;
  return current.severity !== 'OK' && nowMs - (previous.sentAt || 0) >= repeatMs;
}

function applyAiOutcomes(state, outcomes = []) {
  for (const outcome of outcomes) {
    if (outcome.status === 'success') delete state._ai?.[outcome.provider];
    if (outcome.status === 'open') {
      state._ai = { ...state._ai, [outcome.provider]: { retryAt: outcome.retryAt, reason: outcome.reason, openedAt: Date.now() } };
    }
  }
  if (state._ai && Object.keys(state._ai).length === 0) delete state._ai;
}

// Eski tek-sağlayıcılı state'i (state._codex) bir kez yeni şemaya taşır.
function migrateLegacyCircuit(state) {
  if (!state._codex) return;
  state._ai = { ...state._ai, codex: state._codex };
  delete state._codex;
}

function recordNotified(state, source, health, runtimeHealth) {
  if (!source.isPartial) state._health = { ...health, sentAt: Date.now() };
  state._transport = { accessMode: source.accessMode, isPartial: source.isPartial, severity: health.severity, sentAt: Date.now() };
  state._runtimeHealth = { severity: runtimeHealth.severity, sentAt: Date.now() };
}

function buildRecoveryMessage(recoveries, timestamp) {
  return [`✅ *RECOVERY* | ${timestamp}`, '', ...recoveries.map(name => `• *${name}* tekrar UP`)].join('\n');
}

function addOperationalContext(message, source, runtimeHealth) {
  const context = [];
  if (source.isPartial) {
    context.push('⚠️ *Veri erişimi*: Socket.IO kullanılamıyor; yalnızca public monitor verisi gösteriliyor. Recovery state güncellenmedi.');
  }
  if (runtimeHealth.issues.length > 0) {
    const icon = runtimeHealth.severity === 'CRITICAL' ? '🚨' : '⚠️';
    context.push(`${icon} *Ajan kaynağı*: ${runtimeHealth.issues.join('; ')}`);
  }
  return context.length ? `${message}\n\n${context.join('\n')}` : message;
}

function alignMessageSeverity(message, severity) {
  const icon = { OK: '🟢', WARNING: '🟡', CRITICAL: '🔴' }[severity] || '🟡';
  return message.replace(/^(?:🟢 OK|🟡 WARNING|🔴 CRITICAL)(?= \|)/, `${icon} ${severity}`);
}

export async function run() {
  const startMs = Date.now();
  const timestamp = new Date().toLocaleString('tr-TR', {
    timeZone: TIMEZONE,
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  log(`Uptime Resilience Agent basliyor... [mod: ${hasToken ? 'socket.io+jwt' : 'public-http'}]`);
  if (isDry) log('[DRY MODE] Telegram bildirimi gonderilmeyecek');

  try {
    requireEnv(['UPTIME_KUMA_URL', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID']);
  } catch (err) {
    log(err.message);
    return 1;
  }

  try {
    // 1. Monitor verisini al
    let source;
    if (hasToken) {
      try {
        source = await fetchMonitorsViaSocket();
      } catch (err) {
        if (!isSocketTransportError(err)) throw err;
        log(`Socket.IO gecici hatasi: ${err.message}; public HTTP yedegi kullaniliyor`);
        source = await fetchMonitorsViaHttp('public-http-fallback');
      }
    } else {
      log('Ipucu: JWT ile tum monitorlere erisebilirsin → node scripts/get-jwt-token.js');
      source = await fetchMonitorsViaHttp();
    }

    let monitors = source.monitors;

    monitors = monitors.filter(m => m.active !== false);

    if (monitors.length === 0) {
      throw new Error('Hicbir monitor verisi alinamadi.');
    }

    // State tracking
    const state = loadState();
    migrateLegacyCircuit(state);
    const recoveries = [];
    let needsAlert = false;
    const repeatMs = (Number(process.env.ALERT_REPEAT_HOURS) || 4) * 3_600_000;

    if (!source.isPartial) {
      for (const m of monitors) {
        const result = updateMonitorState(state, m);
        if (result.isRecovered) {
          log(`[RECOVERY] ${m.name} UP`);
          recoveries.push(m.name);
          needsAlert = true;
        }
        if (shouldAlert(result)) {
          needsAlert = true;
          if (!result.isNewDown) recordRepeatAlert(state, m.id);
        }
      }
    } else {
      log(`Kismi veri modu: ${source.accessMode}; monitor state ve recovery yazilmayacak`);
    }

    const stats = aggregateStats(monitors, source.accessMode);
    const runtimeHealth = collectRuntimeHealth();
    log(`${monitors.length} monitor | UP: ${stats.up} | DOWN: ${stats.down} | PENDING: ${stats.pending} | MAINTENANCE: ${stats.maintenance} | Saglik: ${stats.healthScore}/100 | Kaynak: ${source.accessMode}`);
    if (runtimeHealth.issues.length > 0) log(`[RUNTIME] ${runtimeHealth.issues.join('; ')}`, runtimeHealth.severity === 'CRITICAL' ? 'error' : 'warn');
    debug('stats', stats);
    debug('runtime', runtimeHealth);

    const monitorHealth = assessHealth(monitors);
    const health = {
      ...monitorHealth,
      severity: higherSeverity(monitorHealth.severity, runtimeHealth.severity),
      fingerprint: `${monitorHealth.fingerprint}|runtime:${runtimeHealth.severity}`,
    };
    const previousHealth = state._health;
    if (source.isPartial) {
      if (shouldNotifyTransport(source, state._transport, Date.now(), repeatMs, health.severity)) needsAlert = true;
    } else {
      if (shouldNotifyHealth(health, previousHealth, Date.now(), repeatMs)) needsAlert = true;
      if (state._transport?.isPartial) {
        log('Tam Socket.IO verisi geri geldi');
        needsAlert = true;
      }
    }
    if (shouldNotifyRuntime(runtimeHealth, state._runtimeHealth, Date.now(), repeatMs)) needsAlert = true;

    const decision = decideNotification({ severity: health.severity, recoveries, isPartial: source.isPartial, needsAlert });
    debug('decision', { decision, severity: health.severity, needsAlert });

    // --dry her zaman tam analiz yolunu calistirir (dogrulama icin); karar sadece loglanir.
    if (isDry && decision !== 'full') log(`[DRY] Karar: ${decision} (production'da Telegram gonderilmez/kisa gonderilir)`);

    if (decision === 'skip' && !isDry) {
      log(needsAlert ? 'Durum OK, Telegram atlanıyor' : 'Hicbir degisiklik yok, Telegram atlanıyor');
      // Severity OK'e dondu: state'i guncelle ki sonraki WARNING bastirilmasin.
      if (needsAlert) recordNotified(state, source, health, runtimeHealth);
      saveState(state);
      log(`Agent tamamlandi (${Date.now() - startMs}ms)`);
      return 0;
    }

    if (decision === 'recovery' && !isDry) {
      const recoveryMessage = buildRecoveryMessage(recoveries, timestamp);
      await sendMessage(recoveryMessage, 'Markdown', { chatId: getChatIdForSeverity('OK') });
      log('Recovery bildirimi gonderildi');
      recordNotified(state, source, health, runtimeHealth);
      saveState(state);
      log(`Agent tamamlandi (${Date.now() - startMs}ms)`);
      return 0;
    }

    // 2. SSH diagnostics (SSH_DIAGNOSTICS_ENABLED=true ise, DOWN/PENDING monitor'ler icin)
    // status 0=DOWN, 2=PENDING (son check basarisiz, onay bekleniyor)
    if (!hasToken && process.env.SSH_DIAGNOSTICS_ENABLED === 'true') {
      log('[WARN] SSH_DIAGNOSTICS_ENABLED=true ancak public HTTP modunda calisiliyor — monitor taglari yok, SSH diagnostics devre disi');
    }
    const downMonitors = monitors.filter(m => m.status === 0 || m.status === 2);
    const diagnostics = await collectDiagnostics(downMonitors);
    if (diagnostics.length > 0) {
      const ok  = diagnostics.filter(d => d.status === 'ok').length;
      const err = diagnostics.filter(d => d.status === 'error').length;
      log(`SSH diagnostics tamamlandi: ${ok} host ok, ${err} host hatali`);
    }

    // 3. AI CLI saglayici zinciri ile analiz (agy → codex → kurali analiz)
    const providers = resolveProviders();
    log(`AI analizi yapiliyor (${providers.map(p => p.name).join(' → ') || 'saglayici yok'})...`);
    const analysis = await analyzeMonitors(monitors, stats, timestamp, TIMEZONE, diagnostics, {
      providers,
      circuits: state._ai,
      runtimeHealth,
    });
    const severityRank = { OK: 0, WARNING: 1, CRITICAL: 2 };
    if (severityRank[analysis.severity] < severityRank[health.severity]) {
      analysis.severity = health.severity;
      analysis.telegramMessage = alignMessageSeverity(analysis.telegramMessage, health.severity);
    }
    debug('analysis', analysis);

    log(`Analiz tamam — Severity: ${analysis.severity} | Score: ${analysis.healthScore}/100`);

    if (analysis.criticalIssues?.length > 0) {
      for (const i of analysis.criticalIssues) log(`  !! [CRITICAL] ${i.monitor}: ${i.issue}`);
    }
    if (analysis.warnings?.length > 0) {
      for (const w of analysis.warnings) log(`  !  [WARNING]  ${w.monitor}: ${w.issue}`);
    }

    // Prepend recovery info to message if any
    let message = addOperationalContext(analysis.telegramMessage, source, runtimeHealth);
    if (recoveries.length > 0) {
      const recoveryText = recoveries.map(n => `[RECOVERY] ${n} UP`).join('\n');
      message = recoveryText + '\n\n' + message;
    }

    // 3. Telegram bildirimi (severity-based channel routing)
    const severityKey = (analysis.severity || 'OK').toUpperCase();
    const chatId = getChatIdForSeverity(severityKey);

    if (isDry) {
      log('[DRY] Telegram mesaji:\n' + message);
    } else {
      await sendMessage(message, 'Markdown', { chatId });
      log('Telegram bildirimi gonderildi');
    }

    if (!isDry) {
      recordNotified(state, source, health, runtimeHealth);
      applyAiOutcomes(state, analysis._aiOutcomes);
      saveState(state);
    }

    if (isDebug && analysis.detailedReport) {
      for (const line of analysis.detailedReport.split('\n')) log(`[DEBUG] RAPOR ${line}`);
    }

    log(`Agent tamamlandi (${Date.now() - startMs}ms)`);

    return analysis.severity?.toUpperCase() === 'CRITICAL' ? 2 : 0;

  } catch (err) {
    log(`HATA: ${err.message}`);
    if (isDebug && err.stack) log(`[DEBUG] ${err.stack}`, 'error');

    if (!isDry) {
      await sendErrorAlert(err.message, timestamp).catch(() => {});
    }

    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let release;
  try {
    if (!isDry) release = acquireLock(join(import.meta.dirname, '..', 'data', 'run.lock'));
    process.exitCode = (await run()) || 0;
  } catch (err) {
    log(`HATA: ${err.message}`);
    process.exitCode = 1;
  } finally {
    release?.();
  }
}
