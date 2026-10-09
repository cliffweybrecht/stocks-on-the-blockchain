import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EquityCard } from "./equity-card";
import { formatUsdCompact } from "@/lib/market/format";
import type { AssetSummary } from "@/lib/market/types";

function asset(partial: Partial<AssetSummary> = {}): AssetSummary {
  return {
    chainId: "solana",
    sourceId: "solana",
    sourceLabel: "test",
    symbol: "AAPLx",
    name: "Apple xStock",
    contractAddress: "mint-aapl",
    issuer: "xStocks",
    logoUrl: null,
    volume24hUsd: 12_000,
    displayedLiquidityUsd: 4_000,
    usdGLiquidityUsd: null,
    poolCount: 2,
    dexCount: 1,
    pools: [],
    robinhoodReferencePriceUsd: null,
    dexMedianPriceUsd: 215.5,
    premiumDiscountPct: null,
    top3ConcentrationPct: null,
    liquidityCoverageComplete: true,
    volume24hCoverageComplete: true,
    volumeCoverage: "reported",
    coverageNote: null,
    instrumentKind: "equity",
    priceChange24hPct: 1.2,
    ...partial,
  };
}

describe("EquityCard range headline", () => {
  it("keeps the live Vol figure on 24H", () => {
    const html = renderToStaticMarkup(createElement(EquityCard, { asset: asset(), href: "/chains/solana/assets/AAPLx" }));
    expect(html).toContain('data-card-range="24h"');
    expect(html).toContain("Vol");
    expect(html).not.toContain("data-card-range-days");
    expect(html).toContain(formatUsdCompact(12_000));
    expect(html).not.toContain("data-card-holders");
    expect(html).not.toContain(">Holders<");
    expect(html).not.toContain("data-card-supply");
  });

  it("shows the closed-range sum, its label, and a partial-day hint", () => {
    const html = renderToStaticMarkup(
      createElement(EquityCard, {
        asset: asset(),
        href: "/chains/solana/assets/AAPLx",
        rangeVolume: { id: "7d", volumeUsd: 3_898_895.25, days: 4 },
      }),
    );
    expect(html).toContain('data-card-range="7d"');
    expect(html).toContain("7D vol");
    expect(html).toContain("4 of 7 days");
    expect(html).toContain('data-card-range-days');
    expect(html).toContain(formatUsdCompact(3_898_895.25));
    expect(html).not.toContain(formatUsdCompact(12_000));
  });

  it("renders the existing dash when the range has no recorded days", () => {
    const html = renderToStaticMarkup(
      createElement(EquityCard, {
        asset: asset({ volume24hUsd: 12_000 }),
        href: "/chains/solana/assets/AAPLx",
        rangeVolume: { id: "30d", volumeUsd: null, days: 0 },
      }),
    );
    expect(html).toContain("30D vol");
    expect(html).toContain(formatUsdCompact(null));
    expect(html).not.toContain("data-card-range-days");
    expect(html).not.toContain(formatUsdCompact(12_000));
  });
});
