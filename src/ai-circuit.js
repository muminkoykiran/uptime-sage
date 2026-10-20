const PERMANENT_FAILURE = /usage limit|rate limit|invalid_request_error|not supported when using codex|authentication|unauthorized|forbidden|invalid model selection|quota|RESOURCE_EXHAUSTED|not logged in|login required/i;

export function isCircuitOpen(circuit, now = Date.now()) {
  return Number(circuit?.retryAt) > now;
}

export function circuitRetryAt(detail, now = Date.now(), backoffMinutes = 60) {
  // Usage-limit errors commonly include a local-clock reset such as "try again at 8:13 AM".
  const match = String(detail).match(/try again at\s+(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (match) {
    let hours = Number(match[1]);
    const minutes = Number(match[2]);
    const ampm = match[3]?.toUpperCase();
    if (ampm === 'AM' && hours === 12) hours = 0;
    if (ampm === 'PM' && hours !== 12) hours += 12;
    if (hours < 24 && minutes < 60) {
      const retry = new Date(now);
      retry.setHours(hours, minutes, 0, 0);
      if (retry.getTime() <= now) retry.setDate(retry.getDate() + 1);
      return retry.getTime();
    }
  }
  return now + Math.max(1, backoffMinutes) * 60_000;
}

export function classifyFailure(detail) {
  return PERMANENT_FAILURE.test(String(detail)) ? 'permanent' : 'transient';
}
