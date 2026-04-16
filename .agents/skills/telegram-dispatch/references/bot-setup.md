# Telegram Bot Setup Reference

## Bot Olusturma

1. Telegram'da `@BotFather`'a git
2. `/newbot` komutu gonder
3. Bot adi ve kullanici adi belirle
4. Token al: `123456789:AAF...`
5. `.env` dosyasina ekle: `TELEGRAM_BOT_TOKEN=<token>`

## Chat ID Bulma

**Kisisel:**
```
@userinfobot'a /start yaz → ID'ni gonderir
```

**Grup:**
```
1. Gruba @getidsbot ekle
2. /id komutunu gonder
3. Grup ID'si negatif olur: -123456789
```

**Kanal:**
```
Kanal username'ini dogrudan kullan: @kanaladi
veya: kanal ayarlarindan ID'yi al (negatif: -100...)
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

## Cok Alici Gonderimi

```javascript
import { sendMessage } from './src/telegram.js';

const chatIds = process.env.TELEGRAM_CHAT_IDS?.split(',') || [process.env.TELEGRAM_CHAT_ID];
for (const chatId of chatIds) {
  await sendMessage(text, 'Markdown', { chatId: chatId.trim() });
}
```

## Rate Limits

Telegram Bot API limitleri:
- Gruba: max 20 mesaj/dakika
- Kanala: max 20 mesaj/dakika
- Kullaniciya: max 1 mesaj/saniye

`telegram.js` HTTP 429 yaniti alinca `Retry-After` header'a gore otomatik bekler.
