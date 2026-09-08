import { describe, expect, it } from "vitest";
import type { AssetSummary } from "../types";
import {
  aggregateDailyVolume,
  buildEquityVolumeHistory,
  collectEquityVolumeTargets,
  emptyEquityVolumeHistory,
  parseGeckoTerminalOhlcv,
  rankEquityVolumeTargets,
} from "../volume-history";

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
            [1_700_086_400, 2, 3, 1, 2, 40],
            [1_700_000_000, 1, 2, 1, 1, 10],
          ],
        },
      },
    });
    expect(candles).toEqual([
      { t: 1_700_000_000, volumeUsd: 10 },
      { t: 1_700_086_400, volumeUsd: 40 },
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
              [1_700_000_000, 1, 2, 1, 1, -5],
              [0, 1, 2, 1, 1, 9],
              ["bad", 1, 2, 1, 1, 9],
              [1_700_086_400, 1, 2, 1, 1, 12],
            ],
          },
        },
      }),
    ).toEqual([{ t: 1_700_086_400, volumeUsd: 12 }]);
  });
});

describe("collectEquityVolumeTargets", () => {
  it("keeps unique equity pools and excludes the ETF lane", () => {
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
    ]);
    expect(targets.map((row) => row.pairAddress)).toEqual(["pool-a", "pool-b"]);
    expect(rankEquityVolumeTargets(targets, 1).map((row) => row.pairAddress)).toEqual(["pool-a"]);
  });
});

describe("aggregateDailyVolume", () => {
  it("sums observed days across pools and never fills missing days", () => {
    const points = aggregateDailyVolume([
      {
        pairAddress: "a",
        candles: [
          { t: 100, volumeUsd: 10 },
          { t: 300, volumeUsd: 5 },
        ],
      },
      {
        pairAddress: "b",
        candles: [{ t: 100, volumeUsd: 2 }],
      },
    ]);
    expect(points).toEqual([
      { t: 100, volumeUsd: 12 },
      { t: 300, volumeUsd: 5 },
    ]);
    expect(points.map((point) => point.t)).not.toContain(200);
  });

  it("keeps a source-reported zero and does not invent zeros for gaps", () => {
    const points = aggregateDailyVolume([
      {
        pairAddress: "a",
        candles: [
          { t: 100, volumeUsd: 0 },
          { t: 300, volumeUsd: 4 },
        ],
      },
    ]);
    expect(points).toEqual([
      { t: 100, volumeUsd: 0 },
      { t: 300, volumeUsd: 4 },
    ]);
  });

  it("returns an empty series when no pool candles exist", () => {
    expect(aggregateDailyVolume([{ pairAddress: "a", candles: [] }])).toEqual([]);
    expect(buildEquityVolumeHistory({ seriesByPool: [], attemptedPoolCount: 3, mintCount: 2 }).available).toBe(
      false,
    );
    expect(emptyEquityVolumeHistory("none").points).toEqual([]);
  });

  it("labels fetched coverage separately from the snapshot universe", () => {
    const history = buildEquityVolumeHistory({
      seriesByPool: [
        { pairAddress: "a", candles: [{ t: 100, volumeUsd: 3 }] },
        { pairAddress: "b", candles: [] },
      ],
      attemptedPoolCount: 2,
      universePoolCount: 40,
      mintCount: 12,
    });
    expect(history.available).toBe(true);
    expect(history.definition).toMatch(/1 of 2 fetched highest-volume pools/);
    expect(history.definition).toMatch(/40 classified equity pools \/ 12 mints/);
  });
});
