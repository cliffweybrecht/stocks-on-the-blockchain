import { describe, expect, it } from "vitest";
import { sortAssets } from "@/lib/market/aggregate";
import {
  equityCardDayMovePct,
  equityCardDayPriceSeries,
  equityCardDayVolumeSeries,
  equityCardHeadline,
  equityCardPriceSparklineDirection,
  equityCardSpotPriceUsd,
} from "../equity-card-view";

const NOW = 1_700_000_000;

describe("equityCardHeadline", () => {
  it("keeps 24h volume and the Vol label outside liquidity mode", () => {
    const row = { volume24hUsd: 19_500_000, displayedLiquidityUsd: 4_200_000 };
    expect(equityCardHeadline(row, "volume24hUsd")).toEqual({
      amountUsd: row.volume24hUsd,
      label: "Vol",
      kind: "volume",
      coverageHint: null,
    });
    expect(equityCardHeadline(row, "poolCount").label).toBe("Vol");
    expect(equityCardHeadline(row, "premiumDiscountPct").amountUsd).toBe(row.volume24hUsd);
  });

  it("does not invent a liquidity figure when the feed left it missing", () => {
    expect(equityCardHeadline({ volume24hUsd: 10, displayedLiquidityUsd: null }, "displayedLiquidityUsd")).toEqual({
      amountUsd: null,
      label: "Liq",
      kind: "liquidity",
      coverageHint: null,
    });
    expect(equityCardHeadline({ volume24hUsd: null, displayedLiquidityUsd: 0 }, "displayedLiquidityUsd").amountUsd).toBe(0);
    expect(equityCardHeadline({ volume24hUsd: Number.NaN, displayedLiquidityUsd: 4 }, "volume24hUsd").amountUsd).toBeNull();
  });

  it("shows the desk liquidity field, not 24h volume, when those feeds differ", () => {
    // Sep 27 desk snapshot rows. displayedLiquidityUsd is the sum of DexScreener liquidity.usd.
    const samples = [
      { symbol: "NVDAx", volume24hUsd: 5_629_424.34, displayedLiquidityUsd: 4_135_108.76, volumeCoverage: "reported" as const },
      { symbol: "CRCLx", volume24hUsd: 1_214_324.92, displayedLiquidityUsd: 4_835_437.43, volumeCoverage: "reported" as const },
      { symbol: "TSLAx", volume24hUsd: 320_783.04, displayedLiquidityUsd: 3_090_522.47, volumeCoverage: "reported" as const },
      { symbol: "AAPLx", volume24hUsd: 427_078.86, displayedLiquidityUsd: 729_640.42, volumeCoverage: "reported" as const },
    ];

    for (const row of samples) {
      expect(row.volume24hUsd).not.toBeCloseTo(row.displayedLiquidityUsd, 0);
      expect(equityCardHeadline(row, "volume24hUsd")).toEqual({
        amountUsd: row.volume24hUsd,
        label: "Vol",
        kind: "volume",
        coverageHint: null,
      });
      expect(equityCardHeadline(row, "displayedLiquidityUsd")).toEqual({
        amountUsd: row.displayedLiquidityUsd,
        label: "Liq",
        kind: "liquidity",
        coverageHint: null,
      });
    }

    const byVolume = sortAssets(samples, "volume24hUsd");
    const byLiquidity = sortAssets(samples, "displayedLiquidityUsd");
    expect(byVolume[0]?.symbol).toBe("NVDAx");
    expect(byLiquidity[0]?.symbol).toBe("CRCLx");
    expect(equityCardHeadline(byVolume[0]!, "volume24hUsd").label).toBe("Vol");
    expect(equityCardHeadline(byLiquidity[0]!, "displayedLiquidityUsd")).toEqual({
      amountUsd: byLiquidity[0]?.displayedLiquidityUsd,
      label: "Liq",
      kind: "liquidity",
      coverageHint: null,
    });
  });

  it("labels a closed range and keeps a partial-day hint off a complete window", () => {
    const row = { volume24hUsd: 10, displayedLiquidityUsd: 4 };
    expect(equityCardHeadline(row, "volume24hUsd", { id: "7d", volumeUsd: 70, days: 7 })).toEqual({
      amountUsd: 70,
      label: "7D vol",
      kind: "volume",
      coverageHint: null,
    });
    expect(equityCardHeadline(row, "volume24hUsd", { id: "14d", volumeUsd: 40, days: 4 })).toEqual({
      amountUsd: 40,
      label: "14D vol",
      kind: "volume",
      coverageHint: "4 of 14 days",
    });
    expect(equityCardHeadline(row, "poolCount", { id: "30d", volumeUsd: null, days: 0 })).toEqual({
      amountUsd: null,
      label: "30D vol",
      kind: "volume",
      coverageHint: null,
    });
  });

  it("keeps the live 24h figure and the liquidity figure when a range is also passed", () => {
    const row = { volume24hUsd: 10, displayedLiquidityUsd: 4 };
    expect(equityCardHeadline(row, "volume24hUsd", { id: "24h", volumeUsd: 99, days: 1 })).toEqual({
      amountUsd: 10,
      label: "Vol",
      kind: "volume",
      coverageHint: null,
    });
    expect(equityCardHeadline(row, "displayedLiquidityUsd", { id: "7d", volumeUsd: 70, days: 7 })).toEqual({
      amountUsd: 4,
      label: "Liq",
      kind: "liquidity",
      coverageHint: null,
    });
  });
});

describe("equityCardSpotPriceUsd", () => {
  it("uses the reported DEX median and does not invent a price", () => {
    expect(equityCardSpotPriceUsd({ dexMedianPriceUsd: 215.85 })).toBe(215.85);
    expect(equityCardSpotPriceUsd({ dexMedianPriceUsd: null })).toBeNull();
    expect(equityCardSpotPriceUsd({ dexMedianPriceUsd: 0 })).toBeNull();
  });
});

describe("equityCardDayMovePct", () => {
  it("keeps a reported DexScreener h24 move and hides unknown", () => {
    expect(equityCardDayMovePct(-8.2)).toBe(-8.2);
    expect(equityCardDayMovePct(0)).toBe(0);
    expect(equityCardDayMovePct(null)).toBeNull();
    expect(equityCardDayMovePct(Number.NaN)).toBeNull();
  });
});

describe("equityCardDayPriceSeries", () => {
  it("needs two hourly closes inside the last 24h", () => {
    expect(
      equityCardDayPriceSeries(
        [
          { t: NOW - 2 * 3600, priceUsd: 10 },
          { t: NOW - 3600, priceUsd: 11 },
        ],
        NOW,
      ),
    ).toHaveLength(2);
    expect(equityCardDayPriceSeries([{ t: NOW - 3600, priceUsd: 10 }], NOW)).toBeNull();
    expect(
      equityCardDayPriceSeries(
        [
          { t: NOW - 3 * 86_400, priceUsd: 8 },
          { t: NOW - 2 * 86_400, priceUsd: 9 },
        ],
        NOW,
      ),
    ).toBeNull();
  });

  it("does not draw a series from a non-finite price", () => {
    expect(
      equityCardDayPriceSeries(
        [
          { t: NOW - 3600, priceUsd: Number.NaN },
          { t: NOW, priceUsd: 11 },
        ],
        NOW,
      ),
    ).toBeNull();
  });
});

describe("equityCardDayVolumeSeries", () => {
  it("needs two hourly volume buckets inside the last 24h", () => {
    expect(
      equityCardDayVolumeSeries(
        [
          { t: NOW - 2 * 3600, volumeUsd: 12 },
          { t: NOW - 3600, volumeUsd: 8 },
        ],
        NOW,
      ),
    ).toHaveLength(2);
    expect(equityCardDayVolumeSeries([{ t: NOW - 3600, volumeUsd: 12 }], NOW)).toBeNull();
  });
});

describe("equityCardPriceSparklineDirection", () => {
  it("reads direction from first vs last observed close", () => {
    expect(
      equityCardPriceSparklineDirection([
        { t: 1, priceUsd: 10 },
        { t: 2, priceUsd: 9 },
      ]),
    ).toBe("down");
    expect(equityCardPriceSparklineDirection([{ t: 1, priceUsd: 10 }])).toBeNull();
  });
});
