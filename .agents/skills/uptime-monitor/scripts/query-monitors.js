#!/usr/bin/env node
/**
 * Uptime Kuma monitor durumunu sorgular ve ozet cikti uretir.
 * Kullanim: node .agents/skills/uptime-monitor/scripts/query-monitors.js
 */

import { loadEnv } from '../../../src/env.js';
import {
  fetchStatusPageList,
  fetchPublicStatus,
  parsePublicMonitors,
  aggregateStats,
} from '../../../src/uptime.js';

loadEnv();

if (!process.env.UPTIME_KUMA_URL) {
  console.error('HATA: UPTIME_KUMA_URL .env dosyasinda tanimli degil');
  process.exit(1);
}

let slugs = ['default'];

try {
  const listData = await fetchStatusPageList();
  const pages = listData.statusPageList || [];
  if (pages.length > 0) slugs = pages.map(p => p.slug);
} catch {
  // varsayilan slug ile devam et
}

const results = await Promise.allSettled(slugs.map(slug => fetchPublicStatus(slug)));
const allMonitors = [];

for (const [i, result] of results.entries()) {
  if (result.status === 'fulfilled') {
    allMonitors.push(...parsePublicMonitors(result.value));
  } else {
    console.error(`'${slugs[i]}' alinamadi: ${result.reason.message}`);
  }
}

const seen = new Set();
const monitors = allMonitors.filter(m => {
  const id = Number(m.id);
  return seen.has(id) ? false : seen.add(id);
});

const stats = aggregateStats(monitors);

console.log(`\nUptime Kuma Monitor Ozeti`);
console.log(`${'─'.repeat(40)}`);
console.log(`Toplam : ${stats.total}`);
console.log(`UP     : ${stats.up}`);
console.log(`DOWN   : ${stats.down}`);
console.log(`Saglik : ${stats.healthScore}/100`);
if (stats.avgPing != null) console.log(`Ping   : ort ${stats.avgPing}ms / maks ${stats.maxPing}ms`);
if (stats.downMonitors.length > 0) console.log(`\nDOWN: ${stats.downMonitors.join(', ')}`);
if (stats.slowMonitors.length > 0) console.log(`Yavas: ${stats.slowMonitors.join(', ')}`);

console.log(`\nJSON:`);
console.log(JSON.stringify({ stats, monitors }, null, 2));
