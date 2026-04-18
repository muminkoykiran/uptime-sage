# Telegram Bot Setup Reference

## Creating a Bot

1. Open Telegram and search for `@BotFather`
2. Send the `/newbot` command
3. Choose a display name and username for the bot
4. Copy the token provided: `123456789:AAF...`
5. Add it to `.env`: `TELEGRAM_BOT_TOKEN=<token>`

## Finding a Chat ID

**Personal:**
```
Send /start to @userinfobot → it replies with your user ID
```

**Group:**
```
1. Add @getidsbot to the group
2. Send the /id command
3. Group IDs are negative: -123456789
```

**Channel:**
```
Use the channel username directly: @channelname
or: retrieve the ID from channel settings (negative: -100...)
```

## API Endpoint

```
POST https://api.telegram.org/bot{TOKEN}/sendMessage
Content-Type: application/json

{
  "chat_id": "...",
  "text": "...",
  "parse_mode": "Markdown",
  "disable_web_page_preview": true
}
```

## Sending to Multiple Recipients

```javascript
import { sendMessage } from './src/telegram.js';

const chatIds = process.env.TELEGRAM_CHAT_IDS?.split(',') || [process.env.TELEGRAM_CHAT_ID];
for (const chatId of chatIds) {
  await sendMessage(text, 'Markdown', { chatId: chatId.trim() });
}
```

## Rate Limits

Telegram Bot API limits:
- Group: max 20 messages/minute
- Channel: max 20 messages/minute
- Individual user: max 1 message/second

`telegram.js` automatically waits according to the `Retry-After` header when it receives an HTTP 429 response.
