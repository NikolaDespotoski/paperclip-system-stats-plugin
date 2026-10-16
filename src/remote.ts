/** Remote host collection over SSH, plus the shared webhook/SSH wrap-up. */
import { collectLocal } from "./collect.js";
import type { PluginConfig, RemoteHostConfig } from "./config.js";
import { nodePlatform, type Platform } from "./platform.js";
import { remoteCollectScriptBase64 } from "./remote-script.js";
import { emptyHostStats, type HostStats, type HostsSnapshot, type RemoteStats } from "./types.js";

const SAMPLE_MS = 200;

/** Build the `ssh` command that runs the embedded collector on the target. */
export function sshCommand(host: RemoteHostConfig, config: PluginConfig): string {
  const b64 = remoteCollectScriptBase64();
  const args = ["ssh", "-o BatchMode=yes", "-o ConnectTimeout=8", "-o StrictHostKeyChecking=accept-new"];
  if (host.ssh_key_path) args.push(`-i ${shellQuote(host.ssh_key_path)}`);
  const env = [
    `STATS_INCLUDE_LOOPBACK=${config.include_loopback_interfaces ? "true" : "false"}`,
    `STATS_INCLUDE_DOCKER_BRIDGE=${config.include_docker_bridge ? "true" : "false"}`,
  ].join(" ");
  const remote = `${env} node --input-type=commonjs -e "eval(Buffer.from('${b64}','base64').toString())"`;
  args.push(`${host.user}@${host.host}`, remote);
  return args.join(" ");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Fill any missing metric block so a partial remote payload still renders. */
export function toHostStats(id: string, label: string, method: HostStats["collection_method"], raw: RemoteStats): HostStats {
  return {
    id,
    label,
    collected_at: new Date().toISOString(),
    collection_method: method,
    available: raw.available !== false,
    error: raw.error ?? null,
    cpu: {
      usage_pct: raw.cpu?.usage_pct ?? 0,
      load1: raw.cpu?.load1 ?? 0,
      load5: raw.cpu?.load5 ?? 0,
      load15: raw.cpu?.load15 ?? 0,
      cores: raw.cpu?.cores ?? 0,
      psi_cpu_some10: raw.cpu?.psi_cpu_some10 ?? null,
    },
    mem: {
      total_bytes: raw.mem?.total_bytes ?? 0,
      used_bytes: raw.mem?.used_bytes ?? 0,
      available_bytes: raw.mem?.available_bytes ?? 0,
      usage_pct: raw.mem?.usage_pct ?? 0,
      swap_total_bytes: raw.mem?.swap_total_bytes ?? 0,
      swap_used_bytes: raw.mem?.swap_used_bytes ?? 0,
      buffers_bytes: raw.mem?.buffers_bytes ?? 0,
      cached_bytes: raw.mem?.cached_bytes ?? 0,
    },
    disk: raw.disk ?? [],
    network: {
      interfaces: raw.network?.interfaces ?? [],
      total_rx_per_sec: raw.network?.total_rx_per_sec ?? 0,
      total_tx_per_sec: raw.network?.total_tx_per_sec ?? 0,
    },
    docker: raw.docker ?? null,
    top_procs: raw.top_procs ?? [],
    uptime_seconds: raw.uptime_seconds ?? 0,
  };
}

/** Run the collector on one SSH host. Never throws: failures become an unreachable host. */
export async function collectSsh(
  host: RemoteHostConfig,
  config: PluginConfig,
  platform: Platform = nodePlatform(),
): Promise<HostStats> {
  const output = platform.exec(sshCommand(host, config));
  if (output == null) {
    return emptyHostStats(host.id, host.label, "ssh", "ssh command failed");
  }
  let raw: RemoteStats;
  try {
    raw = JSON.parse(output.trim()) as RemoteStats;
  } catch {
    return emptyHostStats(host.id, host.label, "ssh", "collector returned invalid JSON");
  }
  if (raw.available === false) {
    return emptyHostStats(host.id, host.label, "ssh", raw.error ?? "collector unavailable");
  }
  return toHostStats(host.id, host.label, "ssh", raw);
}

/**
 * Collect the local host plus every SSH-configured host. Webhook hosts are
 * merged later by the data handler, which reads their latest pushed snapshot.
 */
export async function collectAllHosts(
  config: PluginConfig,
  logger?: { warn(message: string, meta?: Record<string, unknown>): void },
  platform: Platform = nodePlatform(),
): Promise<HostsSnapshot> {
  const hosts: HostStats[] = [];
  try {
    hosts.push(
      await collectLocal(platform, {
        id: "localhost",
        label: "Localhost",
        sampleMs: SAMPLE_MS,
        includeLoopback: config.include_loopback_interfaces,
        includeDockerBridge: config.include_docker_bridge,
        docker: { socketPath: config.docker_socket_path, collect: true },
      }),
    );
  } catch (error) {
    logger?.warn("local stats collection failed", { error: String(error) });
    hosts.push(emptyHostStats("localhost", "Localhost", "local", "collection failed"));
  }
  for (const host of config.remote_hosts) {
    if (host.mode !== "ssh") continue;
    try {
      hosts.push(await collectSsh(host, config, platform));
    } catch (error) {
      logger?.warn("ssh stats collection failed", { host: host.id, error: String(error) });
      hosts.push(emptyHostStats(host.id, host.label, "ssh", "collection failed"));
    }
  }
  return { hosts, collected_at: new Date().toISOString() };
}
