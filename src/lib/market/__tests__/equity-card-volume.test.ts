import { describe, expect, it } from "vitest";
import {
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
