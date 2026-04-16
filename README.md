# Uptime Resilience Agent

Codex CLI tabanli Uptime Kuma resilience izleme ajani. Her saat Uptime Kuma durumunu analiz eder, uzman SRE perspektifinden Telegram bildirimi gonderir.

## Mimari

```
Uptime Kuma API
     |
     v
src/uptime.js       Monitor verisi ceker (Socket.IO + JWT, HTTP fallback)
     |
     v
src/analyzer.js     codex exec ile SRE analizi
     |              (Anthropic API gerektirmez — Codex CLI kullanir)
     v
src/telegram.js     Telegram bildirimi gonderir (native fetch)
     |
     v
Telegram Chat / Grup / Kanal
```

> **Not:** Analiz icin ayri bir API key gerekmez. `codex exec` senin mevcut
> Codex CLI konfigurasyonunu kullanir.

## Gereksinimler

- Node.js v20.11+ (`import.meta.dirname` gerektiriyor)
- [Codex CLI](https://github.com/openai/codex) kurulu ve yapilandirilmis
- Uptime Kuma instance
- Telegram Bot Token

## Kurulum

### 1. Bagimliliklari yukle

```bash
npm install
```

### 2. .env dosyasini olustur

```bash
cp .env.example .env
```

`.env` dosyasini ac ve doldur (zorunlu alanlar):

```
UPTIME_KUMA_URL=https://uptime.yourdomain.com
TELEGRAM_BOT_TOKEN=123456:AAF...
TELEGRAM_CHAT_ID=123456789
```

### 3. Test et (Telegram gondermeden)

```bash
node src/index.js --dry --debug
```

### 4. Canli test (Telegram gonderir)

```bash
node src/index.js
```

### 5. JWT ile tam erisim (opsiyonel)

Public HTTP API sadece public monitorlere erisir. Tum monitorler icin JWT token gereklidir:

```bash
node scripts/get-jwt-token.js <username> <password>
# Cikan tokeni .env'e UPTIME_KUMA_TOKEN olarak ekle
```

### 6. Saatlik zamanla

**Ubuntu / Linux (systemd — onerilen):**

```bash
bash scripts/setup-systemd.sh
```

**macOS (LaunchAgent):**

```bash
bash scripts/setup-launchd.sh
```

**Cron (Linux / macOS alternatifi):**

```bash
bash scripts/setup-cron.sh
```

## Ubuntu Kurulumu (Hizli Referans)

```bash
# Node.js 22 LTS kur (NodeSource)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# node versiyonunu dogrula (>=20.11 olmali)
node --version

# Codex CLI kur
npm install -g @openai/codex

# Repoyu klon
git clone https://github.com/muminkoykiran/uptime-sage.git
cd uptime-sage
npm install

# Yapilandir ve baslat
cp .env.example .env
# .env dosyasini doldur
bash scripts/setup-systemd.sh
```

## Codex CLI ile Kullanim

Bu proje Codex CLI icin tam optimize edilmistir (`AGENTS.md` + `.agents/skills/`).

### Interaktif mod

```bash
cd /path/to/uptime-sage
codex
# > "analyzer.js'deki promptu daha iyi SRE pratikleri icin optimize et"
# > "Telegram mesajina uptime grafiklerini de ekle"
# > "Kritik durumda SMS de gonder"
```

### Headless / CI mod

```bash
# Analizi calistir (JSON cikti)
codex exec --json --sandbox read-only --ephemeral \
  "Uptime Kuma monitor durumunu analiz et ve Telegram bildirimi gonder"

# Kuru calistirma (sadece rapor, Telegram gonderme)
codex exec --json --sandbox read-only --ephemeral \
  "Uptime Kuma durumu nedir? Ozet rapor"

# Structured output
codex exec --json --sandbox read-only --ephemeral \
  --output-schema config/analysis-schema.json \
  "Uptime Kuma monitor durumunu analiz et"
```

## Proje Yapisi

```
uptime-sage/
  AGENTS.md                        # Codex CLI proje talimatlari
  CLAUDE.md                        # Claude Code rehberi
  src/
    index.js                       # Ana giris / orkestrasyon
    uptime.js                      # Uptime Kuma API istemcisi
    analyzer.js                    # Codex CLI exec ile AI analiz
    telegram.js                    # Telegram Bot istemcisi
    state.js                       # Alert state yonetimi
    env.js                         # .env yukleyici
  .agents/skills/
    uptime-monitor/                # Uptime Kuma sorgulama skill
    resilience-analysis/           # SRE analiz skill
    telegram-dispatch/             # Telegram bildirim skill
  .codex/
    config.toml                    # Codex proje konfigurasyonu
    hooks.json                     # SessionStart / Stop hooks
    hook-scripts/                  # Hook implementasyonlari
  scripts/
    setup-systemd.sh               # Ubuntu/Linux systemd zamanlama
    setup-launchd.sh               # macOS saatlik zamanlama
    setup-cron.sh                  # Cron zamanlama (evrensel)
    get-jwt-token.js               # Uptime Kuma JWT token alma
  config/
    analysis-schema.json           # Codex exec JSON schema
  .env.example                     # Ortam degiskeni sablonu
  package.json
```

## Cikis Kodlari

| Kod | Anlam |
|-----|-------|
| 0 | Basarili (OK veya WARNING) |
| 1 | Hata (API hatasi, auth hatasi) |
| 2 | CRITICAL tespit edildi |

CI/CD entegrasyonu icin exit code kullanilabilir.

## Log Takibi

**Ubuntu / Linux (systemd):**

```bash
tail -f ~/.local/log/uptime-resilience-agent/stdout.log
tail -f ~/.local/log/uptime-resilience-agent/stderr.log
```

**macOS (LaunchAgent):**

```bash
tail -f ~/Library/Logs/uptime-resilience-agent/stdout.log
tail -f ~/Library/Logs/uptime-resilience-agent/stderr.log
```

## Genisleme Plani

- [x] Socket.IO ile JWT kimlik dogrulama (tam monitor erisimi)
- [x] Severity bazli farkli Telegram kanallarina eskalasyon (`TELEGRAM_CRITICAL_CHAT_ID`)
- [x] Tekrar alert onleme — state yonetimi ile yapilandirilabilir re-alert araligi
- [x] Ubuntu / Linux systemd timer destegi
- [ ] Socket.IO ile monitor durdurma/baslatma aksiyonu (`pauseMonitor` / `resumeMonitor`)
