/** Small formatting helpers shared by the worker and the UI. */

export function round(value: number, digits = 1): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

const UNITS = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];

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

export function rateToHuman(bytesPerSec: number | null | undefined): string {
  return `${bytesToHuman(bytesPerSec)}/s`;
}

export function pct(value: number | null | undefined, digits = 0): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${round(value, digits)}%`;
}

/**
 * Parse a human byte size such as `1.2GB`, `500MB`, `1.5GiB`, `1024`, `0B`.
 * Returns `NaN` when the text is not a size.
 */
export function sizeToBytes(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return Number.NaN;
  const match = /^([\d.]+)\s*([a-zA-Z]*)$/.exec(trimmed);
  if (!match) return Number.NaN;
  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value)) return Number.NaN;
  const unit = match[2].toLowerCase();
  const powers: Record<string, number> = {
    "": 0,
    b: 0,
    k: 1,
    kb: 1,
    kib: 1,
    m: 2,
    mb: 2,
    mib: 2,
    g: 3,
    gb: 3,
    gib: 3,
    t: 4,
    tb: 4,
    tib: 4,
    p: 5,
    pb: 5,
    pib: 5,
  };
  const power = powers[unit];
  if (power === undefined) return Number.NaN;
  return value * 1024 ** power;
}

/** Strip a trailing `%` and parse a float. Returns `NaN` when not a number. */
export function parsePercent(text: string | null | undefined): number {
  if (text == null) return Number.NaN;
  const value = Number.parseFloat(text.replace("%", "").trim());
  return Number.isFinite(value) ? value : Number.NaN;
}
