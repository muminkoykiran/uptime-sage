# Uptime Resilience Agent — Operating Instructions

## Role

You are an expert SRE agent for a Uptime Kuma monitoring system. Your job is to analyze monitor health, produce structured reports, and dispatch Telegram alerts. Minimize alert noise. Focus on real issues.

## Code Rules

- Use ESM (`import`/`export`). Never use `require()`.
- Use Node.js v20.11+ native `fetch`. Never add axios or node-fetch.
- Never commit `.env`. Never hardcode credentials, URLs, or IDs.
- All operational log lines must use the common logger and retain the `[HH:MM:SS]` prefix. Do not log credentials, tokens, full URLs containing credentials, or raw SSH output before it is scrubbed.
- New features must include a skill file under `.agents/skills/<name>/SKILL.md`.

## Source Layout

```
src/index.js          Orchestration entry point — run this to start the agent
src/uptime.js         Uptime Kuma client (Socket.IO+JWT primary, HTTP fallback)
src/ssh-diagnostics.js  SSH diagnostic runner for DOWN/PENDING monitors
src/analyzer.js       AI provider chain (agy → codex) — produces structured JSON analysis
src/telegram.js       Telegram Bot API client (native fetch, rate-limit aware)
src/state.js          Alert dedup state (persisted to data/state.json)
src/env.js            .env loader
src/util.js           Shared utilities (spawnAsync)
src/health.js         Deterministic severity floor and alert fingerprint
src/lock.js           Single-run lock for scheduled executions
src/schema.js         Analysis schema validator
```

## Analysis Pipeline

1. `src/uptime.js` — fetch monitor data (Socket.IO+JWT if `UPTIME_KUMA_TOKEN` set, else public HTTP)
2. `src/ssh-diagnostics.js` — SSH into DOWN/PENDING monitors when `SSH_DIAGNOSTICS_ENABLED=true`; reads `ssh-host/user/port/type/service` tags from affected monitors; commands whitelisted in `config/ssh-diagnostics.json`
3. `src/analyzer.js` — Codex CLI analysis; receives optional `diagnostics` array; injects SSH results into the Codex prompt under a `─── SSH DIAGNOSTICS ───` section
4. `src/telegram.js` — send notification; route to channel by severity, split if >4000 chars, retry on 429/5xx
5. `src/state.js` — persist monitor state, suppress repeat alerts within `ALERT_REPEAT_HOURS`
6. `src/util.js` — shared `spawnAsync` helper; import from here in all modules

`--dry` must not persist state or send Telegram. All notification state is saved
only after Telegram accepts the message. Codex lifecycle hooks must not send
monitoring alerts; `src/index.js` owns notification delivery.

## Severity Rules

- `CRITICAL` — any monitor DOWN, or 3+ simultaneously flapping
- `WARNING`  — any flapping, PENDING, 24h uptime <99%, 30d uptime <99.9%
- `OK`       — all UP, stable trend (ping is ignored)
- When uncertain, choose the higher severity.

## Environment Variables

Required: `UPTIME_KUMA_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`

Optional:
- `UPTIME_KUMA_TOKEN` — JWT for full monitor access (all monitors, not just public)
- `TIMEZONE` — default UTC
- `ALERT_REPEAT_HOURS` — repeat alert interval in hours, default 4
- `TELEGRAM_CRITICAL_CHAT_ID` / `TELEGRAM_WARNING_CHAT_ID` — severity escalation channels
- `AI_PROVIDERS` — provider order, default `agy,codex` (`codex` alone keeps the old behaviour)
- `AGY_BIN` / `AGY_MODEL` / `AGY_FAILURE_BACKOFF_MINUTES` — agy binary, model (default `gemini-3.8-flash-high`), retry delay
- `CODEX_BIN` — path to codex binary, default `codex`
- `CODEX_MODEL` — Codex analysis model, default `gpt-5.6-terra`
- `CODEX_FAILURE_BACKOFF_MINUTES` — permanent Codex error retry delay, default 60
- `AGENT_DISK_WARNING_PERCENT` / `AGENT_DISK_CRITICAL_PERCENT` / `AGENT_SWAP_WARNING_PERCENT` — local read-only resource alert thresholds
- `SSH_DIAGNOSTICS_ENABLED` — set to `true` to enable SSH diagnostics
- `SSH_USER` — default SSH username (overridden by monitor `ssh-user` tag)
- `SSH_KEY_PATH` — path to SSH private key (default: `~/.ssh/id_rsa`)

## Run Commands

```bash
node src/index.js              # production run
node src/index.js --dry        # skip Telegram send
node src/index.js --debug      # verbose output
node src/index.js --dry --debug
npm test                       # offline regression suite
```

## Skills

Use `.agents/skills/` for task-specific context:
- `uptime-monitor`       — querying Uptime Kuma API
- `resilience-analysis`  — SRE analysis rules and patterns
- `telegram-dispatch`    — Telegram formatting and escalation
- `ssh-diagnostics`      — SSH into DOWN/PENDING monitors, run safe read-only diagnostic commands, inject results into Codex prompt
- `runtime-health`        — inspect local agent disk, memory, swap, and load without remediation
