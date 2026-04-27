/**
 * Uptime Resilience Agent — Ana Giris Noktasi
 *
 * Kullanim:
 *   node src/index.js          # Normal calistirma
 *   node src/index.js --dry    # Telegram gondermeden test
 *   node src/index.js --debug  # Detayli log
 */

import { loadEnv, requireEnv } from './env.js';
import {
  connectSocketIO,
  fetchAllMonitors,
  parseSocketMonitors,
  fetchStatusPageList,
  fetchPublicStatus,
  parsePublicMonitors,
  aggregateStats,
} from './uptime.js';
import { analyzeMonitors } from './analyzer.js';
import { collectDiagnostics } from './ssh-diagnostics.js';
import { sendMessage, sendErrorAlert, getChatIdForSeverity } from './telegram.js';
import { loadState, saveState, updateMonitorState, shouldAlert, recordRepeatAlert } from './state.js';

loadEnv();

const isDry = process.argv.includes('--dry');
const isDebug = process.argv.includes('--debug');
const hasToken = Boolean(process.env.UPTIME_KUMA_TOKEN);

const TIMEZONE = process.env.TIMEZONE || 'UTC';

function log(msg) {
  const now = new Date().toLocaleTimeString('tr-TR', { timeZone: TIMEZONE });
  console.log(`[${now}] ${msg}`);
}

function debug(label, data) {
  if (!isDebug) return;
  console.log(`\n[DEBUG] ${label}:\n`, JSON.stringify(data, null, 2));
}

async function fetchMonitorsViaSocket() {
  log('Socket.IO + JWT ile baglaniliyor...');
  const socket = await connectSocketIO();
  try {
    const { monitorList, heartbeatList } = await fetchAllMonitors(socket);
    const monitors = parseSocketMonitors(monitorList, heartbeatList);
    log(`Socket.IO: ${monitors.length} monitor alindi (aktif+pasif tumu)`);
    return monitors;
  } finally {
    socket.disconnect();
  }
}

async function fetchMonitorsViaHttp() {
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
  return allMonitors.filter(m => { const nid = Number(m.id); return seen.has(nid) ? false : seen.add(nid); });
}

async function run() {
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
    console.error(err.message);
    process.exit(1);
  }

  try {
    // 1. Monitor verisini al
    let monitors;
    if (hasToken) {
      monitors = await fetchMonitorsViaSocket();
    } else {
      log('Ipucu: JWT ile tum monitorlere erisebilirsin → node scripts/get-jwt-token.js');
      monitors = await fetchMonitorsViaHttp();
    }

    monitors = monitors.filter(m => m.active !== false);

    if (monitors.length === 0) {
      throw new Error('Hicbir monitor verisi alinamadi.');
    }

    // State tracking
    const state = loadState();
    const recoveries = [];
    let needsAlert = false;

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

    const stats = aggregateStats(monitors);
    log(`${monitors.length} monitor | UP: ${stats.up} | DOWN: ${stats.down} | Saglik: ${stats.healthScore}/100`);
    debug('stats', stats);

    if (!needsAlert) {
      log('Hicbir degisiklik yok, Telegram atlanıyor');
      saveState(state);
      log(`Agent tamamlandi (${Date.now() - startMs}ms)`);
      return;
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

    // 3. Codex CLI ile AI analizi
    log('Codex CLI analiz yapiliyor...');
    const analysis = await analyzeMonitors(monitors, stats, timestamp, TIMEZONE, diagnostics);
    debug('analysis', analysis);

    log(`Analiz tamam — Severity: ${analysis.severity} | Score: ${analysis.healthScore}/100`);

    if (analysis.criticalIssues?.length > 0) {
      for (const i of analysis.criticalIssues) log(`  !! [CRITICAL] ${i.monitor}: ${i.issue}`);
    }
    if (analysis.warnings?.length > 0) {
      for (const w of analysis.warnings) log(`  !  [WARNING]  ${w.monitor}: ${w.issue}`);
    }

    // Prepend recovery info to message if any
    let message = analysis.telegramMessage;
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

    saveState(state);

    if (analysis.detailedReport) {
      log('\n--- DETAYLI TEKNIK RAPOR ---');
      console.log(analysis.detailedReport);
    }

    log(`Agent tamamlandi (${Date.now() - startMs}ms)`);

    if (analysis.severity?.toUpperCase() === 'CRITICAL') process.exit(2);

  } catch (err) {
    log(`HATA: ${err.message}`);
    if (isDebug) console.error(err.stack);

    if (!isDry) {
      await sendErrorAlert(err.message, timestamp).catch(() => {});
    }

    process.exit(1);
  }
}

run();
