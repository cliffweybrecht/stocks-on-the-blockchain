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

  it("shows the range liquidity average, its hint, and that range's sparkline", () => {
    const html = renderToStaticMarkup(
      createElement(EquityCard, {
        asset: asset(),
        href: "/chains/solana/assets/AAPLx",
        sortKey: "displayedLiquidityUsd",
        dayVolumeSeries: [
          { t: Date.now() / 1000 - 7200, volumeUsd: 50 },
          { t: Date.now() / 1000 - 3600, volumeUsd: 80 },
        ],
        rangeLiquidity: {
          id: "7d",
          liquidityUsd: 6_500,
          days: 4,
          series: [
            { date: "2026-10-01", t: 1, liquidityUsd: 4_000 },
            { date: "2026-10-03", t: 2, liquidityUsd: 9_000 },
          ],
        },
      }),
    );
    expect(html).toContain('data-card-range="7d"');
    expect(html).toContain('data-card-liq-basis="average"');
    expect(html).toContain("Liq");
    expect(html).toContain("avg 7D · 4 of 7 days");
    expect(html).toContain(formatUsdCompact(6_500));
    expect(html).not.toContain(formatUsdCompact(4_000));
    expect(html).toContain("AAPLx 7D liquidity");
    expect(html).not.toContain("24h volume trend");
  });

  it("uses the last closed day in 24H and the live figure only as current", () => {
    const closed = renderToStaticMarkup(
      createElement(EquityCard, {
        asset: asset(),
        href: "/chains/solana/assets/AAPLx",
        sortKey: "displayedLiquidityUsd",
        rangeLiquidity: { id: "24h", liquidityUsd: 9_100, days: 1, series: [{ date: "2026-10-06", t: 1, liquidityUsd: 9_100 }] },
      }),
    );
    expect(closed).toContain('data-card-liq-basis="close"');
    expect(closed).toContain("24H");
    expect(closed).toContain(formatUsdCompact(9_100));
    expect(closed).not.toContain('role="img"');

    const current = renderToStaticMarkup(
      createElement(EquityCard, {
        asset: asset(),
        href: "/chains/solana/assets/AAPLx",
        sortKey: "displayedLiquidityUsd",
        dayVolumeSeries: [
          { t: Date.now() / 1000 - 7200, volumeUsd: 50 },
          { t: Date.now() / 1000 - 3600, volumeUsd: 80 },
        ],
        rangeLiquidity: { id: "14d", liquidityUsd: null, days: 0, series: [] },
      }),
    );
    expect(current).toContain('data-card-liq-basis="current"');
    expect(current).toContain("current");
    expect(current).toContain(formatUsdCompact(4_000));
    expect(current).not.toContain("24h volume trend");
    expect(current).not.toContain('role="img"');
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

  it("shows captured supply × price and a dash when that snapshot is missing", () => {
    const recorded = renderToStaticMarkup(
      createElement(EquityCard, {
        asset: asset({ volume24hUsd: 12_000, displayedLiquidityUsd: 4_000 }),
        href: "/chains/solana/assets/AAPLx",
        sortKey: "marketValueUsd",
        rangeMarketValue: {
          id: "14d",
          marketValueUsd: 88_000,
          days: 1,
          recorded: true,
          series: [{ date: "2026-10-08", t: 1, marketValueUsd: 88_000 }],
        },
      }),
    );
    expect(recorded).toContain('data-card-metric="market-value"');
    expect(recorded).toContain('data-card-mkt-basis="average"');
    expect(recorded).toContain(formatUsdCompact(88_000));
    expect(recorded).toContain("Mkt");
    expect(recorded).toContain("avg 14D · 1 of 14 days");
    expect(recorded).not.toContain("Holders");

    const missing = renderToStaticMarkup(
      createElement(EquityCard, {
        asset: asset({ volume24hUsd: 12_000, displayedLiquidityUsd: 4_000 }),
        href: "/chains/solana/assets/AAPLx",
        sortKey: "marketValueUsd",
        rangeMarketValue: { id: "7d", marketValueUsd: null, days: 0, recorded: false, series: [] },
      }),
    );
    expect(missing).toContain('data-card-mkt-basis="missing"');
    expect(missing).toContain("No captured supply");
    expect(missing).toContain(formatUsdCompact(null));
    expect(missing).not.toContain(formatUsdCompact(12_000));
    expect(missing).not.toContain(formatUsdCompact(4_000));
    expect(missing).not.toContain("Holders");
  });
});
