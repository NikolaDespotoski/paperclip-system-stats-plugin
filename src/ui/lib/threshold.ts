/** Threshold colour coding shared by every card. */
import type { Thresholds } from "../../config.js";

export type Tone = "ok" | "warn" | "crit" | "muted";

export const TONE_COLOR: Record<Tone, string> = {
  ok: "#22c55e",
  warn: "#eab308",
  crit: "#ef4444",
  muted: "#94a3b8",
};

export function threshold(value: number | null | undefined, warn: number, crit: number): Tone {
  if (value == null || !Number.isFinite(value)) return "muted";
  if (value >= crit) return "crit";
  if (value >= warn) return "warn";
  return "ok";
}

/** Load average expressed per core, so a 16-core box is not always red. */
export function loadTone(load1: number, cores: number, thresholds: Thresholds): Tone {
  const perCore = load1 / Math.max(1, cores);
  return threshold(perCore, 1.0, 2.0);
}
