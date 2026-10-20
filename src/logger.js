let timezone = 'UTC';

export function configureLogger({ timeZone = 'UTC' } = {}) {
  timezone = timeZone;
}

export function logOperational(message, level = 'log') {
  const now = new Date().toLocaleTimeString('tr-TR', { timeZone: timezone });
  console[level](`[${now}] ${message}`);
}
