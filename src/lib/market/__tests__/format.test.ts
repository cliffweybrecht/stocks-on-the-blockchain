import { describe, expect, it } from "vitest";
import { formatCountCompact, formatUsdCompact } from "../format";

describe("formatUsdCompact", () => {
  it("formats zero as $0 on both server and client", () => {
    expect(formatUsdCompact(0)).toBe("$0");
  });
});

describe("formatCountCompact", () => {
  it("keeps missing values as a dash and does not coerce them to zero", () => {
    expect(formatCountCompact(null)).toBe("—");
    expect(formatCountCompact(undefined)).toBe("—");
    expect(formatCountCompact(Number.NaN)).toBe("—");
  });

  it("compacts thousands and leaves smaller counts exact", () => {
    expect(formatCountCompact(0)).toBe("0");
    expect(formatCountCompact(68)).toBe("68");
    expect(formatCountCompact(6130)).toBe("6.13K");
  });
});
