/**
 * Data shapes shared by the worker, the collectors and the UI bundle.
 *
 * `HostStats` is the contract rendered by the plugin UI. The plan's field
 * names are preserved exactly; `available` and `error` were added so the UI can
 * render the "not available" / "unreachable" states from the graceful
 * degradation table without guessing.
 */

export interface CpuStats {
  usage_pct: number;
  load1: number;
  load5: number;
  load15: number;
  cores: number;
  psi_cpu_some10: number | null;
}

export interface MemStats {
  total_bytes: number;
  used_bytes: number;
  available_bytes: number;
  usage_pct: number;
  swap_total_bytes: number;
  swap_used_bytes: number;
  buffers_bytes: number;
  cached_bytes: number;
}

export interface DiskMount {
  mount: string;
  total_bytes: number;
  used_bytes: number;
  available_bytes: number;
  usage_pct: number;
}

export interface NetworkInterface {
  name: string;
  rx_bytes_per_sec: number;
  tx_bytes_per_sec: number;
  rx_packets_per_sec: number;
  tx_packets_per_sec: number;
  rx_errors: number;
  tx_errors: number;
  state: "up" | "down";
  speed_mbps: number | null;
}

export interface NetworkStats {
  interfaces: NetworkInterface[];
  total_rx_per_sec: number;
  total_tx_per_sec: number;
}

export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  status: string;
  cpu_percent: number;
  mem_usage_bytes: number;
  mem_limit_bytes: number;
  mem_percent: number;
  net_rx_bytes: number;
  net_tx_bytes: number;
  block_read_bytes: number;
  block_write_bytes: number;
  pids: number;
}

export interface DockerDisk {
  images_total: number;
  images_size: number;
  containers_total: number;
  containers_size: number;
  volumes_total: number;
  volumes_size: number;
  build_cache_size: number;
}

export interface DockerStats {
  containers: DockerContainer[];
  disk: DockerDisk | null;
  running_count: number;
  total_count: number;
}

export interface TopProc {
  pid: number;
  cpu_pct: number;
  mem_pct: number;
  command: string;
}

export interface HostStats {
  id: string;
  label: string;
  collected_at: string;
  collection_method: "local" | "ssh" | "webhook";
  /** False when the collector could not read the platform at all. */
  available: boolean;
  /** Human-readable failure reason when `available` is false. */
  error: string | null;
  cpu: CpuStats;
  mem: MemStats;
  disk: DiskMount[];
  network: NetworkStats;
  docker: DockerStats | null;
  top_procs: TopProc[];
  uptime_seconds: number;
}

/** The newest snapshot for every locally/SSH-collected host. */
export interface HostsSnapshot {
  hosts: HostStats[];
  collected_at: string;
}

/** The subset a remote collector (SSH script or webhook) produces. */
export type RemoteStats = Omit<HostStats, "id" | "label" | "collected_at" | "collection_method">;

/**
 * One point in the rolling time series (the shape the charts consume).
 *
 * Every field is the raw instantaneous reading at `ts` — never an average or a
 * smoothed value. This is the "no averaging" contract from the plan.
 */
export interface SeriesPoint {
  /** ISO timestamp of the sample. */
  ts: string;
  cpu_pct: number;
  mem_pct: number;
  /** Absolute space taken on the fullest mount (not a percentage). */
  disk_used_bytes: number;
  disk_total_bytes: number;
  /** used/total for threshold colouring. */
  disk_pct: number;
  net_rx_bps: number;
  net_tx_bps: number;
  docker_cpu_pct: number | null;
  docker_mem_bytes: number | null;
  docker_mem_pct: number | null;
}

/** Payload returned by the `host-series` data feed and the `series-since` action. */
export interface HostSeries {
  hostId: string;
  windowMs: number;
  points: SeriesPoint[];
}

/** Downsampled arrays backing one host's dashboard-widget sparkline. */
export interface HostSparkline {
  id: string;
  cpu: number[];
  mem: number[];
  disk: number[];
}

export interface SparklinePayload {
  hosts: HostSparkline[];
}

/** The mount with the highest usage, i.e. the one closest to filling up. */
function fullestMount(mounts: DiskMount[]): DiskMount | null {
  let worst: DiskMount | null = null;
  for (const mount of mounts) {
    if (!worst || mount.usage_pct > worst.usage_pct) worst = mount;
  }
  return worst;
}

/** Reduce a full snapshot to a single raw series point. */
export function toSeriesPoint(stats: HostStats): SeriesPoint {
  const disk = fullestMount(stats.disk);
  const containers = stats.docker?.containers ?? [];
  let dockerCpu: number | null = null;
  let dockerMem: number | null = null;
  let dockerMemPct: number | null = null;
  if (containers.length) {
    dockerCpu = containers.reduce((sum, c) => sum + (c.cpu_percent || 0), 0);
    dockerMem = containers.reduce((sum, c) => sum + (c.mem_usage_bytes || 0), 0);
    const limit = containers.reduce((sum, c) => sum + (c.mem_limit_bytes || 0), 0);
    dockerMemPct = limit > 0 ? (dockerMem / limit) * 100 : null;
  }
  return {
    ts: stats.collected_at,
    cpu_pct: stats.cpu.usage_pct,
    mem_pct: stats.mem.usage_pct,
    disk_used_bytes: disk?.used_bytes ?? 0,
    disk_total_bytes: disk?.total_bytes ?? 0,
    disk_pct: disk?.usage_pct ?? 0,
    net_rx_bps: stats.network.total_rx_per_sec,
    net_tx_bps: stats.network.total_tx_per_sec,
    docker_cpu_pct: dockerCpu,
    docker_mem_bytes: dockerMem,
    docker_mem_pct: dockerMemPct,
  };
}

/** Stride-sample a series down to at most `maxPoints`, always keeping the newest point. */
export function downsample(points: SeriesPoint[], maxPoints: number): SeriesPoint[] {
  if (points.length <= maxPoints) return points;
  const stride = Math.ceil(points.length / maxPoints);
  const out: SeriesPoint[] = [];
  for (let i = 0; i < points.length; i += stride) out.push(points[i]!);
  const last = points[points.length - 1]!;
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

/** A zeroed metric block, used when a host is unreachable. */
export function emptyHostStats(
  id: string,
  label: string,
  collection_method: HostStats["collection_method"],
  error: string,
): HostStats {
  return {
    id,
    label,
    collected_at: new Date(0).toISOString(),
    collection_method,
    available: false,
    error,
    cpu: { usage_pct: 0, load1: 0, load5: 0, load15: 0, cores: 0, psi_cpu_some10: null },
    mem: {
      total_bytes: 0,
      used_bytes: 0,
      available_bytes: 0,
      usage_pct: 0,
      swap_total_bytes: 0,
      swap_used_bytes: 0,
      buffers_bytes: 0,
      cached_bytes: 0,
    },
    disk: [],
    network: { interfaces: [], total_rx_per_sec: 0, total_tx_per_sec: 0 },
    docker: null,
    top_procs: [],
    uptime_seconds: 0,
  };
}
