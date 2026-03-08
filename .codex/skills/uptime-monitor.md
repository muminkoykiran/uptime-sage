---
name: uptime-monitor
description: Uptime Kuma monitoring sistemininden servis durumu, heartbeat verileri ve uptime metrikleri sorgular. Monitor ekleme, duzenleme veya duraklatma gibi islemlerde kullan.
---

# Uptime Monitor Skill

Bu skill Uptime Kuma monitoring sistemini sorgulamak ve yonetmek icin kullanilir.

## Instance Bilgileri

- URL: `$UPTIME_KUMA_URL` (.env'den okunur — zorunlu)
- API Tipi: Public HTTP (status page) + Socket.IO (yonetim)
- Timezone: `$TIMEZONE` (.env'den okunur — default: UTC)

## Public Endpoint'ler (Auth Gerektirmez)

```bash
# Tum status sayfalari
curl "$UPTIME_KUMA_URL/api/status-page/list"

# Belirli bir sayfanin detaylari (default slug: "default")
curl "$UPTIME_KUMA_URL/api/status-page/default"
```

## Response Yapisi

`/api/status-page/{slug}` yaniti:

```json
{
  "publicGroupList": [
    {
      "name": "Grup Adi",
      "monitorList": [
        {
          "id": 1,
          "name": "Servis Adi",
          "type": "http",
          "url": "https://example.com"
        }
      ]
    }
  ],
  "heartbeatList": {
    "1": [
      {
        "status": 1,
        "time": "2026-03-07T12:00:00.000Z",
        "ping": 125,
        "msg": "OK"
      }
    ]
  },
  "uptimeList": {
    "1_24": 0.998,
    "1_720": 0.995
  }
}
```

## Status Degerleri

- `0` = DOWN (Kapalı)
- `1` = UP (Acık)
- `2` = PENDING (Bekleniyor)
- `3` = MAINTENANCE (Bakimda)

## Monitor Sorgu Kodu

```javascript
import { fetchStatusPageList, fetchPublicStatus, parsePublicMonitors, aggregateStats } from './src/uptime.js';

const pages = await fetchStatusPageList();
const pageData = await fetchPublicStatus('default');
const monitors = parsePublicMonitors(pageData);
const stats = aggregateStats(monitors);

console.log(`UP: ${stats.up}/${stats.total} | Saglik: ${stats.healthScore}/100`);
```

## Uptime Hesaplama

`uptimeList["monitorId_24"]` degeri 0-1 arasi float:
- `0.998` = %99.8 uptime (son 24 saat)
- `0.995` = %99.5 uptime (son 720 saat / 30 gun)

## Yeni Monitor Ekleme (Socket.IO)

Monitor ekleme/duzenleme icin kimlik dogrulama gerekir.
Socket.IO ile `addMonitor` event'i kullanilir.
Bu ozellik henuz agent'a eklenmemistir — gelecek surum icin planlanmistir.
