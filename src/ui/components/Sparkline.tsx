/**
 * Inline SVG line sparkline.
 *
 * Draws a single polyline (plus a soft area fill under it) that stretches to
 * fill its container. Two deliberate choices, both driven by what a real
 * dashboard needs:
 *
 *  - The y-domain tracks the data by default (with 15% headroom) instead of a
 *    fixed `0..100`. A host idling at 6% CPU still shows its shape rather than
 *    a dead flat line pinned to the bottom of the box. Pass `min`/`max` to
 *    pin the domain when comparability matters more than resolution.
 *  - No threshold bands. Tinted zones behind the line read as data at this
 *    size; the stroke colour carries the ok/warn/crit signal instead, and the
 *    numeric labels next to the graph are already colour-coded.
 */
import type { ReactElement } from "react";

const TONE_COLOR = { ok: "#22c55e", warn: "#eab308", crit: "#ef4444" };

/** Internal horizontal coordinate space; the SVG is stretched to its container. */
const VIEW_WIDTH = 100;
/** Vertical breathing room so the stroke is never clipped by the viewBox. */
const PAD = 2;
/** Fractional headroom added to an auto-derived domain. */
const HEADROOM = 0.15;

export function Sparkline({
  values,
  height = 28,
  width = "100%",
  min,
  max,
  warn,
  crit,
  color,
}: {
  values: number[];
  height?: number;
  /** CSS width; defaults to filling the container. */
  width?: number | string;
  /** Fixed lower bound of the value domain. Defaults to the series minimum. */
  min?: number;
  /** Fixed upper bound of the value domain. Defaults to the series maximum. */
  max?: number;
  /** Stroke turns amber once the latest value reaches this. */
  warn?: number;
  /** Stroke turns red once the latest value reaches this. */
  crit?: number;
  /** Explicit stroke colour; otherwise derived from the latest value + thresholds. */
  color?: string;
}): ReactElement {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length === 0) return <svg width={width} height={height} aria-hidden="true" />;

  // A lone sample has no line to draw; render it as a flat line at that level.
  const series = finite.length === 1 ? [finite[0]!, finite[0]!] : finite;

  let low = min ?? Math.min(...series);
  let high = max ?? Math.max(...series);
  const pad = (high - low) * HEADROOM || 1;
  if (min == null) low -= pad;
  if (max == null) high += pad;
  const span = high - low || 1;

  const plotHeight = height - PAD * 2;
  const y = (value: number) => PAD + plotHeight - ((value - low) / span) * plotHeight;
  const x = (index: number) => (index / (series.length - 1)) * VIEW_WIDTH;

  const line = series.map((value, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(2)},${y(value).toFixed(2)}`).join(" ");
  const area = `${line} L${VIEW_WIDTH},${height - PAD} L0,${height - PAD} Z`;
  const last = finite[finite.length - 1]!;
  const stroke =
    color ??
    (crit != null && last >= crit ? TONE_COLOR.crit : warn != null && last >= warn ? TONE_COLOR.warn : TONE_COLOR.ok);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${VIEW_WIDTH} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`sparkline, latest ${last}`}
      style={{ display: "block", overflow: "visible" }}
    >
      <path d={area} fill={stroke} opacity={0.14} />
      <path
        d={line}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
