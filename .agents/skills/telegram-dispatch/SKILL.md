---
name: telegram-dispatch
description: Send Telegram notifications, format alert messages, and manage escalation routing by severity. Use when sending monitoring alerts, error notifications, or testing Telegram bot connectivity. Do NOT use for data fetching or analysis.
---

# Telegram Dispatch Skill

Telegram Bot API uzerinden bildirim gonderme ve kanal yonetimi.

## Gonderim

```javascript
import { sendMessage, getChatIdForSeverity } from './src/telegram.js';

const chatId = getChatIdForSeverity('CRITICAL');
await sendMessage(messageText, 'Markdown', { chatId });
```

## Eskalasyon Mantigi

Severity'ye gore farkli kanallara yonlendirme:

| Severity | Env Degiskeni | Fallback |
|----------|---------------|---------|
| CRITICAL | `TELEGRAM_CRITICAL_CHAT_ID` | `TELEGRAM_CHAT_ID` |
| WARNING  | `TELEGRAM_WARNING_CHAT_ID`  | `TELEGRAM_CHAT_ID` |
| OK       | —                           | `TELEGRAM_CHAT_ID` |

## Markdown Formatlama

```
*kalin*         → bold
_italik_        → italic
`kod`           → inline code
```

**Onemli:** Ozel karakterler (`_`, `*`, `` ` ``, `[`) escape edilmeli.
Parse hatasi durumunda `telegram.js` otomatik plain text'e gecer.

## Mesaj Limitleri

- Tek mesaj max: 4096 karakter
- `splitMessage()` 4000 karakter limitiyle otomatik boler
- Telegram schema max: 3800 karakter (guveli marj)

## Hata Yonetimi

`sendMessage()`:
- HTTP 429 → `Retry-After` header'a gore bekler
- HTTP 5xx → 2 saniye bekleyip bir kez tekrar dener
- HTTP 400 + parseMode → stripMarkdown() ile plain text olarak tekrar dener

`sendErrorAlert()` her zaman plain text gonderir (parse hatasi riski olmaz).

Detayli kurulum icin `references/bot-setup.md` dosyasina bakin.
