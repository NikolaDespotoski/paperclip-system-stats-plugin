import type { PluginContext, ScopeKey } from "@paperclipai/plugin-sdk";
import { describe, expect, it } from "vitest";
import { RingBuffer, seriesScope } from "../src/series.js";
import { downsample, emptyHostStats, toSeriesPoint, type SeriesPoint } from "../src/types.js";

const NOW = 1_700_000_000_000;
const WINDOW = 30 * 60_000;
const at = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

function point(offsetMs: number, cpu = 10): SeriesPoint {
  return {
    ts: at(offsetMs),
    cpu_pct: cpu,
    mem_pct: 20,
    disk_used_bytes: 100,
    disk_total_bytes: 1000,
    disk_pct: 10,
    net_rx_bps: 1,
    net_tx_bps: 2,
    docker_cpu_pct: null,
    docker_mem_bytes: null,
    docker_mem_pct: null,
  };
}

/** Minimal `ctx` covering only the `state` surface the ring buffer touches. */
function stubCtx() {
  const store = new Map<string, unknown>();
  const key = (scope: ScopeKey) => `${scope.scopeKind}:${scope.namespace}:${scope.stateKey}`;
  const ctx = {
    state: {
      get: async (scope: ScopeKey) => store.get(key(scope)),
      set: async (scope: ScopeKey, value: unknown) => {
        store.set(key(scope), value);
      },
    },
  } as unknown as PluginContext;
  return { ctx, store };
}

describe("RingBuffer", () => {
  it("appends raw points and drops anything older than the window", () => {
    const buffer = new RingBuffer();
    buffer.push("h", point(-WINDOW - 1_000), WINDOW, NOW);
    buffer.push("h", point(-60_000), WINDOW, NOW);
    buffer.push("h", point(0), WINDOW, NOW);

    const points = buffer.points("h");
    expect(points).toHaveLength(2);
    expect(points[points.length - 1]!.ts).toBe(at(0));
    expect(buffer.latest("h")!.ts).toBe(at(0));
  });

  it("tracks hosts independently and reports unknown hosts as empty", () => {
    const buffer = new RingBuffer();
    buffer.push("a", point(0, 11), WINDOW, NOW);
    buffer.push("b", point(0, 22), WINDOW, NOW);

    expect(buffer.hostIds().sort()).toEqual(["a", "b"]);
    expect(buffer.points("a")[0]!.cpu_pct).toBe(11);
    expect(buffer.latest("missing")).toBeNull();
    expect(buffer.window("missing", WINDOW, NOW)).toEqual([]);
  });

  it("filters the window by the requested span, not just retention", () => {
    const buffer = new RingBuffer();
    buffer.push("h", point(-120_000), WINDOW, NOW);
    buffer.push("h", point(-30_000), WINDOW, NOW);
    buffer.push("h", point(0), WINDOW, NOW);

    expect(buffer.window("h", 60_000, NOW).map((p) => p.ts)).toEqual([at(-30_000), at(0)]);
  });

  it("returns only points strictly newer than `sinceTs`", () => {
    const buffer = new RingBuffer();
    buffer.push("h", point(-120_000), WINDOW, NOW);
    buffer.push("h", point(-60_000), WINDOW, NOW);
    buffer.push("h", point(0), WINDOW, NOW);

    expect(buffer.since("h", 0, WINDOW, NOW)).toHaveLength(3);
    expect(buffer.since("h", Date.parse(at(-60_000)), WINDOW, NOW).map((p) => p.ts)).toEqual([at(0)]);
    expect(buffer.since("h", Date.parse(at(0)), WINDOW, NOW)).toEqual([]);
  });

  it("trims in place and reports how many points were dropped", () => {
    const buffer = new RingBuffer();
    buffer.push("h", point(-120_000), WINDOW, NOW);
    buffer.push("h", point(-60_000), WINDOW, NOW);
    buffer.push("h", point(0), WINDOW, NOW);

    // Advance the clock so the two oldest points fall out of the window.
    const later = NOW + WINDOW - 30_000;
    expect(buffer.trim("h", WINDOW, later)).toBe(2);
    expect(buffer.points("h").map((p) => p.ts)).toEqual([at(0)]);
    expect(buffer.trim("missing", WINDOW, later)).toBe(0);
  });

  it("hydrates persisted history, ignoring out-of-window and malformed entries", async () => {
    const { ctx, store } = stubCtx();
    store.set("instance:series:h", [point(0), point(-WINDOW - 1), { nope: true }, "junk"]);

    const buffer = new RingBuffer();
    await buffer.hydrate(ctx, ["h", "empty"], WINDOW, NOW);

    expect(buffer.points("h").map((p) => p.ts)).toEqual([at(0)]);
    expect(buffer.points("empty")).toEqual([]);
  });

  it("round-trips through plugin state", async () => {
    const { ctx } = stubCtx();
    const buffer = new RingBuffer();
    buffer.push("h", point(-60_000), WINDOW, NOW);
    buffer.push("h", point(0), WINDOW, NOW);
    await buffer.persist(ctx, "h");

    const reloaded = new RingBuffer();
    await reloaded.hydrate(ctx, ["h"], WINDOW, NOW);
    expect(reloaded.points("h")).toHaveLength(2);
    expect(reloaded.points("h")[1]!.ts).toBe(at(0));
  });

  it("persists every tracked host and can be cleared", async () => {
    const { ctx, store } = stubCtx();
    const buffer = new RingBuffer();
    buffer.push("a", point(0), WINDOW, NOW);
    buffer.push("b", point(0), WINDOW, NOW);
    await buffer.persistAll(ctx);

    expect(store.get("instance:series:a")).toHaveLength(1);
    expect(store.get("instance:series:b")).toHaveLength(1);
    buffer.clear();
    expect(buffer.hostIds()).toEqual([]);
  });
});

describe("seriesScope", () => {
  it("is instance-scoped and namespaced per host", () => {
    expect(seriesScope("gpu-1")).toEqual({ scopeKind: "instance", namespace: "series", stateKey: "gpu-1" });
  });
});

describe("downsample", () => {
  it("returns the series untouched when it already fits", () => {
    const points = [point(-2000), point(-1000), point(0)];
    expect(downsample(points, 10)).toBe(points);
  });

  it("caps the series and always keeps the newest point", () => {
    const points = Array.from({ length: 1000 }, (_, i) => point(-1000 + i, i));
    const out = downsample(points, 180);
    expect(out.length).toBeLessThanOrEqual(181);
    expect(out[out.length - 1]).toBe(points[points.length - 1]);
    expect(out[0]).toBe(points[0]);
  });
});

describe("toSeriesPoint", () => {
  it("projects absolute disk bytes from the fullest mount and sums docker usage", () => {
    const base = emptyHostStats("h", "Host", "local", "x");
    const stats = {
      ...base,
      available: true,
      collected_at: at(0),
      cpu: { ...base.cpu, usage_pct: 42 },
      mem: { ...base.mem, usage_pct: 55 },
      disk: [
        { mount: "/", total_bytes: 1000, used_bytes: 100, available_bytes: 900, usage_pct: 10 },
        { mount: "/data", total_bytes: 2000, used_bytes: 1500, available_bytes: 500, usage_pct: 75 },
      ],
      network: { interfaces: [], total_rx_per_sec: 111, total_tx_per_sec: 222 },
      docker: {
        containers: [
          { id: "1", name: "a", image: "i", status: "Up", cpu_percent: 10, mem_usage_bytes: 100, mem_limit_bytes: 1000, mem_percent: 10, net_rx_bytes: 0, net_tx_bytes: 0, block_read_bytes: 0, block_write_bytes: 0, pids: 1 },
          { id: "2", name: "b", image: "i", status: "Up", cpu_percent: 5, mem_usage_bytes: 200, mem_limit_bytes: 1000, mem_percent: 20, net_rx_bytes: 0, net_tx_bytes: 0, block_read_bytes: 0, block_write_bytes: 0, pids: 1 },
        ],
        disk: null,
        running_count: 2,
        total_count: 2,
      },
    };

    const series = toSeriesPoint(stats);
    expect(series.ts).toBe(at(0));
    expect(series.cpu_pct).toBe(42);
    expect(series.mem_pct).toBe(55);
    expect(series.disk_used_bytes).toBe(1500);
    expect(series.disk_total_bytes).toBe(2000);
    expect(series.disk_pct).toBe(75);
    expect(series.net_rx_bps).toBe(111);
    expect(series.net_tx_bps).toBe(222);
    expect(series.docker_cpu_pct).toBe(15);
    expect(series.docker_mem_bytes).toBe(300);
    expect(series.docker_mem_pct).toBe(15);
  });

  it("leaves docker fields null when there are no containers", () => {
    const stats = { ...emptyHostStats("h", "Host", "local", "x"), collected_at: at(0) };
    const series = toSeriesPoint(stats);
    expect(series.docker_cpu_pct).toBeNull();
    expect(series.docker_mem_bytes).toBeNull();
    expect(series.docker_mem_pct).toBeNull();
    expect(series.disk_used_bytes).toBe(0);
  });
});
