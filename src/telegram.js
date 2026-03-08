/**
 * Telegram Bot API istemcisi
 */

const TELEGRAM_API = 'https://api.telegram.org';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function sendChunk(botToken, chatId, text, parseMode) {
  const doFetch = () => fetch(`${TELEGRAM_API}/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: parseMode,
      disable_web_page_preview: true,
    }),
    signal: AbortSignal.timeout(10000),
  });

  let res = await doFetch();

  // Retry on 429 (rate limit)
  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get('Retry-After') || '5', 10);
    await sleep(retryAfter * 1000);
    res = await doFetch();
  }
  // Retry once on 5xx
  else if (res.status >= 500) {
    await sleep(2000);
    res = await doFetch();
  }

  return res;
}

export function getChatIdForSeverity(severity) {
  return process.env[`TELEGRAM_${severity}_CHAT_ID`] || process.env.TELEGRAM_CHAT_ID;
}

export async function sendMessage(text, parseMode = 'Markdown', options = {}) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = options.chatId || process.env.TELEGRAM_CHAT_ID;
  if (!botToken) throw new Error('TELEGRAM_BOT_TOKEN ayarli degil');
  if (!chatId) throw new Error('TELEGRAM_CHAT_ID ayarli degil');

  for (const chunk of splitMessage(text, 4000)) {
    let res = await sendChunk(botToken, chatId, chunk, parseMode);

    // FIX: sadece basarisiz olan chunk'i yeniden dene — tum mesaji tekrar gondermez
    if (!res.ok && res.status === 400 && parseMode !== '') {
      res = await sendChunk(botToken, chatId, stripMarkdown(chunk), '');
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Telegram API hatasi ${res.status}: ${body}`);
    }
  }
}

export async function sendErrorAlert(errorMessage, timestamp) {
  const text = [
    'Uptime Resilience Agent -- Hata',
    `Saat: ${timestamp}`,
    '',
    errorMessage.slice(0, 500),
  ].join('\n');

  // Plain text gondeririz — parse hatasi olmaz; network hatasi olursa sustur
  await sendMessage(text, '').catch(() => {});
}

function splitMessage(text, maxLength = 4000) {
  if (text.length <= maxLength) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > maxLength) {
    let splitAt = maxLength;
    // try to split at last newline within maxLength
    const lastNl = remaining.lastIndexOf('\n', maxLength);
    if (lastNl > maxLength - 200) splitAt = lastNl + 1;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }
  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}

function stripMarkdown(text) {
  return text.replace(/[*_`[\]]/g, '');
}
