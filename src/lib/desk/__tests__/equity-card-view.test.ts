import { describe, expect, it } from "vitest";
import {
  equityCardDayMovePct,
  equityCardDayPriceSeries,
  equityCardDayVolumeSeries,
  equityCardPriceSparklineDirection,
  equityCardSpotPriceUsd,
} from "../equity-card-view";

const NOW = 1_700_000_000;

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
