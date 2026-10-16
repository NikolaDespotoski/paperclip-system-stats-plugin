import type { CSSProperties } from "react";
import { TONE_COLOR, type Tone } from "./threshold.js";

export function Stat({ label, value, tone = "muted" }: { label: string; value: string; tone?: Tone }) {
  return (
    <div style={{ display: "grid", gap: 2, minWidth: 96 }}>
      <span style={{ fontSize: 12, opacity: 0.65 }}>{label}</span>
      <span style={{ fontSize: 20, fontWeight: 600, color: TONE_COLOR[tone], fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </div>
  );
}

export const card: CSSProperties = {
  display: "grid",
  gap: 12,
  padding: 16,
  borderRadius: 10,
  border: "1px solid rgba(148, 163, 184, 0.25)",
  background: "rgba(148, 163, 184, 0.06)",
};

export const grid = {
  display: "grid",
  gap: 12,
  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
} as const;
