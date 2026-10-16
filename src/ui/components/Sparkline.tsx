/**
 * Inline SVG sparkline.
 *
 * Deliberately tiny and dependency-free: it draws a polyline over an optional
 * fixed value domain so percentage series (`0..100`) stay visually comparable
 * across hosts and across restarts. An optional threshold band tints the area
 * behind the line red/warning so a widget row reads at a glance.
 */
import type { ReactElement } from "react";

const TONE_COLOR = { ok: "#22c55e", warn: "#f59e0b", crit: "#ef4444" };

export function Sparkline({
  values,
  width = 120,
  height = 28,
  min,
  max,
  warn,
  crit,
  color,
}: {
  values: number[];
  width?: number;
  height?: number;
  /** Fixed lower bound of the value domain. Defaults to the series minimum. */
  min?: number;
  /** Fixed upper bound of the value domain. Defaults to the series maximum. */
  max?: number;
  /** Draw a tinted danger zone above this value. */
  warn?: number;
  /** Draw a tinted critical zone above this value. */
  crit?: number;
  /** Explicit stroke colour; otherwise derived from the latest value + thresholds. */
  color?: string;
}): ReactElement {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length === 0) return <svg width={width} height={height} aria-hidden="true" />;

  const lo = min ?? Math.min(...finite);
  const hi = max ?? Math.max(...finite);
  const span = hi - lo || 1;
  const pad = 2;
  const plotW = width;
  const plotH = height - pad * 2;
  const step = finite.length > 1 ? plotW / (finite.length - 1) : 0;

  const y = (value: number) => pad + plotH - ((value - lo) / span) * plotH;
  const line = finite.map((value, index) => `${index === 0 ? "M" : "L"}${(index * step).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
  const area = `${line} L${plotW.toFixed(1)},${(height - pad).toFixed(1)} L0,${(height - pad).toFixed(1)} Z`;
  const last = finite[finite.length - 1]!;
  const stroke = color ?? (crit != null && last >= crit ? TONE_COLOR.crit : warn != null && last >= warn ? TONE_COLOR.warn : TONE_COLOR.ok);

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`sparkline, latest ${last}`}>
      {crit != null && <rect x={0} y={0} width={width} height={Math.max(0, y(crit) - pad)} fill={TONE_COLOR.crit} opacity={0.1} />}
      {warn != null && <rect x={0} y={0} width={width} height={Math.max(0, y(warn) - pad)} fill={TONE_COLOR.warn} opacity={0.08} />}
      <path d={area} fill={stroke} opacity={0.14} />
      <path d={line} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
