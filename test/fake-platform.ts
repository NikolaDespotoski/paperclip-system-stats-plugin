import type { Platform } from "../src/platform.js";

/** In-memory `Platform` for tests: files, per-path read sequences and commands. */
export class FakePlatform implements Platform {
  readonly files = new Map<string, string>();
  readonly commands = new Map<string, string>();
  readonly sequences = new Map<string, string[]>();
  readonly sleepCalls: number[] = [];
  private readonly readIndex = new Map<string, number>();
  private clock = 1_700_000_000_000;

  set(path: string, contents: string): this {
    this.files.set(path, contents);
    return this;
  }

  /** Return a different payload on each successive read of `path`. */
  setSequence(path: string, contents: string[]): this {
    this.sequences.set(path, contents);
    return this;
  }

  on(command: string, output: string): this {
    this.commands.set(command, output);
    return this;
  }

  readText(path: string): string | null {
    const sequence = this.sequences.get(path);
    if (sequence) {
      const index = this.readIndex.get(path) ?? 0;
      this.readIndex.set(path, index + 1);
      return sequence[Math.min(index, sequence.length - 1)] ?? null;
    }
    return this.files.get(path) ?? null;
  }

  exec(command: string): string | null {
    return this.commands.get(command) ?? null;
  }

  now(): number {
    return this.clock;
  }

  async sleep(ms: number): Promise<void> {
    this.clock += ms;
    this.sleepCalls.push(ms);
  }
}

export const PROC_STAT_1 = [
  "cpu  1000 0 500 8000 200 0 0 0 0 0",
  "cpu0 500 0 250 4000 100 0 0 0 0 0",
  "cpu1 500 0 250 4000 100 0 0 0 0 0",
  "intr 12345 0 0",
].join("\n");

export const PROC_STAT_2 = [
  "cpu  2000 0 1000 8800 400 0 0 0 0 0",
  "cpu0 1000 0 500 4400 200 0 0 0 0 0",
  "cpu1 1000 0 500 4400 200 0 0 0 0 0",
].join("\n");

export const MEMINFO = [
  "MemTotal:       16000000 kB",
  "MemFree:         4000000 kB",
  "MemAvailable:    8000000 kB",
  "Buffers:          100000 kB",
  "Cached:          2000000 kB",
  "SwapTotal:       2000000 kB",
  "SwapFree:        1500000 kB",
].join("\n");

export const NET_DEV_1 = [
  "Inter-|   Receive                                                |  Transmit",
  " face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed",
  "    lo: 1000 10 0 0 0 0 0 0 1000 10 0 0 0 0 0 0",
  "  eth0: 100000 1000 0 0 0 0 0 0 200000 2000 0 0 0 0 0 0",
].join("\n");

export const NET_DEV_2 = [
  "Inter-|   Receive                                                |  Transmit",
  " face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed",
  "    lo: 2000 20 0 0 0 0 0 0 2000 20 0 0 0 0 0 0",
  "  eth0: 110000 1100 0 0 0 0 0 0 210000 2100 0 0 0 0 0 0",
].join("\n");

export const DF_OUTPUT = [
  "Filesystem     1024-blocks      Used Available Capacity Mounted on",
  "/dev/sda1         1000000   400000    600000      40% /",
].join("\n");

export const PS_OUTPUT = ["  PID %CPU %MEM COMMAND", " 1234  12.5  3.2 node", " 5678   1.0  0.5 bash"].join("\n");
