import type { TopProc } from "../../types.js";
import { card } from "../lib/stat.js";
import { Table, type DataTableColumn } from "../lib/table.js";

export function TopProcsTable({ procs }: { procs: TopProc[] }) {
  const columns: DataTableColumn<TopProc>[] = [
    { key: "pid", header: "PID", width: "90px" },
    { key: "cpu_pct", header: "CPU %", render: (v) => `${(v as number).toFixed(1)}%` },
    { key: "mem_pct", header: "MEM %", render: (v) => `${(v as number).toFixed(1)}%` },
    { key: "command", header: "Command" },
  ];
  return (
    <section style={card} aria-label="Top processes">
      <h3 style={{ margin: 0, fontSize: 15 }}>Top processes</h3>
      <Table columns={columns} rows={procs} emptyMessage="No process data." />
    </section>
  );
}
