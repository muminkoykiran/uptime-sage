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
| Ping > 1000ms (sustained) | WARNING |
| 24h uptime < 99% | WARNING |
| 30d uptime < 99.9% | WARNING |
| All services healthy and stable | OK |

When in doubt, always choose the higher severity.

## Analysis Architecture

The `analyzeMonitors()` function in `src/analyzer.js`:
1. Structures monitor data with `buildPrompt()`
2. Runs analysis via `codex exec --json --sandbox read-only --output-schema`
3. Parses the JSON response from the JSONL event stream
4. Falls back to `buildFallbackAnalysis()` on failure

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

The model is determined by the `model` setting in `~/.codex/config.toml`.
This agent's `.codex/config.toml` defaults to `gpt-5.4`.
`model_reasoning_effort = "high"` is active — analysis quality is the priority.
