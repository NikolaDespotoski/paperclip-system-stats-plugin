import { Spinner, useHostNavigation, usePluginData, type PluginWidgetProps } from "@paperclipai/plugin-sdk/ui";
import { useMemo, type ReactElement } from "react";
import type { Thresholds } from "../config.js";
import type { HostSparkline, HostsSnapshot, SparklinePayload } from "../types.js";
import { HostSparklineRow } from "./components/HostSparklineRow.js";
import { rate } from "./lib/format.js";
import { usePolling } from "./lib/usePolling.js";

const ROUTE = "/system-stats";
const MAX_HOST_ROWS = 3;
const DEFAULT_REFRESH_SECONDS = 2;

/** Stable params object: a fresh `{}` each render could re-trigger the fetch. */
const NO_PARAMS: Record<string, never> = {};

type WidgetResponse = HostsSnapshot & { thresholds?: Thresholds; ui_refresh_seconds?: number };

export function SystemStatsWidget({ context: _context }: PluginWidgetProps): ReactElement {
  const nav = useHostNavigation();
  const stats = usePluginData<WidgetResponse>("host-stats", NO_PARAMS);
  const sparks = usePluginData<SparklinePayload>("host-sparklines", NO_PARAMS);

  const { data, loading, error } = stats;
  const refreshSeconds = data?.ui_refresh_seconds ?? DEFAULT_REFRESH_SECONDS;

  // Without this the widget fetches once and freezes at first paint.
  usePolling(() => {
    stats.refresh();
    sparks.refresh();
  }, refreshSeconds);

  const sparkById = useMemo(() => {
    const map = new Map<string, HostSparkline>();
    for (const host of sparks.data?.hosts ?? []) map.set(host.id, host);
    return map;
  }, [sparks.data]);

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
        <HostSparklineRow key={host.id} host={host} spark={sparkById.get(host.id)} thresholds={thresholds} />
      ))}
      <span style={{ opacity: 0.7, fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
        {hosts.length} host{hosts.length === 1 ? "" : "s"} · {rate(totals.rx)} in · {rate(totals.tx)} out
        {docker > 0 ? ` · ${docker} container${docker === 1 ? "" : "s"}` : ""}
      </span>
    </div>
  );
}
