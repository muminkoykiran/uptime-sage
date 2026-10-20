import { readFileSync, statfsSync } from 'node:fs';
import { freemem, loadavg, totalmem } from 'node:os';

function envPercent(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : fallback;
}

export function collectRuntimeHealth(path = '/') {
  const fs = statfsSync(path);
  const total = Number(fs.blocks) * Number(fs.bsize);
  const available = Number(fs.bavail) * Number(fs.bsize);
  const diskUsedPercent = total > 0 ? Math.round(((total - available) / total) * 100) : 0;
  const memoryTotal = totalmem();
  const memoryFree = freemem();
  const swap = readSwapInfo();
  const diskWarning = envPercent('AGENT_DISK_WARNING_PERCENT', 85);
  const diskCritical = envPercent('AGENT_DISK_CRITICAL_PERCENT', 95);
  const swapWarning = envPercent('AGENT_SWAP_WARNING_PERCENT', 80);
  const issues = [];
  let severity = 'OK';

  if (diskUsedPercent >= diskCritical) {
    severity = 'CRITICAL';
    issues.push(`Kök disk kullanımı %${diskUsedPercent} (kritik eşik %${diskCritical})`);
  } else if (diskUsedPercent >= diskWarning) {
    severity = 'WARNING';
    issues.push(`Kök disk kullanımı %${diskUsedPercent} (uyarı eşiği %${diskWarning})`);
  }
  if (swap.usedPercent >= swapWarning) {
    if (severity === 'OK') severity = 'WARNING';
    issues.push(`Swap kullanımı %${swap.usedPercent} (uyarı eşiği %${swapWarning})`);
  }

  return {
    severity,
    issues,
    diskUsedPercent,
    diskAvailableBytes: available,
    memoryAvailableBytes: memoryFree,
    memoryTotalBytes: memoryTotal,
    swap,
    load1: Math.round(loadavg()[0] * 100) / 100,
  };
}

function readSwapInfo() {
  try {
    const text = process.platform === 'linux' ? readFileSync('/proc/meminfo', 'utf8') : '';
    const total = Number(text.match(/^SwapTotal:\s+(\d+)/m)?.[1] || 0) * 1024;
    const free = Number(text.match(/^SwapFree:\s+(\d+)/m)?.[1] || 0) * 1024;
    const used = Math.max(0, total - free);
    return { totalBytes: total, usedBytes: used, usedPercent: total ? Math.round((used / total) * 100) : 0 };
  } catch {
    return { totalBytes: 0, usedBytes: 0, usedPercent: 0 };
  }
}
