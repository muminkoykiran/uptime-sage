---
name: telegram-dispatch
description: Telegram Bot API ile mesaj gonderme, bildirim formatlama ve eskalasyon yonetimi. Telegram entegrasyonunu duzenleme veya yeni bildirim kanali ekleme islemlerinde kullan.
---

# Telegram Dispatch Skill

Telegram Bot API uzerinden bildirim gonderme ve kanal yonetimi.

## Bot Kurulum

1. Telegram'da @BotFather'a git
2. `/newbot` yaz
3. Bot adi ve kullanici adi ver
4. Token al: `123456789:AAF...`
5. `TELEGRAM_BOT_TOKEN=<token>` env'e ekle

## Chat ID Bulma

**Kullanici ID:**
```
@userinfobot'a /start yaz → sana ID'ni gonderir
```

**Grup ID:**
```
1. Gruba @getidsbot ekle
2. /id komutunu gonder → grup ID'si gelir
3. Grup ID'si negatif olur: -123456789
```

**Kanal:**
```
Kanal username'ini kullanabilirsin: @kanaladi
```

## API Endpoint

```
POST https://api.telegram.org/bot{TOKEN}/sendMessage
{
  "chat_id": "...",
  "text": "...",
  "parse_mode": "Markdown"
}
```

## Markdown Formatlama Kurallari

```
*kalin*           → bold
_italik_          → italic
`kod`             → inline code
```kod blogu```   → code block
[link](url)       → hyperlink
```

**Onemli:** Markdown'da kac `_`, `*`, `` ` ``, `[` karakterleri escape edilmeli!

## Eskalasyon Mantigi

Farkli severity icin farkli kanallara gonderim — `getChatIdForSeverity` ve `sendMessage` options parametresi kullan:

```javascript
import { sendMessage, getChatIdForSeverity } from './src/telegram.js';

async function dispatchBySeverity(analysis) {
  const chatId = getChatIdForSeverity(analysis.severity);
  await sendMessage(analysis.telegramMessage, 'Markdown', { chatId });
}
```

Env degiskenleri:
- `TELEGRAM_CRITICAL_CHAT_ID` — CRITICAL icin kanal (yoksa TELEGRAM_CHAT_ID)
- `TELEGRAM_WARNING_CHAT_ID`  — WARNING icin kanal (yoksa TELEGRAM_CHAT_ID)
- `TELEGRAM_CHAT_ID`          — varsayilan kanal (zorunlu)

## Bircok Alici

```javascript
import { sendMessage } from './src/telegram.js';

const chatIds = process.env.TELEGRAM_CHAT_IDS?.split(',') || [process.env.TELEGRAM_CHAT_ID];

for (const chatId of chatIds) {
  await sendMessage(text, 'Markdown', { chatId: chatId.trim() });
}
```

## Hata Yonetimi

Parse hatasi durumunda `telegram.js` otomatik olarak plain text'e dusar.
4096 karakter siniri icin `splitMessage()` fonksiyonu kullanilir.
