# Uptime Kuma API Reference

## Public HTTP Endpoints

### GET /api/status-page/list
Returns all public status pages.

```json
{
  "statusPageList": [
    { "id": 1, "slug": "default", "title": "Status Page" }
  ]
}
```

### GET /api/status-page/{slug}
Returns full status page data including monitors, heartbeats and uptime.

```json
{
  "publicGroupList": [
    {
      "name": "Group Name",
      "monitorList": [
        { "id": 1, "name": "Service Name", "type": "http", "url": "https://example.com" }
      ]
    }
  ],
  "heartbeatList": {
    "1": [
      { "status": 1, "time": "2026-04-01T12:00:00.000Z", "ping": 125, "msg": "OK" }
    ]
  },
  "uptimeList": {
    "1_24": 0.998,
    "1_720": 0.995
  }
}
```

## Socket.IO Events (JWT required)

| Event (emit)     | Payload               | Response        |
|------------------|-----------------------|-----------------|
| `loginByToken`   | `token`               | `{ ok, msg }`   |
| `monitorList`    | —                     | monitor objects |
| `heartbeatList`  | —                     | heartbeat array |
| `pauseMonitor`   | `monitorId`           | `{ ok, msg }`   |
| `resumeMonitor`  | `monitorId`           | `{ ok, msg }`   |

## Status Codes

| Value | Meaning     |
|-------|-------------|
| 0     | DOWN        |
| 1     | UP          |
| 2     | PENDING     |
| 3     | MAINTENANCE |
