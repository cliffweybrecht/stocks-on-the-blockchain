import { describe, expect, it } from "vitest";
import {
  allMarketsLiveSetIsPartial,
  allMarketsPoolSetCompatible,
  assembleAllMarketsDaily,
  mergeVolumeSeries,
  selectAssetVolumeHeadline,
  selectAssetVolumeSeries,
  sumObservedVolumeUsd,
  uniqueAllMarketsPools,
} from "../asset-volume-headline";

const NOW = 1_700_086_400;
const DAY = 86_400;

describe("selectAssetVolumeHeadline", () => {
  it("uses the DexScreener all-markets total for 24H, not the primary-pool candles", () => {
    const headline = selectAssetVolumeHeadline({
      range: "24h",
      nowT: NOW,
      windowSeconds: DAY,
      allMarkets24hUsd: 9_301_969.53,
      primaryPoolPoints: [
        { volumeUsd: 100 },
        { volumeUsd: 40 },
      ],
      allMarketsDaily: [{ t: NOW, volumeUsd: 50_000_000 }],
    });
    expect(headline).toEqual({
      volumeUsd: 9_301_969.53,
      label: "24H volume (all markets)",
      scope: "all_markets",
    });
  });

  it("keeps a reported 24H zero and rejects blank or negative DexScreener totals", () => {
    expect(
      selectAssetVolumeHeadline({
        range: "24h",
        nowT: NOW,
        windowSeconds: DAY,
        allMarkets24hUsd: 0,
        primaryPoolPoints: [{ volumeUsd: 12 }],
        allMarketsDaily: null,
      }).volumeUsd,
    ).toBe(0);
    const fallback = selectAssetVolumeHeadline({
      range: "24h",
      nowT: NOW,
      windowSeconds: DAY,
      allMarkets24hUsd: Number.NaN,
      primaryPoolPoints: [{ volumeUsd: 4 }, { volumeUsd: 8 }],
      allMarketsDaily: null,
    });
    expect(fallback).toEqual({
      volumeUsd: 12,
      label: "24H volume",
      scope: "primary_pool",
    });
    expect(fallback.label).not.toMatch(/all markets/i);
  });

  it("sums every pool for 7D when the all-markets series is complete", () => {
    const headline = selectAssetVolumeHeadline({
      range: "7d",
      nowT: NOW,
      windowSeconds: 7 * DAY,
      allMarkets24hUsd: 1_000,
      primaryPoolPoints: [
        { volumeUsd: 10 },
        { volumeUsd: 5 },
      ],
      allMarketsDaily: [
        { t: NOW - 10 * DAY, volumeUsd: 9_999 },
        { t: NOW - 2 * DAY, volumeUsd: 4_000_000 },
        { t: NOW - DAY, volumeUsd: 10_800_000 },
      ],
    });
    expect(headline.volumeUsd).toBe(14_800_000);
    expect(headline.label).toBe("7D volume (all markets)");
    expect(headline.scope).toBe("all_markets");
  });

  it("labels 30D all-markets only from the complete cross-pool series", () => {
    const headline = selectAssetVolumeHeadline({
      range: "30d",
      nowT: NOW,
      windowSeconds: 30 * DAY,
      allMarkets24hUsd: 1_000,
      primaryPoolPoints: [{ volumeUsd: 15 }],
      allMarketsDaily: [
        { t: NOW - 20 * DAY, volumeUsd: 3 },
        { t: NOW - 40 * DAY, volumeUsd: 100 },
      ],
    });
    expect(headline).toEqual({
      volumeUsd: 3,
      label: "30D volume (all markets)",
      scope: "all_markets",
    });
  });

  it("does not call a primary-pool sum all-markets", () => {
    const headline = selectAssetVolumeHeadline({
      range: "7d",
      nowT: NOW,
      windowSeconds: 7 * DAY,
      allMarkets24hUsd: 50_000,
      primaryPoolPoints: [{ volumeUsd: 1_200_000 }, { volumeUsd: 300_000 }],
      allMarketsDaily: null,
    });
    expect(headline).toEqual({
      volumeUsd: 1_500_000,
      label: "7D volume",
      scope: "primary_pool",
    });
    expect(headline.label).not.toMatch(/all markets/i);
    const thirty = selectAssetVolumeHeadline({
      range: "30d",
      nowT: NOW,
      windowSeconds: 30 * DAY,
      allMarkets24hUsd: 50_000,
      primaryPoolPoints: [{ volumeUsd: 9 }],
      allMarketsDaily: null,
    });
    expect(thirty.label).toBe("30D volume");
    expect(thirty.scope).toBe("primary_pool");
  });

  it("omits a UTC day that America/New_York has not started from the 30D sum", () => {
    const now = Date.parse("2026-09-29T03:00:00.000Z") / 1000;
    const sep28 = Date.parse("2026-09-28T00:00:00.000Z") / 1000;
    const sep29 = Date.parse("2026-09-29T00:00:00.000Z") / 1000;
    const headline = selectAssetVolumeHeadline({
      range: "30d",
      nowT: now,
      windowSeconds: 30 * DAY,
      allMarkets24hUsd: 1_000,
      primaryPoolPoints: [{ volumeUsd: 78_323 }],
      allMarketsDaily: [
        { t: sep28, volumeUsd: 1_062_043 },
        { t: sep29, volumeUsd: 78_323 },
      ],
    });
    expect(headline.volumeUsd).toBe(1_062_043);
    expect(headline.label).toBe("30D volume (all markets)");

    const series = selectAssetVolumeSeries({
      range: "30d",
      nowT: now,
      windowSeconds: 30 * DAY,
      primaryPoolPoints: [{ t: sep29, volumeUsd: 78_323 }],
      allMarketsDaily: [
        { t: sep28, volumeUsd: 1_062_043 },
        { t: sep29, volumeUsd: 78_323 },
      ],
      allMarketsHourly: null,
    });
    expect(series.points).toEqual([{ t: sep28, volumeUsd: 1_062_043 }]);

    const opened = selectAssetVolumeSeries({
      range: "30d",
      nowT: Date.parse("2026-09-29T04:00:00.000Z") / 1000,
      windowSeconds: 30 * DAY,
      primaryPoolPoints: [],
      allMarketsDaily: [
        { t: sep28, volumeUsd: 1_062_043 },
        { t: sep29, volumeUsd: 78_323 },
      ],
      allMarketsHourly: null,
    });
    expect(opened.points.map((point) => point.t)).toEqual([sep28, sep29]);
  });

  it("does not replace an empty all-markets window with the primary pool or with $0", () => {
    const headline = selectAssetVolumeHeadline({
      range: "7d",
      nowT: NOW,
      windowSeconds: 7 * DAY,
      allMarkets24hUsd: 80,
      primaryPoolPoints: [{ volumeUsd: 14_800_000 }],
      allMarketsDaily: [{ t: NOW - 40 * DAY, volumeUsd: 10 }],
    });
    expect(headline.volumeUsd).toBeNull();
    expect(headline.label).toBe("7D volume (all markets)");
    expect(headline.scope).toBe("all_markets");
    expect(sumObservedVolumeUsd([])).toBeNull();
  });
});

describe("selectAssetVolumeSeries", () => {
  const hour = NOW - 3_600;

  it("keeps the 24H line on the primary pool until hourly candles are complete", () => {
    const series = selectAssetVolumeSeries({
      range: "24h",
      nowT: NOW,
      windowSeconds: DAY,
      primaryPoolPoints: [{ t: hour, volumeUsd: 187_000 }],
      allMarketsDaily: [{ t: hour, volumeUsd: 9_000_000 }],
      allMarketsHourly: null,
    });
    expect(series.scope).toBe("primary_pool");
    expect(series.points).toEqual([{ t: hour, volumeUsd: 187_000 }]);
  });

  it("plots summed hourly candles for 24H once every pool has resolved", () => {
    const series = selectAssetVolumeSeries({
      range: "24h",
      nowT: NOW,
      windowSeconds: DAY,
      primaryPoolPoints: [{ t: hour, volumeUsd: 187_000 }],
      allMarketsDaily: null,
      allMarketsHourly: [
        { t: hour, volumeUsd: 4_200_000 },
        { t: NOW - 2 * DAY, volumeUsd: 9_999 },
      ],
    });
    expect(series).toEqual({
      scope: "all_markets",
      points: [{ t: hour, volumeUsd: 4_200_000 }],
    });
  });

  it("plots summed daily candles for 7D and 30D and does not fall back when the window is empty", () => {
    const complete = selectAssetVolumeSeries({
      range: "7d",
      nowT: NOW,
      windowSeconds: 7 * DAY,
      primaryPoolPoints: [{ t: NOW - DAY, volumeUsd: 187_000 }],
      allMarketsDaily: [
        { t: NOW - 2 * DAY, volumeUsd: 5_000_000 },
        { t: NOW - DAY, volumeUsd: 1_000_000 },
      ],
      allMarketsHourly: [{ t: hour, volumeUsd: 12 }],
    });
    expect(complete.scope).toBe("all_markets");
    expect(complete.points).toEqual([
      { t: NOW - 2 * DAY, volumeUsd: 5_000_000 },
      { t: NOW - DAY, volumeUsd: 1_000_000 },
    ]);

    const emptyWindow = selectAssetVolumeSeries({
      range: "30d",
      nowT: NOW,
      windowSeconds: 30 * DAY,
      primaryPoolPoints: [{ t: NOW - DAY, volumeUsd: 187_000 }],
      allMarketsDaily: [{ t: NOW - 40 * DAY, volumeUsd: 8_000_000 }],
      allMarketsHourly: null,
    });
    expect(emptyWindow).toEqual({ scope: "all_markets", points: [] });

    const pending = selectAssetVolumeSeries({
      range: "30d",
      nowT: NOW,
      windowSeconds: 30 * DAY,
      primaryPoolPoints: [{ t: NOW - DAY, volumeUsd: 187_000 }],
      allMarketsDaily: null,
      allMarketsHourly: [{ t: hour, volumeUsd: 4_200_000 }],
    });
    expect(pending.scope).toBe("primary_pool");
    expect(pending.points).toEqual([{ t: NOW - DAY, volumeUsd: 187_000 }]);
  });
});

describe("assembleAllMarketsDaily", () => {
  it("adds every pool's candle at the same timestamp and drops unresolved pools", () => {
    const complete = assembleAllMarketsDaily([
      {
        pairAddress: "a",
        volume24hUsd: 10,
        definitiveMiss: false,
        points: [
          { t: 100, volumeUsd: 4 },
          { t: 200, volumeUsd: 1 },
        ],
      },
      {
        pairAddress: "b",
        volume24hUsd: 3,
        definitiveMiss: false,
        points: [{ t: 200, volumeUsd: 7 }],
      },
    ]);
    expect(complete.complete).toBe(true);
    expect(complete.daily).toEqual([
      { t: 100, volumeUsd: 4 },
      { t: 200, volumeUsd: 8 },
    ]);

    const rateLimited = assembleAllMarketsDaily([
      { pairAddress: "a", volume24hUsd: 10, definitiveMiss: false, points: [{ t: 100, volumeUsd: 4 }] },
      { pairAddress: "b", volume24hUsd: 3, definitiveMiss: false, points: null },
    ]);
    expect(rateLimited).toEqual({ complete: false, daily: [] });
  });

  it("refuses all-markets when a pool with live volume has no Gecko series", () => {
    const blocked = assembleAllMarketsDaily([
      { pairAddress: "a", volume24hUsd: 10, definitiveMiss: false, points: [{ t: 100, volumeUsd: 4 }] },
      { pairAddress: "b", volume24hUsd: 25, definitiveMiss: true, points: null },
    ]);
    expect(blocked.complete).toBe(false);

    const dust = assembleAllMarketsDaily([
      { pairAddress: "a", volume24hUsd: 10, definitiveMiss: false, points: [{ t: 100, volumeUsd: 4 }] },
      { pairAddress: "b", volume24hUsd: 0, definitiveMiss: true, points: null },
      { pairAddress: "c", volume24hUsd: null, definitiveMiss: true, points: null },
    ]);
    expect(dust.complete).toBe(true);
    expect(dust.daily).toEqual([{ t: 100, volumeUsd: 4 }]);
  });

  it("dedupes pair addresses before a multi-pool fetch", () => {
    expect(
      uniqueAllMarketsPools([
        { pairAddress: "  ", volume24hUsd: 9 },
        { pairAddress: "pool-a", volume24hUsd: 2 },
        { pairAddress: "pool-a", volume24hUsd: 5 },
        { pairAddress: "pool-b", volume24hUsd: null },
      ]).map((pool) => [pool.pairAddress, pool.volume24hUsd]),
    ).toEqual([
      ["pool-a", 5],
      ["pool-b", null],
    ]);
  });
});

describe("all-markets pool set wobble", () => {
  const many = Array.from({ length: 37 }, (_, index) => `pool-${index}`);

  it("treats a one-pool swap on a large set as the same fill", () => {
    const swapped = [...many.slice(0, 36), "pool-new"];
    expect(allMarketsPoolSetCompatible(many, swapped)).toBe(true);
    expect(allMarketsLiveSetIsPartial(many, swapped)).toBe(false);
    expect(allMarketsPoolSetCompatible(many, many)).toBe(true);
  });

  it("treats a 3-pool one-swap as compatible and a shrink to one pool as partial", () => {
    expect(allMarketsPoolSetCompatible(["a", "b", "c"], ["a", "b", "d"])).toBe(true);
    expect(allMarketsPoolSetCompatible(["a", "b", "c"], ["a"])).toBe(false);
    expect(allMarketsLiveSetIsPartial(["a", "b", "c"], ["a"])).toBe(true);
    expect(allMarketsLiveSetIsPartial(many, many.slice(0, 5))).toBe(true);
    expect(allMarketsPoolSetCompatible(["a", "b"], ["c", "d"])).toBe(false);
    expect(allMarketsLiveSetIsPartial(["a", "b"], ["c", "d"])).toBe(false);
  });

  it("adds candles that share a timestamp and leaves missing timestamps missing", () => {
    expect(
      mergeVolumeSeries(
        [
          { t: 100, volumeUsd: 1_000 },
          { t: 200, volumeUsd: 50 },
        ],
        [
          { t: 100, volumeUsd: 4_000 },
          { t: 300, volumeUsd: 7 },
        ],
      ),
    ).toEqual([
      { t: 100, volumeUsd: 5_000 },
      { t: 200, volumeUsd: 50 },
      { t: 300, volumeUsd: 7 },
    ]);
  });
});
