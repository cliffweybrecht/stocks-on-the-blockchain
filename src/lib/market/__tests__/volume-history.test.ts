import { describe, expect, it } from "vitest";
import type { AssetSummary } from "../types";
import {
  aggregateDailyVolume,
  alignLatestDayWithDesk24h,
  buildEquityVolumeHistory,
  buildMintWeekVolumeSeries,
  collectEquityVolumeTargets,
  emptyEquityVolumeHistory,
  fillMissingCalendarDays,
  parseGeckoTerminalOhlcv,
  rankEquityVolumeTargets,
  selectEquityVolumeFetchTargets,
  sliceWeekVolumeSeries,
  utcDayStart,
  UTC_DAY_SECONDS,
  volumeSparklineDirection,
} from "../volume-history";

const DAY0 = 1_699_920_000; // 2023-11-14 00:00 UTC
const DAY1 = DAY0 + UTC_DAY_SECONDS;
const DAY2 = DAY0 + 2 * UTC_DAY_SECONDS;
const DAY3 = DAY0 + 3 * UTC_DAY_SECONDS;

function equity(partial: Partial<AssetSummary> & Pick<AssetSummary, "symbol" | "contractAddress">): AssetSummary {
  return {
    chainId: "solana",
    sourceId: "solana",
    sourceLabel: "test",
    name: partial.symbol,
    issuer: "Backed / xStocks",
    logoUrl: null,
    volume24hUsd: 10,
    displayedLiquidityUsd: 1,
    usdGLiquidityUsd: null,
    poolCount: 1,
    dexCount: 1,
    pools: [],
    robinhoodReferencePriceUsd: null,
    dexMedianPriceUsd: null,
    premiumDiscountPct: null,
    top3ConcentrationPct: null,
    liquidityCoverageComplete: true,
    volume24hCoverageComplete: true,
    instrumentKind: "equity",
    volumeCoverage: "reported",
    coverageNote: null,
    ...partial,
  };
}

describe("parseGeckoTerminalOhlcv", () => {
  it("reads daily candles and sorts oldest first", () => {
    const candles = parseGeckoTerminalOhlcv({
      data: {
        type: "ohlcv_request_response",
        attributes: {
          ohlcv_list: [
            [DAY1 + 3_600, 2, 3, 1, 2, 40],
            [DAY0 + 3_600, 1, 2, 1, 1, 10],
          ],
        },
      },
    });
    expect(candles).toEqual([
      { t: DAY0 + 3_600, volumeUsd: 10 },
      { t: DAY1 + 3_600, volumeUsd: 40 },
    ]);
  });

  it("drops invalid rows instead of inventing volume", () => {
    expect(parseGeckoTerminalOhlcv("nope")).toEqual([]);
    expect(parseGeckoTerminalOhlcv({ data: { attributes: {} } })).toEqual([]);
    expect(
      parseGeckoTerminalOhlcv({
        data: {
          attributes: {
            ohlcv_list: [
              [DAY0, 1, 2, 1, 1, -5],
              [0, 1, 2, 1, 1, 9],
              ["bad", 1, 2, 1, 1, 9],
              [DAY1, 1, 2, 1, 1, 12],
            ],
          },
        },
      }),
    ).toEqual([{ t: DAY1, volumeUsd: 12 }]);
  });
});

describe("collectEquityVolumeTargets", () => {
  it("keeps unique equity pools and excludes the ETF and private-market lanes", () => {
    const targets = collectEquityVolumeTargets([
      equity({
        symbol: "TSLAx",
        contractAddress: "mint-tsla",
        pools: [
          { pairAddress: "pool-a", dexId: "raydium", volume24hUsd: 100, liquidityUsd: 1, priceUsd: 1 },
          { pairAddress: "pool-b", dexId: "orca", volume24hUsd: 20, liquidityUsd: 1, priceUsd: 1 },
          { pairAddress: "  ", dexId: "ignore", volume24hUsd: 999, liquidityUsd: 1, priceUsd: 1 },
        ],
      }),
      equity({
        symbol: "SPYx",
        contractAddress: "mint-spy",
        instrumentKind: "etf",
        pools: [{ pairAddress: "pool-etf", dexId: "raydium", volume24hUsd: 9_000, liquidityUsd: 1, priceUsd: 1 }],
      }),
      equity({
        symbol: "OPENAI",
        contractAddress: "mint-openai",
        instrumentKind: "private",
        pools: [{ pairAddress: "pool-private", dexId: "raydium", volume24hUsd: 8_000, liquidityUsd: 1, priceUsd: 1 }],
      }),
    ]);
    expect(targets.map((row) => row.pairAddress)).toEqual(["pool-a", "pool-b"]);
    expect(rankEquityVolumeTargets(targets, 1).map((row) => row.pairAddress)).toEqual(["pool-a"]);
  });

  it("prefers reported DexScreener 24h pools when selecting fetch targets", () => {
    const targets = collectEquityVolumeTargets([
      equity({
        symbol: "NFLXx",
        contractAddress: "mint-nflx",
        pools: [{ pairAddress: "pool-null", dexId: "raydium", volume24hUsd: null, liquidityUsd: 1, priceUsd: 1 }],
      }),
      equity({
        symbol: "TSLAx",
        contractAddress: "mint-tsla",
        pools: [{ pairAddress: "pool-hot", dexId: "raydium", volume24hUsd: 50, liquidityUsd: 1, priceUsd: 1 }],
      }),
    ]);
    expect(selectEquityVolumeFetchTargets(targets, 1).map((row) => row.pairAddress)).toEqual(["pool-hot"]);
  });
});

describe("aggregateDailyVolume", () => {
  it("sums observed UTC days across pools without filling gaps", () => {
    const points = aggregateDailyVolume([
      {
        pairAddress: "a",
        candles: [
          { t: DAY0 + 100, volumeUsd: 10 },
          { t: DAY2 + 100, volumeUsd: 5 },
        ],
      },
      {
        pairAddress: "b",
        candles: [{ t: DAY0 + 200, volumeUsd: 2 }],
      },
    ]);
    expect(points).toEqual([
      { t: DAY0, volumeUsd: 12, kind: "calendar_day" },
      { t: DAY2, volumeUsd: 5, kind: "calendar_day" },
    ]);
    expect(points.map((point) => point.t)).not.toContain(DAY1);
  });

  it("is per-day volume, not a running total", () => {
    const points = aggregateDailyVolume([
      {
        pairAddress: "a",
        candles: [
          { t: DAY0, volumeUsd: 10 },
          { t: DAY1, volumeUsd: 4 },
          { t: DAY2, volumeUsd: 9 },
        ],
      },
    ]);
    expect(points.map((point) => point.volumeUsd)).toEqual([10, 4, 9]);
    expect(points[2]?.volumeUsd).not.toBe(23);
    const history = buildEquityVolumeHistory({
      seriesByPool: [{ pairAddress: "a", candles: points.map((point) => ({ t: point.t, volumeUsd: point.volumeUsd })) }],
      attemptedPoolCount: 1,
      mintCount: 1,
      nowT: DAY2,
      generatedAt: new Date(DAY2 * 1000).toISOString(),
    });
    expect(history.definition).toMatch(/Per-day GeckoTerminal USD volume/i);
    expect(history.definition).not.toMatch(/cumulative|inception/i);
  });

  it("keeps a source-reported zero", () => {
    const points = aggregateDailyVolume([
      {
        pairAddress: "a",
        candles: [
          { t: DAY0, volumeUsd: 0 },
          { t: DAY2, volumeUsd: 4 },
        ],
      },
    ]);
    expect(points).toEqual([
      { t: DAY0, volumeUsd: 0, kind: "calendar_day" },
      { t: DAY2, volumeUsd: 4, kind: "calendar_day" },
    ]);
  });

  it("returns an empty series when no pool candles exist", () => {
    expect(aggregateDailyVolume([{ pairAddress: "a", candles: [] }])).toEqual([]);
    expect(buildEquityVolumeHistory({ seriesByPool: [], attemptedPoolCount: 3, mintCount: 2 }).available).toBe(
      false,
    );
    expect(emptyEquityVolumeHistory("none").points).toEqual([]);
    expect(emptyEquityVolumeHistory("none").seriesByMint).toEqual({});
  });
});

describe("fillMissingCalendarDays", () => {
  it("inserts $0 for every UTC day in the gap and never invents nonzero volume", () => {
    const filled = fillMissingCalendarDays([
      { t: DAY0, volumeUsd: 12 },
      { t: DAY2, volumeUsd: 5 },
    ]);
    expect(filled).toEqual([
      { t: DAY0, volumeUsd: 12, kind: "calendar_day" },
      { t: DAY1, volumeUsd: 0, kind: "calendar_day" },
      { t: DAY2, volumeUsd: 5, kind: "calendar_day" },
    ]);
  });

  it("extends through an explicit end day with zeros", () => {
    const filled = fillMissingCalendarDays([{ t: DAY0, volumeUsd: 3 }], DAY2);
    expect(filled.map((point) => [point.t, point.volumeUsd])).toEqual([
      [DAY0, 3],
      [DAY1, 0],
      [DAY2, 0],
    ]);
  });
});

describe("alignLatestDayWithDesk24h", () => {
  it("replaces today with the DexScreener 24h rollup", () => {
    const aligned = alignLatestDayWithDesk24h(
      [
        { t: DAY0, volumeUsd: 10 },
        { t: DAY1, volumeUsd: 3 },
      ],
      27_300_000,
      DAY1 + 3_600,
    );
    expect(aligned[aligned.length - 1]).toEqual({ t: DAY1, volumeUsd: 27_300_000, kind: "rolling_24h" });
    expect(aligned[0]).toEqual({ t: DAY0, volumeUsd: 10, kind: "calendar_day" });
  });

  it("appends today when GeckoTerminal has not returned a candle yet", () => {
    const aligned = alignLatestDayWithDesk24h([{ t: DAY0, volumeUsd: 10 }], 100, DAY2 + 100);
    expect(aligned).toEqual([
      { t: DAY0, volumeUsd: 10, kind: "calendar_day" },
      { t: DAY1, volumeUsd: 0, kind: "calendar_day" },
      { t: DAY2, volumeUsd: 100, kind: "rolling_24h" },
    ]);
  });

  it("does not coerce a null desk 24h to zero", () => {
    const aligned = alignLatestDayWithDesk24h([{ t: DAY0, volumeUsd: 10 }, { t: DAY2, volumeUsd: 4 }], null, DAY3);
    expect(aligned.map((point) => point.volumeUsd)).toEqual([10, 0, 4]);
    expect(aligned.every((point) => point.kind !== "rolling_24h")).toBe(true);
  });

  it("can stand alone as a single desk-24h point when history is empty", () => {
    expect(alignLatestDayWithDesk24h([], 1_250.25, DAY1 + 10)).toEqual([
      { t: DAY1, volumeUsd: 1_250.25, kind: "rolling_24h" },
    ]);
    expect(alignLatestDayWithDesk24h([], null, DAY1)).toEqual([]);
  });
});

describe("buildEquityVolumeHistory", () => {
  it("fills gaps, aligns the latest point to desk 24h, and labels coverage", () => {
    const history = buildEquityVolumeHistory({
      seriesByPool: [
        {
          pairAddress: "a",
          candles: [
            { t: DAY0, volumeUsd: 3 },
            { t: DAY2, volumeUsd: 8 },
          ],
        },
        { pairAddress: "b", candles: [] },
      ],
      attemptedPoolCount: 2,
      universePoolCount: 40,
      mintCount: 12,
      volume24hUsd: 99,
      nowT: DAY3,
      generatedAt: new Date(DAY3 * 1000).toISOString(),
    });
    expect(history.available).toBe(true);
    expect(history.volume24hUsd).toBe(99);
    expect(history.points).toEqual([
      { t: DAY0, volumeUsd: 3, kind: "calendar_day" },
      { t: DAY1, volumeUsd: 0, kind: "calendar_day" },
      { t: DAY2, volumeUsd: 8, kind: "calendar_day" },
      { t: DAY3, volumeUsd: 99, kind: "rolling_24h" },
    ]);
    expect(history.definition).toMatch(/Missing calendar days are plotted as \$0/);
    expect(history.definition).toMatch(/DexScreener 24h public-equity rollup/);
    expect(history.definition).toMatch(/1 of 2 fetched highest-volume pools/);
    expect(history.definition).toMatch(/40 classified equity pools \/ 12 mints/);
    expect(history.definition).toMatch(/page headline adds reported private-market and ETF\/index 24h/);
    expect(history.definition).toMatch(/headline universe is broader/);
    expect(history.definition).not.toMatch(/ETF lane excluded/);
    expect(utcDayStart(DAY0 + 100)).toBe(DAY0);
  });

  it("uses a desk-only point when GeckoTerminal returns nothing but 24h is reported", () => {
    const history = buildEquityVolumeHistory({
      seriesByPool: [{ pairAddress: "a", candles: [] }],
      attemptedPoolCount: 1,
      mintCount: 1,
      volume24hUsd: 50,
      nowT: DAY0 + 100,
      generatedAt: new Date((DAY0 + 100) * 1000).toISOString(),
    });
    expect(history.available).toBe(true);
    expect(history.points).toEqual([{ t: DAY0, volumeUsd: 50, kind: "rolling_24h" }]);
    expect(history.definition).toMatch(/No GeckoTerminal daily candles/);
  });

  it("attaches a per-mint week series from the same pool candles", () => {
    const history = buildEquityVolumeHistory({
      seriesByPool: [
        {
          pairAddress: "pool-tsla",
          mint: "mint-tsla",
          candles: [
            { t: DAY0, volumeUsd: 10 },
            { t: DAY1, volumeUsd: 4 },
            { t: DAY2, volumeUsd: 20 },
          ],
        },
        {
          pairAddress: "pool-hood",
          mint: "mint-hood",
          candles: [
            { t: DAY0, volumeUsd: 50 },
            { t: DAY2, volumeUsd: 8 },
          ],
        },
      ],
      attemptedPoolCount: 2,
      mintCount: 2,
      volume24hByMint: { "mint-tsla": 22, "mint-hood": 9 },
      nowT: DAY2 + 3_600,
      generatedAt: new Date((DAY2 + 3_600) * 1000).toISOString(),
    });
    expect(history.seriesByMint["mint-tsla"]?.map((point) => point.volumeUsd)).toEqual([10, 4, 22]);
    expect(history.seriesByMint["mint-hood"]?.map((point) => point.volumeUsd)).toEqual([50, 0, 9]);
    expect(volumeSparklineDirection(history.seriesByMint["mint-tsla"] ?? [])).toBe("up");
    expect(volumeSparklineDirection(history.seriesByMint["mint-hood"] ?? [])).toBe("down");
  });
});

describe("week volume sparkline series", () => {
  it("slices the last 7 UTC days and does not invent a week from a single 24h point", () => {
    const points = [
      { t: DAY0, volumeUsd: 3, kind: "calendar_day" as const },
      { t: DAY1, volumeUsd: 8, kind: "calendar_day" as const },
      { t: DAY2, volumeUsd: 1, kind: "calendar_day" as const },
    ];
    expect(sliceWeekVolumeSeries(points, DAY2, 2).map((point) => point.t)).toEqual([DAY1, DAY2]);
    expect(
      buildMintWeekVolumeSeries({
        seriesByPool: [{ pairAddress: "a", mint: "mint-a", candles: [] }],
        volume24hByMint: { "mint-a": 99 },
        nowT: DAY2,
      }),
    ).toEqual({});
  });

  it("omits mints without candles and never fabricates a series", () => {
    expect(
      buildMintWeekVolumeSeries({
        seriesByPool: [
          { pairAddress: "a", mint: "mint-a", candles: [] },
          { pairAddress: "b", candles: [{ t: DAY0, volumeUsd: 4 }] },
        ],
        nowT: DAY2,
      }),
    ).toEqual({});
  });

  it("needs two points before calling a direction", () => {
    expect(volumeSparklineDirection([])).toBeNull();
    expect(volumeSparklineDirection([{ t: DAY0, volumeUsd: 4 }])).toBeNull();
    expect(
      volumeSparklineDirection([
        { t: DAY0, volumeUsd: 4 },
        { t: DAY1, volumeUsd: 4 },
      ]),
    ).toBe("flat");
  });
});
