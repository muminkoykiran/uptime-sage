# Server Topology (Example)
#
# Copy this file: cp config/servers.private.example.md config/servers.private.md
# servers.private.md is gitignored — never committed to the repository.
# Can be used as reference context for SSH diagnostic troubleshooting.

## <hostname or IP> (<alias>)
- RAM, CPU, OS details
- Which services are running and how they are managed (Docker Compose / systemd)
- Critical ports and what is running on them
- Special notes (deploy method, dependencies)

---

## Example: master (203.0.113.10)
- 16GB RAM, 4 vCPU, Ubuntu 22.04 LTS
- Managed with Docker Compose (`/opt/compose/master/`)
- Traefik reverse proxy: 80/443 → backends on ports 8080–8099
- Port 8082 → Tomato Tricker (Python Flask, internal job worker)
- Local Anthropic API proxy: 8090 → Ollama

## Example: slave3 (192.0.2.101)
- Raspberry Pi 5, 8GB RAM, Raspberry Pi OS 64-bit
- Systemd services: FinancialGPT.service, CandyTrader.service
- FinancialGPT healthcheck: expects HTTP 200 + body "OK"
- CandyTrader healthcheck: expects HTTP 200 + body contains "running"

## Example: jetson (192.0.2.50)
- Jetson Nano 4GB, JetPack 4.6, Ubuntu 18.04
- CUDA ML workloads
- Known intermittent network issue — flapping is expected
