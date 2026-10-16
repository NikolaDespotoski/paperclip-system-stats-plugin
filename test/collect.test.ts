import { describe, expect, it } from "vitest";
import {
  collectLocal,
  parseDfOutput,
  parseDfPosix,
  parseLoadavg,
  parseMeminfo,
  parsePressureCpu,
  parseProcStat,
  parseTopProcs,
  parseUptime,
} from "../src/collect.js";
import { parseConfig } from "../src/config.js";
import {
  DF_OUTPUT,
  FakePlatform,
  MEMINFO,
  NET_DEV_1,
  NET_DEV_2,
  PROC_STAT_1,
  PROC_STAT_2,
  PS_OUTPUT,
} from "./fake-platform.js";

describe("proc parsers", () => {
  it("parses cpu jiffies and core count", () => {
    expect(parseProcStat(PROC_STAT_1)).toEqual({ total: 9700, idle: 8200, cores: 2 });
  });

  it("parses meminfo into bytes", () => {
    const mem = parseMeminfo(MEMINFO);
    expect(mem.memTotal).toBe(16000000 * 1024);
    expect(mem.memAvailable).toBe(8000000 * 1024);
    expect(mem.swapTotal).toBe(2000000 * 1024);
    expect(mem.swapFree).toBe(1500000 * 1024);
  });

  it("parses load, uptime and PSI", () => {
    expect(parseLoadavg("0.10 0.20 0.30 1/234 5678")).toEqual({ load1: 0.1, load5: 0.2, load15: 0.3 });
    expect(parseUptime("100000.40 200000.90")).toBe(100000.4);
    expect(parsePressureCpu("some avg10=0.42 avg60=0.00 total=123\nfull avg10=0.00")).toBe(0.42);
    expect(parsePressureCpu(null)).toBeNull();
  });
});

describe("df and ps parsers", () => {
  it("parses the --output format", () => {
    const rows = parseDfOutput(DF_OUTPUT);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ mount: "/", used_bytes: 400000 * 1024, available_bytes: 600000 * 1024, usage_pct: 40 });
  });

  it("parses the POSIX fallback format", () => {
    const rows = parseDfPosix(["Filesystem 1024-blocks Used Available Capacity Mounted on", "/dev/sda1 1000000 400000 600000 40% /"].join("\n"));
    expect(rows[0]).toMatchObject({ mount: "/", usage_pct: 40 });
  });

  it("parses top processes", () => {
    expect(parseTopProcs(PS_OUTPUT)).toEqual([
      { pid: 1234, cpu_pct: 12.5, mem_pct: 3.2, command: "node" },
      { pid: 5678, cpu_pct: 1, mem_pct: 0.5, command: "bash" },
    ]);
  });
});

describe("collectLocal", () => {
  it("derives usage, memory, disk, network and processes from two samples", async () => {
    const platform = new FakePlatform()
      .setSequence("/proc/stat", [PROC_STAT_1, PROC_STAT_2])
      .set("/proc/meminfo", MEMINFO)
      .set("/proc/loadavg", "0.10 0.20 0.30 1/234 5678")
      .set("/proc/uptime", "100000.00 200000.00")
      .set("/proc/pressure/cpu", "some avg10=0.42 avg60=0.00 total=0")
      .setSequence("/proc/net/dev", [NET_DEV_1, NET_DEV_2])
      .on("df -k --output=source,size,used,avail,pcent,target", DF_OUTPUT)
      .on("ps -eo pid,pcpu,pmem,comm --sort=-pcpu --no-headers | head -6", PS_OUTPUT)
      .set("/sys/class/net/eth0/operstate", "up\n")
      .set("/sys/class/net/eth0/speed", "1000\n");

    const host = await collectLocal(platform, { id: "localhost", label: "Localhost", sampleMs: 200 });

    expect(host.available).toBe(true);
    expect(host.error).toBeNull();
    expect(host.cpu.usage_pct).toBe(60);
    expect(host.cpu.cores).toBe(2);
    expect(host.cpu.load1).toBeCloseTo(0.1);
    expect(host.cpu.psi_cpu_some10).toBe(0.42);
    expect(host.mem.total_bytes).toBe(16000000 * 1024);
    expect(host.mem.used_bytes).toBe((16000000 - 8000000) * 1024);
    expect(host.mem.swap_used_bytes).toBe(500000 * 1024);
    expect(host.disk[0]).toMatchObject({ mount: "/", usage_pct: 40 });
    expect(host.network.interfaces).toHaveLength(1);
    expect(host.network.interfaces[0]).toMatchObject({ name: "eth0", rx_bytes_per_sec: 50000, tx_bytes_per_sec: 50000, state: "up", speed_mbps: 1000 });
    expect(host.top_procs[0]).toMatchObject({ pid: 1234, command: "node" });
    expect(host.uptime_seconds).toBe(100000);
  });

  it("reports an unavailable host when /proc is missing", async () => {
    const host = await collectLocal(new FakePlatform(), { id: "localhost", label: "Localhost" });
    expect(host.available).toBe(false);
    expect(host.error).toMatch(/proc/i);
  });

  it("can include loopback when configured", async () => {
    const platform = new FakePlatform()
      .setSequence("/proc/stat", [PROC_STAT_1, PROC_STAT_2])
      .set("/proc/meminfo", MEMINFO)
      .set("/proc/loadavg", "0.10 0.20 0.30 1/234 5678")
      .set("/proc/uptime", "100000.00 200000.00")
      .setSequence("/proc/net/dev", [NET_DEV_1, NET_DEV_2]);
    const host = await collectLocal(platform, { id: "localhost", label: "Localhost", sampleMs: 0, includeLoopback: true });
    expect(host.network.interfaces.map((i) => i.name).sort()).toEqual(["eth0", "lo"]);
  });
});

describe("collectAllHosts", () => {
  it("collects the local host plus ssh hosts", async () => {
    const { collectAllHosts } = await import("../src/remote.js");
    const platform = new FakePlatform()
      .setSequence("/proc/stat", [PROC_STAT_1, PROC_STAT_2])
      .set("/proc/meminfo", MEMINFO)
      .set("/proc/loadavg", "0.10 0.20 0.30 1/234 5678")
      .set("/proc/uptime", "100000.00 200000.00")
      .setSequence("/proc/net/dev", [NET_DEV_1, NET_DEV_2])
      .on("df -k --output=source,size,used,avail,pcent,target", DF_OUTPUT)
      .on("ps -eo pid,pcpu,pmem,comm --sort=-pcpu --no-headers | head -6", PS_OUTPUT);
    const config = parseConfig({ remote_hosts: [{ id: "gpu", label: "GPU box", mode: "ssh", host: "10.0.0.5", user: "deploy" }] });
    const snapshot = await collectAllHosts(config, undefined, platform);
    expect(snapshot.hosts.map((h) => h.id)).toEqual(["localhost", "gpu"]);
    expect(snapshot.hosts[0].available).toBe(true);
    expect(snapshot.hosts[1].available).toBe(false);
  });
});
