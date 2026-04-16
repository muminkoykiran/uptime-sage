# Resilience Analysis — Severity Rules Reference

## Severity Decision Tree

```
Any monitor DOWN?
  YES → CRITICAL

3+ monitors flapping simultaneously?
  YES → CRITICAL

Any monitor flapping (>4 transitions in last 20 checks)?
  YES → WARNING

Any ping permanently >1000ms?
  YES → WARNING

Any 24h uptime < 99%?
  YES → WARNING

Any 30d uptime < 99.9%?
  YES → WARNING

All monitors UP, stable trend, normal ping?
  → OK
```

When in doubt, choose the higher severity.

## Flapping Detection

```javascript
// recentStatuses: last 20 heartbeats
let transitions = 0;
for (let i = 1; i < recentStatuses.length; i++) {
  if (recentStatuses[i].status !== recentStatuses[i-1].status) transitions++;
}
const isFlapping = transitions > 4;
```

## Health Score Adjustment

Base score from `aggregateStats()`: `Math.round((up / total) * 100)`

Adjustments (applied by AI analysis):
- Each flapping monitor: `-3` (max `-15`)
- Any DOWN monitor: additional `-10`

## Telegram Message Rules

- CRITICAL: `🔴` icon, `*CRITICAL*` bold
- WARNING: `🟡` icon, `*WARNING*` bold
- OK: `🟢` icon, `*OK*` bold
- Max 3800 characters
- Group healthy monitors into one line
- Do NOT list each healthy monitor individually

## Action Priority Levels

| Priority | Trigger | Example |
|----------|---------|---------|
| HIGH | DOWN monitor | Restart service, check logs |
| MED | Flapping / slow ping | Investigate logs, check network |
| LOW | Preventive | Capacity planning, alert tuning |

## Exit Code Behavior

The agent exits with:
- `0` — OK or WARNING (informational alert sent)
- `1` — Runtime error (API failure, auth error)
- `2` — CRITICAL detected (action required)

systemd `SuccessExitStatus=0 1 2 3` ensures none of these mark the service as failed.
