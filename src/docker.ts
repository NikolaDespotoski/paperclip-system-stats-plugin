/** Docker collection: `docker stats`, `docker system df` and their parsers. */
import { parsePercent, sizeToBytes } from "./format.js";
import type { DockerContainer, DockerDisk, DockerStats } from "./types.js";

/** Parse the one-JSON-object-per-line output of `docker stats --format json`. */
export function parseDockerStats(text: string | null): DockerContainer[] {
  if (!text) return [];
  const containers: DockerContainer[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }
    const mem = splitPair(String(raw.MemUsage ?? ""));
    const net = splitPair(String(raw.NetIO ?? ""));
    const block = splitPair(String(raw.BlockIO ?? ""));
    containers.push({
      id: String(raw.ID ?? raw.Container ?? ""),
      name: String(raw.Name ?? ""),
      image: String(raw.Image ?? ""),
      status: String(raw.Status ?? ""),
      cpu_percent: parsePercent(String(raw.CPUPerc ?? "")),
      mem_usage_bytes: mem[0],
      mem_limit_bytes: mem[1],
      mem_percent: parsePercent(String(raw.MemPerc ?? "")),
      net_rx_bytes: net[0],
      net_tx_bytes: net[1],
      block_read_bytes: block[0],
      block_write_bytes: block[1],
      pids: Number.parseInt(String(raw.PIDs ?? "0"), 10) || 0,
    });
  }
  return containers;
}

/** Parse `docker system df` into byte totals. Returns `null` when unavailable. */
export function parseDockerSystemDf(text: string | null): DockerDisk | null {
  if (!text) return null;
  const rows = new Map<string, { count: number; size: number }>();
  for (const line of text.split("\n").slice(1)) {
    const tokens = line.trim().split(/\s+/);
    if (tokens.length < 4) continue;
    // The TYPE column can contain spaces ("Local Volumes", "Build Cache"),
    // so anchor on the first integer token (TOTAL) instead of fixed indices.
    const countIndex = tokens.findIndex((token) => /^\d+$/.test(token));
    if (countIndex < 1) continue;
    const kind = tokens.slice(0, countIndex).join(" ").toLowerCase();
    const count = Number.parseInt(tokens[countIndex], 10);
    const size = sizeToBytes(tokens[countIndex + 2] ?? "");
    if (!Number.isFinite(count) || Number.isNaN(size)) continue;
    rows.set(kind, { count, size });
  }
  if (rows.size === 0) return null;
  const get = (kind: string) => rows.get(kind) ?? { count: 0, size: 0 };
  return {
    images_total: get("images").count,
    images_size: get("images").size,
    containers_total: get("containers").count,
    containers_size: get("containers").size,
    volumes_total: get("local volumes").count + get("volumes").count,
    volumes_size: get("local volumes").size + get("volumes").size,
    build_cache_size: get("build cache").size,
  };
}

/** Split a `docker` "used / limit" cell into `[used, limit]` byte counts. */
function splitPair(text: string): [number, number] {
  const [left, right] = text.split("/");
  return [sizeToBytes(left ?? ""), sizeToBytes(right ?? "")];
}

export interface DockerOptions {
  /** Extra flags, e.g. `-H unix:///var/run/docker.sock`. */
  socketPath?: string;
  collect?: boolean;
}

/** Collect container stats and disk usage, or `null` when Docker is absent. */
export function readDocker(
  platform: { exec(command: string): string | null },
  options: DockerOptions = {},
): DockerStats | null {
  if (options.collect === false) return null;
  const hostFlag = options.socketPath ? `-H unix://${options.socketPath}` : "";
  const statsText = platform.exec(`docker stats --no-stream --format json ${hostFlag}`.trim());
  if (statsText == null) return null;
  const containers = parseDockerStats(statsText);
  const dfText = platform.exec(`docker system df ${hostFlag}`.trim());
  const disk = parseDockerSystemDf(dfText);
  return {
    containers,
    disk,
    running_count: containers.length,
    total_count: containers.length,
  };
}
