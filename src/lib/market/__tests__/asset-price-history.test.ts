import { describe, expect, it } from "vitest";
import {
  buildAssetPriceHistory,
  emptyAssetPriceHistory,
  parseGeckoTerminalOhlcvSeries,
  parseGeckoTerminalPriceOhlcv,
  rankPoolsForMintPrice,
  readGeckoOhlcvBaseAddress,
  selectPrimaryPricePool,
} from "../asset-price-history";

const T0 = 1_700_000_000;
const HOUR = 3_600;

describe("parseGeckoTerminalPriceOhlcv", () => {
  it("reads close (index 4) and never treats volume as a price", () => {
    const points = parseGeckoTerminalPriceOhlcv({
      data: {
        attributes: {
          ohlcv_list: [
            [T0 + HOUR, 10, 12, 9, 11.5, 9_999],
            [T0, 8, 9, 7, 8.25, 1],
          ],
        },
      },
    });
    expect(points).toEqual([
      { t: T0, priceUsd: 8.25 },
      { t: T0 + HOUR, priceUsd: 11.5 },
    ]);
    expect(points.some((point) => point.priceUsd === 9_999)).toBe(false);
  });

  it("drops invalid or non-positive closes instead of inventing prices", () => {
    expect(parseGeckoTerminalPriceOhlcv("nope")).toEqual([]);
    expect(parseGeckoTerminalPriceOhlcv({ data: { attributes: {} } })).toEqual([]);
    expect(
      parseGeckoTerminalPriceOhlcv({
        data: {
          attributes: {
            ohlcv_list: [
              [T0, 1, 2, 1, 0, 40],
              [T0 + HOUR, 1, 2, 1, -3, 40],
              [0, 1, 2, 1, 9, 40],
              [T0 + 2 * HOUR, 1, 2, 1, 12, 40],
              [T0 + 3 * HOUR, 1, 2, 1],
            ],
          },
        },
      }),
    ).toEqual([{ t: T0 + 2 * HOUR, priceUsd: 12 }]);
  });
});

describe("parseGeckoTerminalOhlcvSeries", () => {
  it("reads volume from the sixth element and keeps a reported 0", () => {
    const parsed = parseGeckoTerminalOhlcvSeries({
      data: {
        attributes: {
          ohlcv_list: [
            [T0, 8, 9, 7, 8.25, 0],
            [T0 + HOUR, 10, 12, 9, 11.5, 40],
            [T0 + 2 * HOUR, 10, 12, 9, 12],
            [T0 + 3 * HOUR, 10, 12, 9, 13, Number.NaN],
          ],
        },
      },
    });
    expect(parsed.volumes).toEqual([
      { t: T0, volumeUsd: 0 },
      { t: T0 + HOUR, volumeUsd: 40 },
    ]);
    expect(parsed.prices.map((point) => point.t)).toEqual([T0, T0 + HOUR, T0 + 2 * HOUR, T0 + 3 * HOUR]);
  });
});

describe("selectPrimaryPricePool", () => {
  it("picks the highest-volume pair with a real address", () => {
    expect(
      selectPrimaryPricePool([
        { pairAddress: "  ", volume24hUsd: 9_000 },
        { pairAddress: "pool-b", volume24hUsd: 20 },
        { pairAddress: "pool-a", volume24hUsd: 100 },
      ]),
    ).toBe("pool-a");
  });

  it("returns null when no pair address exists", () => {
    expect(selectPrimaryPricePool([{ pairAddress: "", volume24hUsd: 10 }])).toBeNull();
    expect(selectPrimaryPricePool([])).toBeNull();
  });

  it("prefers the highest-volume pool where this mint is the base token", () => {
    expect(
      selectPrimaryPricePool(
        [
          { pairAddress: "meme", volume24hUsd: 9_000, baseAddress: "other" },
          { pairAddress: "real", volume24hUsd: 100, baseAddress: "mint-a" },
        ],
        "mint-a",
      ),
    ).toBe("real");
  });
});

describe("rankPoolsForMintPrice", () => {
  it("asks base-token pools before quote-side pools and drops blanks", () => {
    expect(
      rankPoolsForMintPrice(
        [
          { pairAddress: " meme ", volume24hUsd: 9_000, baseAddress: "other" },
          { pairAddress: "", volume24hUsd: 99_000, baseAddress: "mint-a" },
          { pairAddress: "real-b", volume24hUsd: 50, baseAddress: "mint-a" },
          { pairAddress: "real-a", volume24hUsd: 80, baseAddress: "mint-a" },
        ],
        "mint-a",
      ),
    ).toEqual(["real-a", "real-b", "meme"]);
  });
});

describe("readGeckoOhlcvBaseAddress", () => {
  it("reads meta.base.address and ignores a missing base", () => {
    expect(
      readGeckoOhlcvBaseAddress({
        meta: { base: { address: " mint-a " } },
      }),
    ).toBe("mint-a");
    expect(readGeckoOhlcvBaseAddress({ data: { attributes: { ohlcv_list: [] } } })).toBeNull();
    expect(readGeckoOhlcvBaseAddress(null)).toBeNull();
  });
});

describe("buildAssetPriceHistory", () => {
  it("is unavailable when both series are empty", () => {
    const empty = buildAssetPriceHistory({ pairAddress: "pool-a", daily: [], hourly: [] });
    expect(empty.available).toBe(false);
    expect(empty.daily).toEqual([]);
    expect(empty.hourly).toEqual([]);
    expect(empty.dailyVolume).toEqual([]);
    expect(empty.hourlyVolume).toEqual([]);
    expect(empty.emptyReason).toMatch(/did not return usable USD closes/i);
  });

  it("uses same-pool candle volume and only falls back when that series is empty", () => {
    const fromCandles = buildAssetPriceHistory({
      pairAddress: "pool-a",
      daily: [{ t: T0, priceUsd: 10 }],
      hourly: [],
      dailyVolume: [{ t: T0, volumeUsd: 40 }],
      fallbackDailyVolume: [{ t: T0, volumeUsd: 99 }],
    });
    expect(fromCandles.dailyVolume).toEqual([{ t: T0, volumeUsd: 40 }]);

    const fallback = buildAssetPriceHistory({
      pairAddress: "pool-a",
      daily: [{ t: T0, priceUsd: 10 }],
      hourly: [],
      dailyVolume: [],
      fallbackDailyVolume: [{ t: T0, volumeUsd: 99 }],
    });
    expect(fallback.dailyVolume).toEqual([{ t: T0, volumeUsd: 99 }]);
  });

  it("keeps observed closes without filling gaps", () => {
    const history = buildAssetPriceHistory({
      pairAddress: "pool-a",
      daily: [
        { t: T0 + 86_400, priceUsd: 12 },
        { t: T0, priceUsd: 10 },
      ],
      hourly: [{ t: T0, priceUsd: 10.2 }],
    });
    expect(history.available).toBe(true);
    expect(history.daily.map((point) => point.t)).toEqual([T0, T0 + 86_400]);
    expect(history.emptyReason).toBeNull();
  });

  it("empty helper never invents a series", () => {
    const empty = emptyAssetPriceHistory("none");
    expect(empty.available).toBe(false);
    expect(empty.daily).toEqual([]);
    expect(empty.hourly).toEqual([]);
    expect(empty.dailyVolume).toEqual([]);
    expect(empty.hourlyVolume).toEqual([]);
    expect(empty.pairAddress).toBeNull();
  });
});
