import { KeyValueList } from "@paperclipai/plugin-sdk/ui";
import type { Thresholds } from "../../config.js";
import type { HostStats } from "../../types.js";
import { bytesToHuman, pct } from "../lib/format.js";
import { Stat, card, grid } from "../lib/stat.js";
import { threshold } from "../lib/threshold.js";

export function MemCard({ host, thresholds }: { host: HostStats; thresholds: Thresholds }) {
  const mem = host.mem;
  const usedPct = mem.usage_pct;
  const swapPct = mem.swap_total_bytes > 0 ? (mem.swap_used_bytes / mem.swap_total_bytes) * 100 : 0;
  return (
    <section style={card} aria-label="Memory">
      <h3 style={{ margin: 0, fontSize: 15 }}>Memory</h3>
      <div style={grid}>
        <Stat label="Used / total" value={`${bytesToHuman(mem.used_bytes)} / ${bytesToHuman(mem.total_bytes)}`} tone={threshold(usedPct, thresholds.mem_warn, thresholds.mem_crit)} />
        <Stat label="Usage" value={pct(usedPct)} tone={threshold(usedPct, thresholds.mem_warn, thresholds.mem_crit)} />
        <Stat label="Available" value={bytesToHuman(mem.available_bytes)} tone="ok" />
        <Stat label="Swap used" value={`${bytesToHuman(mem.swap_used_bytes)} / ${bytesToHuman(mem.swap_total_bytes)}`} tone={threshold(swapPct, 70, 90)} />
      </div>
      <div
        role="progressbar"
        aria-valuenow={Math.round(usedPct)}
        aria-valuemin={0}
        aria-valuemax={100}
        style={{ height: 8, borderRadius: 4, background: "rgba(148, 163, 184, 0.25)", overflow: "hidden" }}
      >
        <div style={{ width: `${Math.min(100, Math.max(0, usedPct))}%`, height: "100%", background: "#3b82f6" }} />
      </div>
      <KeyValueList
        pairs={[
          { label: "Buffers", value: bytesToHuman(mem.buffers_bytes) },
          { label: "Cached", value: bytesToHuman(mem.cached_bytes) },
        ]}
      />
    </section>
  );
}
