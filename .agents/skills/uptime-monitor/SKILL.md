---
name: uptime-monitor
description: Query Uptime Kuma for service status, heartbeat data, and uptime metrics. Use when checking monitor health, fetching current status, or troubleshooting connectivity to the Uptime Kuma instance. Do NOT use for sending notifications or AI analysis.
---

# Uptime Monitor Skill

Used to query and interact with the Uptime Kuma monitoring system.

## Instance Configuration

- URL: `$UPTIME_KUMA_URL` (read from `.env` — required)
- API Type: Public HTTP (status page) + Socket.IO (management via JWT)
- Timezone: `$TIMEZONE` (read from `.env` — default: UTC)

## Public Endpoints (No Auth Required)

```bash
# List all status pages
curl "$UPTIME_KUMA_URL/api/status-page/list"

# Details for a specific page
curl "$UPTIME_KUMA_URL/api/status-page/default"
```

For the full API reference, see `references/api-endpoints.md`.

## Querying via Code

```javascript
import { fetchStatusPageList, fetchPublicStatus, parsePublicMonitors, aggregateStats } from './src/uptime.js';

const pages = await fetchStatusPageList();
const pageData = await fetchPublicStatus('default');
const monitors = parsePublicMonitors(pageData);
const stats = aggregateStats(monitors);

console.log(`UP: ${stats.up}/${stats.total} | Health: ${stats.healthScore}/100`);
```

For an example query script, see `scripts/query-monitors.js`.

## Uptime Calculation

The `uptimeList["monitorId_24"]` value is a float between 0 and 1:
- `0.998` = 99.8% uptime (last 24 hours)
- `0.995` = 99.5% uptime (last 720 hours / 30 days)

## Status Values

- `0` = DOWN
- `1` = UP
- `2` = PENDING
- `3` = MAINTENANCE

## Socket.IO (JWT Required)

Full access with a JWT token: use the `connectSocketIO()` function in `src/uptime.js`.
If no token is present, the client automatically falls back to the public HTTP API.
To obtain a token: `node scripts/get-jwt-token.js <username> <password>`
