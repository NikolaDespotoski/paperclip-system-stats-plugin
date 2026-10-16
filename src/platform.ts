/**
 * The `Platform` abstraction is the seam between the collectors and the host
 * machine. Production uses `nodePlatform`; tests inject a fake so every parser
 * and the full collection pipeline can be exercised without Linux `/proc`.
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

export interface Platform {
  /** Read a UTF-8 file. Returns `null` when it is missing or unreadable. */
  readText(path: string): string | null;
  /** Run a command, returning stdout. Returns `null` on any failure. */
  exec(command: string): string | null;
  /** Current time in milliseconds since the epoch. */
  now(): number;
  /** Wait for `ms` milliseconds. */
  sleep(ms: number): Promise<void>;
}

function safeRead(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function safeExec(command: string): string | null {
  try {
    return execSync(command, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10_000,
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

export function nodePlatform(): Platform {
  return {
    readText: safeRead,
    exec: safeExec,
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}
