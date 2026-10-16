import { MetricCard, Spinner, useHostNavigation, usePluginData, type PluginWidgetProps } from "@paperclipai/plugin-sdk/ui";
import { useMemo, type ReactElement } from "react";
import type { HostStats, HostsSnapshot } from "../types.js";
import { pct, rate } from "./lib/format.js";

const ROUTE = "/system-stats";

export function SystemStatsWidget({ context: _context }: PluginWidgetProps): ReactElement {
  const nav = useHostNavigation();
  const { data, loading, error } = usePluginData<HostsSnapshot>("host-stats", {});

  const summary = useMemo(() => {
    const hosts = (data?.hosts ?? []).filter((h) => h.available);
    if (!hosts.length) return null;
    const avg = (pick: (h: HostStats) => number) => hosts.reduce((sum, h) => sum + pick(h), 0) / hosts.length;
    const worstDisk = Math.max(0, ...hosts.flatMap((h) => h.disk.map((d) => d.usage_pct)));
    const netRx = hosts.reduce((sum, h) => sum + h.network.total_rx_per_sec, 0);
    const netTx = hosts.reduce((sum, h) => sum + h.network.total_tx_per_sec, 0);
    const docker = hosts.reduce((sum, h) => sum + (h.docker?.running_count ?? 0), 0);
    return { cpu: avg((h) => h.cpu.usage_pct), mem: avg((h) => h.mem.usage_pct), worstDisk, netRx, netTx, docker, hosts: hosts.length };
  }, [data]);

  if (loading && !data) return <Spinner label="Loading host health" />;
  if (error) return <div>Error: {error.message}</div>;
  if (!summary) return <div>No host stats yet.</div>;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <strong>Host health</strong>
        <a {...nav.linkProps(ROUTE)}>Open</a>
      </div>
      <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))" }}>
        <MetricCard label="CPU avg" value={pct(summary.cpu)} />
        <MetricCard label="RAM avg" value={pct(summary.mem)} />
        <MetricCard label="Worst disk" value={pct(summary.worstDisk)} />
        <MetricCard label="Net RX" value={rate(summary.netRx)} />
        <MetricCard label="Net TX" value={rate(summary.netTx)} />
        <MetricCard label="Docker" value={summary.docker} />
      </div>
      <span style={{ opacity: 0.7, fontSize: 12 }}>
        {summary.hosts} host{summary.hosts === 1 ? "" : "s"}
      </span>
    </div>
  );
}
