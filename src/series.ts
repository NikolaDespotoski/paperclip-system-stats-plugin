/**
 * Rolling time-series ring buffer.
 *
 * The plan's primary design persists samples to a plugin-owned Postgres
 * namespace, with an explicit fallback for operators who prefer zero
 * migrations: keep the last-30-minute window as a JSON blob in `ctx.state`
 * (which the host backs with Postgres). This plugin takes that fallback for a
 * concrete reason: the `database.namespace.*` capabilities are **company
 * scoped**, and this plugin's sampling loop is instance-wide with no active
 * company invocation, so `ctx.db` is not reachable from the sampler. Instance
 * scoped `ctx.state` is, and it survives worker restarts exactly as required.
 *
 * The buffer is deliberately dumb: append, trim to the window, read back a
 * window or a delta. No averaging, no rollups — every stored point is the raw
 * instantaneous reading.
 */
import type { PluginContext, ScopeKey } from "@paperclipai/plugin-sdk";
import type { SeriesPoint } from "./types.js";

export const SERIES_NAMESPACE = "series";

export function seriesScope(hostId: string): ScopeKey {
  return { scopeKind: "instance", namespace: SERIES_NAMESPACE, stateKey: hostId };
}

function isPoint(value: unknown): value is SeriesPoint {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as SeriesPoint).ts === "string" &&
    Number.isFinite(Date.parse((value as SeriesPoint).ts))
  );
}

export class RingBuffer {
  private readonly buffers = new Map<string, SeriesPoint[]>();

  /** Host ids currently tracked by the buffer. */
  hostIds(): string[] {
    return [...this.buffers.keys()];
  }

  /** The raw, already-trimmed points held for a host. */
  points(hostId: string): SeriesPoint[] {
    return this.buffers.get(hostId) ?? [];
  }

  /** Append a raw point and trim anything older than the window. */
  push(hostId: string, point: SeriesPoint, windowMs: number, now: number): void {
    const list = this.buffers.get(hostId) ?? [];
    list.push(point);
    this.buffers.set(hostId, trim(list, windowMs, now));
  }

  /** The newest raw point, or `null` when nothing is recorded yet. */
  latest(hostId: string): SeriesPoint | null {
    const list = this.buffers.get(hostId);
    return list && list.length > 0 ? list[list.length - 1]! : null;
  }

  /** Every point inside the last `windowMs`, oldest first. */
  window(hostId: string, windowMs: number, now: number): SeriesPoint[] {
    const cutoff = now - windowMs;
    return this.points(hostId).filter((point) => Date.parse(point.ts) >= cutoff);
  }

  /**
   * Points strictly newer than `sinceTs` (the realtime delta). A non-positive
   * `sinceTs` means "everything in the window" — the initial chart load.
   */
  since(hostId: string, sinceTs: number, windowMs: number, now: number): SeriesPoint[] {
    const window = this.window(hostId, windowMs, now);
    if (!sinceTs || sinceTs <= 0) return window;
    return window.filter((point) => Date.parse(point.ts) > sinceTs);
  }

  /** Trim a host to the window in place; returns how many points were dropped. */
  trim(hostId: string, windowMs: number, now: number): number {
    const list = this.buffers.get(hostId);
    if (!list) return 0;
    const trimmed = trim(list, windowMs, now);
    this.buffers.set(hostId, trimmed);
    return list.length - trimmed.length;
  }

  /** Load persisted history for `hostIds`, dropping anything already out of window. */
  async hydrate(ctx: PluginContext, hostIds: string[], windowMs: number, now: number): Promise<void> {
    await Promise.all(
      hostIds.map(async (hostId) => {
        try {
          const raw = await ctx.state.get(seriesScope(hostId));
          if (!Array.isArray(raw)) return;
          const points = raw.filter(isPoint).filter((point) => Date.parse(point.ts) >= now - windowMs);
          if (points.length > 0) this.buffers.set(hostId, points);
        } catch {
          // No persisted history yet (or state unavailable): start cold.
        }
      }),
    );
  }

  /** Persist one host's windowed history back to instance state. */
  async persist(ctx: PluginContext, hostId: string): Promise<void> {
    await ctx.state.set(seriesScope(hostId), this.points(hostId));
  }

  /** Persist every tracked host. Used by the retention job. */
  async persistAll(ctx: PluginContext): Promise<void> {
    await Promise.all(this.hostIds().map((hostId) => this.persist(ctx, hostId)));
  }

  clear(): void {
    this.buffers.clear();
  }
}

function trim(list: SeriesPoint[], windowMs: number, now: number): SeriesPoint[] {
  const cutoff = now - windowMs;
  let index = 0;
  while (index < list.length && Date.parse(list[index]!.ts) < cutoff) index += 1;
  return index > 0 ? list.slice(index) : list;
}
