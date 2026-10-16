import { Spinner, useHostNavigation, usePluginData, type PluginWidgetProps } from "@paperclipai/plugin-sdk/ui";
import { useMemo, type ReactElement } from "react";
import type { Thresholds } from "../config.js";
import type { HostSparkline, HostStats, HostsSnapshot, SparklinePayload } from "../types.js";
import { Sparkline } from "./components/Sparkline.js";
import { pct, rate } from "./lib/format.js";
import { TONE_COLOR, threshold } from "./lib/threshold.js";

const ROUTE = "/system-stats";
const MAX_HOST_ROWS = 3;

type WidgetResponse = HostsSnapshot & { thresholds?: Thresholds };

/** One compact block: host label, live percentages, throughput, CPU line. */
function HostRow({
  host,
  spark,
  thresholds,
}: {
  host: HostStats;
  spark: HostSparkline | undefined;
  thresholds: Thresholds;
}): ReactElement {
  const worstDisk = Math.max(0, ...host.disk.map((mount) => mount.usage_pct));
  const stats: Array<{ label: string; value: string; tone: ReturnType<typeof threshold> }> = [
    { label: "CPU", value: pct(host.cpu.usage_pct), tone: threshold(host.cpu.usage_pct, thresholds.cpu_warn, thresholds.cpu_crit) },
    { label: "RAM", value: pct(host.mem.usage_pct), tone: threshold(host.mem.usage_pct, thresholds.mem_warn, thresholds.mem_crit) },
    { label: "Disk", value: pct(worstDisk), tone: threshold(worstDisk, thresholds.disk_warn, thresholds.disk_crit) },
  ];

  return (
    <div style={{ display: "grid", gap: 2, opacity: host.available ? 1 : 0.55 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 12 }}>
        <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{host.label}</span>
        <span style={{ fontVariantNumeric: "tabular-nums" }}>
          {stats.map((stat) => (
            <span key={stat.label} style={{ marginRight: 8 }}>
              {stat.label} <b style={{ color: TONE_COLOR[stat.tone] }}>{stat.value}</b>
            </span>
          ))}
        </span>
        <span style={{ marginLeft: "auto", opacity: 0.6, fontSize: 11, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
          {host.available ? `↓${rate(host.network.total_rx_per_sec)} ↑${rate(host.network.total_tx_per_sec)}` : (host.error ?? "unreachable")}
        </span>
      </div>
      <Sparkline
        values={spark?.cpu ?? []}
        height={26}
        warn={thresholds.cpu_warn}
        crit={thresholds.cpu_crit}
      />
    </div>
  );
}

export function SystemStatsWidget({ context: _context }: PluginWidgetProps): ReactElement {
  const nav = useHostNavigation();
  const { data, loading, error } = usePluginData<WidgetResponse>("host-stats", {});
  const { data: sparks } = usePluginData<SparklinePayload>("host-sparklines", {});

  const sparkById = useMemo(() => {
    const map = new Map<string, HostSparkline>();
    for (const host of sparks?.hosts ?? []) map.set(host.id, host);
    return map;
  }, [sparks]);

  const hosts = useMemo(() => data?.hosts ?? [], [data]);
  const thresholds = data?.thresholds;

  if (loading && !data) return <Spinner label="Loading host health" />;
  if (error) return <div>Error: {error.message}</div>;
  if (!hosts.length || !thresholds) return <div>No host stats yet.</div>;

  const docker = hosts.reduce((sum, host) => sum + (host.docker?.running_count ?? 0), 0);
  const totals = hosts.reduce(
    (acc, host) => {
      acc.rx += host.network.total_rx_per_sec;
      acc.tx += host.network.total_tx_per_sec;
      return acc;
    },
    { rx: 0, tx: 0 },
  );

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <strong>Host health</strong>
        <a {...nav.linkProps(ROUTE)}>Open</a>
      </div>
      {hosts.slice(0, MAX_HOST_ROWS).map((host) => (
        <HostRow key={host.id} host={host} spark={sparkById.get(host.id)} thresholds={thresholds} />
      ))}
      <span style={{ opacity: 0.7, fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
        {hosts.length} host{hosts.length === 1 ? "" : "s"} · {rate(totals.rx)} in · {rate(totals.tx)} out
        {docker > 0 ? ` · ${docker} container${docker === 1 ? "" : "s"}` : ""}
      </span>
    </div>
  );
}
