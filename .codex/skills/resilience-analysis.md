---
name: resilience-analysis
description: Uptime Kuma monitor verilerini SRE/Resilience perspektifinden analiz eder. Severity belirleme, trend analizi, aksiyon oneri uretme ve raporlama islemlerinde kullan.
---

# Resilience Analysis Skill

Monitor verilerini uzman SRE ekibi gibi analiz etmek icin kural seti ve ornekler.

## Severity Belirleme Kurallari

| Durum | Severity |
|-------|----------|
| Herhangi bir servis DOWN | CRITICAL |
| Ping > 1000ms | WARNING |
| Uptime < 95% (24h) | WARNING |
| Uptime < 99% (24h) | WARNING |
| Tum servisler saglikli | OK |

## Analiz Prompt Stratejisi

`src/analyzer.js` dosyasindaki `buildPrompt()` fonksiyonu ile prompt olusturulur:

```javascript
// buildPrompt() fonksiyonunda ek baglamlar ekleyebilirsin:
// - Kritik servis listesi (ornek: "payment-api kritik servistir")
// - SLA gereksinimleri (ornek: "99.9% uptime zorunlu")
// - Eskalasyon proseduru
// - On-call rotasyon bilgisi
```

## Analiz Cikti Formati

```json
{
  "severity": "CRITICAL",
  "healthScore": 72,
  "summary": "2 kritik servis 15 dakikadır kapalı...",
  "criticalIssues": [
    {
      "monitor": "API Gateway",
      "issue": "HTTP 502 Bad Gateway — 15 dakikadır DOWN",
      "impact": "Tum API istekleri basarisiz",
      "action": "Pod loglarini kontrol et: kubectl logs -l app=api-gateway"
    }
  ],
  "warnings": [
    {
      "monitor": "Database",
      "issue": "Ortalama ping 1250ms (normal: <200ms)",
      "recommendation": "Slow query loglarini incele"
    }
  ],
  "actions": [
    {
      "priority": "HIGH",
      "description": "API Gateway servisini yeniden baslat",
      "command": "kubectl rollout restart deployment/api-gateway"
    }
  ],
  "telegramMessage": "...",
  "detailedReport": "..."
}
```

## Trend Analizi

Son 20 heartbeat'ten trend cikarma ornegi:

```javascript
// DOWN -> UP -> DOWN -> UP paterni = flapping (kararsiz servis)
const statuses = monitor.recentStatuses.map(s => s.status);
const transitions = statuses.filter((s, i) => i > 0 && s !== statuses[i-1]).length;
const isFlapping = transitions > 4;
```

## Aksiyon Oneri Turleri

1. **Immediate** (HIGH): Servis yeniden baslatma, failover, on-call arama
2. **Short-term** (MED): Log analizi, metric inceleme, alert kural guncelleme
3. **Long-term** (LOW): Kapasite planlama, altyapi iyilestirme

## Telegram Mesaj Formati

Severity bazli emoji kuralı:
- CRITICAL: 🔴 Kirmizi daire ve alarm emojisi
- WARNING: 🟡 Sari daire ve uyari emojisi
- OK: 🟢 Yesil daire ve onay emojisi

Mesaj icerik kurallari:
- Maksimum 4000 karakter
- Kod bloklari icin backtick kullan
- Bold icin `*metin*` kullan
- Italic icin `_metin_` kullan

## Model Secimi

Model secimi `~/.codex/config.toml` dosyasindaki `model` ayari ile yapilir.
Ornek: `model = "gpt-4o"` veya `model = "o3"`.
`CLAUDE_MODEL` env degiskeninin bu sistemde etkisi yoktur.
