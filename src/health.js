export function assessHealth(monitors) {
  const issues = [];
  let flapping = 0;
  for (const m of monitors) {
    const beats = m.recentStatuses || [];
    const transitions = beats.slice(1).filter((b, i) => b.status !== beats[i].status).length;
    if (transitions > 4) { flapping++; issues.push(`${m.id}:flapping`); }
    if (m.status === 0) issues.push(`${m.id}:down`);
    if (![0, 1, 3].includes(m.status)) issues.push(`${m.id}:missing-or-pending`);
    if (m.uptime24h != null && m.uptime24h < 99) issues.push(`${m.id}:uptime24h`);
    if (m.uptime30d != null && m.uptime30d < 99.9) issues.push(`${m.id}:uptime30d`);
  }
  return {
    severity: monitors.some(m => m.status === 0) || flapping >= 3 ? 'CRITICAL' : issues.length ? 'WARNING' : 'OK',
    fingerprint: issues.sort().join('|'),
  };
}

export function shouldNotifyHealth(current, previous, nowMs, repeatMs) {
  if (!previous) return current.severity !== 'OK';
  if (current.severity !== previous.severity) return true;
  return current.severity !== 'OK' && nowMs - (previous.sentAt || 0) >= repeatMs;
}

// 'skip' | 'recovery' | 'full' — OK durumunda yalnizca gercek recovery mesaji gider.
export function decideNotification({ severity, recoveries = [], isPartial = false, needsAlert }) {
  if (!needsAlert) return 'skip';
  if (severity === 'OK' && !isPartial) return recoveries.length > 0 ? 'recovery' : 'skip';
  return 'full';
}
