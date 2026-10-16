# System Stats (Paperclip plugin)

Real-time CPU, RAM, disk, network and Docker monitoring for the Paperclip host and any configured remote execution hosts. A worker collects metrics from Linux `/proc`, `df`, `ps` and `docker`; the UI renders them as a live dashboard page and a compact dashboard widget.

| Where | What it shows |
|---|---|
| **System** page (`/<company>/system-stats`) | Host tabs, a live indicator, CPU (usage, load, PSI, cores), memory (used/total, swap, buffers), per-mount disk table, per-interface network rates, per-container Docker stats, and top processes. |
| Dashboard widget | Compact averages: CPU, RAM, worst disk, network totals and Docker container count, plus a link to the page. |

The page polls every 15 seconds and has a **Refresh** button that forces a collection immediately.

## Data gathered

| Metric | Source |
|---|---|
| CPU usage % | `/proc/stat` — two samples, jiffy delta |
| CPU load 1/5/15 | `/proc/loadavg` |
| PSI pressure | `/proc/pressure/cpu` (`avg10`; omitted when the kernel has no PSI) |
| RAM total/used/available | `/proc/meminfo` (`MemTotal`, `MemAvailable`) |
| Swap | `/proc/meminfo` (`SwapTotal`, `SwapFree`) |
| Disk usage | `df -k --output=...` (falls back to `df -kP`) |
| Network RX/TX | `/proc/net/dev` — two samples → bytes/packets per second |
| Interface state / speed | `/sys/class/net/<if>/{operstate,speed}` |
| Docker containers | `docker stats --no-stream --format json` |
| Docker disk | `docker system df` |
| Top processes | `ps -eo pid,pcpu,pmem,comm --sort=-pcpu` |
| Uptime | `/proc/uptime` |

Collection never throws: a missing tool becomes an empty section, and a missing `/proc` becomes an unavailable host with a reason.

## Install

The plugin runs on the same machine as the Paperclip host (it reads local `/proc`). It needs Node ≥ 24.11.

```sh
npm ci            # or npm install
npm run build
paperclipai plugin install "$(pwd)"
```

To publish for other instances, publish the package to your registry and install by name.

## Configuration

Configured in **Settings → Plugins → System Stats**. The schema is also in [`src/config.ts`](src/config.ts).

| Key | Default | Meaning |
|---|---|---|
| `poll_interval_seconds` | `15` | Worker polling cadence. `0` disables the worker timer; the manifest cron job then runs once a minute. |
| `include_loopback_interfaces` | `false` | Include `lo` in the network card. |
| `include_docker_bridge` | `false` | Include `docker0` / `br-*` / `veth*` interfaces. |
| `docker_socket_path` | `/var/run/docker.sock` | Docker socket for `docker -H`. |
| `remote_hosts` | `[]` | SSH or webhook hosts (below). |
| `thresholds` | see below | Colour cut-offs. |

### Remote hosts

**Strategy A — SSH pull (zero remote setup).** The worker runs the embedded collector over SSH every cycle.

```json
{
  "remote_hosts": [
    { "id": "gpu-box", "label": "GPU Box", "mode": "ssh", "host": "100.89.40.1", "user": "deploy", "ssh_key_path": "~/.ssh/id_ed25519_paperclip" }
  ]
}
```

The target needs `node` (≥ 18) and the usual Linux tools; the collector is piped to `node -e` as base64, so there is nothing to install.

**Strategy B — Webhook push.** The remote host runs the same collector on a timer and POSTs the JSON to Paperclip. Declare a host with `mode: "webhook"` and a `webhook_secret` (a Paperclip `secret_ref`), then install a systemd timer:

```ini
# /etc/systemd/system/paperclip-stats-collector.service
[Service]
Type=oneshot
Environment=HOST_ID=gpu-box
Environment=PAPERCLIP_URL=https://paperclip.example.com
EnvironmentFile=/etc/paperclip-stats-collector/credentials
ExecStart=/usr/local/bin/paperclip-stats-collector.sh

# /etc/systemd/system/paperclip-stats-collector.timer
[Timer]
OnBootSec=15
OnUnitActiveSec=15
```

The script base64-decodes `REMOTE_COLLECT_SCRIPT` (exported from `src/remote-script.ts`) and POSTs it:

```sh
curl -fsS -X POST "$PAPERCLIP_URL/api/plugins/paperclip.system-stats/webhooks/host-stats" \
  -H "content-type: application/json" \
  -H "x-paperclip-secret: $PAPERCLIP_SECRET" \
  -d "{\"host\":\"$HOST_ID\",\"stats\":$(node -e '<collector>')}"
```

The webhook secret is compared in constant time; pushes with a missing or wrong secret are ignored.

### Thresholds

| Metric | Green | Yellow | Red |
|---|---|---|---|
| CPU % | < `cpu_warn` (70) | → `cpu_crit` (90) | ≥ 90 |
| RAM % | < `mem_warn` (70) | → `mem_crit` (90) | ≥ 90 |
| Disk % | < `disk_warn` (70) | → `disk_crit` (90) | ≥ 90 |
| Load / core | < 1.0 | 1.0–2.0 | > 2.0 |
| Docker CPU | < `docker_cpu_warn` (80) | → 95 | ≥ 95 |

## Graceful degradation

- **No Docker** — the Docker card says so; nothing crashes.
- **No remote hosts** — only localhost is shown and the host tabs are hidden.
- **No PSI** — the PSI row shows "not available".
- **No network permissions** — the network card shows an error state.
- **SSH failure** — the remote card shows "unreachable" with the reason.

## Development

```sh
npm run typecheck   # worker and UI
npm test            # vitest: parsers, collectors, remote and worker wiring
npm run build       # dist/ (worker via tsc, UI bundle via esbuild)
```

The worker is tested through the SDK's in-memory harness (`createTestHarness`), and the collectors through an injected fake `Platform`, so no Linux host or Docker daemon is needed.

## Security

The plugin declares only the capabilities it uses: the two UI slots, plugin state read/write, the schedule job, webhook receive and secret resolution. It does not call the Paperclip API or arbitrary network hosts (SSH targets come from operator config). Remote stats are stored in instance-scoped plugin state; webhook secrets are resolved at call time and never persisted.
