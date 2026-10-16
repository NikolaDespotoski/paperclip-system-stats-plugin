/**
 * One widget row: host label, throughput, and a line per headline metric.
 *
 * Kept free of SDK imports so it can be rendered standalone (React server
 * rendering) for visual checks without the Paperclip host.
 */
import type { ReactElement } from "react";
import type { Thresholds } from "../../config.js";
import { fullestMount, type HostSparkline, type HostStats } from "../../types.js";
import { bytesRatio, bytesToHuman, pct, rate } from "../lib/format.js";
import { TONE_COLOR, threshold, type Tone } from "../lib/threshold.js";
import { Sparkline } from "./Sparkline.js";

interface Metric {
  key: string;
  label: string;
  value: number;
  tone: Tone;
  series: number[] | undefined;
  warn: number;
  crit: number;
  /**
   * The absolute reading behind the percentage ("240/500 GB"), or `null`/absent
   * when the metric has no meaningful pair. Every column renders the same
   * number of rows so the sparklines stay aligned across a row.
   */
  detail?: string | null;
}

export function HostSparklineRow({
  host,
  spark,
  thresholds,
}: {
  host: HostStats;
  spark: HostSparkline | undefined;
  thresholds: Thresholds;
}): ReactElement {
  // The fullest mount is the one the percentage and the free-space readout
  // describe, so both halves of the Disk column agree.
  const disk = fullestMount(host.disk);
  const worstDisk = disk?.usage_pct ?? 0;
  const metrics: Metric[] = [
    {
      key: "cpu",
      label: "CPU",
      value: host.cpu.usage_pct,
      tone: threshold(host.cpu.usage_pct, thresholds.cpu_warn, thresholds.cpu_crit),
      series: spark?.cpu,
      warn: thresholds.cpu_warn,
      crit: thresholds.cpu_crit,
      // A percentage is the whole story for CPU; load is its absolute companion.
      detail: `load ${host.cpu.load1.toFixed(2)}`,
    },
    {
      key: "mem",
      label: "RAM",
      value: host.mem.usage_pct,
      tone: threshold(host.mem.usage_pct, thresholds.mem_warn, thresholds.mem_crit),
      series: spark?.mem,
      warn: thresholds.mem_warn,
      crit: thresholds.mem_crit,
      detail: bytesRatio(host.mem.used_bytes, host.mem.total_bytes),
    },
    {
      key: "disk",
      label: "Disk",
      value: worstDisk,
      tone: threshold(worstDisk, thresholds.disk_warn, thresholds.disk_crit),
      series: spark?.disk,
      warn: thresholds.disk_warn,
      crit: thresholds.disk_crit,
      // Free space runs out, so it is the number worth showing; the percentage
      // above it already says how full that same mount is.
      detail: disk ? `${bytesToHuman(disk.available_bytes)} free` : null,
    },
  ];

  return (
    <div style={{ display: "grid", gap: 4, opacity: host.available ? 1 : 0.55 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 12 }}>
        <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{host.label}</span>
        {!host.available && <span style={{ opacity: 0.7, fontSize: 11 }}>{host.error ?? "unreachable"}</span>}
        <span style={{ marginLeft: "auto", opacity: 0.6, fontSize: 11, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
          {host.available ? `↓${rate(host.network.total_rx_per_sec)} ↑${rate(host.network.total_tx_per_sec)}` : ""}
        </span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
        {metrics.map((metric) => (
          <div key={metric.key} style={{ display: "grid", gap: 2, minWidth: 0 }}>
            <span style={{ fontSize: 11, whiteSpace: "nowrap" }}>
              {metric.label}{" "}
              {/* An unreachable host reports zeroed metrics; "0%" in green would
                  read as healthy, so show a dash and skip the line instead. */}
              {host.available ? (
                <b style={{ color: TONE_COLOR[metric.tone] }}>{pct(metric.value)}</b>
              ) : (
                <b style={{ opacity: 0.5 }}>—</b>
              )}
            </span>
            {host.available && metric.detail && (
              <span
                title={metric.detail}
                style={{
                  fontSize: 10,
                  opacity: 0.65,
                  fontVariantNumeric: "tabular-nums",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {metric.detail}
              </span>
            )}
            {host.available && <Sparkline values={metric.series ?? []} height={24} warn={metric.warn} crit={metric.crit} />}
          </div>
        ))}
      </div>
    </div>
  );
}
