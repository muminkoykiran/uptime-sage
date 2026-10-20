---
name: ai-providers
description: Configure or extend the AI CLI provider chain (agy, codex) used by src/analyzer.js. Use when changing provider order, models, quota/backoff behavior, or adding a new provider. Do NOT use for severity rules or Telegram delivery.
---

# AI Providers Skill

`analyzeMonitors()` walks the providers named in `AI_PROVIDERS` (default `agy,codex`). The first provider that returns a schema-valid analysis wins; if all fail, `buildFallbackAnalysis()` produces the deterministic report.

## Providers

| Name | File | Invocation |
|------|------|------------|
| `agy` | `src/providers/agy.js` | `agy -p <prompt> --model $AGY_MODEL --sandbox --disable-slash-commands --output-format json --json-schema config/analysis-schema.json` (runs in an empty temp dir) |
| `codex` | `src/providers/codex.js` | `codex exec --json --sandbox read-only --output-schema …` |

Single provider: `AI_PROVIDERS=agy` or `AI_PROVIDERS=codex`.

## Env

`AI_PROVIDERS`, `AGY_BIN`, `AGY_MODEL` (default `gemini-3.8-flash-high`, list via `agy models`), `AGY_FAILURE_BACKOFF_MINUTES`, `CODEX_BIN`, `CODEX_MODEL`, `CODEX_FAILURE_BACKOFF_MINUTES`.

## Circuit behavior

Permanent failures (quota, auth, invalid model — see `PERMANENT_FAILURE` in `src/ai-circuit.js`) open a per-provider circuit stored in `data/state.json` under `_ai.<provider>` until the reset time or the backoff elapses. Timeouts are transient and retried once.

## Adding a provider

Create `src/providers/<name>.js` exporting `{ name, run(prompt, { timeout, isValid }), failureDetail(err), backoffMinutes() }`, where `run` returns a valid analysis or `null` and throws on failure; register it in `PROVIDERS` in `src/analyzer.js`. Providers must never send Telegram messages or trigger hooks.
