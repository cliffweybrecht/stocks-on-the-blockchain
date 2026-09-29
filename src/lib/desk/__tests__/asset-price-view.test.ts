import { describe, expect, it } from "vitest";
import {
  displayPriceChangePct,
  filterPriceRange,
  filterVolumeRange,
  formatPriceChartTick,
  priceRangeChangePct,
  scalePricePoints,
  scaleVolumePoints,
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
    dailyVolume: [],
    hourlyVolume: [],
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

  it("filters pool volume independently and does not invent $0 gap days", () => {
    const series = history({
      hourlyVolume: [
        { t: NOW - 2 * 3_600, volumeUsd: 4 },
        { t: NOW - 3_600, volumeUsd: 0 },
      ],
      dailyVolume: [
        { t: NOW - 10 * 86_400, volumeUsd: 80 },
        { t: NOW - 86_400, volumeUsd: 12 },
      ],
    });
    expect(filterVolumeRange(series, "24h", NOW)).toEqual([
      { t: NOW - 2 * 3_600, volumeUsd: 4 },
      { t: NOW - 3_600, volumeUsd: 0 },
    ]);
    expect(filterVolumeRange(series, "7d", NOW)).toEqual([{ t: NOW - 86_400, volumeUsd: 12 }]);
    expect(filterVolumeRange(history({ dailyVolume: [] }), "30d", NOW)).toEqual([]);
  });

  it("keeps 7D and 30D on closed Eastern days and leaves the open Gecko day off the chart", () => {
    const beforeMidnight = Date.parse("2026-09-29T03:00:00.000Z") / 1000;
    const afternoon = Date.parse("2026-09-29T20:00:00.000Z") / 1000;
    const afterClose = Date.parse("2026-09-30T04:00:00.000Z") / 1000;
    const sep28 = Date.parse("2026-09-28T00:00:00.000Z") / 1000;
    const sep29 = Date.parse("2026-09-29T00:00:00.000Z") / 1000;
    const aug31 = Date.parse("2026-08-31T00:00:00.000Z") / 1000;
    const series = history({
      generatedAt: "2026-09-29T20:00:00.000Z",
      daily: [
        { t: aug31, priceUsd: 350 },
        { t: sep28, priceUsd: 357 },
        { t: sep29, priceUsd: 356 },
      ],
      dailyVolume: [
        { t: aug31, volumeUsd: 1_095_145 },
        { t: sep28, volumeUsd: 1_062_043 },
        { t: sep28, volumeUsd: 22_600_000, kind: "rolling_24h" },
        { t: sep29, volumeUsd: 22_600_000 },
      ],
      hourly: [{ t: Date.parse("2026-09-29T20:00:00.000Z") / 1000, priceUsd: 356 }],
      hourlyVolume: [{ t: Date.parse("2026-09-29T20:00:00.000Z") / 1000, volumeUsd: 47_245 }],
    });

    for (const range of ["7d", "30d"] as const) {
      const volume = filterVolumeRange(series, range, afternoon);
      const prices = filterPriceRange(series, range, afternoon);
      expect(volume.map((point) => point.t)).not.toContain(sep29);
      expect(prices.map((point) => point.t)).not.toContain(sep29);
      expect(volume.some((point) => point.kind === "rolling_24h")).toBe(false);
      expect(volume.map((point) => formatPriceChartTick(point.t, range))).not.toContain("Sep 29");
      expect(formatPriceChartTick(volume[volume.length - 1]!.t, range)).toBe("Sep 28");
    }

    // 03:00Z is still Sep 28 in New York, so that candle is not closed yet.
    expect(filterVolumeRange(series, "30d", beforeMidnight).map((point) => point.t)).toEqual([aug31]);
    expect(filterVolumeRange(series, "7d", beforeMidnight)).toEqual([]);
    expect(filterPriceRange(series, "30d", beforeMidnight).map((point) => point.t)).toEqual([aug31]);

    expect(filterVolumeRange(series, "30d", afternoon).some((point) => point.t === aug31)).toBe(true);
    expect(formatPriceChartTick(aug31, "30d")).toBe("Aug 31");
    expect(filterVolumeRange(series, "24h", afternoon)).toEqual(series.hourlyVolume);
    expect(filterPriceRange(series, "24h", afternoon)).toEqual(series.hourly);

    const closedVolume = filterVolumeRange(series, "30d", afterClose);
    const closedPrices = filterPriceRange(series, "30d", afterClose);
    expect(closedVolume.map((point) => point.t)).toEqual([sep28, sep29]);
    expect(closedVolume.find((point) => point.t === sep29)?.volumeUsd).toBe(22_600_000);
    expect(closedVolume.some((point) => point.kind === "rolling_24h")).toBe(false);
    expect(closedPrices.map((point) => point.t)).toEqual([sep28, sep29]);
    expect(formatPriceChartTick(sep29, "30d")).toBe("Sep 29");
  });

  it("labels 24H clocks in America/New_York and leaves 7D/30D on the UTC day key", () => {
    const at = (iso: string) => Date.parse(iso) / 1000;
    expect(formatPriceChartTick(at("2026-09-29T20:00:00.000Z"), "24h")).toBe("4:00 PM");
    expect(formatPriceChartTick(at("2026-09-29T04:00:00.000Z"), "24h")).toBe("12:00 AM");
    expect(formatPriceChartTick(at("2026-09-29T11:00:00.000Z"), "24h")).toBe("7:00 AM");
    expect(formatPriceChartTick(at("2026-09-29T19:00:00.000Z"), "24h")).toBe("3:00 PM");
    expect(formatPriceChartTick(at("2026-01-15T20:00:00.000Z"), "24h")).toBe("3:00 PM");
    expect(formatPriceChartTick(at("2026-09-28T00:00:00.000Z"), "7d")).toBe("Sep 28");
    expect(formatPriceChartTick(at("2026-09-28T00:00:00.000Z"), "30d")).toBe("Sep 28");
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

describe("scaleVolumePoints", () => {
  it("pins the volume y-axis at $0", () => {
    const map = scaleVolumePoints([
      { t: 1, volumeUsd: 20 },
      { t: 2, volumeUsd: 40 },
    ]);
    expect(map.minY).toBe(0);
    expect(map.y(0)).toBeGreaterThan(map.y(40));
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
