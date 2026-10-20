import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AssetTable } from "./asset-table";
import { DeskVolumeRangeProvider } from "./desk-volume-range";
import { equityCardLiquidityHistoryFromSnapshot } from "@/lib/market/equity-card-range-liquidity";
import type { AssetSummary } from "@/lib/market/types";

function asset(partial: Partial<AssetSummary> & Pick<AssetSummary, "symbol" | "contractAddress">): AssetSummary {
  return {
    chainId: "solana",
    sourceId: "solana",
    sourceLabel: "test",
    name: partial.symbol,
    issuer: "xStocks",
    logoUrl: null,
    volume24hUsd: 10,
    displayedLiquidityUsd: 1,
    usdGLiquidityUsd: null,
    poolCount: 1,
    dexCount: 1,
    pools: [],
    robinhoodReferencePriceUsd: null,
    dexMedianPriceUsd: 10,
    premiumDiscountPct: null,
    top3ConcentrationPct: null,
    liquidityCoverageComplete: true,
    volume24hCoverageComplete: true,
    volumeCoverage: "reported",
    coverageNote: null,
    instrumentKind: "equity",
    priceChange24hPct: null,
    ...partial,
  };
}

function day(date: string, assets: unknown[]) {
  return { date, combined24hUsd: 1, generatedAt: `${date}T16:00:00.000Z`, assets };
}

/** Oct 7 is still open, so Oct 6 is the 24H close. */
const NOW = Date.parse("2026-10-08T03:00:00Z") / 1000;

function renderDesk(range: "7d" | "14d") {
  const history = equityCardLiquidityHistoryFromSnapshot(
    {
      records: [
        day("2026-09-20", [
          { address: "wide", displayedLiquidityUsd: 100 },
          { address: "narrow", displayedLiquidityUsd: 1 },
        ]),
        ...["2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"].map((date) => ({
          date,
          combined24hUsd: 1,
          generatedAt: `${date}T16:00:00.000Z`,
        })),
        day("2026-10-06", [
          { address: "wide", displayedLiquidityUsd: 4 },
          { address: "narrow", displayedLiquidityUsd: 50 },
        ]),
      ],
    },
    NOW,
  );
  const rows = [
    asset({ symbol: "WIDE", contractAddress: "wide", displayedLiquidityUsd: 3 }),
    asset({ symbol: "NARROW", contractAddress: "narrow", displayedLiquidityUsd: 3 }),
    asset({ symbol: "SPOT", contractAddress: "spot", displayedLiquidityUsd: 20 }),
  ];
  return renderToStaticMarkup(
    createElement(DeskVolumeRangeProvider, {
      volumes: {},
      liquidity: history,
      initialRange: range,
      children: createElement(AssetTable, {
        assets: rows,
        chainId: "base",
        totalInLane: rows.length,
        equityCount: rows.length,
        sortKey: "displayedLiquidityUsd",
      }),
    }),
  );
}

describe("AssetTable liquidity range", () => {
  it("reorders cards and labels the average for 7D and 14D", () => {
    const week = renderDesk("7d");
    const fortnight = renderDesk("14d");
    expect(week.indexOf("NARROW")).toBeLessThan(week.indexOf("SPOT"));
    expect(week.indexOf("SPOT")).toBeLessThan(week.indexOf("WIDE"));
    expect(fortnight.indexOf("WIDE")).toBeLessThan(fortnight.indexOf("NARROW"));
    expect(fortnight.indexOf("NARROW")).toBeLessThan(fortnight.indexOf("SPOT"));
    expect(week).toContain("avg 7D");
    expect(fortnight).toContain("avg 14D");
    expect(week).toContain("current");
    expect(week).not.toBe(fortnight);
  });
});
