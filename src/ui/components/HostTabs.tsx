import type { HostStats } from "../../types.js";

export function HostTabs({
  hosts,
  selected,
  onSelect,
}: {
  hosts: HostStats[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  if (hosts.length <= 1) return null;
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }} role="tablist" aria-label="Hosts">
      {hosts.map((host) => (
        <button
          key={host.id}
          type="button"
          role="tab"
          aria-selected={host.id === selected}
          onClick={() => onSelect(host.id)}
          style={{
            padding: "6px 10px",
            borderRadius: 8,
            border: "1px solid rgba(148, 163, 184, 0.35)",
            background: host.id === selected ? "rgba(59, 130, 246, 0.18)" : "transparent",
            fontWeight: host.id === selected ? 600 : 400,
            cursor: "pointer",
          }}
        >
          {host.label}
        </button>
      ))}
    </div>
  );
}
