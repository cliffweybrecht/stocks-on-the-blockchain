import { describe, expect, it } from "vitest";
import type { AssetSummary } from "../../market/types";
import { PRICE_TICKER_MIN_VOLUME_USD, deskSpotPriceUsd, selectEquityPriceTicker } from "../price-ticker";

function row(
  partial: Partial<AssetSummary> & Pick<AssetSummary, "symbol" | "contractAddress" | "volume24hUsd" | "dexMedianPriceUsd">,
): AssetSummary {
  return {
    chainId: "solana",
    sourceId: "solana",
    sourceLabel: "test",
    name: partial.symbol,
    issuer: "Backed / xStocks",
    logoUrl: null,
    displayedLiquidityUsd: 1,
    usdGLiquidityUsd: null,
    poolCount: 1,
    dexCount: 1,
    pools: [],
    robinhoodReferencePriceUsd: null,
    premiumDiscountPct: null,
    top3ConcentrationPct: null,
    liquidityCoverageComplete: true,
    volume24hCoverageComplete: true,
    instrumentKind: "equity",
    volumeCoverage: "reported",
    coverageNote: null,
    priceChange24hPct: null,
    ...partial,
  };
}

describe("selectEquityPriceTicker", () => {
  it("keeps equities with ≥ $1M 24h volume and a DEX median price", () => {
    const items = selectEquityPriceTicker([
      row({ symbol: "TSLAx", contractAddress: "mint-tsla", volume24hUsd: 2_500_000, dexMedianPriceUsd: 248.2 }),
      row({ symbol: "LOWx", contractAddress: "mint-low", volume24hUsd: 999_999, dexMedianPriceUsd: 10 }),
      row({ symbol: "NOPRICEx", contractAddress: "mint-np", volume24hUsd: 5_000_000, dexMedianPriceUsd: null }),
      row({
        symbol: "SPYx",
        contractAddress: "mint-spy",
        volume24hUsd: 9_000_000,
        dexMedianPriceUsd: 500,
        instrumentKind: "etf",
      }),
    ]);
    expect(PRICE_TICKER_MIN_VOLUME_USD).toBe(1_000_000);
    expect(items.map((item) => item.symbol)).toEqual(["TSLAx"]);
    expect(items[0]?.priceUsd).toBe(248.2);
    expect(items[0]?.href).toBe("/chains/solana/assets/TSLAx");
  });

  it("skips null volume, non-finite price, and non-positive price instead of inventing", () => {
    expect(
      selectEquityPriceTicker([
        row({ symbol: "A", contractAddress: "a", volume24hUsd: null, dexMedianPriceUsd: 12 }),
        row({ symbol: "B", contractAddress: "b", volume24hUsd: 2_000_000, dexMedianPriceUsd: 0 }),
        row({ symbol: "C", contractAddress: "c", volume24hUsd: 2_000_000, dexMedianPriceUsd: Number.NaN }),
        row({ symbol: "D", contractAddress: "d", volume24hUsd: 3_000_000, dexMedianPriceUsd: 0.00001 }),
      ]),
    ).toEqual([]);
    expect(deskSpotPriceUsd({ dexMedianPriceUsd: null })).toBeNull();
    expect(deskSpotPriceUsd({ dexMedianPriceUsd: 0 })).toBeNull();
    expect(deskSpotPriceUsd({ dexMedianPriceUsd: 0.00001 })).toBeNull();
  });

  it("ranks by reported 24h volume, then symbol", () => {
    const items = selectEquityPriceTicker([
      row({ symbol: "NVDAx", contractAddress: "n", volume24hUsd: 1_200_000, dexMedianPriceUsd: 100 }),
      row({ symbol: "AAPLx", contractAddress: "a", volume24hUsd: 4_000_000, dexMedianPriceUsd: 200 }),
    ]);
    expect(items.map((item) => item.symbol)).toEqual(["AAPLx", "NVDAx"]);
  });
});
