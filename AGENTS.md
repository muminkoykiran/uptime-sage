# Uptime Resilience Agent — AGENTS.md

Codex CLI tabanli, Uptime Kuma izleme sistemi icin uzman SRE resilience ajani.

## Proje Amaci

- Uptime Kuma public status page API'sinden monitor verisi ceker
- Codex CLI ile SRE perspektifinden analiz yapar
- Telegram uzerinden akilli bildirimler gonderir
- Her saat otomatik calisir (systemd / launchd / cron)
- Kritik durumlarda aksiyon onerileri uretir

## Dizin Yapisi

```
src/
  index.js      - Ana giris noktasi, orkestrasyonu yonetir
  uptime.js     - Uptime Kuma API istemcisi (Socket.IO + public HTTP)
  analyzer.js   - Codex CLI exec ile AI analiz motoru
  telegram.js   - Telegram Bot API istemcisi
  state.js      - Alert durumu ve tekrar alert yonetimi
  env.js        - .env dosyasindan ortam degiskeni yukleyici

.codex/skills/
  uptime-monitor.md       - Uptime Kuma sorgulama skill'i
  resilience-analysis.md  - Resilience analiz skill'i
  telegram-dispatch.md    - Telegram bildirim skill'i

scripts/
  setup-systemd.sh  - Ubuntu/Linux systemd timer kurulum scripti (saatlik)
  setup-launchd.sh  - macOS launchd kurulum scripti (saatlik)
  setup-cron.sh     - Cron job kurulum scripti (evrensel)
  get-jwt-token.js  - Uptime Kuma JWT token alma araci

config/
  analysis-schema.json    - Codex exec JSON schema

.env.example    - Ortam degiskeni sablonu
package.json
README.md
```

## Gelistirme Kurallari

- ESM (import/export) kullan, require() kullanma
- Node.js v20.11+ native fetch kullan, axios/node-fetch ekleme
- Tum log mesajlari `[HH:MM:SS]` prefix ile
- Hata durumunda Telegram'a da hata bildirimi gonder
- Yeni ozellikler .codex/skills/ altina SKILL.md ile dokumante edilmeli
- .env dosyasi asla commit edilmemeli

## Ortam Degiskenleri (Zorunlu)

```
UPTIME_KUMA_URL      - Uptime Kuma instance adresi (orn: https://uptime.yourdomain.com)
TELEGRAM_BOT_TOKEN   - @BotFather'dan alinan bot tokeni
TELEGRAM_CHAT_ID     - Mesajin gidecegi chat/kanal/grup ID'si
```

## Ortam Degiskenleri (Opsiyonel)

```
UPTIME_KUMA_TOKEN         - JWT token (node scripts/get-jwt-token.js ile alinir)
                            Yoksa: public HTTP API (fallback, sadece public monitorler)
TIMEZONE                  - Zaman dilimi (default: UTC)
ALERT_REPEAT_HOURS        - DOWN monitor icin tekrar alert araligi, saat (default: 4)
TELEGRAM_CRITICAL_CHAT_ID - CRITICAL severity icin alternatif kanal
TELEGRAM_WARNING_CHAT_ID  - WARNING severity icin alternatif kanal
CODEX_BIN                 - Codex CLI binary yolu (default: codex)
```

## Analiz Mimarisi

`src/analyzer.js` Anthropic API KULLANMAZ.
`codex exec --ephemeral --sandbox read-only --output-schema` ile calisiyor.
Codex CLI kendi API key'ini kullanir (~/.codex/config.toml'daki model).

`codex exec` prompt'u, `config/analysis-schema.json` schema'sına uygun JSON dondurur.
Bu JSON'daki `telegramMessage` alani dogrudan Telegram'a gonderilir.

## Calistirma

```bash
node src/index.js           # tek seferlik manuel calistirma
node src/index.js --dry     # Telegram gondermeden test
node src/index.js --debug   # Detayli log

scripts/setup-systemd.sh    # Ubuntu/Linux systemd timer ile saatlik calistirma
scripts/setup-launchd.sh    # macOS launchd ile saatlik calistirma
scripts/setup-cron.sh       # Linux/macOS cron ile saatlik calistirma
```

## Codex CLI ile Kullanim

```bash
# Non-interactive analiz calistir
codex exec --json --sandbox read-only --ephemeral \
  "Uptime Kuma monitor durumunu analiz et ve Telegram bildirimi gonder"

# Mevcut kodu incele ve iyilestir
codex "src/analyzer.js dosyasindaki analiz promptunu daha iyi SRE pratikleri icin optimize et"

# Yeni skill ekle
codex "$skill-installer install the uptime-monitor skill"
```

## Mimari Notlar

- JWT token (UPTIME_KUMA_TOKEN) varsa Socket.IO API kullanilir (tam erisim)
- Token yoksa public HTTP status page API'ye fallback yapilir (sadece public monitorler)
- Aksiyon almak (monitor durdurma/baslatma) ileriki surum icin planlanmis
- `codex exec` ile non-interactive modda da calistirilebilir
