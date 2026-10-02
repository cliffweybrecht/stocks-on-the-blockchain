import { describe, expect, it } from "vitest";
import {
  DESK_VOLUME_24H_POLL_MIN_GAP_MS,
  DESK_VOLUME_24H_POLL_MS,
  DESK_VOLUME_HISTORY_POLL_MS,
  deskVolumePollDue,
  parseDeskVolumeHistoryPayload,
  parseDeskVolumeLivePayload,
  preferFresherClosedHistory,
  preferFresherHourlyHistory,
} from "../desk-volume-live";
import { emptyEquityVolumeHistory } from "../volume-history";
import { emptyHourlyRollingVolumeHistory } from "../volume-hourly-snapshots";

const generatedAt = "2026-09-30T20:40:00.000Z";

function hourly(points: { t: number; volumeUsd: number }[], at = generatedAt) {
  const base = emptyHourlyRollingVolumeHistory("empty", at);
  return {
    ...base,
    available: points.length > 0,
    points: points.map((point) => ({ ...point, kind: "rolling_24h" as const })),
    emptyReason: points.length === 0 ? base.emptyReason : null,
  };
}

describe("desk volume 24H live payload", () => {
  it("polls inside a minute and collapses a focus burst", () => {
    expect(DESK_VOLUME_24H_POLL_MS).toBeGreaterThanOrEqual(30_000);
    expect(DESK_VOLUME_24H_POLL_MS).toBeLessThanOrEqual(60_000);
    expect(deskVolumePollDue(10_000, 0)).toBe(true);
    expect(deskVolumePollDue(1_000, 0, DESK_VOLUME_24H_POLL_MIN_GAP_MS)).toBe(false);
    expect(deskVolumePollDue(DESK_VOLUME_24H_POLL_MIN_GAP_MS, 0)).toBe(true);
  });

  it("keeps captured hours and does not invent the gap between them", () => {
    const parsed = parseDeskVolumeLivePayload({
      hourlyHistory: hourly([
        { t: 1_700_000_000, volumeUsd: 100 },
        { t: 1_700_007_200, volumeUsd: 80 },
      ]),
      rolling24h: {
        publicVolume24hUsd: 150_700_000,
        privateVolume24hUsd: 1,
        etfVolume24hUsd: null,
      },
    });
    expect(parsed?.hourlyHistory.points.map((point) => point.t)).toEqual([1_700_000_000, 1_700_007_200]);
    expect(parsed?.hourlyHistory.points.every((point) => point.kind === "rolling_24h")).toBe(true);
    expect(parsed?.rolling24h).toEqual({
      publicVolume24hUsd: 150_700_000,
      privateVolume24hUsd: 1,
      etfVolume24hUsd: null,
    });
  });

  it("drops closed-day rows, bad volumes, and a headline that is not a number", () => {
    const parsed = parseDeskVolumeLivePayload({
      hourlyHistory: {
        ...hourly([{ t: 1_700_000_000, volumeUsd: 10 }]),
        points: [
          { t: 1_700_000_000, volumeUsd: 10, kind: "rolling_24h" },
          { t: 1_700_003_600, volumeUsd: 12, kind: "calendar_day" },
          { t: 1_700_007_200, volumeUsd: -1, kind: "rolling_24h" },
          { t: 0, volumeUsd: 4, kind: "rolling_24h" },
          { t: 1_700_010_800, volumeUsd: 6, kind: "rolling_24h" },
        ],
      },
      rolling24h: { publicVolume24hUsd: "150", privateVolume24hUsd: null, etfVolume24hUsd: null },
    });
    expect(parsed?.hourlyHistory.points).toEqual([
      { t: 1_700_000_000, volumeUsd: 10, kind: "rolling_24h" },
      { t: 1_700_010_800, volumeUsd: 6, kind: "rolling_24h" },
    ]);
    expect(parsed?.rolling24h).toBeNull();
  });

  it("rejects a payload that is not an hourly series", () => {
    expect(parseDeskVolumeLivePayload(null)).toBeNull();
    expect(parseDeskVolumeLivePayload({ rolling24h: { publicVolume24hUsd: 1 } })).toBeNull();
    expect(parseDeskVolumeLivePayload({ hourlyHistory: { points: [] } })).toBeNull();
  });

  it("polls closed snapshot days on the same cadence and drops rolling rows", () => {
    expect(DESK_VOLUME_HISTORY_POLL_MS).toBe(45_000);
    expect(DESK_VOLUME_HISTORY_POLL_MS).toBe(DESK_VOLUME_24H_POLL_MS);
    const parsed = parseDeskVolumeHistoryPayload({
      history: {
        ...emptyEquityVolumeHistory("empty", generatedAt),
        available: true,
        emptyReason: null,
        points: [
          { t: 1_758_585_600, volumeUsd: 113_009_159, kind: "calendar_day" },
          { t: 1_758_672_000, volumeUsd: 293_070_235, kind: "rolling_24h" },
          { t: 1_758_758_400, volumeUsd: -5, kind: "calendar_day" },
          { t: 1_758_844_800, volumeUsd: 143_757_138, kind: "calendar_day" },
        ],
      },
    });
    expect(parsed?.points).toEqual([
      { t: 1_758_585_600, volumeUsd: 113_009_159, kind: "calendar_day" },
      { t: 1_758_844_800, volumeUsd: 143_757_138, kind: "calendar_day" },
    ]);
  });

  it("keeps plotted snapshot days when a later poll is empty", () => {
    const current = {
      ...emptyEquityVolumeHistory("empty", "2026-09-30T20:00:00.000Z"),
      available: true,
      emptyReason: null,
      points: [{ t: 1_758_585_600, volumeUsd: 10, kind: "calendar_day" as const }],
    };
    const empty = emptyEquityVolumeHistory("read failed", "2026-09-30T21:00:00.000Z");
    expect(preferFresherClosedHistory(current, empty)).toBe(current);
    const newer = {
      ...current,
      generatedAt: "2026-09-30T21:00:00.000Z",
      points: [
        ...current.points,
        { t: 1_758_844_800, volumeUsd: 12, kind: "calendar_day" as const },
      ],
    };
    expect(preferFresherClosedHistory(current, newer)?.points).toHaveLength(2);
    expect(preferFresherClosedHistory(newer, current)).toBe(newer);
  });

  it("rejects a closed-day payload that is not a history series", () => {
    expect(parseDeskVolumeHistoryPayload(null)).toBeNull();
    expect(parseDeskVolumeHistoryPayload({ history: null })).toBeNull();
    expect(parseDeskVolumeHistoryPayload({ hourlyHistory: { points: [], generatedAt } })).toBeNull();
  });

  it("keeps an older poll when a stale server payload arrives later", () => {
    const older = hourly([{ t: 100, volumeUsd: 1 }], "2026-09-30T20:00:00.000Z");
    const newer = hourly(
      [
        { t: 100, volumeUsd: 1 },
        { t: 4_600, volumeUsd: 2 },
      ],
      "2026-09-30T21:00:00.000Z",
    );
    expect(preferFresherHourlyHistory(newer, older)).toBe(newer);
    expect(preferFresherHourlyHistory(older, newer)?.points).toHaveLength(2);
  });
});
