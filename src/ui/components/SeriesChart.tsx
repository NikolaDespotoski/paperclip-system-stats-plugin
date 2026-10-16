/**
 * Thin wrapper over the host-styled `TimeseriesChart`.
 *
 * The worker ships raw `SeriesPoint`s (one per metric); this projects whichever
 * numeric field a card needs onto the SDK's `{ timestamp, value }` shape. The
 * chart is host-rendered, so it inherits the host's theming and interactivity
 * for free.
 */
import { TimeseriesChart } from "@paperclipai/plugin-sdk/ui";
import type { ReactElement } from "react";
import type { SeriesPoint } from "../../types.js";

const EMPTY_STYLE = { opacity: 0.6, fontSize: 12 } as const;

export function SeriesChart({
  points,
  pick,
  title,
  yLabel,
  height = 140,
}: {
  points: SeriesPoint[];
  /** Project a raw point onto the single value this chart plots. */
  pick: (point: SeriesPoint) => number | null;
  title?: string;
  yLabel?: string;
  height?: number;
}): ReactElement {
  const data = points
    .map((point) => ({ timestamp: point.ts, value: pick(point) }))
    .filter((entry): entry is { timestamp: string; value: number } => entry.value != null && Number.isFinite(entry.value));

  if (data.length === 0) return <div style={EMPTY_STYLE}>Collecting samples…</div>;
  return <TimeseriesChart data={data} type="line" title={title} yLabel={yLabel} height={height} />;
}
