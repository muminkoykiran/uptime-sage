# uptime-sage

**uptime-sage** is a Node.js ESM agent that monitors your Uptime Kuma instance on a schedule, runs SSH diagnostics on any DOWN server, feeds the results to Codex CLI for SRE-quality analysis, and routes Telegram notifications by severity to separate channels.

```
Uptime Kuma
     |
     v
src/uptime.js          Fetch monitor data (Socket.IO + JWT, or public HTTP fallback)
     |
     v
src/ssh-diagnostics.js  SSH into DOWN servers, collect read-only diagnostics
     |
     v
src/analyzer.js         Send data to Codex CLI for SRE analysis
     |
     v
src/telegram.js         Route notification to CRITICAL / WARNING / default channel
```

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Requirements](#requirements)
3. [Installation](#installation)
4. [Environment Variables](#environment-variables)
5. [SSH Diagnostics](#ssh-diagnostics)
   - [Uptime Kuma: configuring monitor tags](#uptime-kuma-configuring-monitor-tags)
   - [Target server: create a read-only diagnostic user](#target-server-create-a-read-only-diagnostic-user)
   - [Agent machine: SSH key setup](#agent-machine-ssh-key-setup)
   - [Diagnostic commands and types](#diagnostic-commands-and-types)
   - [Security model](#security-model)
6. [Scheduling](#scheduling)
   - [systemd timer (Ubuntu/Debian)](#systemd-timer-ubuntudebian)
   - [launchd (macOS)](#launchd-macos)
   - [cron (generic)](#cron-generic)
7. [Architecture](#architecture)
8. [Codex CLI Integration](#codex-cli-integration)
9. [Server Topology Reference](#server-topology-reference)
10. [Exit Codes](#exit-codes)
11. [Log Monitoring](#log-monitoring)
12. [Run Modes](#run-modes)

---

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/muminkoykiran/uptime-sage.git
cd uptime-sage
npm install

# 2. Configure
cp .env.example .env
# Edit .env: set UPTIME_KUMA_URL, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID

# 3. Dry run (no Telegram, verbose output)
node src/index.js --dry --debug

# 4. Production run
node src/index.js
```

---

## Requirements

| Requirement | Minimum version | Notes |
|---|---|---|
| Node.js | v20.11.0 | `import.meta.dirname` is used throughout |
| npm | any recent version | bundled with Node.js |
| Codex CLI | latest | `npm install -g @openai/codex` |
| Uptime Kuma | any self-hosted instance | public HTTP or Socket.IO access |
| Telegram Bot | — | create via @BotFather |

Install Node.js 22 LTS on Ubuntu:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version   # must be >=20.11.0
```

Install Codex CLI:

```bash
npm install -g @openai/codex
codex --version
```

---

## Installation

### 1. Install dependencies

```bash
npm install
```

### 2. Create `.env`

```bash
cp .env.example .env
```

At minimum, set the three required variables:

```
UPTIME_KUMA_URL=https://uptime.yourdomain.com
TELEGRAM_BOT_TOKEN=123456:AAF...
TELEGRAM_CHAT_ID=-1001234567890
```

### 3. Get a JWT token (recommended)

The public HTTP API only exposes monitors that are published on a public status page. Socket.IO with a JWT token provides full access to all monitors — including their tags, which are required for SSH diagnostics.

```bash
node scripts/get-jwt-token.js <username> <password>
# For 2FA-enabled accounts:
node scripts/get-jwt-token.js <username> <password> <2fa-token>
```

Copy the printed token into `.env`:

```
UPTIME_KUMA_TOKEN=eyJ...
```

Uptime Kuma JWT tokens do not expire. You only need to generate one once.

### 4. Test the setup

```bash
# Dry run with debug output — fetches data, runs Codex, prints the Telegram message, sends nothing
node src/index.js --dry --debug
```

---

## Environment Variables

### Required

| Variable | Description |
|---|---|
| `UPTIME_KUMA_URL` | Base URL of your Uptime Kuma instance (e.g. `https://uptime.example.com`) |
| `TELEGRAM_BOT_TOKEN` | Token from @BotFather |
| `TELEGRAM_CHAT_ID` | Default chat, group, or channel ID for notifications |

### Optional

| Variable | Default | Description |
|---|---|---|
| `UPTIME_KUMA_TOKEN` | — | JWT token. Enables Socket.IO mode with full monitor data including tags. Required for SSH diagnostics. |
| `TIMEZONE` | `UTC` | Display timezone for timestamps in logs and Telegram messages |
| `ALERT_REPEAT_HOURS` | `4` | Minimum hours between repeat alerts for the same ongoing incident |
| `TELEGRAM_CRITICAL_CHAT_ID` | falls back to `TELEGRAM_CHAT_ID` | Separate chat for CRITICAL severity notifications |
| `TELEGRAM_WARNING_CHAT_ID` | falls back to `TELEGRAM_CHAT_ID` | Separate chat for WARNING severity notifications |
| `CODEX_BIN` | `codex` | Path to the Codex CLI binary, if not on PATH |
| `SSH_DIAGNOSTICS_ENABLED` | — | Set to `true` to enable SSH diagnostics on DOWN monitors |
| `SSH_USER` | `ubuntu` | Default SSH username for target servers (overridden per-monitor by the `ssh-user` tag) |
| `SSH_KEY_PATH` | `~/.ssh/id_rsa` | Path to the SSH private key used for diagnostic connections |

---

## SSH Diagnostics

When a monitor goes DOWN and `SSH_DIAGNOSTICS_ENABLED=true`, the agent connects to the affected server over SSH, runs a set of safe read-only diagnostic commands, scrubs the output for secrets, and feeds it into the Codex CLI prompt. This gives the SRE analysis concrete evidence — service status, recent logs, resource usage — rather than just the Uptime Kuma heartbeat data.

SSH diagnostics only run when `needsAlert: true`. Suppressed repeat incidents (within `ALERT_REPEAT_HOURS`) skip SSH to reduce load.

### Uptime Kuma: configuring monitor tags

SSH connection parameters are stored as tags on each Uptime Kuma monitor. Open the monitor settings (the edit icon), scroll to the **Tags** section, and add each tag as a name/value pair.

| Tag name | Example value | Required | Description |
|---|---|---|---|
| `ssh-host` | `203.0.113.10` | Yes | SSH target hostname or IP address |
| `ssh-user` | `uptime-diag` | No | SSH username. Falls back to `SSH_USER` env var, then `ubuntu` |
| `ssh-port` | `22` | No | SSH port. Defaults to `22` |
| `ssh-type` | `systemd` | No | Monitor type: `systemd`, `docker`, or `http`. Determines which command set runs |
| `ssh-service` | `homebridge` | No | Service name (for `systemd`), container name (for `docker`), or port number (for `http`) |

Monitors without an `ssh-host` tag are silently skipped. When multiple DOWN monitors share the same `ssh-host`, the agent opens a single SSH connection and runs all commands for that host in one session.

How to add a tag in Uptime Kuma:

1. Open the monitor and click the edit (pencil) icon.
2. Scroll down to the **Tags** section.
3. Click **Add Tag**, enter the tag name (e.g. `ssh-host`) and its value (e.g. `203.0.113.10`).
4. Repeat for each required tag.
5. Save the monitor.

### Target server: create a read-only diagnostic user

Create a dedicated user for diagnostics on each server you want to monitor. Do not use root — the principle of least privilege applies here.

```bash
# Create the dedicated user
sudo useradd -r -s /bin/bash -m uptime-diag

# Allow reading systemd journal logs (required for journalctl commands)
sudo usermod -aG systemd-journal uptime-diag
```

If you need Docker diagnostics, add the user to the `docker` group. Be aware that docker group membership is effectively equivalent to root access on the host — only do this if your threat model allows it.

```bash
# Only if Docker diagnostics are needed
sudo usermod -aG docker uptime-diag
```

No sudo access is needed or granted. The user runs only the whitelisted commands listed in `config/ssh-diagnostics.json`.

### Agent machine: SSH key setup

Generate a dedicated key pair on the machine that runs uptime-sage. Keep this key separate from your personal SSH keys.

```bash
# Generate a dedicated ed25519 key
ssh-keygen -t ed25519 -f ~/.ssh/uptime-sage-readonly -C "uptime-sage-diag"
```

Deploy the public key to each target server:

```bash
ssh-copy-id -i ~/.ssh/uptime-sage-readonly.pub uptime-diag@<host>
```

Add each host to `known_hosts` before running the agent. The agent enforces `StrictHostKeyChecking=yes` — connections to unknown hosts are refused, not silently accepted. Use the interactive helper script to verify the fingerprint and add the entry:

```bash
node scripts/add-ssh-host.js <host>
# For a non-standard port:
node scripts/add-ssh-host.js <host> <port>
```

Or do it manually (skips fingerprint verification — only acceptable in a fully trusted network):

```bash
ssh-keyscan -H -p 22 <host> >> ~/.ssh/known_hosts
```

Set the SSH variables in `.env`:

```
SSH_DIAGNOSTICS_ENABLED=true
SSH_USER=uptime-diag
SSH_KEY_PATH=~/.ssh/uptime-sage-readonly
```

### Diagnostic commands and types

Commands are defined in `config/ssh-diagnostics.json`. The `general` template always runs regardless of `ssh-type`. The type-specific template runs in addition to it, immediately before.

| `ssh-type` | Commands run |
|---|---|
| `systemd` | `systemctl status {service} --no-pager -l` then `journalctl -u {service} -n 50 --no-pager --output=short-iso` |
| `docker` | `docker ps -a --filter name={container} ...` then `docker logs {container} --tail 50` |
| `http` | `ss -tlnp \| grep ':{port}'` then a `curl` health probe to `http://localhost:{port}/health` |
| *(any / omitted)* | `uptime && free -h && df -h /` (this is the `general` template, always runs) |

Timeout per command is 20 seconds. Output is capped at 1200 characters per command before being passed to Codex.

### Security model

- `StrictHostKeyChecking=yes` is enforced. A host that is not in `known_hosts` produces an SSH error that is included in the Codex prompt as a diagnostic signal — it is not silently skipped.
- `BatchMode=yes` and `PasswordAuthentication=no` are set on all SSH connections. Only key-based authentication is used.
- All command templates go through strict regex validation before substitution. Unknown template variables are rejected.
- Output is scrubbed for secrets before reaching Codex: JWT tokens, database connection strings, AWS access keys, Stripe keys, GitHub tokens, private keys, and `password=`/`secret=` patterns are replaced with `[REDACTED]` placeholders.
- The command whitelist (`config/ssh-diagnostics.json`) contains only read-only observability commands. No writes, no restarts, no privilege escalation.

---

## Scheduling

The agent is designed to run on a schedule and exit after each run. Use one of the three methods below. The setup scripts automate the configuration.

### systemd timer (Ubuntu/Debian)

Recommended for Linux. Runs at the top of every hour, persists across reboots, and handles missed runs if the machine was offline.

```bash
bash scripts/setup-systemd.sh
```

Verify and manage:

```bash
# Check timer status
systemctl --user status uptime-resilience-agent.timer

# Run immediately (for testing)
systemctl --user start uptime-resilience-agent.service

# View logs
tail -f ~/.local/log/uptime-resilience-agent/stdout.log
tail -f ~/.local/log/uptime-resilience-agent/stderr.log

# Stop the timer
systemctl --user stop uptime-resilience-agent.timer

# Remove entirely
systemctl --user disable --now uptime-resilience-agent.timer
rm ~/.config/systemd/user/uptime-resilience-agent.{service,timer}
```

The `.service` unit file uses `SuccessExitStatus=0 1 2 3` so that exit code 2 (CRITICAL) does not cause systemd to mark the run as failed.

### launchd (macOS)

Runs at the top of every hour as a user-level LaunchAgent.

```bash
bash scripts/setup-launchd.sh
```

Manage:

```bash
# Check status
launchctl print gui/$(id -u)/com.uptime.resilience.agent

# Run immediately
launchctl kickstart gui/$(id -u)/com.uptime.resilience.agent

# View logs
tail -f ~/Library/Logs/uptime-resilience-agent/stdout.log
tail -f ~/Library/Logs/uptime-resilience-agent/stderr.log

# Remove
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.uptime.resilience.agent.plist
rm ~/Library/LaunchAgents/com.uptime.resilience.agent.plist
```

### cron (generic)

Works on any Unix system. Appends a single cron entry for the current user.

```bash
bash scripts/setup-cron.sh
```

The script checks for an existing entry tagged `# uptime-resilience-agent` and prompts before replacing it. The generated cron line runs at minute 0 of every hour:

```
0 * * * * cd "/path/to/uptime-sage" && CODEX_BIN=codex node src/index.js >> ~/.uptime-resilience-agent.log 2>&1
```

Manage:

```bash
# List jobs
crontab -l

# Edit or remove the entry
crontab -e

# View the log
tail -f ~/.uptime-resilience-agent.log
```

---

## Architecture

### Pipeline overview

```
src/uptime.js
  Socket.IO + JWT  →  all monitors, including tags
  Public HTTP      →  public monitors only, no tags
        |
        v  [monitors: id, name, status, tags, ping, uptime24h, uptime30d, recentStatuses]
        |
src/ssh-diagnostics.js  (only when SSH_DIAGNOSTICS_ENABLED=true and needsAlert=true)
  Group DOWN monitors by ssh-host tag
  One SSH connection per unique host
  Run whitelisted commands in parallel across hosts
  Scrub secrets from output
        |
        v  [DiagnosticResult[]: host, status, commands[label, output]]
        |
src/analyzer.js
  Build prompt (monitor data + SSH diagnostics + severity rules)
  spawnAsync("codex exec --json --ephemeral --sandbox read-only ...")
  Parse JSONL event stream → structured JSON analysis
        |
        v  [{ severity, healthScore, summary, criticalIssues, warnings, telegramMessage, ... }]
        |
src/telegram.js
  Route by severity to CRITICAL / WARNING / default channel
  Split messages > 4000 chars
  Retry on 429 / 5xx
        |
        v  Telegram notification delivered
```

### Module reference

**`src/index.js`** — Orchestration entry point. Loads env, selects the Socket.IO or HTTP fetch path, runs the SSH diagnostics step, calls Codex, routes the Telegram message, and saves state. All operational log lines go through the `log()` helper here, which prepends `[HH:MM:SS]`. Exit code 2 is emitted when severity is CRITICAL.

**`src/uptime.js`** — Uptime Kuma client. When `UPTIME_KUMA_TOKEN` is set, connects via Socket.IO and authenticates with `loginByToken` to receive the full monitor list including tags, heartbeat history, and uptime ratios. Otherwise, falls back to unauthenticated public HTTP. Both paths produce the same output shape via `aggregateStats()`.

**`src/ssh-diagnostics.js`** — SSH diagnostic runner. Reads `ssh-host`, `ssh-user`, `ssh-port`, `ssh-type`, and `ssh-service` tags from each DOWN monitor, groups by host (one connection per unique host), validates and substitutes command templates from `config/ssh-diagnostics.json`, runs commands sequentially within each host, and runs hosts in parallel via `Promise.allSettled`. Scrubs secrets from all output before returning.

**`src/analyzer.js`** — Codex CLI execution engine. Builds the analysis prompt with monitor state, statistics, and the SSH diagnostics section. Shells out to `codex exec` via `spawnAsync` (never `execFile` — see note in `src/util.js` about Node 22 stdin behaviour). Parses the JSONL event stream output from Codex. Falls back to a basic statistics-based analysis if Codex does not respond.

**`src/telegram.js`** — Telegram Bot API client. Routes messages to the severity-specific chat ID when `TELEGRAM_CRITICAL_CHAT_ID` or `TELEGRAM_WARNING_CHAT_ID` are configured, otherwise uses `TELEGRAM_CHAT_ID`. Splits messages exceeding 4000 characters at newline boundaries. Retries once on HTTP 429 (honouring `Retry-After`) and once on 5xx responses.

**`src/state.js`** — Alert deduplication. Reads and writes `data/state.json` (gitignored). Tracks `firstDownAt`, `lastAlertAt`, and `alertCount` per monitor. Suppresses repeat alerts within `ALERT_REPEAT_HOURS` (default: 4) for monitors that have already been alerted. Detects recovery transitions when a previously-DOWN monitor returns to UP.

**`src/util.js`** — Shared `spawnAsync` helper. Wraps `child_process.spawn` with `stdio: ['ignore', 'pipe', 'pipe']`, a configurable timeout (default 120 s), SIGKILL as the kill signal, and streaming stdout/stderr callbacks. All modules that need to spawn subprocesses import from here.

---

## Codex CLI Integration

Codex CLI is a command-line agent from OpenAI that reads your project context and executes tasks. uptime-sage uses it in headless `exec` mode — no interactive session, no human in the loop.

Install Codex CLI:

```bash
npm install -g @openai/codex
```

Codex must be configured with an OpenAI API key before first use. Follow the [Codex CLI documentation](https://github.com/openai/codex) for initial setup.

### Project-level defaults

`.codex/config.toml` sets the model and policy for all Codex runs in this project:

```toml
model                  = "gpt-5.4"
model_reasoning_effort = "high"
approval_policy        = "never"
sandbox_mode           = "read-only"
```

`approval_policy = "never"` means Codex runs without prompting for confirmation — required for unattended scheduled operation. `sandbox_mode = "read-only"` prevents any writes during analysis.

### Lifecycle hooks

`.codex/hooks.json` wires two hooks:

**`SessionStart`** — runs `.codex/hook-scripts/session-start.js` at the beginning of every Codex session. This script reads `data/state.json` and injects the current list of DOWN monitors (with how long they have been down) into the Codex system message as context. Codex sees which monitors were already known to be failing before it begins analysis.

**`Stop`** — runs `.codex/hook-scripts/session-stop.js` when the Codex session ends. If the session ended while CRITICAL was in the last assistant message — which can happen if `codex exec` itself crashes — this hook sends a fallback Telegram notification directly. Normal CRITICAL notifications are already handled by `src/index.js`; this hook is a safety net for the edge case where the Codex process itself terminates abnormally.

---

## Server Topology Reference

`config/servers.private.md` is a human-readable document describing each server in your infrastructure. It is gitignored and never committed.

```bash
cp config/servers.private.example.md config/servers.private.md
```

Edit `servers.private.md` to document each server you have SSH diagnostic tags on: hostname, IP, OS, RAM, running services, critical ports, and any deployment notes. This file can be used as reference context when reviewing Codex analysis output or when onboarding a new SRE to the setup.

See `config/servers.private.example.md` for the format.

---

## Exit Codes

| Code | Meaning | Notes |
|---|---|---|
| `0` | OK or WARNING | All monitors UP, or only warnings — no action required |
| `1` | Error | API failure, authentication error, or unhandled exception |
| `2` | CRITICAL | At least one monitor is DOWN |

The systemd unit file sets `SuccessExitStatus=0 1 2 3` so exit code 2 does not trigger a systemd failure state.

---

## Log Monitoring

**systemd (Ubuntu/Linux):**

```bash
tail -f ~/.local/log/uptime-resilience-agent/stdout.log
tail -f ~/.local/log/uptime-resilience-agent/stderr.log

# Or via journald if configured to forward:
journalctl --user -u uptime-resilience-agent.service -f
```

**launchd (macOS):**

```bash
tail -f ~/Library/Logs/uptime-resilience-agent/stdout.log
tail -f ~/Library/Logs/uptime-resilience-agent/stderr.log
```

**cron:**

```bash
tail -f ~/.uptime-resilience-agent.log
```

---

## Run Modes

| Command | Behaviour |
|---|---|
| `node src/index.js` | Production run. Fetches monitors, runs SSH diagnostics if enabled, calls Codex, sends Telegram notification. |
| `node src/index.js --dry` | Dry run. All steps execute normally, but no Telegram message is sent. The formatted message is printed to stdout instead. |
| `node src/index.js --dry --debug` | Dry run with verbose output. Prints the full monitor list, aggregated stats, SSH diagnostic results (if any), raw Codex output, and the Telegram message. Useful for validating a new setup before scheduling. |
| `npm run test:dry` | Alias for `node src/index.js --dry --debug` |
| `npm start` | Alias for `node src/index.js` |

---

## Project Structure

```
uptime-sage/
  src/
    index.js                  Orchestration entry point
    uptime.js                 Uptime Kuma client (Socket.IO + JWT, public HTTP fallback)
    ssh-diagnostics.js        SSH diagnostic runner
    analyzer.js               Codex CLI exec engine
    telegram.js               Telegram Bot API client
    state.js                  Alert deduplication and repeat-alert state
    env.js                    .env loader
    util.js                   Shared spawnAsync helper
  config/
    analysis-schema.json      JSON schema for Codex structured output
    ssh-diagnostics.json      SSH command whitelist and templates
    servers.private.example.md  Template for server topology documentation
  scripts/
    get-jwt-token.js          Fetch a JWT token from Uptime Kuma
    add-ssh-host.js           Interactively add a host to known_hosts
    setup-systemd.sh          Install systemd timer (Ubuntu/Debian)
    setup-launchd.sh          Install launchd agent (macOS)
    setup-cron.sh             Install cron job (generic)
  .agents/skills/
    resilience-analysis/      SRE analysis skill for Codex
    ssh-diagnostics/          SSH diagnostics skill for Codex
    telegram-dispatch/        Telegram notification skill for Codex
    uptime-monitor/           Uptime Kuma query skill for Codex
  .codex/
    config.toml               Codex project defaults (model, sandbox, approval policy)
    hooks.json                SessionStart and Stop hook definitions
    hook-scripts/
      session-start.js        Injects current monitor state into Codex session context
      session-stop.js         Fallback Telegram alert if Codex session ends on CRITICAL
  data/
    state.json                Runtime alert state (gitignored)
  .env.example                Environment variable template
  package.json
```
