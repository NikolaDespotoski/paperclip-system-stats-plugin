import { beforeEach, describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest.js";
import { remoteStatsScope, snapshotScope } from "../src/state.js";
import type { HostsSnapshot, RemoteStats } from "../src/types.js";
import plugin from "../src/worker.js";

const NO_POLL = { poll_interval_seconds: 0 };

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

  it("the refresh action collects and stores a snapshot", async () => {
    const result = await h.performAction<{ ok: boolean; hosts: number }>("refresh", {});
    expect(result.ok).toBe(true);
    const stored = h.getState(snapshotScope()) as HostsSnapshot | undefined;
    expect(stored?.hosts.length).toBeGreaterThan(0);
  });

  it("the scheduled job collects without manual action", async () => {
    await h.runJob("collect-stats");
    const stored = h.getState(snapshotScope()) as HostsSnapshot | undefined;
    expect(stored?.hosts.length).toBeGreaterThan(0);
  });

  it("merges a webhook push into the data feed", async () => {
    h.setConfig({ ...NO_POLL, remote_hosts: [{ id: "gpu-box", label: "GPU Box", mode: "webhook", webhook_secret: "s3cr3t" }] });
    await plugin.definition.onWebhook!(webhookInput("resolved:s3cr3t"));

    const stored = h.getState(remoteStatsScope("gpu-box")) as { collection_method: string } | undefined;
    expect(stored?.collection_method).toBe("webhook");

    const snapshot = await h.getData<HostsSnapshot>("host-stats", {});
    expect(snapshot.hosts.map((host) => host.id)).toContain("gpu-box");
  });

  it("rejects a webhook push with the wrong secret", async () => {
    h.setConfig({ ...NO_POLL, remote_hosts: [{ id: "gpu-box", label: "GPU Box", mode: "webhook", webhook_secret: "s3cr3t" }] });
    await plugin.definition.onWebhook!(webhookInput("wrong"));
    expect(h.getState(remoteStatsScope("gpu-box"))).toBeUndefined();
  });

  it("marks a webhook host stale when no push arrives for too long", async () => {
    h.setConfig({ ...NO_POLL, remote_hosts: [{ id: "gpu-box", label: "GPU Box", mode: "webhook", webhook_secret: "s3cr3t" }] });
    await h.ctx.state.set(remoteStatsScope("gpu-box"), { ...REMOTE, id: "gpu-box", label: "GPU Box", collection_method: "webhook", collected_at: new Date(Date.now() - 10 * 60_000).toISOString() });
    const snapshot = await h.getData<HostsSnapshot>("host-stats", {});
    const pushed = snapshot.hosts.find((host) => host.id === "gpu-box");
    expect(pushed?.available).toBe(false);
    expect(pushed?.error).toMatch(/stale/i);
  });

  it("validates operator config", async () => {
    const valid = await plugin.definition.onValidateConfig!({ poll_interval_seconds: 15 });
    expect(valid.ok).toBe(true);
    const invalid = await plugin.definition.onValidateConfig!({ poll_interval_seconds: -1 });
    expect(invalid.ok).toBe(false);
    expect(invalid.errors?.join(" ")).toMatch(/poll_interval_seconds/);
  });

  it("reports health", async () => {
    const health = await plugin.definition.onHealth!();
    expect(health.status).toBe("ok");
  });
});
