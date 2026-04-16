---
name: resilience-analysis
description: Analyze Uptime Kuma monitor data from an SRE/resilience perspective. Use when determining severity levels, performing trend analysis, generating action recommendations, or producing structured monitoring reports. Do NOT use for data fetching or sending notifications.
---

# Resilience Analysis Skill

Monitor verilerini uzman SRE ekibi gibi analiz etmek icin kural seti ve ornekler.

## Severity Belirleme Kurallari

| Durum | Severity |
|-------|----------|
| Herhangi bir servis DOWN | CRITICAL |
| 3+ monitor eş zamanlı flapping | CRITICAL |
| Herhangi bir monitor flapping | WARNING |
| Ping > 1000ms (kalici) | WARNING |
| 24s uptime < %99 | WARNING |
| 30g uptime < %99.9 | WARNING |
| Tum servisler saglikli, stabil | OK |

Belirsiz durumlarda her zaman ust seviyeyi sec.

## Analiz Mimarisi

`src/analyzer.js` dosyasindaki `analyzeMonitors()` fonksiyonu:
1. `buildPrompt()` ile monitor verisini yapilandirir
2. `codex exec --json --sandbox read-only --output-schema` ile analiz yapar
3. JSONL event stream'den JSON response'u parse eder
4. Basarisizlik durumunda `buildFallbackAnalysis()` devreye girer

Detayli kural seti icin `references/severity-rules.md` dosyasina bakin.

## Cikti Formati

`config/analysis-schema.json` sema dosyasina uygun JSON:

```json
{
  "severity": "CRITICAL",
  "healthScore": 72,
  "summary": "2 kritik servis 15 dakikadir kapali...",
  "criticalIssues": [
    {
      "monitor": "API Gateway",
      "issue": "HTTP 502 — 15 dakikadir DOWN",
      "impact": "Tum API istekleri basarisiz",
      "action": "Pod loglarini kontrol et"
    }
  ],
  "warnings": [...],
  "actions": [...],
  "telegramMessage": "...",
  "detailedReport": "..."
}
```

## Prompt Ozelleştirme

`src/analyzer.js` icerisindeki `buildPrompt()` fonksiyonuna ek baglamlar eklenebilir:

```javascript
// Kritik servis listesi
// SLA gereksinimleri
// Eskalasyon proseduru
```

## Model Secimi

Model, `~/.codex/config.toml` icerisindeki `model` ayari ile belirlenir.
Bu ajanin `.codex/config.toml` dosyasinda varsayilan olarak `gpt-5.4` ayarlidir.
`model_reasoning_effort = "high"` aktiftir — analiz kalitesi onceliklidir.
