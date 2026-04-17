---
name: telegram-dispatch
description: Send Telegram notifications, format alert messages, and manage escalation routing by severity. Use when sending monitoring alerts, error notifications, or testing Telegram bot connectivity. Do NOT use for data fetching or analysis.
---

# Telegram Dispatch Skill

Sending notifications and managing channels via the Telegram Bot API.

## Sending a Message

```javascript
import { sendMessage, getChatIdForSeverity } from './src/telegram.js';

const chatId = getChatIdForSeverity('CRITICAL');
await sendMessage(messageText, 'Markdown', { chatId });
```

## Escalation Logic

Routes messages to different channels based on severity:

| Severity | Env Variable | Fallback |
|----------|--------------|---------|
| CRITICAL | `TELEGRAM_CRITICAL_CHAT_ID` | `TELEGRAM_CHAT_ID` |
| WARNING  | `TELEGRAM_WARNING_CHAT_ID`  | `TELEGRAM_CHAT_ID` |
| OK       | —                           | `TELEGRAM_CHAT_ID` |

## Markdown Formatting

```
*bold*          → bold
_italic_        → italic
`code`          → inline code
```

**Important:** Special characters (`_`, `*`, `` ` ``, `[`) must be escaped.
If a parse error occurs, `telegram.js` automatically falls back to plain text.

## Message Limits

- Single message maximum: 4096 characters
- `splitMessage()` splits automatically at the 4000-character limit
- Telegram schema maximum: 3800 characters (safe margin)

## Error Handling

`sendMessage()`:
- HTTP 429 → waits according to the `Retry-After` header
- HTTP 5xx → waits 2 seconds and retries once
- HTTP 400 + parseMode → retries as plain text using `stripMarkdown()`

`sendErrorAlert()` always sends plain text (no risk of parse errors).

For detailed setup instructions, see `references/bot-setup.md`.
