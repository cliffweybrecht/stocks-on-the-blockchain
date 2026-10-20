import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LendingHistoryChart } from "./lending-history";
import { LendingStockCompare } from "./lending-stock-compare";
import { buildLendingCompare } from "@/lib/market/lending-compare";
import type { LendingHistoryPoint, LendingRow } from "@/lib/market/lending-snapshot";

function row(partial: Partial<LendingRow> & Pick<LendingRow, "id" | "venue">): LendingRow {
  return {
    chainId: "solana",
    chainLabel: "Solana",
    collateralUsd: 100,
    stableBorrowedUsd: 40,
    lendSupplyUsd: 80,
    utilization: 0.5,
    borrowApy: 0.04,
    borrowApyMin: 0.04,
    borrowApyMax: 0.04,
    stockBorrowedUsd: null,
    borrowEstimate: null,
    source: "https://api.kamino.finance/example",
    error: null,
    assets: [{ symbol: "NVDAx", address: "mint", collateralUsd: 100, collateralTokens: 2, maxLtv: 0.55 }],
    ...partial,
  };
}

describe("lending compare markup", () => {
  it("shows the stock list, a dash for a missing cost, and the Venus estimate label", () => {
    const model = buildLendingCompare(
      [
        row({ id: "kamino-xstocks", venue: "Kamino xStocks" }),
        row({
          id: "venus-bnb",
          venue: "Venus",
          chainId: "bnb",
          chainLabel: "BNB",
          borrowApy: null,
          borrowApyMin: null,
          borrowApyMax: null,
          lendSupplyUsd: null,
          utilization: null,
          stableBorrowedUsd: 12,
          source: "https://api.venus.io/markets/core-pool",
          borrowEstimate: { method: "pro-rata", asOf: "2026-10-14T04:05:54.597Z", lowerBoundUsd: 4 },
          assets: [{ symbol: "NVDAB", address: "0x02fca66c1d1afb4e2a7884261eb00f63598a7436", collateralUsd: null, collateralTokens: null, maxLtv: 0.6 }],
        }),
      ],
      "2026-10-14T04:05:54.597Z",
    );
    const html = renderToStaticMarkup(createElement(LendingStockCompare, { model, initialTicker: "NVDA" }));
    expect(html).toContain("Stocks people lock up");
    expect(html).toContain("Where to borrow against NVDA");
    expect(html).toContain("pro-rata estimate");
    expect(html).toContain("does not publish its own lend supply");
    expect(html).toContain("api.venus.io");
    expect(html).toContain("0x02fca66c1d1afb4e2a7884261eb00f63598a7436");
    expect(html).toContain("—");
    expect(html).toMatch(/E[DS]T/);
  });

  it("draws stock, borrowed, and how full for the selected day window", () => {
    const history: LendingHistoryPoint[] = [
      { date: "2026-10-08", capturedAt: "2026-10-09T04:00:00.000Z", collateralUsd: 10, stableBorrowedUsd: 4, utilization: 0.4 },
      { date: "2026-10-13", capturedAt: "2026-10-14T04:00:00.000Z", collateralUsd: 12, stableBorrowedUsd: null, utilization: null },
    ];
    const html = renderToStaticMarkup(createElement(LendingHistoryChart, { history, initialRange: "7d" }));
    expect(html).toContain('data-lending-history="line"');
    expect(html).toContain('data-lending-history-range="7d"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("7 days");
    expect(html).toContain("30 days");
    expect(html).toContain("Jupiter Lend, Venus, and Frankencoin are left out");
    expect(html).toContain("borrowed —");
    expect(html).toContain("Daily snapshots on this desk");
  });
});
