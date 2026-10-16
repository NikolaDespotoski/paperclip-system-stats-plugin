import { describe, expect, it } from "vitest";
import { bytesRatio } from "../src/ui/lib/format.js";

// Binary units, matching bytesToHuman and the rest of the plugin's readouts.
const GB = 1024 ** 3;

describe("bytesRatio", () => {
  it("shares one unit between used and total", () => {
    expect(bytesRatio(240 * GB, 500 * GB)).toBe("240/500 GiB");
  });

  it("keeps a decimal only when the total is small", () => {
    expect(bytesRatio(21 * GB, 32 * GB)).toBe("21/32 GiB");
    expect(bytesRatio(8.2 * GB, 9.5 * GB)).toBe("8.2/9.5 GiB");
  });

  it("scales the unit to the total, not the used value", () => {
    // 950 MiB used out of 500 GiB must still read in GiB (hence the rounding).
    expect(bytesRatio(950 * 1024 ** 2, 500 * GB)).toBe("1/500 GiB");
  });

  it("climbs to TiB", () => {
    expect(bytesRatio(2.5 * 1024 ** 4, 4 * 1024 ** 4)).toBe("2.5/4 TiB");
  });

  it("returns null when there is nothing to divide by", () => {
    expect(bytesRatio(0, 0)).toBeNull();
    expect(bytesRatio(10, 0)).toBeNull();
    expect(bytesRatio(null, GB)).toBeNull();
    expect(bytesRatio(GB, null)).toBeNull();
    expect(bytesRatio(Number.NaN, GB)).toBeNull();
  });
});
