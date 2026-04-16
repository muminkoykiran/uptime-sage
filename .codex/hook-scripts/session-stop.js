/**
 * Stop hook — Codex oturumu tamamlandiginda veya beklenmedik sekilde kapandiginda calisir.
 * CRITICAL durumunda Telegram'a dogrudan bildirim gonderir (Codex exec crash fallback).
 */


let input = '';
for await (const chunk of process.stdin) input += chunk;

let event = {};
try { event = JSON.parse(input); } catch { /* stdin bos veya parse edilemiyor */ }

const lastMsg = event.last_assistant_message || '';
const isCritical = /CRITICAL/i.test(lastMsg);

// Sadece dogrudan Telegram bildirimi gereken durumlar: beklenmedik sonlanma
// Normal CRITICAL durumlar zaten src/index.js tarafindan Telegram'a gonderiliyor.
// Bu hook, codex exec'in kendisi crash yaparsa devreye girer.
if (isCritical && process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
  const text = `Uptime Agent — Codex oturumu CRITICAL ile kapandi.\n\n${lastMsg.slice(0, 400)}`;
  try {
    await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text }),
      signal: AbortSignal.timeout(8000),
    });
  } catch { /* hook hatalari sessizce gecilir */ }
}

process.stdout.write(JSON.stringify({ continue: true }) + '\n');
