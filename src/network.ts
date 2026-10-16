/** `/proc/net/dev` parsing and per-interface rate derivation. */
import { round } from "./format.js";

export interface NetCounter {
  rxBytes: number;
  rxPackets: number;
  rxErrors: number;
  txBytes: number;
  txPackets: number;
  txErrors: number;
}

export interface NetworkOptions {
  includeLoopback?: boolean;
  includeDockerBridge?: boolean;
}

function isExcluded(name: string, options: NetworkOptions): boolean {
  if (name === "lo" && !options.includeLoopback) return true;
  if (!options.includeDockerBridge && /^(docker|br-|veth)/.test(name)) return true;
  return false;
}

/** Parse `/proc/net/dev` into per-interface cumulative counters. */
export function parseNetDev(text: string | null): Record<string, NetCounter> {
  const result: Record<string, NetCounter> = {};
  if (!text) return result;
  for (const line of text.split("\n")) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const name = line.slice(0, colon).trim();
    if (!name) continue;
    const fields = line.slice(colon + 1).trim().split(/\s+/).map((v) => Number.parseInt(v, 10));
    if (fields.length < 16 || fields.some((v) => Number.isNaN(v))) continue;
    result[name] = {
      rxBytes: fields[0],
      rxPackets: fields[1],
      rxErrors: fields[2],
      txBytes: fields[8],
      txPackets: fields[9],
      txErrors: fields[10],
    };
  }
  return result;
}

export interface InterfaceMeta {
  state: "up" | "down";
  speedMbps: number | null;
}

export function readInterfaceMeta(platform: { readText(path: string): string | null }, name: string): InterfaceMeta {
  const operstate = platform.readText(`/sys/class/net/${name}/operstate`);
  const speedText = platform.readText(`/sys/class/net/${name}/speed`);
  const speed = speedText == null ? Number.NaN : Number.parseFloat(speedText);
  return {
    state: operstate?.trim() === "up" ? "up" : "down",
    speedMbps: Number.isFinite(speed) && speed > 0 ? speed : null,
  };
}

export interface DerivedNetwork {
  interfaces: Array<{
    name: string;
    rx_bytes_per_sec: number;
    tx_bytes_per_sec: number;
    rx_packets_per_sec: number;
    tx_packets_per_sec: number;
    rx_errors: number;
    tx_errors: number;
    state: "up" | "down";
    speed_mbps: number | null;
  }>;
  total_rx_per_sec: number;
  total_tx_per_sec: number;
}

/**
 * Turn two cumulative samples into per-second rates. `dtMs` is the wall-clock
 * gap between the two samples; a non-positive gap yields zero rates rather than
 * a divide-by-zero.
 */
export function deriveNetwork(
  previous: Record<string, NetCounter>,
  next: Record<string, NetCounter>,
  dtMs: number,
  platform: { readText(path: string): string | null },
  options: NetworkOptions = {},
): DerivedNetwork {
  const dt = dtMs > 0 ? dtMs / 1000 : 0;
  const interfaces: DerivedNetwork["interfaces"] = [];
  let totalRx = 0;
  let totalTx = 0;
  for (const [name, cur] of Object.entries(next)) {
    if (isExcluded(name, options)) continue;
    const prev = previous[name] ?? { rxBytes: 0, rxPackets: 0, rxErrors: 0, txBytes: 0, txPackets: 0, txErrors: 0 };
    const delta = (a: number, b: number) => (dt > 0 ? Math.max(0, a - b) / dt : 0);
    const meta = readInterfaceMeta(platform, name);
    const rx = delta(cur.rxBytes, prev.rxBytes);
    const tx = delta(cur.txBytes, prev.txBytes);
    totalRx += rx;
    totalTx += tx;
    interfaces.push({
      name,
      rx_bytes_per_sec: round(rx),
      tx_bytes_per_sec: round(tx),
      rx_packets_per_sec: round(delta(cur.rxPackets, prev.rxPackets)),
      tx_packets_per_sec: round(delta(cur.txPackets, prev.txPackets)),
      rx_errors: cur.rxErrors - prev.rxErrors,
      tx_errors: cur.txErrors - prev.txErrors,
      state: meta.state,
      speed_mbps: meta.speedMbps,
    });
  }
  return {
    interfaces,
    total_rx_per_sec: round(totalRx),
    total_tx_per_sec: round(totalTx),
  };
}
