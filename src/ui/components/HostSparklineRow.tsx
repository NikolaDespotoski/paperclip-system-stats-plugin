/**
 * One widget row: host label, throughput, and a line per headline metric.
 *
 * Kept free of SDK imports so it can be rendered standalone (React server
 * rendering) for visual checks without the Paperclip host.
 */
import type { ReactElement } from "react";
import type { Thresholds } from "../../config.js";
import type { HostSparkline, HostStats } from "../../types.js";
import { pct, rate } from "../lib/format.js";
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
  const worstDisk = Math.max(0, ...host.disk.map((mount) => mount.usage_pct));
  const metrics: Metric[] = [
    {
      key: "cpu",
      label: "CPU",
      value: host.cpu.usage_pct,
      tone: threshold(host.cpu.usage_pct, thresholds.cpu_warn, thresholds.cpu_crit),
      series: spark?.cpu,
      warn: thresholds.cpu_warn,
      crit: thresholds.cpu_crit,
    },
    {
      key: "mem",
      label: "RAM",
      value: host.mem.usage_pct,
      tone: threshold(host.mem.usage_pct, thresholds.mem_warn, thresholds.mem_crit),
      series: spark?.mem,
      warn: thresholds.mem_warn,
      crit: thresholds.mem_crit,
    },
    {
      key: "disk",
      label: "Disk",
      value: worstDisk,
      tone: threshold(worstDisk, thresholds.disk_warn, thresholds.disk_crit),
      series: spark?.disk,
      warn: thresholds.disk_warn,
      crit: thresholds.disk_crit,
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
            {host.available && <Sparkline values={metric.series ?? []} height={24} warn={metric.warn} crit={metric.crit} />}
          </div>
        ))}
      </div>
    </div>
  );
}
