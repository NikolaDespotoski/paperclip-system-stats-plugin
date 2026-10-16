/**
 * Run `fn` every `seconds`.
 *
 * The callback is held in a ref so an unstable identity (React re-creates the
 * `refresh` returned by `usePluginData` on every render) cannot restart the
 * interval and thereby starve it — a failure mode that presents as "the UI
 * never updates" because the timer is cleared before it ever fires.
 */
import { useEffect, useRef } from "react";

export function usePolling(fn: (() => void) | null | undefined, seconds: number): void {
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    const timer = setInterval(() => fnRef.current?.(), Math.max(1, seconds) * 1000);
    return () => clearInterval(timer);
  }, [seconds]);
}
