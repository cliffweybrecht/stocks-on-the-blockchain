import { describe, expect, it } from "vitest";
import {
  EQUITY_CARD_VOLUME_SERIES_MIN_GAP_MS,
  EQUITY_CARD_VOLUME_SERIES_RATE_LIMIT_COOLDOWN_MS,
  EQUITY_CARD_VOLUME_SERIES_SLOW_GAP_MS,
  equityCardVolumeRateLimitDelayMs,
  equityCardVolumeSeriesCacheTtlMs,
  equityCardVolumeSeriesIsSparse,
  selectEquityCardVolumeTargets,
  sliceEquityCardDayVolumeSeries,
} from "../equity-card-volume";

const NOW = 1_700_000_000;

describe("sliceEquityCardDayVolumeSeries", () => {
  it("needs two hourly buckets inside the last 24h", () => {
    expect(
      sliceEquityCardDayVolumeSeries(
        [
          { t: NOW - 2 * 3600, volumeUsd: 10 },
          { t: NOW - 3600, volumeUsd: 4 },
        ],
        NOW,
      ),
    ).toHaveLength(2);
    expect(sliceEquityCardDayVolumeSeries([{ t: NOW - 3600, volumeUsd: 10 }], NOW)).toBeNull();
    expect(
      sliceEquityCardDayVolumeSeries(
        [
          { t: NOW - 3 * 86_400, volumeUsd: 8 },
          { t: NOW - 2 * 86_400, volumeUsd: 9 },
        ],
        NOW,
      ),
    ).toBeNull();
  });

  it("keeps a reported 0 and rejects a non-finite volume", () => {
    expect(
      sliceEquityCardDayVolumeSeries(
        [
          { t: NOW - 3600, volumeUsd: 0 },
          { t: NOW, volumeUsd: 3 },
        ],
        NOW,
      ),
    ).toEqual([
      { t: NOW - 3600, volumeUsd: 0 },
      { t: NOW, volumeUsd: 3 },
    ]);
    expect(
      sliceEquityCardDayVolumeSeries(
        [
          { t: NOW - 3600, volumeUsd: Number.NaN },
          { t: NOW, volumeUsd: 3 },
        ],
        NOW,
      ),
    ).toBeNull();
  });
});

describe("equity card volume gecko pacing", () => {
  it("stays under the public per-minute cap and slows further after a 429", () => {
    expect(60_000 / EQUITY_CARD_VOLUME_SERIES_MIN_GAP_MS).toBeLessThan(10);
    expect(EQUITY_CARD_VOLUME_SERIES_MIN_GAP_MS).toBeGreaterThanOrEqual(6_000);
    expect(EQUITY_CARD_VOLUME_SERIES_SLOW_GAP_MS).toBeGreaterThan(EQUITY_CARD_VOLUME_SERIES_MIN_GAP_MS);
    expect(60_000 / EQUITY_CARD_VOLUME_SERIES_SLOW_GAP_MS).toBeLessThan(10);
    expect(EQUITY_CARD_VOLUME_SERIES_RATE_LIMIT_COOLDOWN_MS).toBeGreaterThanOrEqual(30_000);
  });

  it("treats Retry-After 0 as missing", () => {
    expect(equityCardVolumeRateLimitDelayMs("0", 60_000)).toBe(60_000);
    expect(equityCardVolumeRateLimitDelayMs(null, 60_000)).toBe(60_000);
    expect(equityCardVolumeRateLimitDelayMs("5", 60_000)).toBe(5_000);
  });

  it("does not keep a near-empty build for the 30 minute history ttl", () => {
    const fullTtlMs = 30 * 60_000;
    expect(
      equityCardVolumeSeriesCacheTtlMs({
        targetCount: 32,
        failedCount: 24,
        fullTtlMs,
        sparseTtlMs: 60_000,
      }),
    ).toBe(60_000);
    expect(equityCardVolumeSeriesIsSparse(32, 24)).toBe(true);
    expect(
      equityCardVolumeSeriesCacheTtlMs({ targetCount: 32, failedCount: 0, fullTtlMs, sparseTtlMs: 60_000 }),
    ).toBe(fullTtlMs);
    expect(equityCardVolumeSeriesCacheTtlMs({ targetCount: 0, failedCount: 0, fullTtlMs })).toBe(fullTtlMs);
  });
});

describe("selectEquityCardVolumeTargets", () => {
  it("ranks by reported 24h and skips mints without a pair", () => {
    expect(
      selectEquityCardVolumeTargets(
        [
          {
            contractAddress: "mint-low",
            volume24hUsd: 10,
            pools: [{ pairAddress: "pool-low", volume24hUsd: 10 }],
          },
          {
            contractAddress: "mint-high",
            volume24hUsd: 90,
            pools: [{ pairAddress: "pool-high", volume24hUsd: 90 }],
          },
          {
            contractAddress: "mint-empty",
            volume24hUsd: 500,
            pools: [{ pairAddress: "", volume24hUsd: 500 }],
          },
        ],
        8,
      ),
    ).toEqual([
      { mint: "mint-high", pairAddress: "pool-high" },
      { mint: "mint-low", pairAddress: "pool-low" },
    ]);
  });

  it("does not invent targets when the budget is 0", () => {
    expect(
      selectEquityCardVolumeTargets(
        [{ contractAddress: "mint-a", volume24hUsd: 4, pools: [{ pairAddress: "p", volume24hUsd: 4 }] }],
        0,
      ),
    ).toEqual([]);
  });
});
