import type { Thresholds } from "../../config.js";
import type { NetworkInterface, SeriesPoint } from "../../types.js";
import { rate, round } from "../lib/format.js";
import { card } from "../lib/stat.js";
import { TONE_COLOR, threshold } from "../lib/threshold.js";
import { Table, type DataTableColumn } from "../lib/table.js";
import { SeriesChart } from "./SeriesChart.js";

export function NetworkCard({ network, thresholds, series }: { network: { interfaces: NetworkInterface[] }; thresholds: Thresholds; series?: SeriesPoint[] }) {
  const columns: DataTableColumn<NetworkInterface>[] = [
    { key: "name", header: "Interface", width: "16%" },
    {
      key: "state",
      header: "State",
      render: (v) => (
        <span style={{ color: v === "up" ? TONE_COLOR.ok : TONE_COLOR.muted, fontWeight: 600 }}>{String(v)}</span>
      ),
    },
    { key: "speed_mbps", header: "Speed", render: (v) => (v == null ? "—" : `${v} Mb/s`) },
    {
      key: "rx_bytes_per_sec",
      header: "RX",
      render: (_v, row) => {
        const mbps = (row.rx_bytes_per_sec * 8) / 1e6;
        const tone = threshold(mbps, thresholds.net_rx_warn_mbps, thresholds.net_rx_warn_mbps * 1.25);
        return (
          <span style={{ color: TONE_COLOR[tone] }}>
            {rate(row.rx_bytes_per_sec)} <span style={{ opacity: 0.6 }}>({round(mbps)} Mb/s)</span>
          </span>
        );
      },
    },
    { key: "tx_bytes_per_sec", header: "TX", render: (v) => rate(v as number) },
    { key: "rx_packets_per_sec", header: "RX pkt/s", render: (v) => round(v as number) },
    { key: "tx_packets_per_sec", header: "TX pkt/s", render: (v) => round(v as number) },
    { key: "rx_errors", header: "RX err", render: (v) => (v as number) || 0 },
    { key: "tx_errors", header: "TX err", render: (v) => (v as number) || 0 },
  ];
  return (
    <section style={card} aria-label="Network">
      <h3 style={{ margin: 0, fontSize: 15 }}>Network</h3>
      <SeriesChart points={series ?? []} pick={(point) => point.net_rx_bps} title="Receive" yLabel="bytes/s" />
      <SeriesChart points={series ?? []} pick={(point) => point.net_tx_bps} title="Transmit" yLabel="bytes/s" />
      <Table columns={columns} rows={network.interfaces} emptyMessage="No network interfaces reported." />
    </section>
  );
}
