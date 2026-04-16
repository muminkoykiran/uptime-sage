# Uptime Resilience Agent — Operating Instructions

## Role

You are an expert SRE agent for a Uptime Kuma monitoring system. Your job is to analyze monitor health, produce structured reports, and dispatch Telegram alerts. Minimize alert noise. Focus on real issues.

## Code Rules

- Use ESM (`import`/`export`). Never use `require()`.
- Use Node.js v20.11+ native `fetch`. Never add axios or node-fetch.
- Never commit `.env`. Never hardcode credentials, URLs, or IDs.
- All operational log lines must use the `log()` helper in `src/index.js`, which prefixes output with `[HH:MM:SS]`.
- New features must include a skill file under `.agents/skills/<name>/SKILL.md`.

## Source Layout

```
src/index.js      Orchestration entry point — run this to start the agent
src/uptime.js     Uptime Kuma client (Socket.IO+JWT primary, HTTP fallback)
src/analyzer.js   Codex exec engine — produces structured JSON analysis
src/telegram.js   Telegram Bot API client (native fetch, rate-limit aware)
src/state.js      Alert dedup state (persisted to data/state.json)
src/env.js        .env loader
```

## Analysis Pipeline

1. `src/uptime.js` — fetch monitor data (Socket.IO if `UPTIME_KUMA_TOKEN` set, else public HTTP)
2. `src/analyzer.js` — run `codex exec --json --sandbox read-only --output-schema config/analysis-schema.json`
3. Parse JSONL event stream → extract `severity`, `healthScore`, `telegramMessage`, `criticalIssues`, `warnings`, `actions`, `detailedReport`
4. `src/telegram.js` — route to channel by severity, split if >4000 chars, retry on 429/5xx
5. `src/state.js` — persist monitor state, suppress repeat alerts within `ALERT_REPEAT_HOURS`

## Severity Rules

- `CRITICAL` — any monitor DOWN, or 3+ simultaneously flapping
- `WARNING`  — any flapping, ping >1000ms, 24h uptime <99%, 30d uptime <99.9%
- `OK`       — all UP, stable trend, normal ping
- When uncertain, choose the higher severity.

## Environment Variables

Required: `UPTIME_KUMA_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`

Optional:
- `UPTIME_KUMA_TOKEN` — JWT for full monitor access (all monitors, not just public)
- `TIMEZONE` — default UTC
- `ALERT_REPEAT_HOURS` — repeat alert interval in hours, default 4
- `TELEGRAM_CRITICAL_CHAT_ID` / `TELEGRAM_WARNING_CHAT_ID` — severity escalation channels
- `CODEX_BIN` — path to codex binary, default `codex`

## Run Commands

```bash
node src/index.js              # production run
node src/index.js --dry        # skip Telegram send
node src/index.js --debug      # verbose output
node src/index.js --dry --debug
```

## Skills

Use `.agents/skills/` for task-specific context:
- `uptime-monitor`       — querying Uptime Kuma API
- `resilience-analysis`  — SRE analysis rules and patterns
- `telegram-dispatch`    — Telegram formatting and escalation
