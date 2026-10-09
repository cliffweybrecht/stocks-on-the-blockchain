import { describe, expect, it } from "vitest";
import { assetMatchesCoverageFilter } from "../volume-coverage";
import {
  chainDetailHasAssetRows,
  resolveSolanaDeskForDocument,
  solanaDeskFallbackDetail,
  withDocumentBudget,
} from "../document-budget";
import type { ChainDetailResult } from "../types";
import { SOLANA_SOURCE_LABEL } from "../trust";
import type { DeskVolumeSnapshot } from "../volume-snapshots";
import { utcInstantForDayKey } from "../volume-snapshots";

describe("withDocumentBudget", () => {
  it("returns the fallback when work is still pending", async () => {
    const started = Date.now();
    const result = await withDocumentBudget(new Promise<string>(() => undefined), "cached", 30);
    expect(result).toBe("cached");
    expect(Date.now() - started).toBeLessThan(500);
  });

  it("returns the finished value when work beats the budget", async () => {
    await expect(withDocumentBudget(Promise.resolve("live"), "cached", 200)).resolves.toBe("live");
  });
});

const NOW = Date.parse("2026-10-08T16:00:00.000Z") / 1000;

function day(date: string, extras: Partial<DeskVolumeSnapshot> = {}): DeskVolumeSnapshot {
  return {
    date,
    t: utcInstantForDayKey(date),
    publicEquity24hUsd: 1_000,
    private24hUsd: null,
    etfIndex24hUsd: null,
    combined24hUsd: 1_000,
    publicMintCount: 10,
    publicPoolCount: 4,
    generatedAt: `${date}T04:00:00.000Z`,
    ...extras,
  };
}

function emptyLive(): ChainDetailResult {
  return {
    chain: {
      id: "solana",
      name: "Solana",
      shortName: "SOL",
      nativeChainId: "solana",
      sourceId: "solana",
      sourceLabel: SOLANA_SOURCE_LABEL,
      completenessPct: null,
      etfCount: 0,
      etfVolume24hUsd: 50,
      privateCount: 0,
      privateVolume24hUsd: null,
      volumeAggregation: "all-pools",
      coverageNote: "live totals only",
      volume24hUsd: 80_000_000,
      displayedLiquidityUsd: null,
      usdGLiquidityUsd: null,
      assetCount: 1600,
      assetsWithVolume: 0,
      assetsWithPools: 0,
      assetsStillHydrating: 0,
      assetsWithNoIndexedPools: 0,
      reportedPoolCount: 20,
      peakDexCount: 0,
    },
    assets: [],
    etfAssets: [],
    privateAssets: [],
    provenance: {
      sourceId: "solana",
      sourceLabel: SOLANA_SOURCE_LABEL,
      fetchedAt: "2026-10-08T16:00:00.000Z",
      generatedAt: "2026-10-08T16:00:00.000Z",
      refreshStartedAt: null,
      refreshDurationMs: null,
      cacheStatus: "fresh",
      cacheAgeMs: 0,
      notes: [],
      sourceFailures: [],
    },
  };
}

describe("solana desk document assets", () => {
  const records: DeskVolumeSnapshot[] = [
    day("2026-10-03", {
      publicEquity24hUsd: 30_000_000,
      combined24hUsd: 33_000_000,
      assets: [
        {
          address: "mint-aapl",
          symbol: "AAPLx",
          issuer: "Backed",
          instrumentKind: "equity",
          volume24hUsd: 145_511.25,
          displayedLiquidityUsd: 788_633.84,
          pools: [
            {
              pairAddress: "pair-aapl",
              dexId: "raydium",
              volume24hUsd: 145_511.25,
              liquidityUsd: 788_633.84,
            },
          ],
        },
        {
          address: "mint-spy",
          symbol: "SPYx",
          instrumentKind: "etf",
          volume24hUsd: 9_000,
          displayedLiquidityUsd: 1_000,
          pools: [
            { pairAddress: "pair-spy", dexId: "orca", volume24hUsd: 9_000, liquidityUsd: 1_000 },
          ],
        },
        {
          address: "mint-spacex",
          symbol: "SPACEX",
          instrumentKind: "private",
          volume24hUsd: 500,
          displayedLiquidityUsd: null,
          pools: [{ pairAddress: "pair-spacex", dexId: "raydium", volume24hUsd: 500, liquidityUsd: null }],
        },
        {
          address: "mint-sec",
          symbol: "AAPL",
          issuer: "Securitize",
          instrumentKind: "equity",
          volume24hUsd: null,
          displayedLiquidityUsd: null,
          pools: [],
        },
      ],
    }),
    day("2026-10-07", {
      publicEquity24hUsd: 70_000_000,
      combined24hUsd: 81_272_910.46,
      publicMintCount: 1665,
      assets: undefined,
    }),
  ];

  it("returns per-asset rows from the latest nightly snapshot when the newest day is totals-only", () => {
    const detail = solanaDeskFallbackDetail(records, NOW);
    expect(detail?.chain.volume24hUsd).toBe(70_000_000);
    expect(detail?.assets.map((asset) => asset.symbol)).toEqual(["AAPLx", "AAPL"]);
    expect(detail?.etfAssets?.map((asset) => asset.symbol)).toEqual(["SPYx"]);
    expect(detail?.privateAssets?.map((asset) => asset.symbol)).toEqual(["SPACEX"]);
    const apple = detail?.assets.find((asset) => asset.symbol === "AAPLx");
    expect(apple).toMatchObject({
      contractAddress: "mint-aapl",
      issuer: "Backed",
      volume24hUsd: 145_511.25,
      displayedLiquidityUsd: 788_633.84,
      poolCount: 1,
      logoUrl: null,
      dexMedianPriceUsd: null,
      priceChange24hPct: null,
    });
    expect(apple?.pools[0]?.priceUsd).toBeNull();
    const securitize = detail?.assets.find((asset) => asset.issuer === "Securitize");
    expect(securitize?.volume24hUsd).toBeNull();
    expect(securitize?.displayedLiquidityUsd).toBeNull();
    expect(securitize && assetMatchesCoverageFilter(securitize, "no-pools")).toBe(true);
    expect(securitize && assetMatchesCoverageFilter(securitize, "all")).toBe(true);
    expect(securitize && assetMatchesCoverageFilter(securitize, "with-volume")).toBe(false);
  });

  it("prefers an in-memory desk that already has asset rows", () => {
    const live = emptyLive();
    live.assets = [
      {
        ...live.chain,
        chainId: "solana",
        sourceId: "solana",
        sourceLabel: SOLANA_SOURCE_LABEL,
        symbol: "TSLAx",
        name: "Tesla xStock",
        contractAddress: "mint-tsla",
        issuer: "Backed",
        logoUrl: null,
        volume24hUsd: 4_000,
        displayedLiquidityUsd: 9_000,
        usdGLiquidityUsd: null,
        poolCount: 1,
        dexCount: 1,
        pools: [],
        robinhoodReferencePriceUsd: null,
        dexMedianPriceUsd: null,
        premiumDiscountPct: null,
        top3ConcentrationPct: null,
        liquidityCoverageComplete: null,
        volume24hCoverageComplete: null,
        instrumentKind: "equity",
        volumeCoverage: "reported",
        coverageNote: null,
        priceChange24hPct: null,
      },
    ];
    const resolved = resolveSolanaDeskForDocument(live, records, NOW);
    expect(resolved?.assets.map((asset) => asset.symbol)).toEqual(["TSLAx"]);
    expect(resolved?.chain.volume24hUsd).toBe(80_000_000);
  });

  it("uses snapshot asset rows when the in-memory desk has totals and no assets", () => {
    const resolved = resolveSolanaDeskForDocument(emptyLive(), records, NOW);
    expect(chainDetailHasAssetRows(resolved)).toBe(true);
    expect(resolved?.assets.some((asset) => asset.symbol === "AAPLx")).toBe(true);
    expect(resolved?.assets.some((asset) => asset.symbol === "TSLAx")).toBe(false);
  });

  it("uses snapshot asset rows when this process has no in-memory desk", () => {
    const resolved = resolveSolanaDeskForDocument(null, records, NOW);
    expect(resolved?.assets.length).toBeGreaterThan(0);
    expect(resolved?.chain.volume24hUsd).toBe(70_000_000);
  });
});
