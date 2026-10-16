import { describe, expect, it } from "vitest";
import { parseDockerStats, parseDockerSystemDf, readDocker } from "../src/docker.js";
import { sizeToBytes } from "../src/format.js";
import { FakePlatform } from "./fake-platform.js";

const STATS = [
  JSON.stringify({
    ID: "abc123",
    Container: "web",
    Name: "web",
    Image: "nginx:latest",
    Status: "Up 3 hours",
    CPUPerc: "12.34%",
    MemUsage: "1.5GiB / 2GiB",
    MemPerc: "75.00%",
    NetIO: "1.2MB / 2.4MB",
    BlockIO: "0B / 10MB",
    PIDs: "7",
  }),
].join("\n");

const SYSTEM_DF = [
  "TYPE            TOTAL     ACTIVE    SIZE      RECLAIMABLE",
  "Images          5         3         1.2GB     500MB (41%)",
  "Containers      2         1         100MB     50MB (50%)",
  "Local Volumes   1         1         50MB      0B (0%)",
  "Build Cache     0         0         0B        0B",
].join("\n");

describe("sizeToBytes", () => {
  it("parses docker human sizes", () => {
    expect(sizeToBytes("1.5GiB")).toBeCloseTo(1.5 * 1024 ** 3);
    expect(sizeToBytes("500MB")).toBe(500 * 1024 ** 2);
    expect(sizeToBytes("0B")).toBe(0);
    expect(sizeToBytes("1024")).toBe(1024);
    expect(Number.isNaN(sizeToBytes("n/a"))).toBe(true);
  });
});

describe("parseDockerStats", () => {
  it("parses one JSON object per line", () => {
    const containers = parseDockerStats(STATS);
    expect(containers).toHaveLength(1);
    expect(containers[0]).toMatchObject({
      id: "abc123",
      name: "web",
      image: "nginx:latest",
      cpu_percent: 12.34,
      mem_usage_bytes: 1.5 * 1024 ** 3,
      mem_limit_bytes: 2 * 1024 ** 3,
      mem_percent: 75,
      net_rx_bytes: 1.2 * 1024 ** 2,
      net_tx_bytes: 2.4 * 1024 ** 2,
      block_write_bytes: 10 * 1024 ** 2,
      pids: 7,
    });
  });

  it("skips malformed lines", () => {
    expect(parseDockerStats("not json\n" + STATS)).toHaveLength(1);
    expect(parseDockerStats(null)).toEqual([]);
  });
});

describe("parseDockerSystemDf", () => {
  it("parses disk totals", () => {
    const disk = parseDockerSystemDf(SYSTEM_DF);
    expect(disk).toMatchObject({
      images_total: 5,
      images_size: 1.2 * 1024 ** 3,
      containers_total: 2,
      containers_size: 100 * 1024 ** 2,
      volumes_total: 1,
      volumes_size: 50 * 1024 ** 2,
      build_cache_size: 0,
    });
  });

  it("returns null when there is no table", () => {
    expect(parseDockerSystemDf(null)).toBeNull();
    expect(parseDockerSystemDf("")).toBeNull();
  });
});

describe("readDocker", () => {
  it("returns null when docker is missing", () => {
    expect(readDocker(new FakePlatform())).toBeNull();
  });

  it("collects containers and disk usage", () => {
    const platform = new FakePlatform()
      .on("docker stats --no-stream --format json", STATS)
      .on("docker system df", SYSTEM_DF);
    const docker = readDocker(platform);
    expect(docker?.containers).toHaveLength(1);
    expect(docker?.disk?.images_total).toBe(5);
    expect(docker?.running_count).toBe(1);
  });
});
