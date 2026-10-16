/** Operator configuration: JSON schema, defaults and runtime parsing. */
import type { JsonSchema } from "@paperclipai/plugin-sdk";

export interface Thresholds {
  cpu_warn: number;
  cpu_crit: number;
  mem_warn: number;
  mem_crit: number;
  disk_warn: number;
  disk_crit: number;
  net_rx_warn_mbps: number;
  docker_cpu_warn: number;
  docker_mem_warn: number;
}

/** A `secret_ref` binding, or a plain secret id for simple setups. */
export type WebhookSecretRef = string | { type: "secret_ref"; secretId: string; version?: number | "latest" };

export interface RemoteHostConfig {
  id: string;
  label: string;
  mode: "ssh" | "webhook";
  host?: string;
  user?: string;
  ssh_key_path?: string;
  /** A `secret_ref` binding (`{ type: "secret_ref", secretId, ... }`). */
  webhook_secret?: WebhookSecretRef;
  collect_docker?: boolean;
}

export interface PluginConfig {
  sample_interval_seconds: number;
  history_window_seconds: number;
  ui_refresh_seconds: number;
  include_loopback_interfaces: boolean;
  include_docker_bridge: boolean;
  docker_socket_path: string;
  remote_hosts: RemoteHostConfig[];
  thresholds: Thresholds;
}

export const DEFAULT_CONFIG: PluginConfig = {
  sample_interval_seconds: 5,
  history_window_seconds: 1800,
  ui_refresh_seconds: 2,
  include_loopback_interfaces: false,
  include_docker_bridge: false,
  docker_socket_path: "/var/run/docker.sock",
  remote_hosts: [],
  thresholds: {
    cpu_warn: 70,
    cpu_crit: 90,
    mem_warn: 70,
    mem_crit: 90,
    disk_warn: 70,
    disk_crit: 90,
    net_rx_warn_mbps: 800,
    docker_cpu_warn: 80,
    docker_mem_warn: 80,
  },
};

export const CONFIG_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    sample_interval_seconds: { type: "number", default: 5, minimum: 2, maximum: 60, description: "Seconds between samples. The worker records one raw point per host each tick. 0 disables the timer (tests/ops)." },
    history_window_seconds: { type: "number", default: 1800, description: "Retention window for the rolling time series, in seconds." },
    ui_refresh_seconds: { type: "number", default: 2, minimum: 1, maximum: 30, description: "How often the UI appends new chart points." },
    include_loopback_interfaces: { type: "boolean", default: false },
    include_docker_bridge: { type: "boolean", default: false },
    docker_socket_path: { type: "string", default: "/var/run/docker.sock" },
    remote_hosts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          mode: { type: "string", enum: ["ssh", "webhook"] },
          host: { type: "string" },
          user: { type: "string" },
          ssh_key_path: { type: "string" },
          webhook_secret: { type: "string", format: "secret-ref" },
          collect_docker: { type: "boolean", default: true },
        },
        required: ["id", "label", "mode"],
      },
    },
    thresholds: {
      type: "object",
      properties: {
        cpu_warn: { type: "number", default: 70 },
        cpu_crit: { type: "number", default: 90 },
        mem_warn: { type: "number", default: 70 },
        mem_crit: { type: "number", default: 90 },
        disk_warn: { type: "number", default: 70 },
        disk_crit: { type: "number", default: 90 },
        net_rx_warn_mbps: { type: "number", default: 800 },
        docker_cpu_warn: { type: "number", default: 80 },
        docker_mem_warn: { type: "number", default: 80 },
      },
    },
  },
};

function number(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : value == null ? fallback : value === "true" || value === 1;
}

function string(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function secretRef(value: unknown): WebhookSecretRef | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object") {
    const binding = value as Record<string, unknown>;
    if (binding.type === "secret_ref" && typeof binding.secretId === "string") {
      const version = binding.version;
      return { type: "secret_ref", secretId: binding.secretId, version: version === "latest" || typeof version === "number" ? version : undefined };
    }
  }
  return undefined;
}

/** Merge operator config over defaults, dropping malformed remote hosts. */
export function parseConfig(raw: Record<string, unknown> | null | undefined): PluginConfig {
  const source = raw ?? {};
  const rawThresholds = (source.thresholds ?? {}) as Record<string, unknown>;
  const thresholds: Thresholds = {
    cpu_warn: number(rawThresholds.cpu_warn, DEFAULT_CONFIG.thresholds.cpu_warn),
    cpu_crit: number(rawThresholds.cpu_crit, DEFAULT_CONFIG.thresholds.cpu_crit),
    mem_warn: number(rawThresholds.mem_warn, DEFAULT_CONFIG.thresholds.mem_warn),
    mem_crit: number(rawThresholds.mem_crit, DEFAULT_CONFIG.thresholds.mem_crit),
    disk_warn: number(rawThresholds.disk_warn, DEFAULT_CONFIG.thresholds.disk_warn),
    disk_crit: number(rawThresholds.disk_crit, DEFAULT_CONFIG.thresholds.disk_crit),
    net_rx_warn_mbps: number(rawThresholds.net_rx_warn_mbps, DEFAULT_CONFIG.thresholds.net_rx_warn_mbps),
    docker_cpu_warn: number(rawThresholds.docker_cpu_warn, DEFAULT_CONFIG.thresholds.docker_cpu_warn),
    docker_mem_warn: number(rawThresholds.docker_mem_warn, DEFAULT_CONFIG.thresholds.docker_mem_warn),
  };
  const remote_hosts: RemoteHostConfig[] = [];
  const rawHosts = Array.isArray(source.remote_hosts) ? source.remote_hosts : [];
  for (const entry of rawHosts) {
    if (!entry || typeof entry !== "object") continue;
    const host = entry as Record<string, unknown>;
    const id = string(host.id, "");
    const mode = host.mode === "ssh" || host.mode === "webhook" ? host.mode : null;
    if (!id || !mode) continue;
    remote_hosts.push({
      id,
      label: string(host.label, id),
      mode,
      host: string(host.host, ""),
      user: string(host.user, ""),
      ssh_key_path: string(host.ssh_key_path, ""),
      webhook_secret: secretRef(host.webhook_secret),
      collect_docker: host.collect_docker == null ? true : boolean(host.collect_docker, true),
    });
  }
  return {
    sample_interval_seconds: Math.max(0, number(source.sample_interval_seconds ?? source.poll_interval_seconds, DEFAULT_CONFIG.sample_interval_seconds)),
    history_window_seconds: Math.max(60, number(source.history_window_seconds, DEFAULT_CONFIG.history_window_seconds)),
    ui_refresh_seconds: Math.max(1, number(source.ui_refresh_seconds, DEFAULT_CONFIG.ui_refresh_seconds)),
    include_loopback_interfaces: boolean(source.include_loopback_interfaces, DEFAULT_CONFIG.include_loopback_interfaces),
    include_docker_bridge: boolean(source.include_docker_bridge, DEFAULT_CONFIG.include_docker_bridge),
    docker_socket_path: string(source.docker_socket_path, DEFAULT_CONFIG.docker_socket_path),
    remote_hosts,
    thresholds,
  };
}

export interface ConfigValidation {
  ok: boolean;
  warnings: string[];
  errors: string[];
}

/** Validate operator config for the settings UI / "Test connection" button. */
export function validateConfig(raw: Record<string, unknown> | null | undefined): ConfigValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const source = raw ?? {};
  const interval = number(source.sample_interval_seconds ?? source.poll_interval_seconds, DEFAULT_CONFIG.sample_interval_seconds);
  if (interval < 0) errors.push("sample_interval_seconds must be 0 or greater.");
  if (interval > 0 && interval < 2) warnings.push("sample_interval_seconds below 2s may be too chatty for the host.");
  const windowSeconds = number(source.history_window_seconds, DEFAULT_CONFIG.history_window_seconds);
  if (windowSeconds < 60) errors.push("history_window_seconds must be at least 60.");
  const uiSeconds = number(source.ui_refresh_seconds, DEFAULT_CONFIG.ui_refresh_seconds);
  if (uiSeconds < 1) errors.push("ui_refresh_seconds must be at least 1.");
  const seen = new Set<string>();
  const hosts = Array.isArray(source.remote_hosts) ? source.remote_hosts : [];
  for (const entry of hosts) {
    if (!entry || typeof entry !== "object") continue;
    const host = entry as Record<string, unknown>;
    const id = String(host.id ?? "");
    if (seen.has(id)) errors.push(`Duplicate remote host id "${id}".`);
    seen.add(id);
    if (host.mode === "ssh" && !String(host.host ?? "")) errors.push(`Remote host "${id}" needs a host for ssh mode.`);
    if (host.mode === "ssh" && !String(host.user ?? "")) errors.push(`Remote host "${id}" needs a user for ssh mode.`);
    if (host.mode === "webhook" && !host.webhook_secret) warnings.push(`Remote host "${id}" has no webhook_secret; pushes will be rejected.`);
  }
  return { ok: errors.length === 0, warnings, errors };
}
