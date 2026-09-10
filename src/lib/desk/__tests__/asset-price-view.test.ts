import { describe, expect, it } from "vitest";
import {
  displayPriceChangePct,
  filterPriceRange,
  priceRangeChangePct,
  scalePricePoints,
} from "../asset-price-view";
import type { AssetPriceHistoryResult, PriceHistoryPoint } from "@/lib/market/types";

const NOW = 1_700_086_400;

function history(partial: Partial<AssetPriceHistoryResult> = {}): AssetPriceHistoryResult {
  return {
    available: true,
    pairAddress: "pool-a",
    sourceLabel: "test",
    definition: "test",
    daily: [],
    hourly: [],
    generatedAt: new Date(NOW * 1000).toISOString(),
    emptyReason: null,
    ...partial,
  };
}

describe("filterPriceRange", () => {
  it("uses hourly closes for 24H and daily closes for longer ranges", () => {
    const hourly: PriceHistoryPoint[] = [
      { t: NOW - 2 * 3_600, priceUsd: 10 },
      { t: NOW - 3_600, priceUsd: 11 },
    ];
    const daily: PriceHistoryPoint[] = [
      { t: NOW - 10 * 86_400, priceUsd: 8 },
      { t: NOW - 3 * 86_400, priceUsd: 9 },
      { t: NOW - 86_400, priceUsd: 10 },
    ];
    const series = history({ hourly, daily });
    expect(filterPriceRange(series, "24h", NOW)).toEqual(hourly);
    expect(filterPriceRange(series, "7d", NOW).map((point) => point.t)).toEqual([
      NOW - 3 * 86_400,
      NOW - 86_400,
    ]);
    expect(filterPriceRange(series, "30d", NOW)).toEqual(daily);
  });

  it("does not invent points when the window is empty", () => {
    const series = history({
      daily: [{ t: NOW - 40 * 86_400, priceUsd: 9 }],
      hourly: [{ t: NOW - 2 * 86_400, priceUsd: 9 }],
    });
    expect(filterPriceRange(series, "24h", NOW)).toEqual([]);
    expect(filterPriceRange(series, "7d", NOW)).toEqual([]);
  });
});

describe("priceRangeChangePct", () => {
  it("is the first-to-last observed close, not an invented mark", () => {
    expect(
      priceRangeChangePct([
        { t: 1, priceUsd: 100 },
        { t: 2, priceUsd: 93 },
      ]),
    ).toBeCloseTo(-7);
    expect(priceRangeChangePct([{ t: 1, priceUsd: 100 }])).toBeNull();
    expect(priceRangeChangePct([])).toBeNull();
  });
});

describe("displayPriceChangePct", () => {
  it("prefers the visible series, then DexScreener 24h only on the 24H range", () => {
    expect(
      displayPriceChangePct({
        range: "90d",
        visible: [
          { t: 1, priceUsd: 100 },
          { t: 2, priceUsd: 110 },
        ],
        priceChange24hPct: 0.32,
      }),
    ).toBeCloseTo(10);
    expect(
      displayPriceChangePct({
        range: "24h",
        visible: [],
        priceChange24hPct: 0.32,
      }),
    ).toBeCloseTo(0.32);
    expect(
      displayPriceChangePct({
        range: "90d",
        visible: [],
        priceChange24hPct: 0.32,
      }),
    ).toBeNull();
  });
});

describe("scalePricePoints", () => {
  it("does not pin the y-axis to zero", () => {
    const map = scalePricePoints([
      { t: 1, priceUsd: 200 },
      { t: 2, priceUsd: 220 },
    ]);
    expect(map.minY).toBeGreaterThan(150);
    expect(map.y(200)).toBeGreaterThan(map.y(220));
  });
});
