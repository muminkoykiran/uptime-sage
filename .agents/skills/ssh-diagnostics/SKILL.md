---
name: ssh-diagnostics
description: SSH into DOWN/PENDING monitor servers and run safe read-only diagnostic commands. Use when a monitor is DOWN and SSH tags (ssh-host, ssh-user, ssh-port, ssh-type, ssh-service) are present. Results are injected into the Codex analysis prompt. Do NOT use for data fetching or sending notifications.
---

# SSH Diagnostics Skill

When a DOWN monitor is detected, this skill connects to the affected server via SSH, runs safe read-only diagnostic commands, and injects the results into the Codex analysis prompt.

## Activation

```
SSH_DIAGNOSTICS_ENABLED=true   # set in .env
```

To disable: remove the variable or set it to `false`.

## Uptime Kuma Tag Structure

Tags are added per monitor from the Uptime Kuma UI. The `ssh-host` tag is the only required one — all others are optional and fall back to defaults or env vars.

| Tag Name | Example Value | Required | Description |
|----------|---------------|----------|-------------|
| `ssh-host` | `203.0.113.10` | Yes | IP or hostname of the target server to SSH into |
| `ssh-user` | `ubuntu` | No | SSH username; falls back to `SSH_USER` env var |
| `ssh-port` | `22` | No | SSH port; defaults to `22` |
| `ssh-type` | `systemd` \| `docker` \| `http` | No | Service type — determines which command set is executed (see below) |
| `ssh-service` | `homebridge` | No | Service name passed to commands; used together with `ssh-type` |

Monitors without an `ssh-host` tag are excluded from SSH diagnostics entirely.

## ssh-type Values and Commands Triggered

| `ssh-type` | Commands executed |
|------------|-------------------|
| `systemd` | `systemctl status {service}`, `journalctl -u {service} -n 50 --no-pager` |
| `docker` | `docker ps`, `docker logs --tail 50 {container}` |
| `http` | `curl -o /dev/null -s -w "%{http_code}" http://localhost:{port}`, `ss -tlnp` |
| _(unset)_ | Generic host checks: `uptime`, `df -h`, `free -m`, `ss -tlnp` |

All templates use variables from the whitelist: `{service}`, `{container}`, `{port}`.

## Environment Variables

```
SSH_DIAGNOSTICS_ENABLED=true
SSH_USER=ubuntu                           # fallback when ssh-user tag is absent
SSH_KEY_PATH=~/.ssh/uptime-sage-readonly  # path to the dedicated SSH private key
```

## Target Server Setup

### 1. Create a dedicated user

```bash
useradd -r -s /bin/bash -m uptime-diag
usermod -aG systemd-journal uptime-diag
usermod -aG docker uptime-diag   # required for docker commands (docker group is root-equivalent)
```

### 2. Add the SSH key

```bash
# Generate the key pair (on the agent machine)
ssh-keygen -t ed25519 -f ~/.ssh/uptime-sage-readonly -C "uptime-sage-diag"

# Copy the public key to the target server
ssh-copy-id -i ~/.ssh/uptime-sage-readonly.pub uptime-diag@<host>
```

### 3. Update known hosts (on the agent machine)

```bash
# Run once per target server
node scripts/add-ssh-host.js <host> [port]
```

Or manually:
```bash
ssh-keyscan -H -p 22 <host> >> ~/.ssh/known_hosts
```

## Command Whitelist

Defined in `config/ssh-diagnostics.json`. Rules for adding new templates:

- Read-only commands only (`cat`, `systemctl status`, `journalctl`, `docker logs`, `ss`, `curl`)
- `sudo` is not permitted
- Template variables are limited to `{service}`, `{container}`, `{port}`
- Each variable must match the `var_rules` regex defined in the config

## Server Topology Documentation

You can document your server architecture by creating `config/servers.private.md`.
This file is listed in `.gitignore` and can be added as extra context to the Codex prompt in the future.
It must never be committed to the repository.

```markdown
# Server Topology

## master (203.0.113.10)
- 16GB RAM VDS, Ubuntu 22.04, Docker Compose
- Port 8082 → Tomato Tricker (Flask)
...
```

## Architecture Notes

- SSH runs only when `needsAlert: true` — repeated or suppressed alerts skip SSH entirely
- If multiple DOWN monitors share the same host, only one SSH connection is opened
- Execution is parallel across hosts, sequential within a single host
- SSH errors are also injected into the Codex prompt (an unreachable host is itself a diagnostic signal)
- Output is scrubbed for secrets before being passed to Codex
