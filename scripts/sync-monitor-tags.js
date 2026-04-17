#!/usr/bin/env node
/**
 * Syncs SSH diagnostic tags to Uptime Kuma monitors in bulk.
 *
 * Usage:
 *   node scripts/sync-monitor-tags.js          # dry run — preview only
 *   node scripts/sync-monitor-tags.js --apply  # apply changes to Uptime Kuma
 *
 * Config: config/monitor-ssh-map.private.json (gitignored)
 * Copy the example: cp config/monitor-ssh-map.example.json config/monitor-ssh-map.private.json
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { connectSocketIO, fetchAllMonitors } from '../src/uptime.js';
import { loadEnv, requireEnv } from '../src/env.js';

loadEnv();

const CONFIG_PATH = join(import.meta.dirname, '..', 'config', 'monitor-ssh-map.private.json');
const isDry = !process.argv.includes('--apply');

const SSH_TAG_COLORS = {
  'ssh-host':    '#3B82F6',
  'ssh-user':    '#8B5CF6',
  'ssh-port':    '#6366F1',
  'ssh-type':    '#10B981',
  'ssh-service': '#F59E0B',
};

/** Promisify socket.emit with Uptime Kuma callback convention. */
function emitAsync(socket, event, ...args) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timeout: ${event}`)), 15_000);
    socket.emit(event, ...args, (res) => {
      clearTimeout(t);
      if (res?.ok === false) reject(new Error(res.msg || `${event} failed`));
      else resolve(res);
    });
  });
}

async function main() {
  // ── Config validation ────────────────────────────────────────────────────
  if (!existsSync(CONFIG_PATH)) {
    console.error(`Config file not found: ${CONFIG_PATH}`);
    console.error('Create it from the example:');
    console.error('  cp config/monitor-ssh-map.example.json config/monitor-ssh-map.private.json');
    process.exit(1);
  }

  const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  const entries = Object.entries(config.monitors || {});

  const unfilled = entries.filter(([, m]) =>
    !m.skip && Object.entries(m).some(([k, v]) => k !== 'note' && v === 'FILL_ME')
  );

  if (unfilled.length > 0) {
    console.error('Fill in FILL_ME values before running:\n');
    for (const [id, m] of unfilled) {
      const missing = Object.entries(m)
        .filter(([k, v]) => k !== 'note' && v === 'FILL_ME')
        .map(([k]) => k)
        .join(', ');
      console.error(`  Monitor ${id.padStart(3)} (${m.note || '?'}): ${missing}`);
    }
    console.error(`\nEdit: ${CONFIG_PATH}`);
    process.exit(1);
  }

  requireEnv(['UPTIME_KUMA_URL', 'UPTIME_KUMA_TOKEN']);

  console.log(`${isDry ? '[DRY RUN]' : '[APPLY]'} Uptime Kuma monitor tag sync`);
  if (isDry) console.log('Add --apply to write changes.\n');

  // ── Connect & fetch ──────────────────────────────────────────────────────
  const socket = await connectSocketIO();
  const { monitorList } = await fetchAllMonitors(socket);

  // ── Global tag list ──────────────────────────────────────────────────────
  const { tags: globalTags } = await emitAsync(socket, 'getTagList');
  const tagByName = Object.fromEntries(globalTags.map(t => [t.name, t]));

  // Ensure all ssh-* global tags exist
  for (const [name, color] of Object.entries(SSH_TAG_COLORS)) {
    if (!tagByName[name]) {
      if (isDry) {
        console.log(`  [DRY] Would create global tag: ${name}`);
        tagByName[name] = { id: null, name };
      } else {
        const res = await emitAsync(socket, 'addTag', { name, color });
        tagByName[name] = res.tag;
        console.log(`  Created global tag: ${name} (id=${res.tag.id})`);
      }
    }
  }

  // ── Process monitors ─────────────────────────────────────────────────────
  let changed = 0, unchanged = 0, skipped = 0, errors = 0;

  for (const [monitorIdStr, cfg] of entries) {
    const monitorId = parseInt(monitorIdStr, 10);
    const label = `[${String(monitorId).padStart(3)}] ${cfg.note || ''}`;

    if (cfg.skip) {
      console.log(`SKIP  ${label}`);
      skipped++;
      continue;
    }

    // Find raw monitor (key might be string or number depending on UptimeKuma version)
    const rawMonitor = monitorList[monitorIdStr] ?? monitorList[monitorId];
    if (!rawMonitor) {
      console.log(`WARN  ${label} — monitor not found in Uptime Kuma`);
      continue;
    }

    // Current ssh-* tags: {tagName → {globalTagId, currentValue}}
    const currentSsh = {};
    for (const t of (rawMonitor.tags || [])) {
      if (!t.name?.startsWith('ssh-')) continue;
      currentSsh[t.name] = {
        globalTagId: t.tag_id ?? tagByName[t.name]?.id,
        value: String(t.value ?? ''),
      };
    }

    // Desired tags
    const desired = {};
    if (cfg.host)    desired['ssh-host']    = String(cfg.host);
    if (cfg.user)    desired['ssh-user']    = String(cfg.user);
    if (cfg.port)    desired['ssh-port']    = String(cfg.port);
    if (cfg.type)    desired['ssh-type']    = String(cfg.type);
    if (cfg.service) desired['ssh-service'] = String(cfg.service);

    // Diff
    const toDelete = []; // existing tags with wrong/stale value
    const toAdd    = []; // new tags or updated values

    for (const [name, newVal] of Object.entries(desired)) {
      const cur = currentSsh[name];
      if (!cur) {
        toAdd.push([name, newVal]);
      } else if (cur.value !== newVal) {
        toDelete.push([name, cur.value, cur.globalTagId]);
        toAdd.push([name, newVal]);
      }
    }

    if (toAdd.length === 0) {
      console.log(`  OK  ${label}`);
      unchanged++;
      continue;
    }

    console.log(`${isDry ? ' DRY' : 'SYNC'} ${label}`);
    for (const [name, val] of toAdd)         console.log(`       + ${name}=${val}`);
    for (const [name, val] of toDelete)      console.log(`       ~ ${name}: "${val}" → new value above`);

    if (isDry) { changed++; continue; }

    try {
      // Delete stale values first
      for (const [, oldVal, gTagId] of toDelete) {
        if (gTagId) await emitAsync(socket, 'deleteMonitorTag', gTagId, monitorId, oldVal);
      }
      // Add new values
      for (const [name, newVal] of toAdd) {
        const gTag = tagByName[name];
        if (gTag?.id) await emitAsync(socket, 'addMonitorTag', gTag.id, monitorId, newVal);
      }
      changed++;
    } catch (err) {
      console.error(`  ERROR ${label}: ${err.message}`);
      errors++;
    }
  }

  socket.disconnect();

  const summary = `${changed} updated, ${unchanged} already correct, ${skipped} skipped`;
  console.log(`\n${isDry ? 'DRY RUN' : 'DONE'}: ${summary}${errors ? `, ${errors} errors` : ''}`);
  if (isDry && changed > 0) console.log('Run with --apply to write changes.');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
