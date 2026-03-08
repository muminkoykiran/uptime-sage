/**
 * Codex CLI exec ile SRE/Resilience analiz motoru
 * Anthropic API gerektirmez — codex exec (OpenAI) kullanir
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { join } from 'path';

const execFileAsync = promisify(execFile);

// FIX: import.meta.dirname (Node 20.11+) — __dirname shim gereksiz
const ROOT = join(import.meta.dirname, '..');
const SCHEMA_PATH = join(ROOT, 'config', 'analysis-schema.json'); // module-level constant

function isValidAnalysis(obj) {
  return obj && obj.severity && obj.healthScore !== undefined && obj.telegramMessage;
}

export async function analyzeMonitors(monitors, stats, timestamp, timezone = 'UTC') {
  const codexBin = process.env.CODEX_BIN || 'codex';
  const prompt = buildPrompt(monitors, stats, timestamp, timezone);

  let stdout, stderr;
  try {
    ({ stdout, stderr } = await execFileAsync(
      codexBin,
      [
        'exec',
        '--ephemeral',
        '--skip-git-repo-check',
        '--sandbox', 'read-only',
        '--output-schema', SCHEMA_PATH,
        prompt,
      ],
      { cwd: ROOT, timeout: 120_000, maxBuffer: 4 * 1024 * 1024, killSignal: 'SIGKILL' }
    ));
  } catch (err) {
    const detail = [
      err.stderr?.slice(0, 500) || err.message,
      err.code ? `code=${err.code}` : '',
      err.signal ? `signal=${err.signal}` : '',
    ].filter(Boolean).join(' | ');

    console.error(`codex exec hatasi: ${detail}`);
    return buildFallbackAnalysis(stats);
  }

  const raw = stdout.trim();
  if (!raw) {
    console.error(`codex exec bos yanit donurdu. Stderr: ${stderr?.slice(0, 300)}`);
    return buildFallbackAnalysis(stats);
  }

  // Line-based JSON parse: iterate from end, try JSON.parse on each line
  const lines = raw.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(line);
      if (isValidAnalysis(parsed)) return parsed;
    } catch { /* not valid JSON, try previous line */ }
  }

  // Fallback: try parsing entire output
  try {
    const parsed = JSON.parse(raw);
    if (isValidAnalysis(parsed)) return parsed;
  } catch { /* not valid JSON */ }

  console.error(`Gecerli JSON bulunamadi. Cikti: ${raw.slice(0, 300)}`);
  return buildFallbackAnalysis(stats);
}

function buildFallbackAnalysis(stats) {
  const severity = stats.down > 0 ? 'CRITICAL' : (stats.slowMonitors?.length > 0 ? 'WARNING' : 'OK');
  return {
    severity,
    healthScore: stats.healthScore,
    summary: 'AI analizi yapilamadi — temel istatistikler',
    criticalIssues: stats.downMonitors.map(name => ({
      monitor: name,
      issue: 'DOWN — AI analizi yapılamadı, durum bilinmiyor',
      impact: 'Servis erişilemez olabilir',
      action: 'Uptime Kuma panelini ve servis loglarını kontrol edin',
    })),
    warnings: stats.slowMonitors.map(entry => ({
      monitor: entry,
      issue: 'Yüksek ping (>1000ms)',
      recommendation: 'Servis yükünü ve ağ durumunu kontrol edin',
    })),
    actions: stats.down > 0 ? [{
      priority: 'HIGH',
      description: 'Uptime Kuma panelinde DOWN monitörleri incele',
      command: '',
    }] : [],
    telegramMessage: buildFallbackMessage(stats),
    detailedReport: '⚠️ Codex CLI yanıt vermedi — AI analizi yapılamadı. Ham istatistikler gösteriliyor.',
  };
}

function buildFallbackMessage(stats) {
  const icon = stats.down > 0 ? '🔴' : (stats.slowMonitors?.length > 0 ? '🟡' : '🟢');
  const severity = stats.down > 0 ? 'CRITICAL' : (stats.slowMonitors?.length > 0 ? 'WARNING' : 'OK');
  const lines = [
    `${icon} *${severity}* — Uptime Raporu _(fallback)_`,
    '',
    `📊 *${stats.total} monitor* | ${stats.up}✅ ${stats.down > 0 ? stats.down + '🔴' : '0🔴'} | Sağlık: ${stats.healthScore}/100${stats.avgPing != null ? ` | Ping ort: ${stats.avgPing}ms` : ''}`,
  ];
  if (stats.downMonitors.length > 0) {
    lines.push('', '🚨 *Kritik*');
    for (const name of stats.downMonitors) lines.push(`• *${name}* — DOWN`);
  }
  if (stats.slowMonitors?.length > 0) {
    lines.push('', '⚠️ *Yavaş*');
    for (const entry of stats.slowMonitors) lines.push(`• ${entry}`);
  }
  const upNames = stats.total - stats.down - (stats.slowMonitors?.length ?? 0);
  if (upNames > 0 && stats.down === 0 && !stats.slowMonitors?.length) {
    lines.push('', `✅ Tüm servisler normal`);
  }
  return lines.join('\n');
}

function sanitizeLastMsg(msg) {
  if (!msg) return '';
  return msg
    .slice(0, 200)
    .replace(/[\n\r]/g, ' ')
    .replace(/[<>{}[\]`|]/g, '');
}

function detectFlapping(recentStatuses) {
  if (!recentStatuses || recentStatuses.length < 2) return false;
  let transitions = 0;
  for (let i = 1; i < recentStatuses.length; i++) {
    if (recentStatuses[i].status !== recentStatuses[i - 1].status) {
      transitions++;
    }
  }
  return transitions > 4;
}

function buildPrompt(monitors, stats, timestamp, timezone) {
  const problematic = [];
  const healthyNames = [];

  for (const m of monitors) {
    const isFlapping = detectFlapping(m.recentStatuses);
    if (m.statusText !== 'UP' || (m.ping && m.ping > 1000)) {
      const entry = {
        name: m.name,
        status: m.statusText,
        isFlapping,
        recentTrend: m.recentStatuses.slice(-10).map(s => s.status).join('→'),
      };
      if (m.group) entry.group = m.group;
      if (m.ping != null) entry.ping = `${m.ping}ms`;
      if (m.uptime24h != null) entry.uptime24h = `${m.uptime24h}%`;
      if (m.uptime30d != null) entry.uptime30d = `${m.uptime30d}%`;
      const msg = sanitizeLastMsg(m.msg);
      if (msg) entry.lastMsg = msg;
      problematic.push(entry);
    } else {
      healthyNames.push(isFlapping ? `${m.name}[!]` : m.name);
    }
  }

  const downLine = stats.downMonitors.length > 0
    ? `DOWN: ${stats.downMonitors.join(', ')}\n` : '';
  const slowLine = stats.slowMonitors.length > 0
    ? `Yavaş (>1000ms): ${stats.slowMonitors.join(', ')}\n` : '';

  return `Sen kıdemli bir SRE'sin. Saatlik Uptime Kuma kontrolü — ${timestamp} (${timezone}).
Alarm gürültüsünü minimize et. Gerçek sorunlara odaklan.

─── ANLIK DURUM ───
${stats.total} monitor | UP ${stats.up} | DOWN ${stats.down} | PENDING ${stats.pending} | MAINTENANCE ${stats.maintenance}
Sağlık: ${stats.healthScore}/100 | Ort ping: ${stats.avgPing ?? '-'}ms | Maks: ${stats.maxPing ?? '-'}ms
${downLine}${slowLine}
─── SORUNLU MONITORLER ───
<data>${JSON.stringify(problematic)}</data>
Not: recentTrend sol=eski sağ=yeni, [!]=flapping.

Sağlıklı (${healthyNames.length}): ${healthyNames.join(', ') || 'YOK'}

─── SEVERİTY KURALLARI ───
CRITICAL → herhangi DOWN | 3+ monitor eş zamanlı flapping
WARNING  → herhangi flapping | ping kalıcı >1000ms | 24s uptime <%99 | 30g uptime <%99.9
OK       → tümü UP, stabil trend, makul ping
Belirsizse üst seviyeyi seç.

─── ALAN KILAVUZU ───

severity: Yukarıdaki kurallara göre tek değer.

healthScore: ${stats.healthScore} temel al. Her flapping monitor için -3 (maks -15 düzeltme). DOWN varsa ek -10.

summary: 2-3 cümle düz metin (Markdown yok). Ne var, ne etkileniyor, ne zamandan beri?

criticalIssues: Sadece DOWN ve kritik flapping. Her kayıt için:
  monitor: adı
  issue: somut sorun — kaç dakika DOWN, hata mesajı, trend
  impact: hangi sistem/kullanıcı etkileniyor
  action: ilk bakılacak yer (log, port, DNS, SSL vb.)

warnings: Flapping, yavaş ping, düşük uptime. Her kayıt için:
  monitor: adı
  issue: eşik aşımı ve değer
  recommendation: olası neden ve izleme önerisi

actions: Operatör için 1-3 terminal komutu. Boş komut için "" yaz.
  HIGH → DOWN monitor anlık kontrol
  MED  → flapping/yavaş diagnostic
  LOW  → önleyici izleme

detailedReport: Teknik SRE özeti. Trend analizi, flapping pattern, ping yorumu, kök neden tahmini. Markdown kullan.

─── TELEGRAM MESAJI ───
Türkçe. Telegram Markdown: *bold* _italic_ \`kod\`. Maks 3800 karakter.
Sağlıklı monitörleri tek satırda grupla, tek tek açıklama yapma.

ÖRNEK — CRITICAL:
🔴 *CRITICAL* — Uptime Raporu
_${timestamp}_

📊 *5 monitor* | 4✅ 1🔴 | Sağlık: 80/100 | Ping ort: 245ms

🚨 *Kritik*
• *API Server* — 23 dk DOWN
  ↳ Son hata: "connection refused" — sunucu/port kontrol edin

⚠️ *Uyarı*
• *Web Frontend* — Yüksek ping: 1.340ms (son 5 kontrol)

✅ Database, Cache, Queue — normal

ÖRNEK — WARNING:
🟡 *WARNING* — Uptime Raporu
_${timestamp}_

📊 *5 monitor* | 5✅ 0🔴 | Sağlık: 92/100 | Ping ort: 890ms

⚠️ *Uyarı*
• *API Server* — Kararsız (flapping): 1 saatte 6 geçiş
• *CDN* — 24s uptime %97.2 (eşik: %99)

✅ Database, Cache, Queue, Auth — normal

ÖRNEK — OK:
🟢 *OK* — Uptime Raporu
_${timestamp}_

📊 *5 monitor* | 5✅ 0🔴 | Sağlık: 100/100 | Ping ort: 145ms

✅ Tüm servisler normal: API, Web, Database, Cache, Queue`;
}
