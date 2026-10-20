---
name: runtime-health
description: Inspect the local Uptime Resilience Agent host's disk, memory, swap, and load with read-only checks. Use when local agent resource pressure affects monitoring reliability. Do not remediate host resources.
---

# Runtime Health

Use this skill when evaluating the host running Uptime Resilience Agent.

- Collect disk, memory, swap, and load data with read-only local APIs.
- Treat disk use at or above the configured critical threshold as CRITICAL; warning disk and swap thresholds are WARNING.
- Report resource pressure clearly, but never delete files, prune containers, restart services, or change host configuration.
- When monitor data is partial, do not infer monitor recovery from local runtime data.
