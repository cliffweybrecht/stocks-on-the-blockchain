import { describe, expect, it } from "vitest";
import { dexScreenerAmmVersion, dexScreenerOhlcvPath, parseDexScreenerOhlcvBars } from "../dexscreener-ohlcv";

describe("parseDexScreenerOhlcvBars", () => {
  it("reads closeUsd and volumeUsd and converts millisecond timestamps", () => {
    const parsed = parseDexScreenerOhlcvBars({
      bars: [
        { timestamp: 1_700_003_600_000, closeUsd: "241.25", volumeUsd: "12.5" },
        { timestamp: 1_700_000_000_000, closeUsd: "240", volumeUsd: 900 },
      ],
    });
    expect(parsed.prices).toEqual([
      { t: 1_700_000_000, priceUsd: 240 },
      { t: 1_700_003_600, priceUsd: 241.25 },
    ]);
    expect(parsed.volumes).toEqual([
      { t: 1_700_000_000, volumeUsd: 900 },
      { t: 1_700_003_600, volumeUsd: 12.5 },
    ]);
  });

  it("omits a bar that has no volume field instead of storing $0", () => {
    const parsed = parseDexScreenerOhlcvBars({
      bars: [{ timestamp: 1_700_000_000, closeUsd: "10" }],
    });
    expect(parsed.prices).toEqual([{ t: 1_700_000_000, priceUsd: 10 }]);
    expect(parsed.volumes).toEqual([]);
  });

  it("reads OHLCV tuples and does not treat a pair snapshot as candles", () => {
    expect(parseDexScreenerOhlcvBars({ ohlcv: [[1_700_000_000, 1, 2, 0.5, 1.5, 40]] })).toEqual({
      prices: [{ t: 1_700_000_000, priceUsd: 1.5 }],
      volumes: [{ t: 1_700_000_000, volumeUsd: 40 }],
    });
    expect(
      parseDexScreenerOhlcvBars({
        volume: { h24: 1_000_000, h6: 10, h1: 1, m5: 0 },
        priceUsd: "240",
      }),
    ).toEqual({ prices: [], volumes: [] });
    expect(parseDexScreenerOhlcvBars(null)).toEqual({ prices: [], volumes: [] });
  });
});

describe("dexScreenerOhlcvPath", () => {
  it("uses v4 for a 32-byte pool id and v3 for an address", () => {
    expect(dexScreenerAmmVersion("0x" + "ab".repeat(32))).toBe("v4");
    expect(dexScreenerAmmVersion("0x" + "ab".repeat(20))).toBe("v3");
    const day = dexScreenerOhlcvPath("0x" + "cd".repeat(32), { timeframe: "day", limit: 90 });
    expect(day).toContain("/dex/chart/amm/v4/robinhood/");
    expect(day).toContain("res=1440");
    expect(day).toContain("cb=90");
    const hour = dexScreenerOhlcvPath("0xpool", { timeframe: "hour" });
    expect(hour).toContain("/dex/chart/amm/v3/robinhood/0xpool");
    expect(hour).toContain("res=60");
  });
});
