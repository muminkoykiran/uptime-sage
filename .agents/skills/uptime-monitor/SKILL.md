---
name: uptime-monitor
description: Query Uptime Kuma for service status, heartbeat data, and uptime metrics. Use when checking monitor health, fetching current status, or troubleshooting connectivity to the Uptime Kuma instance. Do NOT use for sending notifications or AI analysis.
---

# Uptime Monitor Skill

Uptime Kuma monitoring sistemini sorgulamak ve yonetmek icin kullanilir.

## Instance Bilgileri

- URL: `$UPTIME_KUMA_URL` (.env'den okunur — zorunlu)
- API Tipi: Public HTTP (status page) + Socket.IO (JWT ile yonetim)
- Timezone: `$TIMEZONE` (.env'den okunur — default: UTC)

## Public Endpoint'ler (Auth Gerektirmez)

```bash
# Tum status sayfalari
curl "$UPTIME_KUMA_URL/api/status-page/list"

# Belirli bir sayfanin detaylari
curl "$UPTIME_KUMA_URL/api/status-page/default"
```

Detayli API referansi icin `references/api-endpoints.md` dosyasina bakin.

## Kod Ile Sorgulama

```javascript
import { fetchStatusPageList, fetchPublicStatus, parsePublicMonitors, aggregateStats } from './src/uptime.js';

const pages = await fetchStatusPageList();
const pageData = await fetchPublicStatus('default');
const monitors = parsePublicMonitors(pageData);
const stats = aggregateStats(monitors);

console.log(`UP: ${stats.up}/${stats.total} | Saglik: ${stats.healthScore}/100`);
```

Ornek sorgu scripti icin `scripts/query-monitors.js` dosyasina bakin.

## Uptime Hesaplama

`uptimeList["monitorId_24"]` degeri 0-1 arasi float:
- `0.998` = %99.8 uptime (son 24 saat)
- `0.995` = %99.5 uptime (son 720 saat / 30 gun)

## Status Degerleri

- `0` = DOWN
- `1` = UP
- `2` = PENDING
- `3` = MAINTENANCE

## Socket.IO (JWT gerektirir)

JWT token ile tam erisim: `src/uptime.js` icerisindeki `connectSocketIO()` fonksiyonu kullanilir.
Token yoksa public HTTP API'ye otomatik fallback yapilir.
Token alma: `node scripts/get-jwt-token.js <username> <password>`
