/**
 * Local host collection. Everything reads Linux `/proc` (plus `df`, `ps` and
 * `docker`), so the plugin runs on the Paperclip host or on an SSH target.
 * Each parser is exported so it can be unit tested with fixture text.
 */
import { readDocker, type DockerOptions } from "./docker.js";
import { round } from "./format.js";
import { deriveNetwork, parseNetDev, type NetCounter } from "./network.js";
import type { Platform } from "./platform.js";
import {
  emptyHostStats,
  type CpuStats,
  type DiskMount,
  type HostStats,
  type MemStats,
  type TopProc,
} from "./types.js";

export interface Meminfo {
  memTotal: number;
  memFree: number;
  memAvailable: number;
  buffers: number;
  cached: number;
  swapTotal: number;
  swapFree: number;
}

export interface CounterSample {
  at: number;
  cpu: { total: number; idle: number };
  cores: number;
  mem: Meminfo;
  load: { load1: number; load5: number; load15: number };
  uptime: number;
  psiCpuSome10: number | null;
  net: Record<string, NetCounter>;
}

export interface SlowSample {
  disk: DiskMount[];
  topProcs: TopProc[];
  docker: HostStats["docker"];
}

export interface CollectOptions {
  id: string;
  label: string;
  sampleMs?: number;
  includeLoopback?: boolean;
  includeDockerBridge?: boolean;
  docker?: DockerOptions;
}

// ---- /proc parsers ----

export function parseProcStat(text: string | null): { total: number; idle: number; cores: number } {
  let total = 0;
  let idle = 0;
  let cores = 0;
  if (!text) return { total, idle, cores };
  for (const line of text.split("\n")) {
    if (!line.startsWith("cpu")) continue;
    const fields = line.trim().split(/\s+/);
    const isAggregate = fields[0] === "cpu";
    if (!isAggregate) {
      if (/^cpu\d+$/.test(fields[0])) cores += 1;
      continue;
    }
    const numbers = fields.slice(1).map((v) => Number.parseInt(v, 10)).filter((v) => !Number.isNaN(v));
    total = numbers.reduce((sum, v) => sum + v, 0);
    // idle is field 4 (index 0) and iowait is field 5 (index 1) after the name.
    idle = (numbers[3] ?? 0) + (numbers[4] ?? 0);
  }
  return { total, idle, cores };
}

export function parseMeminfo(text: string | null): Meminfo {
  const kb = new Map<string, number>();
  if (text) {
    for (const line of text.split("\n")) {
      const match = /^(\w+):\s+(\d+)\s*kB/.exec(line);
      if (match) kb.set(match[1], Number.parseInt(match[2], 10));
    }
  }
  const get = (key: string) => (kb.get(key) ?? 0) * 1024;
  return {
    memTotal: get("MemTotal"),
    memFree: get("MemFree"),
    memAvailable: get("MemAvailable"),
    buffers: get("Buffers"),
    cached: get("Cached"),
    swapTotal: get("SwapTotal"),
    swapFree: get("SwapFree"),
  };
}

export function parseLoadavg(text: string | null): CounterSample["load"] {
  const fields = (text ?? "").trim().split(/\s+/);
  const num = (i: number) => Number.parseFloat(fields[i] ?? "") || 0;
  return { load1: num(0), load5: num(1), load15: num(2) };
}

export function parseUptime(text: string | null): number {
  const first = (text ?? "").trim().split(/\s+/)[0];
  return first ? Number.parseFloat(first) || 0 : 0;
}

export function parsePressureCpu(text: string | null): number | null {
  if (!text) return null;
  const line = text.split("\n").find((l) => l.startsWith("some"));
  if (!line) return null;
  const match = /avg10=([\d.]+)/.exec(line);
  return match ? Number.parseFloat(match[1]) : null;
}

export function readCounterSample(platform: Platform): CounterSample | null {
  const stat = platform.readText("/proc/stat");
  if (stat == null) return null;
  const cpu = parseProcStat(stat);
  return {
    at: platform.now(),
    cpu: { total: cpu.total, idle: cpu.idle },
    cores: cpu.cores,
    mem: parseMeminfo(platform.readText("/proc/meminfo")),
    load: parseLoadavg(platform.readText("/proc/loadavg")),
    uptime: parseUptime(platform.readText("/proc/uptime")),
    psiCpuSome10: parsePressureCpu(platform.readText("/proc/pressure/cpu")),
    net: parseNetDev(platform.readText("/proc/net/dev")),
  };
}

// ---- disk ----

/**
 * Sources `df` reports for kernel plumbing rather than real storage. They are
 * either zero-sized or permanently 100% full, so counting them as disks makes a
 * healthy host look full — and would report its free space as `0 B`. macOS
 * `devfs` (mounted on `/dev`) and its `map` entries are the usual offenders,
 * alongside Linux `tmpfs`.
 */
const VIRTUAL_SOURCES = new Set([
  "devfs", "none", "tmpfs", "devtmpfs", "shm", "ramfs", "sysfs", "proc",
  "cgroup", "cgroup2", "autofs", "udev", "efivarfs", "nsfs", "tracefs",
  "debugfs", "pstore", "bpf", "securityfs", "configfs", "fusectl", "mqueue",
  "hugetlbfs", "binfmt_misc", "sunrpc", "rpc_pipefs", "nfsd",
]);

/**
 * Read-only images — a snap's `/dev/loopN`, an AppImage — carry a real-looking
 * device name but are always 100% used, so they are excluded by mount point.
 */
function isVirtualMount(source: string, mount: string): boolean {
  if (VIRTUAL_SOURCES.has(source)) return true;
  if (source === "map" || source.startsWith("map ")) return true;
  return mount === "/snap" || mount.startsWith("/snap/");
}

/** One `df` row of 1024-byte blocks, or `null` when it is not a real disk. */
function toMount(source: string, mount: string, blocks: string, used: string, avail: string, pcent: string): DiskMount | null {
  if (!mount || isVirtualMount(source, mount)) return null;
  const totalBlocks = Number.parseInt(blocks, 10);
  const usedBlocks = Number.parseInt(used, 10);
  const availBlocks = Number.parseInt(avail, 10);
  if ([totalBlocks, usedBlocks, availBlocks].some((v) => Number.isNaN(v))) return null;
  const totalBytes = totalBlocks * 1024;
  // A zero-block mount has no free space to report; it is not a disk.
  if (totalBytes <= 0) return null;
  const usage = Number.parseFloat(pcent.replace("%", ""));
  return {
    mount,
    total_bytes: totalBytes,
    used_bytes: usedBlocks * 1024,
    available_bytes: availBlocks * 1024,
    usage_pct: Number.isFinite(usage) ? usage : round((usedBlocks / totalBlocks) * 100),
  };
}

/** GNU `df -k --output=...`: source size used avail pcent target. */
export function parseDfOutput(text: string | null): DiskMount[] {
  if (!text) return [];
  const rows: DiskMount[] = [];
  for (const line of text.split("\n").slice(1)) {
    const tokens = line.trim().split(/\s+/);
    if (tokens.length < 6) continue;
    const [source, size, used, avail, pcent, ...rest] = tokens;
    const row = toMount(source, rest.join(" "), size, used, avail, pcent);
    if (row) rows.push(row);
  }
  return rows;
}

/** BSD `df -kP`: source blocks used avail pcent target. */
export function parseDfPosix(text: string | null): DiskMount[] {
  if (!text) return [];
  const rows: DiskMount[] = [];
  for (const line of text.split("\n").slice(1)) {
    const tokens = line.trim().split(/\s+/);
    if (tokens.length < 6) continue;
    const [source, blocks, used, avail, pcent, ...rest] = tokens;
    const mount = rest.join(" ");
    if (mount === "on") continue; // tail of the "Mounted on" header
    const row = toMount(source, mount, blocks, used, avail, pcent);
    if (row) rows.push(row);
  }
  return rows;
}

export function readDiskMounts(platform: Platform): DiskMount[] {
  const modern = platform.exec("df -k --output=source,size,used,avail,pcent,target");
  if (modern != null) return parseDfOutput(modern);
  return parseDfPosix(platform.exec("df -kP"));
}

// ---- top processes ----

export function parseTopProcs(text: string | null): TopProc[] {
  if (!text) return [];
  const rows: TopProc[] = [];
  for (const line of text.split("\n")) {
    const tokens = line.trim().split(/\s+/);
    if (tokens.length < 4) continue;
    const pid = Number.parseInt(tokens[0], 10);
    const cpu = Number.parseFloat(tokens[1]);
    const mem = Number.parseFloat(tokens[2]);
    if (Number.isNaN(pid) || Number.isNaN(cpu) || Number.isNaN(mem)) continue;
    rows.push({ pid, cpu_pct: cpu, mem_pct: mem, command: tokens[3] });
  }
  return rows.slice(0, 6);
}

export function readTopProcs(platform: Platform): TopProc[] {
  const text = platform.exec("ps -eo pid,pcpu,pmem,comm --sort=-pcpu --no-headers | head -6");
  return parseTopProcs(text);
}

// ---- assembly ----

export function readSlowSample(platform: Platform, docker: DockerOptions = {}): SlowSample {
  return {
    disk: readDiskMounts(platform),
    topProcs: readTopProcs(platform),
    docker: readDocker(platform, docker),
  };
}

function cpuFromSamples(first: CounterSample, second: CounterSample): number {
  const totalDelta = second.cpu.total - first.cpu.total;
  const idleDelta = second.cpu.idle - first.cpu.idle;
  if (totalDelta <= 0) return 0;
  return round(Math.min(100, Math.max(0, (1 - idleDelta / totalDelta) * 100)));
}

function memFromSample(mem: Meminfo): MemStats {
  const used = Math.max(0, mem.memTotal - mem.memAvailable);
  return {
    total_bytes: mem.memTotal,
    used_bytes: used,
    available_bytes: mem.memAvailable,
    usage_pct: mem.memTotal > 0 ? round((used / mem.memTotal) * 100) : 0,
    swap_total_bytes: mem.swapTotal,
    swap_used_bytes: Math.max(0, mem.swapTotal - mem.swapFree),
    buffers_bytes: mem.buffers,
    cached_bytes: mem.cached,
  };
}

function cpuStatsFromSample(second: CounterSample): CpuStats {
  return {
    usage_pct: 0,
    load1: second.load.load1,
    load5: second.load.load5,
    load15: second.load.load15,
    cores: second.cores,
    psi_cpu_some10: second.psiCpuSome10,
  };
}

export async function collectLocal(platform: Platform, options: CollectOptions): Promise<HostStats> {
  const first = readCounterSample(platform);
  if (!first) {
    return emptyHostStats(options.id, options.label, "local", "No /proc filesystem (not a Linux host?)");
  }
  await platform.sleep(options.sampleMs ?? 200);
  const second = readCounterSample(platform);
  if (!second) {
    return emptyHostStats(options.id, options.label, "local", "/proc became unreadable mid-sample");
  }
  const slow = readSlowSample(platform, options.docker ?? {});

  const cpu: CpuStats = { ...cpuStatsFromSample(second), usage_pct: cpuFromSamples(first, second) };
  return {
    id: options.id,
    label: options.label,
    collected_at: new Date(second.at).toISOString(),
    collection_method: "local",
    available: true,
    error: null,
    cpu,
    mem: memFromSample(second.mem),
    disk: slow.disk,
    network: deriveNetwork(first.net, second.net, second.at - first.at, platform, {
      includeLoopback: options.includeLoopback,
      includeDockerBridge: options.includeDockerBridge,
    }),
    docker: slow.docker,
    top_procs: slow.topProcs,
    uptime_seconds: Math.round(second.uptime),
  };
}
