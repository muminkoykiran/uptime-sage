/**
 * SRE/Resilience analiz motoru — AI CLI saglayici zinciri (agy, codex)
 * Anthropic API gerektirmez. Sira AI_PROVIDERS env'i ile belirlenir (varsayilan: agy,codex).
 */

import { join } from 'path';
import { readFileSync } from 'node:fs';
import { matchesSchema } from './schema.js';
import { logOperational } from './logger.js';
import { circuitRetryAt, classifyFailure, isCircuitOpen } from './ai-circuit.js';
import agy from './providers/agy.js';
import codex from './providers/codex.js';

const ROOT = join(import.meta.dirname, '..');
const SCHEMA_PATH = join(ROOT, 'config', 'analysis-schema.json');
const ANALYSIS_SCHEMA = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
const TRANSIENT_FAILURES = new Set(['TIMEOUT', 'MAX_BUFFER']);
const PROVIDERS = { agy, codex };
const MAX_ATTEMPTS = 2;

function isValidAnalysis(obj) {
  return matchesSchema(obj, ANALYSIS_SCHEMA) && Boolean(obj.telegramMessage.trim());
}

const aiLog = (provider, message, level = 'log') => logOperational(`[${provider.name.toUpperCase()}] ${message}`, level);

export function resolveProviders(names = process.env.AI_PROVIDERS || 'agy,codex') {
  const list = String(names).split(',').map(n => n.trim().toLowerCase()).filter(Boolean);
  const unknown = list.filter(n => !PROVIDERS[n]);
  if (unknown.length > 0) logOperational(`[AI] Bilinmeyen saglayici atlandi: ${unknown.join(', ')}`, 'error');
  return list.filter(n => PROVIDERS[n]).map(n => PROVIDERS[n]);
}

// Tek saglayici: circuit kontrolu + transient retry. { result } veya { outcome } doner.
async function tryProvider(provider, prompt, timeout, circuit, now) {
  if (isCircuitOpen(circuit, now)) {
    const retryAt = new Date(circuit.retryAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
    aiLog(provider, `Kota koruması etkin, ${retryAt}'e kadar atlanıyor`);
    return { outcome: { provider: provider.name, status: 'skipped', retryAt: circuit.retryAt, reason: circuit.reason } };
  }

  let reason = `${provider.name} geçerli bir analiz çıktısı üretmedi`;
  let failureDetail = '';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) {
      aiLog(provider, `Yeniden deneniyor (${attempt}/${MAX_ATTEMPTS})...`);
      await new Promise(r => setTimeout(r, 3_000));
    }
    try {
      const result = await provider.run(prompt, { timeout, isValid: isValidAnalysis });
      if (result) return { result, outcome: { provider: provider.name, status: 'success' } };
      reason = `${provider.name} geçerli şema çıktısı üretmedi`;
      aiLog(provider, `Deneme ${attempt}: geçerli JSON üretilemedi`, 'error');
      break;
    } catch (err) {
      const eventDetail = provider.failureDetail(err) || (err.message?.startsWith('Process') ? '' : err.message);
      const detail = [
        eventDetail,
        err.stderr?.slice(0, 300) || err.message,
        err.signal ? `signal=${err.signal}` : '',
      ].filter(Boolean).join(' | ');
      failureDetail = eventDetail || detail;
      aiLog(provider, `Deneme ${attempt} hatası: ${detail}`, 'error');
      reason = `${provider.name} hatası: ${eventDetail || err.code || err.exitCode || err.signal || 'bilinmeyen hata'}`;
      if (classifyFailure(failureDetail) === 'permanent' || !TRANSIENT_FAILURES.has(err.code)) break;
    }
  }

  const text = failureDetail || reason;
  if (classifyFailure(text) === 'permanent') {
    aiLog(provider, 'Kalıcı hata, kota koruması açıldı', 'error');
    return { reason, outcome: { provider: provider.name, status: 'open', reason: text, retryAt: circuitRetryAt(text, now, provider.backoffMinutes()) } };
  }
  aiLog(provider, 'Analiz yapılamadı', 'error');
  return { reason, outcome: { provider: provider.name, status: 'failed', reason: text } };
}

export async function analyzeMonitors(monitors, stats, timestamp, timezone = 'UTC', diagnostics = [], options = {}) {
  const now = options.now ?? Date.now();
  const providers = options.providers ?? resolveProviders();
  const circuits = options.circuits ?? {};
  const prompt = buildPrompt(monitors, stats, timestamp, timezone, diagnostics, options.runtimeHealth);
  // SSH diagnostics prompt'u büyütür — daha fazla süre ver
  const timeout = diagnostics.length > 0 ? 240_000 : 180_000;

  const outcomes = [];
  const reasons = [];
  for (const provider of providers) {
    const { result, reason, outcome } = await tryProvider(provider, prompt, timeout, circuits[provider.name], now);
    outcomes.push(outcome);
    if (result) return withOutcomes(result, outcomes);
    reasons.push(reason ?? `${provider.name} atlandı: ${outcome.reason}`);
  }

  const fallbackReason = reasons.join('; ') || 'AI sağlayıcısı yapılandırılmadı';
  logOperational('[AI] Hiçbir sağlayıcı analiz üretemedi, kurallı analiz kullanılıyor', 'error');
  return withOutcomes(buildFallbackAnalysis(stats, fallbackReason), outcomes);
}

function withOutcomes(analysis, outcomes) {
  return Object.assign(analysis, { _aiOutcomes: outcomes });
}

function buildFallbackAnalysis(stats, reason) {
  const severity = stats.down > 0 ? 'CRITICAL' : (stats.pending > 0 ? 'WARNING' : 'OK');
  return {
    severity,
    healthScore: stats.healthScore,
    summary: `${reason} — temel istatistikler kullanıldı`,
    criticalIssues: stats.downMonitors.map(name => ({
      monitor: name,
      issue: 'DOWN — AI analizi yapılamadı, durum bilinmiyor',
      impact: 'Servis erişilemez olabilir',
      action: 'Uptime Kuma panelini ve servis loglarını kontrol edin',
    })),
    warnings: stats.pendingMonitors.map(name => ({
      monitor: name,
      issue: 'PENDING — son kontrol başarısız, onay bekleniyor',
      recommendation: 'Monitor durumunu birkaç dakika izleyin',
    })),
    actions: stats.down > 0 ? [{
      priority: 'HIGH',
      description: 'Uptime Kuma panelinde DOWN monitörleri incele',
      command: '',
    }] : [],
    telegramMessage: buildFallbackMessage(stats),
    detailedReport: `⚠️ ${reason}. Ham istatistikler gösteriliyor.`,
  };
}

function buildFallbackMessage(stats) {
  const icon = stats.down > 0 ? '🔴' : (stats.pending > 0 ? '🟡' : '🟢');
  const severity = stats.down > 0 ? 'CRITICAL' : (stats.pending > 0 ? 'WARNING' : 'OK');
  const now = new Date().toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const pingPart = stats.avgPing != null ? ` | Ping: ${stats.avgPing}ms` : '';
  const lines = [
    `${icon} ${severity} | ${now} _(kurallı analiz)_`,
    '',
    `📊 ${stats.total} mon | ${stats.up}✅ ${stats.down}🔴 | Sağlık: ${stats.healthScore}${pingPart}`,
  ];
  if (stats.downMonitors.length > 0) {
    lines.push('', '🚨 *Kritik*');
    for (const name of stats.downMonitors) lines.push(`• *${name}* — DOWN`);
  }
  if (stats.pendingMonitors?.length > 0) {
    lines.push('', `⏳ ${stats.pendingMonitors.join(', ')} — PENDING`);
  }
  if (stats.up > 0) lines.push('', `✅ ${stats.up} normal`);
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
  for (const d of diagnostics.slice(0, 10)) {
    const monitorNames = d.monitors?.join(', ') || d.monitorName || '?';
    if (d.status === 'error') {
      lines.push(`Host: ${d.host} (${monitorNames})`);
      lines.push(`  SSH_ERROR: ${d.reason}`);
    } else {
      lines.push(`Host: ${d.host} (${monitorNames})`);
      for (const cmd of (d.commands || []).slice(0, 12)) {
        lines.push(`  [${cmd.type}] ${cmd.label}`);
        // Her satiri 2 boslukla girintile, boş satırlari atla
        for (const line of String(cmd.output).slice(0, 2_000).split('\n')) {
          if (line.trim()) lines.push(`    ${line}`);
        }
      }
    }
  }
  lines.push('');
  return lines.join('\n');
}

function buildPrompt(monitors, stats, timestamp, timezone, diagnostics = [], runtimeHealth) {
  const problematic = [];

  for (const m of monitors) {
    const isFlapping = detectFlapping(m.recentStatuses);
    if (m.statusText !== 'UP') {
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
    }
  }

  const downLine = stats.downMonitors.length > 0
    ? `DOWN: ${stats.downMonitors.join(', ')}\n` : '';

  return `Sen kıdemli bir SRE'sin. Saatlik Uptime Kuma kontrolü — ${timestamp} (${timezone}).
Alarm gürültüsünü minimize et. Gerçek sorunlara odaklan.

─── ANLIK DURUM ───
${stats.total} monitor | UP ${stats.up} | DOWN ${stats.down} | PENDING ${stats.pending} | MAINTENANCE ${stats.maintenance}
Sağlık: ${stats.healthScore}/100 | Ort ping: ${stats.avgPing ?? '-'}ms | Maks: ${stats.maxPing ?? '-'}ms
${downLine}
─── SORUNLU MONITORLER ───
<data>${JSON.stringify(problematic)}</data>
Not: recentTrend sol=eski sağ=yeni, [!]=flapping.
Sağlıklı monitor sayısı: ${stats.up}. İsimlerini listeleme.
${runtimeHealth ? `\n─── AJAN ÇALIŞMA ORTAMI ───\n${JSON.stringify(runtimeHealth)}\n` : ''}
${buildDiagnosticsSection(diagnostics)}
─── SEVERİTY KURALLARI ───
CRITICAL → herhangi DOWN | 3+ monitor eş zamanlı flapping
WARNING  → herhangi flapping | PENDING | 24s uptime <%99 | 30g uptime <%99.9
OK       → tümü UP, stabil trend
Ping/gecikme tek başına sorun değildir; severity'yi etkilemez, uyarı olarak listeleme.
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

warnings: Flapping, PENDING, düşük uptime. Her kayıt için:
  monitor: adı
  issue: eşik aşımı ve değer
  recommendation: olası neden ve izleme önerisi

actions: Operatör için 1-3 terminal komutu. Boş komut için "" yaz.
  HIGH → DOWN monitor anlık kontrol
  MED  → flapping/PENDING diagnostic
  LOW  → önleyici izleme

detailedReport: Teknik SRE özeti. Trend analizi, flapping pattern, kök neden tahmini. Markdown kullan.

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

OK mesajında yalnızca header, stats ve normal sayısını yaz.`;
}
