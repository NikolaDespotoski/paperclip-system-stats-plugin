import { describe, expect, it } from "vitest";
import { deriveNetwork, parseNetDev } from "../src/network.js";
import { NET_DEV_1 } from "./fake-platform.js";
import { FakePlatform } from "./fake-platform.js";

describe("parseNetDev", () => {
  it("parses cumulative counters per interface", () => {
    const parsed = parseNetDev(NET_DEV_1);
    expect(parsed.eth0).toEqual({ rxBytes: 100000, rxPackets: 1000, rxErrors: 0, txBytes: 200000, txPackets: 2000, txErrors: 0 });
    expect(parsed.lo.rxBytes).toBe(1000);
  });

  it("returns an empty map for missing input", () => {
    expect(parseNetDev(null)).toEqual({});
  });
});

describe("deriveNetwork", () => {
  it("computes per-second rates from a 200ms sample", () => {
    const previous = parseNetDev(NET_DEV_1);
    const next = parseNetDev(
      NET_DEV_1.replace("eth0: 100000", "eth0: 110000").replace("200000 2000", "210000 2100"),
    );
    const platform = new FakePlatform().set("/sys/class/net/eth0/operstate", "up\n").set("/sys/class/net/eth0/speed", "1000\n");
    const network = deriveNetwork(previous, next, 200, platform, {});
    expect(network.interfaces).toHaveLength(1);
    expect(network.interfaces[0].rx_bytes_per_sec).toBe(50000);
    expect(network.interfaces[0].tx_bytes_per_sec).toBe(50000);
    expect(network.interfaces[0].state).toBe("up");
    expect(network.total_rx_per_sec).toBe(50000);
  });

  it("excludes loopback unless asked", () => {
    const previous = parseNetDev(NET_DEV_1);
    const next = parseNetDev(NET_DEV_1);
    const network = deriveNetwork(previous, next, 200, new FakePlatform(), { includeLoopback: true });
    expect(network.interfaces.map((i) => i.name).sort()).toEqual(["eth0", "lo"]);
  });

  it("never divides by zero", () => {
    const counters = parseNetDev(NET_DEV_1);
    const network = deriveNetwork(counters, counters, 0, new FakePlatform(), {});
    expect(network.interfaces[0].rx_bytes_per_sec).toBe(0);
  });
});
