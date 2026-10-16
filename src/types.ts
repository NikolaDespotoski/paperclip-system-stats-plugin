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
