import { describe, expect, it } from "vitest";
import { formatChartClock, formatCountCompact, formatTokenAmount, formatUsdCompact } from "../format";

describe("formatUsdCompact", () => {
  it("formats zero as $0 on both server and client", () => {
    expect(formatUsdCompact(0)).toBe("$0");
  });

  it("keeps a trailing zero so server and browser render the same millions", () => {
    expect(formatUsdCompact(8_958_806)).toBe("$9.0M");
    expect(formatUsdCompact(9.6)).toBe("$9.6");
    expect(formatUsdCompact(743.9)).toBe("$743.9");
  });
});

describe("formatChartClock", () => {
  it("labels the same instant in America/New_York, EDT in September and EST in January", () => {
    const sep29 = (hour: string) => Date.parse(`2026-09-29T${hour}:00:00.000Z`) / 1000;
    expect(formatChartClock(sep29("20"))).toBe("4:00 PM");
    expect(formatChartClock(sep29("04"))).toBe("12:00 AM");
    expect(formatChartClock(sep29("11"))).toBe("7:00 AM");
    expect(formatChartClock(sep29("19"))).toBe("3:00 PM");
    expect(formatChartClock(Date.parse("2026-01-15T20:00:00.000Z") / 1000)).toBe("3:00 PM");
    expect(formatChartClock(Number.NaN)).toBe("");
  });
});

describe("formatTokenAmount", () => {
  it("compacts thousands and leaves a dash when the count is missing", () => {
    expect(formatTokenAmount(null)).toBe("—");
    expect(formatTokenAmount(43_930)).toBe("43.93K");
    expect(formatTokenAmount(12.5)).toBe("12.5");
    expect(formatTokenAmount(2)).toBe("2");
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
