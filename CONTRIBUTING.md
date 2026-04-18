# Contributing to Uptime Resilience Agent

## Git Flow

Bu proje [Git Flow](https://nvie.com/posts/a-successful-git-branching-model/) kullanir.

### Branch Yapisi

| Branch | Amac |
|--------|------|
| `main` | Production — sadece release merge'leri ve hotfix'ler |
| `develop` | Integration — tum feature'lar buraya merge edilir |
| `feature/*` | Yeni ozellik gelistirme |
| `release/*` | Surum hazirlik (version bump, son duzeltmeler) |
| `hotfix/*` | Production'daki kritik bug fix'ler |

### Yeni Ozellik Gelistirme

```bash
# 1. develop'tan feature branch ac
git checkout develop
git pull origin develop
git checkout -b feature/ozellik-adi

# 2. Gelistir, commit'le
git add <dosyalar>
git commit -m "feat: ozellik aciklamasi"

# 3. develop'a merge et
git checkout develop
git merge --no-ff feature/ozellik-adi -m "merge: feature/ozellik-adi into develop"
git push origin develop

# 4. Feature branch'i temizle (opsiyonel)
git branch -d feature/ozellik-adi
```

### Yeni Surum Cikartma

```bash
# 1. develop'tan release branch ac
git checkout develop
git checkout -b release/x.y.z

# 2. Version bump ve son duzeltmeler
# package.json versiyonunu guncelle, CHANGELOG varsa ekle

# 3. main'e merge et ve tag'le
git checkout main
git merge --no-ff release/x.y.z -m "release: vx.y.z"
git tag -a vx.y.z -m "Uptime Resilience Agent vx.y.z"

# 4. develop'a geri merge et
git checkout develop
git merge --no-ff release/x.y.z -m "merge: release/x.y.z back into develop"

# 5. Push
git push origin main develop --tags
```

### Production Hotfix

```bash
# 1. main'den hotfix branch ac
git checkout main
git checkout -b hotfix/bug-adi

# 2. Fix et ve commit'le
git commit -m "fix: bug aciklamasi"

# 3. main'e merge et ve tag'le
git checkout main
git merge --no-ff hotfix/bug-adi -m "hotfix: bug-adi"
git tag -a vx.y.z -m "Uptime Resilience Agent vx.y.z"

# 4. develop'a da merge et
git checkout develop
git merge --no-ff hotfix/bug-adi -m "merge: hotfix/bug-adi into develop"

# 5. Push
git push origin main develop --tags
```

## Commit Mesaji Formati

[Conventional Commits](https://www.conventionalcommits.org/) kullanilir:

```
<tip>: <kisa aciklama>

[opsiyonel govde]
```

| Tip | Kullanim |
|-----|----------|
| `feat` | Yeni ozellik |
| `fix` | Bug fix |
| `docs` | Sadece dokumantasyon degisikligi |
| `refactor` | Davranis degismeden kod duzenleme |
| `test` | Test ekleme veya duzenleme |
| `chore` | Build, bagimlilik, yapilandirma |

### Ornekler

```
feat: add PagerDuty escalation support
fix: handle Socket.IO reconnect on token expiry
docs: update CONTRIBUTING with hotfix workflow
refactor: extract message chunking to shared utility
chore: update socket.io-client to 4.9.0
```

## Gelistirme Ortami

```bash
# Bagimliliklari yukle
npm install

# Dry-run test (Telegram gondermeden)
node src/index.js --dry --debug

# Canli test
node src/index.js --debug
```

## Kural Ozeti

- `main` branch'ine direkt push yapilmaz — her zaman PR veya release merge ile gelir
- `.env` dosyasi asla commit edilmez
- ESM (import/export) kullanilir, `require()` kullanilmaz
- Node.js v20.11+ gereklidir (`import.meta.dirname` zorunluluğu)
- Native `fetch` kullanilir, harici HTTP kutuphanesi eklenmez
- Yeni ozellikler `.agents/skills/<name>/SKILL.md` altina skill dosyasi ile dokumante edilir
