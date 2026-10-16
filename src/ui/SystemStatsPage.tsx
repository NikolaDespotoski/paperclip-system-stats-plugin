import { KeyValueList, Spinner, usePluginAction, usePluginData, type PluginPageProps } from "@paperclipai/plugin-sdk/ui";
import { useEffect, useMemo, useState, type ReactNode } from "react";
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
import { uptime } from "./lib/format.js";

type HostStatsResponse = HostsSnapshot & { thresholds: Thresholds };

const POLL_MS = 15_000;

function usePolling(refresh: () => void) {
  useEffect(() => {
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);
}

export function SystemStatsPage({ context: _context }: PluginPageProps): ReactNode {
  const refresh = usePluginAction("refresh");
  const [selected, setSelected] = useState<string | null>(null);
  const { data, loading, error, refresh: reload } = usePluginData<HostStatsResponse>("host-stats", {});
  usePolling(reload);

  const hosts = useMemo(() => data?.hosts ?? [], [data]);
  const host = useMemo(
    () => hosts.find((h) => h.id === selected) ?? hosts[0] ?? null,
    [hosts, selected],
  );

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
        <button type="button" onClick={() => void refresh({}).catch(() => undefined)} style={{ marginLeft: "auto" }}>
          Refresh
        </button>
      </div>

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
          <CpuCard host={host} thresholds={thresholds} />
          <MemCard host={host} thresholds={thresholds} />
          <DiskTable mounts={host.disk} thresholds={thresholds} />
          <NetworkCard network={host.network} thresholds={thresholds} />
          <DockerCard docker={host.docker} thresholds={thresholds} />
          <TopProcsTable procs={host.top_procs} />
        </>
      )}
    </div>
  );
}
