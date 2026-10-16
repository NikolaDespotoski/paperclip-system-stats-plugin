/** UI-only formatting helpers (kept out of the worker bundle). */

const UNITS = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];

export function round(value: number, digits = 1): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function bytesToHuman(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return bytes == null ? "—" : "0 B";
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${round(value, value < 10 ? 1 : 0)} ${UNITS[unit]}`;
}

export function rate(bytesPerSec: number | null | undefined): string {
  return `${bytesToHuman(bytesPerSec)}/s`;
}

export function pct(value: number | null | undefined, digits = 0): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${round(value, digits)}%`;
}

export function loadPerCore(host: { cpu: { load1: number; cores: number } }): string {
  const cores = host.cpu.cores > 0 ? host.cpu.cores : 1;
  return (host.cpu.load1 / cores).toFixed(2);
}

export function uptime(seconds: number | null | undefined): string {
  if (seconds == null || seconds <= 0) return "—";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/** "12s ago", "3m ago", "2h ago" for the live indicator. */
export function age(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return "—";
  const seconds = Math.max(0, Math.round((now - parsed) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
