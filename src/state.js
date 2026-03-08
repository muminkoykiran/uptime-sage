import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

const STATE_PATH = join(import.meta.dirname, '..', 'data', 'state.json');

export function loadState() {
  try {
    return JSON.parse(readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

let _dirEnsured = false;

export function saveState(state) {
  try {
    if (!_dirEnsured) {
      mkdirSync(dirname(STATE_PATH), { recursive: true });
      _dirEnsured = true;
    }
    writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  } catch (err) {
    console.warn('Warning: could not save state:', err.message);
  }
}

export function updateMonitorState(state, monitor) {
  const key = String(monitor.id);
  const now = new Date().toISOString();
  const prev = state[key];
  let isNewDown = false;
  let isRecovered = false;
  let hoursSinceLastAlert = null;

  if (monitor.status === 0) {
    if (!prev || prev.status !== 0) {
      state[key] = {
        id: monitor.id,
        name: monitor.name,
        status: 0,
        firstDownAt: now,
        lastAlertAt: now,
        alertCount: 1,
        lastSeenAt: now,
      };
      isNewDown = true;
    } else {
      hoursSinceLastAlert =
        (Date.now() - new Date(prev.lastAlertAt).getTime()) / 3_600_000;
      state[key] = { ...prev, lastSeenAt: now };
    }
  } else if (monitor.status === 1 && prev && prev.status === 0) {
    isRecovered = true;
    delete state[key];
  } else {
    if (prev) {
      state[key] = { ...prev, status: monitor.status, lastSeenAt: now };
    }
  }

  return { isNewDown, isRecovered, hoursSinceLastAlert };
}

export function shouldAlert(monitorState) {
  if (monitorState.isNewDown) return true;
  const repeatHours = parseInt(process.env.ALERT_REPEAT_HOURS, 10) || 4;
  if (
    monitorState.hoursSinceLastAlert !== null &&
    monitorState.hoursSinceLastAlert >= repeatHours
  )
    return true;
  return false;
}

export function recordRepeatAlert(state, monitorId) {
  const entry = state[String(monitorId)];
  if (entry) {
    entry.lastAlertAt = new Date().toISOString();
    entry.alertCount = (entry.alertCount || 0) + 1;
  }
}
