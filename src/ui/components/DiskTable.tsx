import type { Thresholds } from "../../config.js";
import type { DiskMount, SeriesPoint } from "../../types.js";
import { bytesToHuman, pct } from "../lib/format.js";
import { card } from "../lib/stat.js";
import { TONE_COLOR, threshold } from "../lib/threshold.js";
import { Table, type DataTableColumn } from "../lib/table.js";
import { SeriesChart } from "./SeriesChart.js";

export function DiskTable({ mounts, thresholds, series }: { mounts: DiskMount[]; thresholds: Thresholds; series?: SeriesPoint[] }) {
  const columns: DataTableColumn<DiskMount>[] = [
    { key: "mount", header: "Mount", width: "30%" },
    { key: "total_bytes", header: "Size", render: (v) => bytesToHuman(v as number) },
    { key: "used_bytes", header: "Used", render: (v) => bytesToHuman(v as number) },
    { key: "available_bytes", header: "Available", render: (v) => bytesToHuman(v as number) },
    {
      key: "usage_pct",
      header: "Use",
      render: (v) => {
        const value = v as number;
        const tone = threshold(value, thresholds.disk_warn, thresholds.disk_crit);
        return <span style={{ color: TONE_COLOR[tone], fontWeight: 600 }}>{pct(value)}</span>;
      },
    },
  ];
  return (
    <section style={card} aria-label="Disk">
      <h3 style={{ margin: 0, fontSize: 15 }}>Disk</h3>
      <SeriesChart points={series ?? []} pick={(point) => point.disk_used_bytes} title="Used space (fullest mount)" yLabel="bytes" />
      <Table columns={columns} rows={mounts} emptyMessage="No filesystems reported." />
    </section>
  );
}
