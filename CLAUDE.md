# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Run Commands

```bash
node src/index.js --dry --debug   # test run, no Telegram send
node src/index.js --dry           # skip Telegram, no verbose output
node src/index.js                 # production run
```

There are no automated tests. Validation is done via `--dry --debug`.

## Architecture

Single-pass pipeline that runs to completion and exits:

```
src/uptime.js → src/analyzer.js → src/telegram.js
```

1. **`src/uptime.js`** — fetches monitor data. If `UPTIME_KUMA_TOKEN` is set, uses Socket.IO (`connectSocketIO` + `fetchAllMonitors`). Otherwise falls back to public HTTP (`fetchStatusPageList` → `fetchPublicStatus` → `parsePublicMonitors`). Always returns the same shape via `aggregateStats`.

2. **`src/analyzer.js`** — shells out to `codex exec --json --sandbox read-only --output-schema config/analysis-schema.json --output-last-message <tmpfile>` via a custom `spawnAsync` helper that uses `stdio: ['ignore', 'pipe', 'pipe']`. **Do not replace this with `execFile`/`execFileAsync`** — Node 22's `input` option does not reliably close the child's stdin pipe, causing Codex to block waiting for EOF indefinitely. With stdin ignored, Codex detects EOF immediately and proceeds. Parses response in three tiers: temp file first, then JSONL event stream (`turn.completed` / `item.completed`), then raw stdout scan. Falls back to `buildFallbackAnalysis()` if Codex is unavailable.

3. **`src/telegram.js`** — sends via Bot API. Routes to `TELEGRAM_CRITICAL_CHAT_ID` / `TELEGRAM_WARNING_CHAT_ID` by severity, falls back to `TELEGRAM_CHAT_ID`. Splits messages >4000 chars, retries on 429/5xx.

4. **`src/state.js`** — reads/writes `data/state.json` (gitignored). Tracks last alert time per monitor to suppress repeat alerts within `ALERT_REPEAT_HOURS` (default 4).

5. **`src/index.js`** — orchestrates the above. All operational logs go through the `log()` helper here (adds `[HH:MM:SS]` prefix). Exit codes: `0` = OK/WARNING, `1` = error, `2` = CRITICAL.

## Code Rules

- ESM only — `import`/`export`, never `require()`.
- Node.js v20.11+ required (`import.meta.dirname` used throughout).
- Native `fetch` only — never add axios or node-fetch.
- All env vars loaded through `src/env.js` (`loadEnv()` + `requireEnv()`).
- New features need a skill file at `.agents/skills/<name>/SKILL.md`.

## Git Flow

- `main` — production, merge via PR only, squash merges enforced
- `develop` — integration branch
- `feature/*` → PR → `develop`
- `release/*` → PR → `main` (triggers auto-release via `release.yml`)
- `hotfix/*` → PR → `main`, then back-merge to `develop`

After merging a `release/*` branch to `main`, the `release.yml` GitHub Action reads the version from `package.json` and auto-creates the tag and GitHub Release. Do not create tags manually.

## Codex CLI Integration

`.codex/config.toml` sets project-level defaults (model, approval policy, sandbox). `.codex/hooks.json` wires two lifecycle hooks:
- `SessionStart` — runs `session-start.js` to inject current monitor state as context
- `Stop` — runs `session-stop.js` to send Telegram alert if session ended on CRITICAL

The analysis prompt is built in `buildPrompt()` inside `src/analyzer.js`. Severity rules and output schema are in `config/analysis-schema.json` and `.agents/skills/resilience-analysis/references/severity-rules.md`.
