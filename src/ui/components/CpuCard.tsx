import { KeyValueList } from "@paperclipai/plugin-sdk/ui";
import type { Thresholds } from "../../config.js";
import type { HostStats } from "../../types.js";
import { pct, round } from "../lib/format.js";
import { Stat, card, grid } from "../lib/stat.js";
import { loadTone, threshold } from "../lib/threshold.js";

export function CpuCard({ host, thresholds }: { host: HostStats; thresholds: Thresholds }) {
  return (
    <section style={card} aria-label="CPU">
      <h3 style={{ margin: 0, fontSize: 15 }}>CPU</h3>
      <div style={grid}>
        <Stat label="Usage" value={pct(host.cpu.usage_pct)} tone={threshold(host.cpu.usage_pct, thresholds.cpu_warn, thresholds.cpu_crit)} />
        <Stat label="Load 1m / core" value={(host.cpu.load1 / Math.max(1, host.cpu.cores)).toFixed(2)} tone={loadTone(host.cpu.load1, host.cpu.cores, thresholds)} />
        <Stat label="Load 5m" value={round(host.cpu.load5, 2).toFixed(2)} tone={loadTone(host.cpu.load5, host.cpu.cores, thresholds)} />
        <Stat label="Load 15m" value={round(host.cpu.load15, 2).toFixed(2)} tone={loadTone(host.cpu.load15, host.cpu.cores, thresholds)} />
      </div>
      <KeyValueList
        pairs={[
          { label: "Cores", value: host.cpu.cores || "—" },
          { label: "PSI cpu some10", value: host.cpu.psi_cpu_some10 == null ? "not available" : `${round(host.cpu.psi_cpu_some10, 2)}%` },
        ]}
      />
    </section>
  );
}
