import { describe, expect, it } from "vitest";
import {
  easternDayKeysInclusive,
  easternDayStartUnix,
  hourlySeriesCoversEasternDay,
  sumHourlyVolumeByEasternDay,
} from "../gecko-hourly-et";
import { easternDayKey } from "../volume-snapshots";

describe("eastern hourly backfill", () => {
  it("puts Eastern midnight on 04:00Z while New York is on EDT", () => {
    const start = easternDayStartUnix("2026-10-04");
    expect(new Date(start * 1000).toISOString()).toBe("2026-10-04T04:00:00.000Z");
    expect(easternDayKey(start)).toBe("2026-10-04");
    expect(easternDayKey(start - 1)).toBe("2026-10-03");
  });

  it("sums hourly opens into the Eastern day and drops the next midnight", () => {
    const oct4 = easternDayStartUnix("2026-10-04");
    const totals = sumHourlyVolumeByEasternDay(
      [
        { t: oct4 - 3600, volumeUsd: 5 },
        { t: oct4, volumeUsd: 2 },
        { t: oct4 + 3600, volumeUsd: 3 },
        { t: oct4 + 24 * 3600, volumeUsd: 9 },
      ],
      "2026-10-03",
      "2026-10-06",
    );
    expect(totals["2026-10-03"]).toEqual({ volumeUsd: 5, hours: 1 });
    expect(totals["2026-10-04"]).toEqual({ volumeUsd: 5, hours: 2 });
    expect(totals["2026-10-05"]).toEqual({ volumeUsd: 9, hours: 1 });
  });

  it("lists the thirty closed days through 2026-10-06", () => {
    const keys = easternDayKeysInclusive("2026-09-07", "2026-10-06");
    expect(keys).toHaveLength(30);
    expect(keys[0]).toBe("2026-09-07");
    expect(keys[29]).toBe("2026-10-06");
  });

  it("treats a series that starts after the day as uncovered", () => {
    const oct6 = easternDayStartUnix("2026-10-06");
    const candles = [{ t: oct6, volumeUsd: 1 }];
    expect(hourlySeriesCoversEasternDay(candles, "2026-10-06")).toBe(true);
    expect(hourlySeriesCoversEasternDay(candles, "2026-10-05")).toBe(false);
  });
});
