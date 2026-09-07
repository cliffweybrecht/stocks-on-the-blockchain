import { describe, expect, it } from "vitest";
import { sumNullable } from "../numbers";
import { mapTerminalRowToAsset, mapTerminalSnapshot, unwrapSnapshot } from "../map-terminal";
import { ROBINHOOD_CHAIN_ID } from "../types";

const sampleRow = {
  asset: {
    symbol: "NVDA",
    name: "NVIDIA • Robinhood Token",
    contractAddress: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC",
    logoUrl: null,
  },
  displayedLiquidityUsd: 4_508_145.59,
  usdGLiquidityUsd: 3_900_000,
  poolCount: 30,
  dexCount: 4,
  observedVolume24h: 13_386_716.29,
  buys24h: 10166,
  sells24h: 9316,
  largestPoolLiquidityUsd: 2_762_395.14,
  top1ConcentrationPct: 61.3,
  top3ConcentrationPct: 71.4,
  top5ConcentrationPct: 82.1,
  liquidityCoverageComplete: true,
  volume24hCoverageComplete: true,
  robinhoodReferencePriceUsd: 215.275,
  dexLiquidityWeightedPriceUsd: 216.026,
  dexMedianPriceUsd: 216.077,
  premiumDiscountPct: 0.3725,
  priceDispersionPct: 4.87,
  priceCoverageComplete: true,
};

describe("unwrapSnapshot", () => {
  it("reads Terminal { data, cache } envelope", () => {
    const result = unwrapSnapshot({
      data: { rows: [sampleRow], generatedAt: "2026-09-06T18:40:00.000Z" },
      cache: { status: "fresh", ageMs: 12 },
    });
    expect(result.cacheStatus).toBe("fresh");
    expect(result.cacheAgeMs).toBe(12);
    expect(Array.isArray(result.snapshot.rows)).toBe(true);
  });

  it("accepts a bare snapshot", () => {
    const result = unwrapSnapshot({ rows: [], generatedAt: "2026-09-06T18:40:00.000Z" });
    expect(result.snapshot.rows).toEqual([]);
  });
});

describe("mapTerminalRowToAsset", () => {
  it("maps Terminal liquidity fields without inventing zeros", () => {
    const asset = mapTerminalRowToAsset({
      ...sampleRow,
      observedVolume24h: null,
      displayedLiquidityUsd: 0,
    });
    expect(asset?.volume24hUsd).toBeNull();
    expect(asset?.displayedLiquidityUsd).toBe(0);
    expect(asset?.chainId).toBe(ROBINHOOD_CHAIN_ID);
  });

  it("drops rows without identity", () => {
    expect(mapTerminalRowToAsset({ observedVolume24h: 1 })).toBeNull();
  });
});

describe("mapTerminalSnapshot", () => {
  it("rolls a single-chain Terminal snapshot into one honest chain entry", () => {
    const mapped = mapTerminalSnapshot({
      snapshot: {
        generatedAt: "2026-09-06T18:40:00.000Z",
        refreshStartedAt: "2026-09-06T18:36:00.000Z",
        refreshDurationMs: 196_000,
        assetsRequested: 3,
        assetsSucceeded: 3,
        assetsFailed: 0,
        completeness: { complete: true, successPct: 100 },
        rows: [
          sampleRow,
          {
            asset: { symbol: "HOOD", name: "HOOD", contractAddress: "0xhood" },
            observedVolume24h: null,
            displayedLiquidityUsd: 210_400,
            poolCount: 2,
            dexCount: 1,
          },
        ],
      },
      cacheStatus: "fresh",
      cacheAgeMs: 0,
      fetchedAt: "2026-09-06T18:41:00.000Z",
      sourceId: "terminal",
      sourceLabel: "Terminal",
      notes: ["live"],
    });

    expect(mapped.chain.id).toBe(ROBINHOOD_CHAIN_ID);
    expect(mapped.chain.nativeChainId).toBe("4663");
    expect(mapped.assets).toHaveLength(2);
    expect(mapped.chain.volume24hUsd).toBe(13_386_716.29);
    expect(mapped.chain.displayedLiquidityUsd).toBe(4_508_145.59 + 210_400);
    expect(mapped.chain.assetsWithVolume).toBe(1);
    expect(mapped.assets[0]?.symbol).toBe("NVDA");
    expect(mapped.details[0]?.price.premiumDiscountPct).toBeCloseTo(0.3725);
  });
});

describe("sumNullable", () => {
  it("keeps missing distinct from zero", () => {
    expect(sumNullable([null, null])).toBeNull();
    expect(sumNullable([0, null])).toBe(0);
    expect(sumNullable([2, 3])).toBe(5);
  });
});
