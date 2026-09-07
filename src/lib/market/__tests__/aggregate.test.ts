import { describe, expect, it } from "vitest";
import { compareAssetsByRank, parseAssetSortKey, sortAssets, sortByVolumeThenLiquidity } from "../aggregate";
import type { RankableRow } from "../aggregate";

function row(partial: Partial<RankableRow> & { symbol: string }): RankableRow {
  return {
    volume24hUsd: null,
    displayedLiquidityUsd: null,
    poolCount: 0,
    volumeCoverage: "no_indexed_pools",
    ...partial,
  };
}

describe("compareAssetsByRank", () => {
  it("orders by coverage tier before volume, then liquidity, pools, and symbol", () => {
    const ranked = sortByVolumeThenLiquidity([
      row({ symbol: "NOOLx", volumeCoverage: "no_indexed_pools" }),
      row({ symbol: "FAILx", volumeCoverage: "hydrate_failed" }),
      row({ symbol: "LOADx", volumeCoverage: "hydrate_incomplete" }),
      row({
        symbol: "POOLx",
        volumeCoverage: "pools_without_volume",
        displayedLiquidityUsd: 50,
        poolCount: 2,
      }),
      row({
        symbol: "LOWVx",
        volume24hUsd: 1,
        displayedLiquidityUsd: 10,
        poolCount: 1,
        volumeCoverage: "reported",
      }),
      row({
        symbol: "HIVx",
        volume24hUsd: 100,
        displayedLiquidityUsd: 5,
        poolCount: 1,
        volumeCoverage: "reported",
      }),
      row({
        symbol: "HIVxB",
        volume24hUsd: 100,
        displayedLiquidityUsd: 20,
        poolCount: 1,
        volumeCoverage: "reported",
      }),
      row({
        symbol: "AAAx",
        volume24hUsd: 100,
        displayedLiquidityUsd: 20,
        poolCount: 4,
        volumeCoverage: "reported",
      }),
      row({
        symbol: "ZZZx",
        volume24hUsd: 100,
        displayedLiquidityUsd: 20,
        poolCount: 4,
        volumeCoverage: "reported",
      }),
      row({ symbol: "ZEROx", volume24hUsd: 0, poolCount: 1, volumeCoverage: "reported" }),
    ]);

    expect(ranked.map((asset) => asset.symbol)).toEqual([
      "AAAx",
      "ZZZx",
      "HIVxB",
      "HIVx",
      "LOWVx",
      "ZEROx",
      "POOLx",
      "LOADx",
      "FAILx",
      "NOOLx",
    ]);
  });

  it("never treats null volume as a zero when ranking", () => {
    const ranked = sortByVolumeThenLiquidity([
      row({ symbol: "MSFTx", volume24hUsd: null, displayedLiquidityUsd: 9, volumeCoverage: "no_indexed_pools" }),
      row({ symbol: "AAPLx", volume24hUsd: 0, displayedLiquidityUsd: 1, poolCount: 1, volumeCoverage: "reported" }),
      row({ symbol: "TSLAx", volume24hUsd: 10, displayedLiquidityUsd: 1, poolCount: 1, volumeCoverage: "reported" }),
    ]);
    expect(ranked.map((asset) => asset.symbol)).toEqual(["TSLAx", "AAPLx", "MSFTx"]);
  });

  it("uses the selected key as primary and keeps coverage + volume as tie-breaks", () => {
    const rows = [
      row({
        symbol: "A",
        volume24hUsd: 50,
        displayedLiquidityUsd: 1,
        poolCount: 1,
        volumeCoverage: "reported",
      }),
      row({
        symbol: "B",
        volume24hUsd: 10,
        displayedLiquidityUsd: 9,
        poolCount: 3,
        volumeCoverage: "reported",
      }),
      row({
        symbol: "C",
        volume24hUsd: null,
        displayedLiquidityUsd: 100,
        poolCount: 2,
        volumeCoverage: "pools_without_volume",
      }),
    ];
    expect(sortAssets(rows, "displayedLiquidityUsd").map((asset) => asset.symbol)).toEqual(["C", "B", "A"]);
    expect(sortAssets(rows, "poolCount").map((asset) => asset.symbol)).toEqual(["B", "C", "A"]);
    expect(compareAssetsByRank(rows[0]!, rows[1]!, "volume24hUsd")).toBeLessThan(0);
  });
});

describe("parseAssetSortKey", () => {
  it("maps query values and defaults to volume", () => {
    expect(parseAssetSortKey(undefined)).toBe("volume24hUsd");
    expect(parseAssetSortKey("liquidity")).toBe("displayedLiquidityUsd");
    expect(parseAssetSortKey("pools")).toBe("poolCount");
    expect(parseAssetSortKey("premium")).toBe("premiumDiscountPct");
    expect(parseAssetSortKey("nope")).toBe("volume24hUsd");
  });
});
