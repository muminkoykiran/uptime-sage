/**
 * Codex CLI exec ile SRE/Resilience analiz motoru
 * Anthropic API gerektirmez — codex exec (OpenAI) kullanir
 */

import { join } from 'path';
import { readFileSync, unlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawnAsync } from './util.js';

const ROOT = join(import.meta.dirname, '..');
const SCHEMA_PATH = join(ROOT, 'config', 'analysis-schema.json');

function isValidAnalysis(obj) {
  return obj && obj.severity && obj.healthScore !== undefined && obj.telegramMessage;
}

// --json modunda JSONL event stream'den structured output'u parse eder.
// turn.completed event'indeki output alani JSON schema ciktiyi icerir.
function parseJsonlOutput(stdout) {
  const lines = stdout.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.startsWith('{')) continue;
    try {
      const event = JSON.parse(line);
      // turn.completed → output field contains the schema-validated JSON string
      if (event.type === 'turn.completed' && event.output) {
        try {
          const parsed = JSON.parse(event.output);
          if (isValidAnalysis(parsed)) return parsed;
        } catch { /* output might not be JSON directly */ }
      }
      // item.completed with assistant message content
      if (event.type === 'item.completed' && event.item?.content) {
        for (const block of (Array.isArray(event.item.content) ? event.item.content : [])) {
          if (block.type === 'text' || block.type === 'output_text') {
            try {
              const parsed = JSON.parse(block.text ?? block.value ?? '');
              if (isValidAnalysis(parsed)) return parsed;
            } catch { /* not JSON */ }
          }
        }
      }
      // Direct JSON object in event stream (--output-schema response)
      if (isValidAnalysis(event)) return event;
    } catch { /* not valid JSON */ }
  }
  return null;
}

const _isDebug = process.argv.includes('--debug');
const _tz = () => process.env.TIMEZONE || 'UTC';
const _now = () => new Date().toLocaleTimeString('tr-TR', { timeZone: _tz() });

// Tek bir Codex denemesi: spawn → parse → result veya null (spawn hatası fırlatır)
async function attemptCodex(codexBin, prompt, outFile, timeout) {
  const spawnMs = Date.now();
  let lastEventMs = spawnMs;
  const progressTimer = setInterval(() => {
    const now = Date.now();
    const quietSec = Math.round((now - lastEventMs) / 1000);
    if (quietSec >= 25) console.log(`[${_now()}] [CODEX] Muhakeme yapılıyor... (${Math.round((now - spawnMs) / 1000)}s)`);
  }, 30_000);
  const clearProgress = () => clearInterval(progressTimer);

  const onStderr = (chunk) => {
    for (const line of chunk.split('\n')) {
      if (line.trim()) console.log(`[${_now()}] [CODEX:err] ${line.trim()}`);
    }
  };

  const _JBUF_MAX = 512 * 1024;
  let _jBuf = '';
  const onStdout = (chunk) => {
    lastEventMs = Date.now();
    _jBuf += chunk;
    if (_jBuf.length > _JBUF_MAX) _jBuf = _jBuf.slice(-_JBUF_MAX);
    const lines = _jBuf.split('\n');
    _jBuf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      let ev;
      try { ev = JSON.parse(line); } catch { continue; }
      const t = ev.type;
      const item = ev.item ?? {};
      if (t === 'turn.started') {
        console.log(`[${_now()}] [CODEX] Analiz başladı`);
      } else if (t === 'item.started' && item.type === 'command_execution') {
        const cmd = String(item.command ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
        if (cmd) console.log(`[${_now()}] [CODEX] $ ${cmd}`);
      } else if (t === 'item.completed' && item.type === 'command_execution') {
        if (_isDebug) console.log(`[${_now()}] [CODEX] exit=${item.exit_code ?? '?'}`);
      } else if (t === 'item.completed' && item.type === 'agent_message') {
        console.log(`[${_now()}] [CODEX] Yanıt oluşturuldu`);
      } else if (t === 'turn.completed') {
        console.log(`[${_now()}] [CODEX] Analiz tamamlandı`);
      } else if (_isDebug && t && t !== 'thread.started') {
        console.log(`[${_now()}] [CODEX:ev] ${t}`);
      }
    }
  };

  let stdout;
  try {
    ({ stdout } = await spawnAsync(
      codexBin,
      ['exec', '--json', '--ephemeral', '--skip-git-repo-check',
       '--sandbox', 'read-only', '--output-schema', SCHEMA_PATH,
       '--output-last-message', outFile, prompt],
      { cwd: ROOT, timeout, killSignal: 'SIGKILL', onStdout, onStderr }
    ));
    clearProgress();
  } catch (err) {
    clearProgress();
    cleanupTmpFile(outFile);
    throw err;
  }

  if (existsSync(outFile)) {
    try {
      const fileContent = readFileSync(outFile, 'utf8').trim();
      cleanupTmpFile(outFile);
      if (fileContent) {
        const parsed = JSON.parse(fileContent);
        if (isValidAnalysis(parsed)) return parsed;
      }
    } catch { /* JSONL'e geç */ }
  }

  cleanupTmpFile(outFile);

  const raw = stdout.trim();
  if (raw) {
    const fromJsonl = parseJsonlOutput(raw);
    if (fromJsonl) return fromJsonl;
  }

  return null;
}

export async function analyzeMonitors(monitors, stats, timestamp, timezone = 'UTC', diagnostics = []) {
  const codexBin = process.env.CODEX_BIN || 'codex';
  const prompt = buildPrompt(monitors, stats, timestamp, timezone, diagnostics);
  // SSH diagnostics prompt'u büyütür — daha fazla süre ver
  const timeout = diagnostics.length > 0 ? 240_000 : 180_000;
  const MAX_ATTEMPTS = 2;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) {
      console.log(`[${_now()}] [CODEX] Yeniden deneniyor (${attempt}/${MAX_ATTEMPTS})...`);
      await new Promise(r => setTimeout(r, 3_000));
    }

    const outFile = join(tmpdir(), `codex-analysis-${randomUUID()}.json`);
    try {
      const result = await attemptCodex(codexBin, prompt, outFile, timeout);
      if (result) return result;
      console.error(`[${_now()}] [CODEX] Deneme ${attempt}: geçerli JSON üretilemedi`);
    } catch (err) {
      const detail = [
        err.stderr?.slice(0, 300) || err.message,
        err.signal ? `signal=${err.signal}` : '',
      ].filter(Boolean).join(' | ');
      console.error(`[${_now()}] [CODEX] Deneme ${attempt} hatası: ${detail}`);
      if (_isDebug) console.error(`[DEBUG] stderr:\n${err.stderr?.slice(-500) ?? ''}`);
    }
  }

  console.error(`[${_now()}] [CODEX] ${MAX_ATTEMPTS} deneme başarısız — fallback`);
  return buildFallbackAnalysis(stats);
}

function cleanupTmpFile(path) {
  try { if (existsSync(path)) unlinkSync(path); } catch { /* sessizce gec */ }
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
  const now = new Date().toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const pingPart = stats.avgPing != null ? ` | Ping: ${stats.avgPing}ms` : '';
  const lines = [
    `${icon} ${severity} | ${now} _(fallback)_`,
    '',
    `📊 ${stats.total} mon | ${stats.up}✅ ${stats.down}🔴 | Sağlık: ${stats.healthScore}${pingPart}`,
  ];
  if (stats.downMonitors.length > 0) {
    lines.push('', '🚨 *Kritik*');
    for (const name of stats.downMonitors) lines.push(`• *${name}* — DOWN`);
  }
  if (stats.slowMonitors?.length > 0) {
    lines.push('', `⚠️ ${stats.slowMonitors.join(', ')} — yüksek ping`);
  }
  const normalCount = stats.up - (stats.slowMonitors?.length ?? 0);
  if (normalCount > 0) lines.push('', `✅ ${normalCount} normal`);
  if (stats.down > 0) {
    lines.push('', `💡 *Özet*\n${stats.down} monitor DOWN — AI analizi yapılamadı, Uptime Kuma panelini kontrol edin.`);
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

function buildDiagnosticsSection(diagnostics) {
  if (!diagnostics || diagnostics.length === 0) return '';
  const lines = ['', '─── SSH DIAGNOSTICS ───'];
  for (const d of diagnostics) {
    const monitorNames = d.monitors?.join(', ') || d.monitorName || '?';
    if (d.status === 'error') {
      lines.push(`Host: ${d.host} (${monitorNames})`);
      lines.push(`  SSH_ERROR: ${d.reason}`);
    } else {
      lines.push(`Host: ${d.host} (${monitorNames})`);
      for (const cmd of (d.commands || [])) {
        lines.push(`  [${cmd.type}] ${cmd.label}`);
        // Her satiri 2 boslukla girintile, boş satırlari atla
        for (const line of cmd.output.split('\n')) {
          if (line.trim()) lines.push(`    ${line}`);
        }
      }
    }
  }
  lines.push('');
  return lines.join('\n');
}

function buildPrompt(monitors, stats, timestamp, timezone, diagnostics = []) {
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
${buildDiagnosticsSection(diagnostics)}
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

Format kuralları:
- Header tek satır: severity ve timestamp inline (örn: "🔴 CRITICAL | 18 Nis 20:45")
- Stats: "📊 N mon | N✅ N🔴 | Sağlık: N | Ping: Nms" (Ping yoksa atla)
- Kritik sorunları sunucu/host adına göre grupla. SSH diagnostics varsa host adresini, yoksa monitor adındaki ortak önek/grup bilgisini kullan.
- Grup başlığı: "🚨 *sunucu_adı*" (bold)
- Her sorun: "• *MonitorAdı* — kısa açıklama (max 70 karakter, teknik detay yeterli)"
- Uyarılar: "⚠️ Ad1, Ad2 — kısa neden"
- Sağlıklılar: sadece "✅ N normal" (isim listesi yok)
- Özet bölümünden önce 🔧 *Aksiyonlar* bölümü ekle (sadece CRITICAL ve WARNING'de, OK'de atla): HIGH öncelikli aksiyonları göster, max 3 madde. Komut varsa \`komut\` formatında yaz, yoksa sadece açıklama. Her madde "• açıklama — \`komut\`" veya sadece "• açıklama" formatında.
- En sona 💡 *Özet* bölümü ekle: SSH bulgularını ve kök neden tahminini 2-3 cümlede sentezle. Hangi sunucuda ne tür sorun olduğunu ve öncelik sırasını belirt. Teknik ama sade.

ÖRNEK — CRITICAL:
🔴 CRITICAL | 18 Nis 20:45

📊 28 mon | 21✅ 7🔴 | Sağlık: 65 | Ping: 352ms

🚨 *master*
• *API Server* — port 8082 kapalı, süreç yok
• *Auth Service* — systemd unit bulunamadı

🚨 *slave3*
• *FinancialGPT* — servis ayakta, health FAILURE, WebSocket hataları
• *XSS* — Exited(137) 18sa, 404

🚨 *jetson*
• *Homebridge* — reboot sonrası 502, container yok

⚠️ FinancialGPT, CandyTrader — %84 uptime, kronik sağlık sorunu

✅ 21 normal

🔧 *Aksiyonlar*
• jetson'da Homebridge container'ı başlat — \`ssh user@host "docker start homebridge"\`
• slave3'te FinancialGPT yeniden başlat — \`ssh user@host "systemctl restart FinancialGPT.service"\`
• XSS container'ını başlat — \`ssh user@host "docker start xss"\`

💡 *Özet*
master'da süreç/deploy eksikliği (port dinleyici yok), slave3'te uygulama sağlık arızası (exchange timeout), jetson'da reboot sonrası container başlamamış. Öncelik: master ve jetson'da manuel restart, slave3'te exchange bağlantısı incelemesi.

ÖRNEK — WARNING:
🟡 WARNING | 18 Nis 20:45

📊 5 mon | 5✅ 0🔴 | Sağlık: 92 | Ping: 890ms

⚠️ *API Server* — flapping, 1 saatte 6 geçiş
⚠️ *CDN* — 24s uptime %97.2

✅ 3 normal

🔧 *Aksiyonlar*
• API Server loglarını kontrol et — \`ssh user@host "journalctl -u api-server -n 50"\`

💡 *Özet*
API Server kararsız davranıyor; CDN uptime eşiğin altında. Ani kesinti yok, izleme yeterli.

ÖRNEK — OK:
🟢 OK | 18 Nis 20:45

📊 5 mon | 5✅ 0🔴 | Sağlık: 100 | Ping: 145ms

✅ 5 normal`;
}
