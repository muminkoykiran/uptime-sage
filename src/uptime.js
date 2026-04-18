/**
 * Uptime Kuma istemcisi
 *
 * Erisim stratejisi (oncelik sirasına gore):
 *   1. UPTIME_KUMA_TOKEN varsa → Socket.IO + JWT (tam erisim, aksiyon alma)
 *   2. Yoksa → Public HTTP status page API (sadece public monitorler, aksiyon yok)
 */

import { io } from 'socket.io-client';

const BASE_URL = () => {
  const url = process.env.UPTIME_KUMA_URL;
  if (!url) throw new Error('UPTIME_KUMA_URL ayarli degil — .env dosyasina ekleyin');
  return url.replace(/\/$/, '');
};

const CONNECT_TIMEOUT = 20_000;
const DATA_WAIT_MS = 3_000;

// ─── Yardimci fonksiyonlar ────────────────────────────────────────────────────

function statusLabel(status) {
  return { 0: 'DOWN', 1: 'UP', 2: 'PENDING', 3: 'MAINTENANCE' }[status] ?? 'UNKNOWN';
}

function buildRecentStatuses(beats) {
  return beats.slice(-20).map(h => ({
    status: statusLabel(h.status),
    ping: h.ping,
    time: h.time,
    msg: h.msg,
  }));
}

// Timestamp'leri onceden parse ederek computeUptime'da tekrar parse'i onler
function preParseTimestamps(beats) {
  return beats.map(b => ({ status: b.status, ts: new Date(b.time).getTime() }));
}

function toUptimePercent(ratio) {
  return ratio != null ? Math.round(ratio * 1000) / 10 : null;
}

function computeUptime(parsedBeats, windowMinutes) {
  if (!parsedBeats.length) return null;
  const cutoff = Date.now() - windowMinutes * 60_000;
  const recent = parsedBeats.filter(b => b.ts > cutoff);
  if (!recent.length) return null;
  return toUptimePercent(recent.filter(b => b.status === 1).length / recent.length);
}

// ─── Public HTTP (fallback, auth yok) ────────────────────────────────────────

export async function fetchStatusPageList() {
  const res = await fetch(`${BASE_URL()}/api/status-page/list`, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`Status page listesi alinamadi: HTTP ${res.status}`);
  return res.json();
}

export async function fetchPublicStatus(slug = 'default') {
  const res = await fetch(`${BASE_URL()}/api/status-page/${slug}`, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Public status page '${slug}' alinamadi: HTTP ${res.status}`);
  return res.json();
}

// ─── Socket.IO (JWT ile tam erisim) ──────────────────────────────────────────

export function connectSocketIO() {
  return new Promise((resolve, reject) => {
    const token = process.env.UPTIME_KUMA_TOKEN;
    if (!token) {
      reject(new Error('UPTIME_KUMA_TOKEN ayarli degil'));
      return;
    }

    const socket = io(BASE_URL(), {
      transports: ['websocket'],
      reconnection: false,
      timeout: CONNECT_TIMEOUT,
    });

    const timer = setTimeout(() => {
      socket.disconnect();
      reject(new Error(`Socket.IO baglanti zaman asimi (${CONNECT_TIMEOUT / 1000}s)`));
    }, CONNECT_TIMEOUT);

    socket.on('connect_error', (err) => {
      clearTimeout(timer);
      socket.disconnect();
      reject(new Error(`Socket.IO baglanti hatasi: ${err.message}`));
    });

    socket.on('connect', () => {
      socket.emit('loginByToken', token, (res) => {
        clearTimeout(timer);
        if (!res.ok) {
          socket.disconnect();
          // FIX: login basarisizsa reject et
          reject(new Error(
            `JWT login basarisiz: ${res.msg}. ` +
            `Token'i yenileyin: node scripts/get-jwt-token.js`
          ));
          return;
        }
        // FIX: resolve SADECE login basarili olduktan sonra
        resolve(socket);
      });
    });
  });
}

export function fetchAllMonitors(socket) {
  return new Promise((resolve, reject) => {
    const monitorList = {};
    const heartbeatList = {};
    let settled = false;
    let waitTimer = null;
    let safetyTimer = null; // FIX: track ediliyor, finish() icinde temizleniyor

    function finish() {
      if (settled) return;
      settled = true;
      clearTimeout(waitTimer);
      clearTimeout(safetyTimer); // FIX: event loop serbest birakiliyor
      resolve({ monitorList, heartbeatList });
    }

    function scheduleFinish() {
      clearTimeout(waitTimer);
      waitTimer = setTimeout(finish, DATA_WAIT_MS);
    }

    socket.on('monitorList', (data) => {
      if (!data || typeof data !== 'object') return;
      Object.assign(monitorList, data);
      if (Object.keys(monitorList).length === 0) finish();
      else scheduleFinish();
    });

    socket.on('heartbeatList', (monitorId, data, overwrite) => {
      if (!Array.isArray(data)) return;
      if (overwrite || !heartbeatList[monitorId]) {
        heartbeatList[monitorId] = data;
      } else {
        heartbeatList[monitorId].push(...data);
      }
      scheduleFinish(); // her heartbeat'te timer'i uzat (veri akiyor demek)
    });

    function rejectOnce(err) {
      if (settled) return;
      settled = true;
      clearTimeout(waitTimer);
      clearTimeout(safetyTimer);
      reject(err);
    }

    socket.on('disconnect', () => rejectOnce(new Error('Socket.IO beklenmedik sekilde kapandi')));
    socket.on('error', (err) => rejectOnce(new Error(`Socket.IO hatasi: ${err}`)));

    safetyTimer = setTimeout(finish, 15_000); // son care: 15s sonra ne varsa isle
  });
}

// ─── Veri isleme ─────────────────────────────────────────────────────────────

export function parseSocketMonitors(monitorList, heartbeatList) {
  return Object.entries(monitorList).map(([id, monitor]) => {
    const beats = heartbeatList[id] || [];
    const latest = beats[beats.length - 1] || null;
    // FIX: timestamp parse'i once yapilir, computeUptime iki kez cagirsa da tek parse
    const parsedBeats = preParseTimestamps(beats);
    return {
      id: Number(id),
      name: monitor.name,
      type: monitor.type,
      url: monitor.url || null,
      group: monitor.tags?.map(t => (typeof t === 'string' ? t : t.name)).filter(Boolean).join(', ') || '',
      tags: Array.isArray(monitor.tags) ? monitor.tags.filter(t => t && typeof t === 'object') : [],
      active: monitor.active,
      status: latest?.status ?? -1,
      statusText: statusLabel(latest?.status),
      ping: latest?.ping ?? null,
      msg: latest?.msg || '',
      time: latest?.time || null,
      uptime24h: computeUptime(parsedBeats, 24 * 60),
      uptime30d: computeUptime(parsedBeats, 30 * 24 * 60),
      recentStatuses: buildRecentStatuses(beats),
    };
  });
}

export function parsePublicMonitors(pageData) {
  const { publicGroupList = [], heartbeatList = {}, uptimeList = {} } = pageData;
  const monitors = [];
  for (const group of publicGroupList) {
    for (const monitor of (group.monitorList || [])) {
      const beats = heartbeatList[monitor.id] || [];
      const latest = beats[beats.length - 1] || null;
      monitors.push({
        id: monitor.id,
        name: monitor.name,
        type: monitor.type,
        url: monitor.url || null,
        group: group.name,
        tags: [],
        active: true,
        status: latest?.status ?? -1,
        statusText: statusLabel(latest?.status),
        ping: latest?.ping ?? null,
        msg: latest?.msg || '',
        time: latest?.time || null,
        // uptimeList API'den geliyor — hesaplamaya gerek yok
        uptime24h: toUptimePercent(uptimeList[`${monitor.id}_24`] ?? null),
        uptime30d: toUptimePercent(uptimeList[`${monitor.id}_720`] ?? null),
        recentStatuses: buildRecentStatuses(beats), // FIX: paylasilan helper
      });
    }
  }
  return monitors;
}

export function aggregateStats(monitors) {
  let up = 0, down = 0, pending = 0, maintenance = 0;
  let pingSum = 0, pingMax = 0, pingCount = 0;
  const downMonitors = [];
  const slowMonitors = [];

  for (const m of monitors) {
    if (m.status === 1) up++;
    else if (m.status === 0) { down++; downMonitors.push(m.name); }
    else if (m.status === 2) pending++;
    else if (m.status === 3) maintenance++;

    if (m.ping != null) {
      pingSum += m.ping;
      if (m.ping > pingMax) pingMax = m.ping;
      pingCount++;
      if (m.ping > 1000) slowMonitors.push(`${m.name} (${m.ping}ms)`);
    }
  }

  const total = monitors.length;
  const avgPing = pingCount ? Math.round(pingSum / pingCount) : null;
  const maxPing = pingCount ? pingMax : null;

  return {
    total, up, down, pending, maintenance,
    avgPing, maxPing,
    healthScore: total === 0 ? 100 : Math.round((up / total) * 100),
    downMonitors,
    slowMonitors,
    accessMode: process.env.UPTIME_KUMA_TOKEN ? 'socket.io+jwt' : 'public-http',
  };
}
