# Contributing to Uptime Resilience Agent

## Git Flow

This project uses [Git Flow](https://nvie.com/posts/a-successful-git-branching-model/).

### Branch Structure

| Branch | Purpose |
|--------|---------|
| `main` | Production — release merges and hotfixes only |
| `develop` | Integration — all features merge here |
| `feature/*` | New feature development |
| `release/*` | Release preparation (version bump, final fixes) |
| `hotfix/*` | Critical bug fixes for production |

### Developing a New Feature

```bash
# 1. Create a feature branch from develop
git checkout develop
git pull origin develop
git checkout -b feature/feature-name

# 2. Develop and commit
git add <files>
git commit -m "feat: feature description"

# 3. Merge into develop
git checkout develop
git merge --no-ff feature/feature-name -m "merge: feature/feature-name into develop"
git push origin develop

# 4. Clean up the feature branch (optional)
git branch -d feature/feature-name
```

### Cutting a New Release

```bash
# 1. Create a release branch from develop
git checkout develop
git checkout -b release/x.y.z

# 2. Version bump and final fixes
# Update version in package.json, add CHANGELOG entry if applicable

# 3. Merge into main and tag
git checkout main
git merge --no-ff release/x.y.z -m "release: vx.y.z"
git tag -a vx.y.z -m "Uptime Resilience Agent vx.y.z"

# 4. Back-merge into develop
git checkout develop
git merge --no-ff release/x.y.z -m "merge: release/x.y.z back into develop"

# 5. Push
git push origin main develop --tags
```

### Production Hotfix

```bash
# 1. Create a hotfix branch from main
git checkout main
git checkout -b hotfix/bug-name

# 2. Fix and commit
git commit -m "fix: bug description"

# 3. Merge into main and tag
git checkout main
git merge --no-ff hotfix/bug-name -m "hotfix: bug-name"
git tag -a vx.y.z -m "Uptime Resilience Agent vx.y.z"

# 4. Back-merge into develop
git checkout develop
git merge --no-ff hotfix/bug-name -m "merge: hotfix/bug-name into develop"

# 5. Push
git push origin main develop --tags
```

## Commit Message Format

[Conventional Commits](https://www.conventionalcommits.org/) are used:

```
<type>: <short description>

[optional body]
```

| Type | Usage |
|------|-------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation changes only |
| `refactor` | Code restructuring without behaviour change |
| `test` | Adding or updating tests |
| `chore` | Build, dependencies, configuration |

### Examples

```
feat: add PagerDuty escalation support
fix: handle Socket.IO reconnect on token expiry
docs: update CONTRIBUTING with hotfix workflow
refactor: extract message chunking to shared utility
chore: update socket.io-client to 4.9.0
```

## Development Environment

```bash
# Install dependencies
npm install

# Dry-run test (without sending Telegram messages)
node src/index.js --dry --debug

# Live test
node src/index.js --debug
```

## Rules Summary

- Never push directly to `main` — always go through a PR or release merge
- Never commit `.env`
- Use ESM (`import`/`export`), never `require()`
- Node.js v20.11+ required (`import.meta.dirname` dependency)
- Use native `fetch` — do not add external HTTP libraries
- New features must be documented with a skill file at `.agents/skills/<name>/SKILL.md`
