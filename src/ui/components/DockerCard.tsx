import { KeyValueList } from "@paperclipai/plugin-sdk/ui";
import type { Thresholds } from "../../config.js";
import type { DockerContainer, DockerStats } from "../../types.js";
import { bytesToHuman } from "../lib/format.js";
import { card } from "../lib/stat.js";
import { TONE_COLOR, threshold } from "../lib/threshold.js";
import { Table, type DataTableColumn } from "../lib/table.js";

export function DockerCard({ docker, thresholds }: { docker: DockerStats | null; thresholds: Thresholds }) {
  if (!docker) {
    return (
      <section style={card} aria-label="Docker">
        <h3 style={{ margin: 0, fontSize: 15 }}>Docker</h3>
        <span style={{ opacity: 0.7 }}>Docker not available on this host.</span>
      </section>
    );
  }
  const columns: DataTableColumn<DockerContainer>[] = [
    { key: "name", header: "Container", width: "18%" },
    { key: "image", header: "Image", width: "22%" },
    { key: "status", header: "Status" },
    {
      key: "cpu_percent",
      header: "CPU",
      render: (v) => {
        const value = v as number;
        return <span style={{ color: TONE_COLOR[threshold(value, thresholds.docker_cpu_warn, 95)] }}>{value.toFixed(1)}%</span>;
      },
    },
    { key: "mem_usage_bytes", header: "Mem", render: (_v, row) => `${bytesToHuman(row.mem_usage_bytes)} / ${bytesToHuman(row.mem_limit_bytes)}` },
    {
      key: "mem_percent",
      header: "Mem %",
      render: (v) => <span style={{ color: TONE_COLOR[threshold(v as number, thresholds.docker_mem_warn, 95)] }}>{(v as number).toFixed(1)}%</span>,
    },
    { key: "net_rx_bytes", header: "Net RX", render: (v) => bytesToHuman(v as number) },
    { key: "net_tx_bytes", header: "Net TX", render: (v) => bytesToHuman(v as number) },
    { key: "block_read_bytes", header: "Block R", render: (v) => bytesToHuman(v as number) },
    { key: "block_write_bytes", header: "Block W", render: (v) => bytesToHuman(v as number) },
    { key: "pids", header: "PIDs" },
  ];
  return (
    <section style={card} aria-label="Docker">
      <h3 style={{ margin: 0, fontSize: 15 }}>Docker</h3>
      <Table columns={columns} rows={docker.containers} emptyMessage="No running containers." />
      {docker.disk && (
        <KeyValueList
          pairs={[
            { label: "Images", value: `${docker.disk.images_total} (${bytesToHuman(docker.disk.images_size)})` },
            { label: "Containers", value: `${docker.disk.containers_total} (${bytesToHuman(docker.disk.containers_size)})` },
            { label: "Volumes", value: `${docker.disk.volumes_total} (${bytesToHuman(docker.disk.volumes_size)})` },
            { label: "Build cache", value: bytesToHuman(docker.disk.build_cache_size) },
          ]}
        />
      )}
    </section>
  );
}
