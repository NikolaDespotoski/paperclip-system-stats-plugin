import { beforeEach, describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest.js";
import { seriesScope } from "../src/series.js";
import { remoteStatsScope, snapshotScope } from "../src/state.js";
import type { HostSeries, HostsSnapshot, RemoteStats, SeriesPoint, SparklinePayload } from "../src/types.js";
import plugin from "../src/worker.js";

/** `0` disables the worker's sampling timer so tests drive it explicitly. */
const NO_POLL = { sample_interval_seconds: 0 };

const WEBHOOK_HOST = { id: "gpu-box", label: "GPU Box", mode: "webhook", webhook_secret: "s3cr3t" };

const REMOTE: RemoteStats = {
  available: true,
  error: null,
  cpu: { usage_pct: 42, load1: 0.5, load5: 0.4, load15: 0.3, cores: 4, psi_cpu_some10: 0.1 },
  mem: { total_bytes: 1_000_000_000, used_bytes: 500_000_000, available_bytes: 500_000_000, usage_pct: 50, swap_total_bytes: 0, swap_used_bytes: 0, buffers_bytes: 0, cached_bytes: 0 },
  disk: [{ mount: "/", total_bytes: 1_000_000_000, used_bytes: 400_000_000, available_bytes: 600_000_000, usage_pct: 40 }],
  network: { interfaces: [], total_rx_per_sec: 0, total_tx_per_sec: 0 },
  docker: null,
  top_procs: [],
  uptime_seconds: 123,
};

function webhookInput(secret: string, host = "gpu-box") {
  return {
    endpointKey: "host-stats",
    headers: { "x-paperclip-secret": secret },
    parsedBody: { host, stats: REMOTE },
    rawBody: JSON.stringify({ host, stats: REMOTE }),
    requestId: "req-1",
  };
}

describe("system stats worker", () => {
  let h: TestHarness;

  beforeEach(async () => {
    h = createTestHarness({ manifest, config: NO_POLL });
    await plugin.definition.setup(h.ctx);
  });

  it("returns an empty snapshot before the first collection", async () => {
    const snapshot = await h.getData<HostsSnapshot>("host-stats", {});
    expect(snapshot.hosts).toEqual([]);
    expect(snapshot.collected_at).toBeTruthy();
  });

  it("exposes the sampling and window settings to the UI", async () => {
    const snapshot = await h.getData<HostsSnapshot & { sample_interval_seconds: number; history_window_seconds: number; ui_refresh_seconds: number }>("host-stats", {});
    expect(snapshot.sample_interval_seconds).toBe(0);
    expect(snapshot.history_window_seconds).toBe(1800);
    expect(snapshot.ui_refresh_seconds).toBe(2);
  });

  it("the refresh action collects and stores a snapshot", async () => {
    const result = await h.performAction<{ ok: boolean; hosts: number }>("refresh", {});
    expect(result.ok).toBe(true);
    const stored = h.getState(snapshotScope()) as HostsSnapshot | undefined;
    expect(stored?.hosts.length).toBeGreaterThan(0);
  });

  it("the retention job persists the windowed series", async () => {
    h.setConfig({ ...NO_POLL, remote_hosts: [WEBHOOK_HOST] });
    await plugin.definition.onWebhook!(webhookInput("resolved:s3cr3t"));

    await h.runJob("prune-samples");

    const persisted = h.getState(seriesScope("gpu-box")) as SeriesPoint[] | undefined;
    expect(persisted).toHaveLength(1);
    expect(persisted?.[0]?.cpu_pct).toBe(42);
  });

  it("records a raw series point for a pushed webhook host", async () => {
    h.setConfig({ ...NO_POLL, remote_hosts: [WEBHOOK_HOST] });
    await plugin.definition.onWebhook!(webhookInput("resolved:s3cr3t"));

    const stored = h.getState(seriesScope("gpu-box")) as SeriesPoint[] | undefined;
    expect(stored).toHaveLength(1);
    expect(stored?.[0]?.disk_used_bytes).toBe(400_000_000);
    expect(stored?.[0]?.disk_total_bytes).toBe(1_000_000_000);
  });

  it("skips the series point when the push reports the host unavailable", async () => {
    h.setConfig({ ...NO_POLL, remote_hosts: [WEBHOOK_HOST] });
    await plugin.definition.onWebhook!({
      ...webhookInput("resolved:s3cr3t"),
      parsedBody: { host: "gpu-box", stats: { ...REMOTE, available: false, error: "boom" } },
    });

    expect(h.getState(seriesScope("gpu-box"))).toBeUndefined();
  });

  it("serves the full window through the host-series feed", async () => {
    h.setConfig({ ...NO_POLL, remote_hosts: [WEBHOOK_HOST] });
    await plugin.definition.onWebhook!(webhookInput("resolved:s3cr3t"));

    const series = await h.getData<HostSeries>("host-series", { hostId: "gpu-box" });
    expect(series.hostId).toBe("gpu-box");
    expect(series.windowMs).toBe(1_800_000);
    expect(series.points).toHaveLength(1);
  });

  it("appends only new points through the series-since action", async () => {
    h.setConfig({ ...NO_POLL, remote_hosts: [WEBHOOK_HOST] });
    await plugin.definition.onWebhook!(webhookInput("resolved:s3cr3t"));

    const first = await h.performAction<{ hostId: string; points: SeriesPoint[] }>("series-since", { hostId: "gpu-box", sinceTs: 0 });
    expect(first.points).toHaveLength(1);

    const latest = Date.parse(first.points[0]!.ts);
    const delta = await h.performAction<{ points: SeriesPoint[] }>("series-since", { hostId: "gpu-box", sinceTs: latest });
    expect(delta.points).toEqual([]);

    const unknown = await h.performAction<{ points: SeriesPoint[] }>("series-since", { hostId: "", sinceTs: 0 });
    expect(unknown.points).toEqual([]);
  });

  it("serves downsampled sparkline arrays for the widget", async () => {
    h.setConfig({ ...NO_POLL, remote_hosts: [WEBHOOK_HOST] });
    await plugin.definition.onWebhook!(webhookInput("resolved:s3cr3t"));

    const payload = await h.getData<SparklinePayload>("host-sparklines", {});
    const host = payload.hosts.find((entry) => entry.id === "gpu-box");
    expect(host?.cpu).toEqual([42]);
    expect(host?.mem).toEqual([50]);
    expect(host?.disk).toEqual([40]);
    // Hosts with no recorded samples are omitted entirely.
    expect(payload.hosts.some((entry) => entry.id === "localhost")).toBe(false);
  });

  it("merges a webhook push into the data feed", async () => {
    h.setConfig({ ...NO_POLL, remote_hosts: [WEBHOOK_HOST] });
    await plugin.definition.onWebhook!(webhookInput("resolved:s3cr3t"));

    const stored = h.getState(remoteStatsScope("gpu-box")) as { collection_method: string } | undefined;
    expect(stored?.collection_method).toBe("webhook");

    const snapshot = await h.getData<HostsSnapshot>("host-stats", {});
    expect(snapshot.hosts.map((host) => host.id)).toContain("gpu-box");
  });

  it("rejects a webhook push with the wrong secret", async () => {
    h.setConfig({ ...NO_POLL, remote_hosts: [WEBHOOK_HOST] });
    await plugin.definition.onWebhook!(webhookInput("wrong"));
    expect(h.getState(remoteStatsScope("gpu-box"))).toBeUndefined();
  });

  it("marks a webhook host stale when no push arrives for too long", async () => {
    h.setConfig({ ...NO_POLL, remote_hosts: [WEBHOOK_HOST] });
    await h.ctx.state.set(remoteStatsScope("gpu-box"), { ...REMOTE, id: "gpu-box", label: "GPU Box", collection_method: "webhook", collected_at: new Date(Date.now() - 10 * 60_000).toISOString() });
    const snapshot = await h.getData<HostsSnapshot>("host-stats", {});
    const pushed = snapshot.hosts.find((host) => host.id === "gpu-box");
    expect(pushed?.available).toBe(false);
    expect(pushed?.error).toMatch(/stale/i);
  });

  it("validates operator config", async () => {
    const valid = await plugin.definition.onValidateConfig!({ sample_interval_seconds: 5 });
    expect(valid.ok).toBe(true);

    const invalid = await plugin.definition.onValidateConfig!({ sample_interval_seconds: -1 });
    expect(invalid.ok).toBe(false);
    expect(invalid.errors?.join(" ")).toMatch(/sample_interval_seconds/);

    const shortWindow = await plugin.definition.onValidateConfig!({ history_window_seconds: 30 });
    expect(shortWindow.ok).toBe(false);
    expect(shortWindow.errors?.join(" ")).toMatch(/history_window_seconds/);
  });

  it("still accepts the legacy poll_interval_seconds key", async () => {
    h.setConfig({ poll_interval_seconds: 7 });
    const snapshot = await h.getData<HostsSnapshot & { sample_interval_seconds: number }>("host-stats", {});
    expect(snapshot.sample_interval_seconds).toBe(7);
  });

  it("reports health", async () => {
    const health = await plugin.definition.onHealth!();
    expect(health.status).toBe("ok");
  });
});
