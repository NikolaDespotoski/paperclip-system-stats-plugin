/**
 * Subscribes to one host's rolling series.
 *
 * The first load asks for the whole window; each later tick asks only for
 * points newer than the newest one we already hold (a realtime delta), so the
 * chart grows by appending instead of re-fetching 30 minutes of data. Polling
 * pauses while the tab is hidden and resumes (with a catch-up fetch) when it
 * becomes visible again.
 */
import { usePluginAction } from "@paperclipai/plugin-sdk/ui";
import { useEffect, useRef, useState } from "react";
import type { SeriesPoint } from "../../types.js";

/** Consecutive failures before we abandon the delta and re-fetch the window. */
const MAX_FAILURES = 4;

function dedupe(points: SeriesPoint[]): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  for (const point of points) {
    if (out.length === 0 || out[out.length - 1]!.ts !== point.ts) out.push(point);
  }
  return out;
}

export function useLiveSeries(hostId: string | null, windowMs: number, refreshSeconds: number) {
  const action = usePluginAction("series-since");
  const actionRef = useRef(action);
  actionRef.current = action;

  const [points, setPoints] = useState<SeriesPoint[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hostId) {
      setPoints([]);
      setError(null);
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    let failures = 0;
    let sinceTs = 0;
    let held: SeriesPoint[] = [];

    const apply = (incoming: SeriesPoint[], full: boolean) => {
      if (incoming.length === 0 && !full) return;
      const cutoff = Date.now() - windowMs;
      held = dedupe(full ? incoming : [...held, ...incoming]).filter((point) => Date.parse(point.ts) >= cutoff);
      sinceTs = held.length > 0 ? Date.parse(held[held.length - 1]!.ts) : 0;
      setPoints(held);
      setError(null);
    };

    const tick = async (full: boolean) => {
      try {
        const result = (await actionRef.current({ hostId, sinceTs: full ? 0 : sinceTs })) as
          | { points?: SeriesPoint[] }
          | undefined;
        if (cancelled) return;
        apply(result?.points ?? [], full);
        failures = 0;
      } catch (cause) {
        if (cancelled) return;
        failures += 1;
        setError(cause instanceof Error ? cause.message : String(cause));
        // The delta cursor may be stale (worker restarted); refetch the window.
        if (failures >= MAX_FAILURES) {
          failures = 0;
          void tick(true);
        }
      }
    };

    const start = () => {
      if (timer) return;
      timer = setInterval(() => void tick(false), Math.max(1, refreshSeconds) * 1000);
    };
    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };
    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        void tick(false);
        start();
      }
    };

    held = [];
    sinceTs = 0;
    void tick(true);
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [hostId, windowMs, refreshSeconds]);

  return { points, error };
}
