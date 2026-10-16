import { age } from "../lib/format.js";

export function LiveIndicator({ collectedAt, error }: { collectedAt: string | null; error?: string | null }) {
  const stale = !collectedAt || (Date.now() - Date.parse(collectedAt)) / 1000 > 120;
  const color = error ? "#ef4444" : stale ? "#eab308" : "#22c55e";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, opacity: 0.85 }}>
      <span
        aria-hidden
        style={{ width: 8, height: 8, borderRadius: "50%", background: color, boxShadow: `0 0 0 3px ${color}33` }}
      />
      {error ? `unavailable · ${error}` : collectedAt ? `live · updated ${age(collectedAt)}` : "waiting for first collection"}
    </span>
  );
}
