# Reliability refactor status

Run `npm test` for offline regression checks. No production deployment is included.

Implemented: subprocess exit/timeout/output bounds, nested analysis validation,
agent_message parsing, early Socket.IO listeners, empty-list rejection,
recovery through PENDING, atomic state writes, dry-run state isolation,
WARNING detection, severity floor, run lock, Telegram retry_after handling,
systemd error exit recognition, run deadline, log rotation setup, and offline
regression tests.

The runtime lock is data/run.lock. After an unclean termination, verify no agent
process is running before removing a stale lock. State retains the existing
monitor-keyed representation and adds _health for notification deduplication.

Codex retries now apply only to timeout and output-limit failures. Protected
`.agents` and `.codex` directories cannot be edited in this session.
`protected-config.patch` is a proposed hook removal, not an applied change.
Until it is applied, dry-run cannot guarantee absence of hook-originated Telegram
messages. No production or paid API validation has been performed.
