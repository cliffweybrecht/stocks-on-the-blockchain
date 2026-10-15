import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ASSET_BACKFILL_DESK_SOURCE,
  backfillHeadlineNote,
  classifyBackfillSymbol,
  countAssetBackfillDays,
  derivedDeskLaneDays,
  laneLookupFromSnapshot,
  nightlyVersusAssetSums,
  summarizeGapPercents,
  volumePointsWithDerivedDays,
} from "../asset-backfill-desk";
import { overlayHistoryWithSolanaAssetBackfill, readSnapshotBackfill, withDerivedSnapshotDays } from "../asset-backfill-desk-file";
import { BASE_DESK } from "../base-desk-volume";
import { BNB_DESK } from "../bnb-desk-volume";
import { sumVolumePoints } from "../daily-volume-view";
import { GECKO_HOURLY_ET_BACKFILL_SOURCE } from "../gecko-hourly-et";
import { loadClosedRobinhoodDeskDays } from "../robinhood-desk-volume-file";
import { robinhoodDaysForRange } from "../robinhood-desk-volume";
import {
  closedSnapshotDeskDays,
  parseSnapshotDeskDays,
  snapshotDeskDaysForRange,
  snapshotDeskVolumePoints,
} from "../snapshot-desk-volume";
import { loadSnapshotDeskDays } from "../snapshot-desk-volume-file";
import { emptyEquityVolumeHistory } from "../volume-history";
import { closedSnapshotVolumePoints, utcInstantForDayKey } from "../volume-snapshots";

/** 23:00 America/New_York on 2026-10-07. Oct 6 is the newest closed day. */
const NOW = Date.parse("2026-10-08T03:00:00Z") / 1000;

function backfillFile(records: unknown[]) {
  return {
    version: 1,
    source: GECKO_HOURLY_ET_BACKFILL_SOURCE,
    records,
  };
}

describe("derived desk days", () => {
  it("keeps a nightly date and sums a missing day into public, private, and ETF", () => {
    const snapshot = {
      records: [
        {
          date: "2026-10-06",
          assets: [{ address: "0xAbC", instrumentKind: "etf" }],
        },
      ],
    };
    const backfill = backfillFile([
      {
        date: "2026-10-05",
        assets: [
          { address: "0xAbC", symbol: "SPYB", volume24hUsd: 2.005, source: GECKO_HOURLY_ET_BACKFILL_SOURCE },
          { address: "MintX", symbol: "AAPLx", volume24hUsd: 4, source: GECKO_HOURLY_ET_BACKFILL_SOURCE },
          { address: "0xPriv", symbol: "SPCXc", volume24hUsd: 1, source: GECKO_HOURLY_ET_BACKFILL_SOURCE },
        ],
      },
      {
        date: "2026-10-06",
        assets: [{ address: "MintX", symbol: "AAPLx", volume24hUsd: 99, source: GECKO_HOURLY_ET_BACKFILL_SOURCE }],
      },
      {
        date: "2026-10-04",
        assets: [],
      },
    ]);
    const days = derivedDeskLaneDays(
      new Set(["2026-10-06"]),
      backfill,
      laneLookupFromSnapshot(snapshot),
    );
    expect(days.map((day) => day.date)).toEqual(["2026-10-05"]);
    expect(days[0]).toMatchObject({
      t: utcInstantForDayKey("2026-10-05"),
      publicEquity24hUsd: 4,
      etfIndex24hUsd: 2.01,
      private24hUsd: 1,
      combined24hUsd: 7.01,
      source: ASSET_BACKFILL_DESK_SOURCE,
      assetCount: 3,
    });
  });

  it("ignores a file that is not the hourly Eastern backfill", () => {
    const days = derivedDeskLaneDays(
      new Set(),
      { source: "dexscreener", records: [{ date: "2026-10-05", assets: [{ address: "a", volume24hUsd: 1 }] }] },
      () => "equity",
    );
    expect(days).toEqual([]);
  });

  it("does not replace a nightly chart point for the same Eastern date", () => {
    const nightlyT = utcInstantForDayKey("2026-10-06");
    const points = volumePointsWithDerivedDays(
      [{ t: nightlyT, volumeUsd: 10, kind: "calendar_day" }],
      [
        {
          date: "2026-10-06",
          t: nightlyT,
          publicEquity24hUsd: 99,
          private24hUsd: null,
          etfIndex24hUsd: null,
          combined24hUsd: 99,
          source: ASSET_BACKFILL_DESK_SOURCE,
        },
        {
          date: "2026-10-05",
          t: utcInstantForDayKey("2026-10-05"),
          publicEquity24hUsd: 3,
          private24hUsd: null,
          etfIndex24hUsd: null,
          combined24hUsd: 3,
          source: ASSET_BACKFILL_DESK_SOURCE,
        },
      ],
    );
    expect(points.map((point) => [point.volumeUsd, point.source])).toEqual([
      [3, ASSET_BACKFILL_DESK_SOURCE],
      [10, undefined],
    ]);
  });

  it("classifies wrapped and suffixed tickers the way the desks already do", () => {
    expect(classifyBackfillSymbol("wtQQQM")).toBe("etf");
    expect(classifyBackfillSymbol("SPYB")).toBe("etf");
    expect(classifyBackfillSymbol("SOXX")).toBe("etf");
    expect(classifyBackfillSymbol("SPCXc")).toBe("private");
    expect(classifyBackfillSymbol("AAPLon")).toBe("equity");
    expect(classifyBackfillSymbol("GDx")).toBe("equity");
  });

  it("reconstructs a full asset sum when gecko rows omit DexScreener addresses", () => {
    const gaps = nightlyVersusAssetSums(
      {
        records: [
          {
            date: "2026-10-06",
            combined24hUsd: 100,
            assets: [
              { address: "0xAa", volume24hUsd: 40 },
              { address: "0xBb", volume24hUsd: 60 },
            ],
          },
          {
            date: "2026-10-05",
            combined24hUsd: 50,
          },
        ],
      },
      backfillFile([
        {
          date: "2026-10-06",
          assets: [{ address: "0xBB", symbol: "B", volume24hUsd: 70, source: GECKO_HOURLY_ET_BACKFILL_SOURCE }],
        },
        {
          date: "2026-10-05",
          assets: [{ address: "0xCc", symbol: "C", volume24hUsd: 55, source: GECKO_HOURLY_ET_BACKFILL_SOURCE }],
        },
      ]),
    );
    expect(gaps).toEqual([
      { date: "2026-10-05", nightlyUsd: 50, assetUsd: 55, deltaPct: 10, geckoOnly: true },
      { date: "2026-10-06", nightlyUsd: 100, assetUsd: 110, deltaPct: 10, geckoOnly: false },
    ]);
    expect(summarizeGapPercents(gaps).medianAbsPct).toBe(10);
  });

  it("pluralizes the headline note and skips a range with no derived days", () => {
    expect(backfillHeadlineNote(1)).toBe("includes 1 backfilled day");
    expect(backfillHeadlineNote(16)).toBe("includes 16 backfilled days");
    expect(backfillHeadlineNote(0)).toBeNull();
    expect(countAssetBackfillDays([{ source: ASSET_BACKFILL_DESK_SOURCE }, {}])).toBe(1);
  });
});

describe("snapshot file overlay", () => {
  it("adds the sibling day and leaves the nightly combined total in place", async () => {
    const dir = await mkdtemp(join(tmpdir(), "desk-backfill-"));
    const nightly = {
      version: 1,
      records: [
        {
          date: "2026-10-06",
          combined24hUsd: 80,
          publicEquity24hUsd: 80,
          private24hUsd: null,
          etfIndex24hUsd: null,
          generatedAt: "2026-10-07T04:00:00.000Z",
          sources: { chainSlug: "base" },
        },
      ],
    };
    await writeFile(join(dir, "base.json"), JSON.stringify(nightly));
    await writeFile(
      join(dir, "base-asset-daily.json"),
      JSON.stringify(
        backfillFile([
          {
            date: "2026-10-05",
            assets: [{ address: "0x1", symbol: "AAPLc", volume24hUsd: 5, source: GECKO_HOURLY_ET_BACKFILL_SOURCE }],
          },
          {
            date: "2026-10-06",
            assets: [{ address: "0x1", symbol: "AAPLc", volume24hUsd: 999, source: GECKO_HOURLY_ET_BACKFILL_SOURCE }],
          },
        ]),
      ),
    );
    const { snapshot, backfill } = await readSnapshotBackfill("base.json", dir);
    const days = withDerivedSnapshotDays(parseSnapshotDeskDays(snapshot, BASE_DESK), snapshot, backfill);
    expect(days.map((day) => [day.date, day.combined24hUsd, day.source])).toEqual([
      ["2026-10-05", 5, ASSET_BACKFILL_DESK_SOURCE],
      ["2026-10-06", 80, undefined],
    ]);
  });
});

describe("recorded desks plus asset backfill", () => {
  it("gives every chain a full 30 closed days and a 14D total distinct from 30D", async () => {
    const [base, bnb, robinhood] = await Promise.all([
      loadSnapshotDeskDays(BASE_DESK),
      loadSnapshotDeskDays(BNB_DESK),
      loadClosedRobinhoodDeskDays(undefined, NOW),
    ]);
    const baseClosed = closedSnapshotDeskDays(base, NOW);
    const bnbClosed = closedSnapshotDeskDays(bnb, NOW);
    for (const days of [baseClosed, bnbClosed, robinhood]) {
      expect(days).toHaveLength(30);
      expect(days[0]?.date).toBe("2026-09-07");
      expect(days[29]?.date).toBe("2026-10-06");
      const fourteen = sumVolumePoints(
        snapshotDeskVolumePoints(snapshotDeskDaysForRange(days, "14d")),
      );
      const thirty = sumVolumePoints(snapshotDeskVolumePoints(snapshotDeskDaysForRange(days, "30d")));
      expect(fourteen).not.toBe(thirty);
      expect(countAssetBackfillDays(snapshotDeskDaysForRange(days, "30d"))).toBeGreaterThan(0);
    }
    expect(robinhoodDaysForRange(robinhood, "30d")).toHaveLength(30);
  });

  it("keeps nightly Solana totals when the live history is empty, then fills the gaps", async () => {
    const overlaid = await overlayHistoryWithSolanaAssetBackfill(
      emptyEquityVolumeHistory("live history unavailable", "2026-10-08T03:00:00.000Z"),
    );
    const closed = closedSnapshotVolumePoints(overlaid.points, NOW);
    expect(closed).toHaveLength(30);
    expect(closed.filter((point) => point.source === ASSET_BACKFILL_DESK_SOURCE)).toHaveLength(16);
    const newest = closed.slice(-7);
    expect(newest.every((point) => point.source !== ASSET_BACKFILL_DESK_SOURCE)).toBe(true);
    expect(sumVolumePoints(newest)).toBeCloseTo(793_612_500.81, 0);
  });
});
