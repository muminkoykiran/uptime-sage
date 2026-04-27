/**
 * Stop hook — Codex oturumu kapandiginda calisir.
 *
 * Normal kosulda: last_assistant_message = analysis JSON → index.js zaten Telegram'a gonderdi,
 * buradan tekrar gonderme. Sadece JSON parse edilemiyorsa (Codex crash/timeout) alert gonder.
 */

let input = '';
for await (const chunk of process.stdin) input += chunk;

let event = {};
try { event = JSON.parse(input); } catch { /* stdin bos veya parse edilemiyor */ }

const lastMsg = (event.last_assistant_message || '').trim();

// lastMsg parseable JSON ise → normal run tamamlandi, index.js halletti
let isNormalCompletion = false;
try {
  if (lastMsg) {
    JSON.parse(lastMsg);
    isNormalCompletion = true;
  }
} catch { /* JSON degil — Codex crash olabilir */ }

if (!isNormalCompletion && process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
  const preview = lastMsg ? lastMsg.slice(0, 300) : '(cikti yok)';
  const text = `⚠️ Uptime Agent — Codex oturumu beklenmedik sekilde kapandi.\n\n${preview}`;
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
