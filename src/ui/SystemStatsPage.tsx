import { KeyValueList, Spinner, usePluginAction, usePluginData, type PluginPageProps } from "@paperclipai/plugin-sdk/ui";
import { useMemo, useState, type ReactNode } from "react";
import type { Thresholds } from "../config.js";
import type { HostsSnapshot } from "../types.js";
import { CpuCard } from "./components/CpuCard.js";
import { DiskTable } from "./components/DiskTable.js";
import { DockerCard } from "./components/DockerCard.js";
import { HostTabs } from "./components/HostTabs.js";
import { LiveIndicator } from "./components/LiveIndicator.js";
import { MemCard } from "./components/MemCard.js";
import { NetworkCard } from "./components/NetworkCard.js";
import { TopProcsTable } from "./components/TopProcsTable.js";
import { age, uptime } from "./lib/format.js";
import { useLiveSeries } from "./lib/useLiveSeries.js";
import { usePolling } from "./lib/usePolling.js";

type HostStatsResponse = HostsSnapshot & {
  thresholds: Thresholds;
  sample_interval_seconds?: number;
  history_window_seconds?: number;
  ui_refresh_seconds?: number;
  sampled_at?: string;
};

const DEFAULT_WINDOW_SECONDS = 1800;
const DEFAULT_REFRESH_SECONDS = 2;

/** Stable params object: a fresh `{}` each render could re-trigger the fetch. */
const NO_PARAMS: Record<string, never> = {};

export function SystemStatsPage({ context: _context }: PluginPageProps): ReactNode {
  const refresh = usePluginAction("refresh");
  const [selected, setSelected] = useState<string | null>(null);
  const { data, loading, error, refresh: reload } = usePluginData<HostStatsResponse>("host-stats", NO_PARAMS);

  const refreshSeconds = data?.ui_refresh_seconds ?? DEFAULT_REFRESH_SECONDS;
  const windowMs = (data?.history_window_seconds ?? DEFAULT_WINDOW_SECONDS) * 1000;

  // Headline numbers + tables: refetch the newest snapshot on the configured cadence.
  usePolling(reload, refreshSeconds);

  const hosts = useMemo(() => data?.hosts ?? [], [data]);
  const host = useMemo(
    () => hosts.find((h) => h.id === selected) ?? hosts[0] ?? null,
    [hosts, selected],
  );

  // Charts follow the selected host and append raw points every refresh tick.
  const { points: series, error: seriesError } = useLiveSeries(host?.id ?? null, windowMs, refreshSeconds);

  if (loading && !data) return <Spinner label="Loading host stats" />;
  if (error) return <div style={{ padding: 16 }}>Error: {error.message}</div>;
  if (!data) return null;
  if (!hosts.length) return <div style={{ padding: 16 }}>No hosts configured.</div>;

  const thresholds = data.thresholds;

  return (
    <div style={{ display: "grid", gap: 16, padding: 16 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: 20 }}>System</h1>
        <LiveIndicator collectedAt={data.collected_at} error={host?.error ?? null} />
        <span style={{ opacity: 0.7, fontSize: 12 }}>
          {series.length} point{series.length === 1 ? "" : "s"} / last {Math.round(windowMs / 60000)}m · sampled{" "}
          {age(data.sampled_at ?? data.collected_at)}
        </span>
        <button type="button" onClick={() => void refresh({}).catch(() => undefined)} style={{ marginLeft: "auto" }}>
          Refresh
        </button>
      </div>

      {seriesError && (
        <div style={{ fontSize: 12, color: "#f59e0b" }}>Live series degraded: {seriesError}</div>
      )}

      <HostTabs hosts={hosts} selected={host?.id ?? ""} onSelect={setSelected} />

      {host && (
        <>
          <div>
            <KeyValueList
              pairs={[
                { label: "Host", value: `${host.label} (${host.id})` },
                { label: "Collected", value: host.collection_method },
                { label: "Uptime", value: uptime(host.uptime_seconds) },
              ]}
            />
          </div>
          {!host.available && (
            <div style={{ padding: 12, borderRadius: 8, background: "rgba(239, 68, 68, 0.12)", color: "#ef4444" }}>
              {host.error ?? "This host is unavailable."}
            </div>
          )}
          <CpuCard host={host} thresholds={thresholds} series={series} />
          <MemCard host={host} thresholds={thresholds} series={series} />
          <DiskTable mounts={host.disk} thresholds={thresholds} series={series} />
          <NetworkCard network={host.network} thresholds={thresholds} series={series} />
          <DockerCard docker={host.docker} thresholds={thresholds} series={series} />
          <TopProcsTable procs={host.top_procs} />
        </>
      )}
    </div>
  );
}
