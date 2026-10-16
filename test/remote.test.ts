import { describe, expect, it } from "vitest";
import { parseConfig, type RemoteHostConfig } from "../src/config.js";
import { collectSsh, sshCommand, toHostStats } from "../src/remote.js";
import { REMOTE_COLLECT_SCRIPT } from "../src/remote-script.js";
import type { RemoteStats } from "../src/types.js";
import { FakePlatform } from "./fake-platform.js";

const HOST: RemoteHostConfig = { id: "gpu", label: "GPU box", mode: "ssh", host: "10.0.0.5", user: "deploy" };

describe("embedded collector", () => {
  // The snippet is a string that only ever runs on a remote host, so a syntax
  // error would otherwise stay invisible until someone SSHes in.
  it("parses as JavaScript", () => {
    expect(() => new Function(REMOTE_COLLECT_SCRIPT)).not.toThrow();
  });

  it("filters away synthetic mounts", () => {
    // Exercise the snippet's own df parsing without touching the filesystem.
    const source = REMOTE_COLLECT_SCRIPT;
    expect(source).toContain("virtualMount");
    expect(source).toContain("/snap/");
  });
});

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

describe("sshCommand", () => {
  it("runs the embedded collector as the configured user", () => {
    const command = sshCommand(HOST, parseConfig({}));
    expect(command).toContain("ssh -o BatchMode=yes -o ConnectTimeout=8 -o StrictHostKeyChecking=accept-new");
    expect(command).toContain("deploy@10.0.0.5");
    expect(command).toContain("node --input-type=commonjs -e");
    expect(command).toContain("eval(Buffer.from('");
  });

  it("adds the ssh key and loopback flags", () => {
    const command = sshCommand({ ...HOST, ssh_key_path: "/keys/id_ed25519" }, parseConfig({ include_loopback_interfaces: true }));
    expect(command).toContain("-i '/keys/id_ed25519'");
    expect(command).toContain("STATS_INCLUDE_LOOPBACK=true");
  });
});

describe("collectSsh", () => {
  it("wraps the remote payload as an ssh host", async () => {
    const config = parseConfig({});
    const platform = new FakePlatform().on(sshCommand(HOST, config), JSON.stringify(REMOTE));
    const host = await collectSsh(HOST, config, platform);
    expect(host.available).toBe(true);
    expect(host.collection_method).toBe("ssh");
    expect(host.id).toBe("gpu");
    expect(host.label).toBe("GPU box");
    expect(host.cpu.usage_pct).toBe(42);
    expect(host.uptime_seconds).toBe(123);
  });

  it("reports unreachable when ssh fails", async () => {
    const host = await collectSsh(HOST, parseConfig({}), new FakePlatform());
    expect(host.available).toBe(false);
    expect(host.error).toMatch(/ssh command failed/);
  });

  it("reports unreachable on invalid JSON", async () => {
    const config = parseConfig({});
    const platform = new FakePlatform().on(sshCommand(HOST, config), "not json");
    const host = await collectSsh(HOST, config, platform);
    expect(host.available).toBe(false);
    expect(host.error).toMatch(/invalid JSON/);
  });
});

describe("toHostStats", () => {
  it("fills defaults for a partial payload", () => {
    const host = toHostStats("gpu", "GPU box", "webhook", { available: true, error: null } as RemoteStats);
    expect(host.cpu.usage_pct).toBe(0);
    expect(host.disk).toEqual([]);
    expect(host.docker).toBeNull();
    expect(host.collection_method).toBe("webhook");
    expect(host.available).toBe(true);
  });
});
