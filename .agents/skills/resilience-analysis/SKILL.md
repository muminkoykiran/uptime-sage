---
name: resilience-analysis
description: Analyze Uptime Kuma monitor data from an SRE/resilience perspective. Use when determining severity levels, performing trend analysis, generating action recommendations, or producing structured monitoring reports. Do NOT use for data fetching or sending notifications.
---

# Resilience Analysis Skill

Rule set and examples for analyzing monitor data the way an expert SRE team would.

## Severity Determination Rules

| Condition | Severity |
|-----------|----------|
| Any service is DOWN | CRITICAL |
| 3+ monitors flapping simultaneously | CRITICAL |
| Any monitor flapping | WARNING |
| PENDING monitor | WARNING |
| 24h uptime < 99% | WARNING |
| 30d uptime < 99.9% | WARNING |
| All services healthy and stable | OK |

When in doubt, always choose the higher severity.

## Analysis Architecture

The `analyzeMonitors()` function in `src/analyzer.js`:
1. Structures monitor data with `buildPrompt()`
2. Tries each provider from `AI_PROVIDERS` in order (default `agy,codex`; see `src/providers/`)
3. Parses the structured JSON each provider returns (agy: `structured_output`, codex: JSONL / output file)
4. Uses a persisted per-provider quota circuit (`state._ai`) after permanent failures, then falls back to deterministic analysis when every provider fails

Ping/latency never affects severity.

For the full rule set, see `references/severity-rules.md`.

## Output Format

JSON conforming to the `config/analysis-schema.json` schema:

```json
{
  "severity": "CRITICAL",
  "healthScore": 72,
  "summary": "2 critical services have been down for 15 minutes...",
  "criticalIssues": [
    {
      "monitor": "API Gateway",
      "issue": "HTTP 502 — DOWN for 15 minutes",
      "impact": "All API requests are failing",
      "action": "Check pod logs"
    }
  ],
  "warnings": [...],
  "actions": [...],
  "telegramMessage": "...",
  "detailedReport": "..."
}
```

## Prompt Customization

Additional context can be added to the `buildPrompt()` function in `src/analyzer.js`:

```javascript
// Critical service list
// SLA requirements
// Escalation procedure
```

## Model Selection

Codex: model comes from `CODEX_MODEL` (default `gpt-5.6-terra`). agy: `AGY_MODEL` (default `gemini-3.8-flash-high`).
`model_reasoning_effort = "high"` is active — analysis quality is the priority.
