import { readFileSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileDeskHourlyVolumeSnapshotStore } from "../volume-hourly-snapshot-store";
import {
  buildHourlyRollingEquityVolumeHistory,
  buildHourlyRollingVolumeHistory,
  deskHourlyVolumeSnapshotFromDetail,
  easternHourStamp,
  easternHourStartUnix,
  easternRollingHourStarts,
  parseDeskHourlyVolumeSnapshotRecords,
  recordDeskHourlyVolumeFromDetail,
  resolvePinnedEasternHour,
  serializeDeskHourlyVolumeSnapshots,
  upsertDeskHourlyVolumeSnapshot,
  MemoryDeskHourlyVolumeSnapshotStore,
  type DeskHourlyVolumeDetail,
  type DeskHourlyVolumeSnapshot,
} from "../volume-hourly-snapshots";
import { buildSnapshotEquityVolumeHistory, parseDeskVolumeSnapshotRecords } from "../volume-snapshots";
import { FileDeskVolumeSnapshotStore } from "../volume-snapshot-store";

function detail(partial: {
  volume24hUsd?: number | null;
  privateVolume24hUsd?: number | null;
  etfVolume24hUsd?: number | null;
  displayedLiquidityUsd?: number | null;
  privateLiquidityUsd?: number | null;
  etfLiquidityUsd?: number | null;
  omitLanes?: boolean;
}): DeskHourlyVolumeDetail {
  const base: DeskHourlyVolumeDetail = {
    chain: {
      volume24hUsd: partial.volume24hUsd ?? null,
      privateVolume24hUsd: partial.privateVolume24hUsd ?? null,
      etfVolume24hUsd: partial.etfVolume24hUsd ?? null,
      displayedLiquidityUsd: partial.displayedLiquidityUsd ?? null,
    },
  };
  if (partial.omitLanes) return base;
  return {
    ...base,
    privateAssets:
      partial.privateLiquidityUsd === undefined ? [] : [{ displayedLiquidityUsd: partial.privateLiquidityUsd }],
    etfAssets: partial.etfLiquidityUsd === undefined ? [] : [{ displayedLiquidityUsd: partial.etfLiquidityUsd }],
  };
}

describe("easternHourStamp", () => {
  it("keys 00:00Z to the previous Eastern evening and does not open the next day", () => {
    const evening = Date.parse("2026-09-29T01:48:00.000Z") / 1000;
    const stamp = easternHourStamp(evening);
    expect(stamp).toEqual({
      hour: "2026-09-28T21",
      offset: "-04:00",
      t: Date.parse("2026-09-28T21:00:00-04:00") / 1000,
    });
  });

  it("uses midnight as hour 00 on the Eastern calendar day", () => {
    const midnight = Date.parse("2026-09-29T04:00:00.000Z") / 1000;
    expect(easternHourStamp(midnight)?.hour).toBe("2026-09-29T00");
    expect(easternHourStamp(midnight)?.offset).toBe("-04:00");
  });

  it("keeps both America/New_York 01:00 hours on the fall-back day", () => {
    const first = easternHourStamp(Date.parse("2026-11-01T05:30:00.000Z") / 1000);
    const second = easternHourStamp(Date.parse("2026-11-01T06:30:00.000Z") / 1000);
    expect(first?.hour).toBe("2026-11-01T01");
    expect(second?.hour).toBe("2026-11-01T01");
    expect(first?.offset).toBe("-04:00");
    expect(second?.offset).toBe("-05:00");
    expect(first?.t).not.toBe(second?.t);
  });

  it("skips the spring-forward gap instead of inventing 02:00", () => {
    const after = easternHourStamp(Date.parse("2026-03-08T07:30:00.000Z") / 1000);
    expect(after?.hour).toBe("2026-03-08T03");
    expect(after?.offset).toBe("-04:00");
  });
});

describe("deskHourlyVolumeSnapshotFromDetail", () => {
  it("stores lane totals and omits nulls instead of writing $0", () => {
    const row = deskHourlyVolumeSnapshotFromDetail(
      detail({
        volume24hUsd: 86_200_000,
        privateVolume24hUsd: 8_700_000,
        etfVolume24hUsd: 32_100_000,
        displayedLiquidityUsd: 40_000_000,
        privateLiquidityUsd: 2_000_000,
        etfLiquidityUsd: 7_500_000,
      }),
      "2026-09-29T01:48:00.000Z",
    );
    expect(row?.hour).toBe("2026-09-28T21");
    expect(row?.combined24hUsd).toBeCloseTo(127_000_000);
    expect(row?.publicEquity24hUsd).toBe(86_200_000);
    expect(row?.combinedLiquidityUsd).toBe(49_500_000);
    expect(row && "assets" in row).toBe(false);
  });

  it("keeps a reported 0 volume and leaves unknown liquidity null", () => {
    const row = deskHourlyVolumeSnapshotFromDetail(
      detail({ volume24hUsd: 0, omitLanes: true }),
      "2026-09-15T16:00:00.000Z",
    );
    expect(row?.combined24hUsd).toBe(0);
    expect(row?.publicEquity24hUsd).toBe(0);
    expect(row?.private24hUsd).toBeNull();
    expect(row?.publicLiquidityUsd).toBeNull();
    expect(row?.privateLiquidityUsd).toBeNull();
    expect(row?.combinedLiquidityUsd).toBeNull();
  });
});

describe("upsertDeskHourlyVolumeSnapshot", () => {
  it("replaces the same Eastern hour, appends the next hour, and keeps both fall-back hours", () => {
    const first = deskHourlyVolumeSnapshotFromDetail(
      detail({ volume24hUsd: 100, displayedLiquidityUsd: 5 }),
      "2026-09-28T21:10:00.000Z",
    );
    const richer = deskHourlyVolumeSnapshotFromDetail(
      detail({ volume24hUsd: 150, privateVolume24hUsd: 20, displayedLiquidityUsd: 9 }),
      "2026-09-28T21:40:00.000Z",
    );
    const nextHour = deskHourlyVolumeSnapshotFromDetail(
      detail({ volume24hUsd: 80 }),
      "2026-09-28T22:05:00.000Z",
    );
    const fallA = deskHourlyVolumeSnapshotFromDetail(detail({ volume24hUsd: 1 }), "2026-11-01T05:10:00.000Z");
    const fallB = deskHourlyVolumeSnapshotFromDetail(detail({ volume24hUsd: 2 }), "2026-11-01T06:10:00.000Z");
    const allNull = deskHourlyVolumeSnapshotFromDetail(detail({}), "2026-09-28T21:50:00.000Z");
    expect(first && richer && nextHour && fallA && fallB && allNull).toBeTruthy();
    if (!first || !richer || !nextHour || !fallA || !fallB || !allNull) return;

    const replaced = upsertDeskHourlyVolumeSnapshot([first], richer);
    expect(replaced).toHaveLength(1);
    expect(replaced[0]?.combined24hUsd).toBe(170);
    expect(replaced[0]?.publicLiquidityUsd).toBe(9);
    expect(replaced[0]?.generatedAt).toBe("2026-09-28T21:40:00.000Z");

    const refused = upsertDeskHourlyVolumeSnapshot(replaced, allNull);
    expect(refused).toHaveLength(1);
    expect(refused[0]?.combined24hUsd).toBe(170);

    const twoHours = upsertDeskHourlyVolumeSnapshot(refused, nextHour);
    expect(twoHours.map((row) => row.hour)).toEqual(["2026-09-28T17", "2026-09-28T18"]);

    const bothFallback = upsertDeskHourlyVolumeSnapshot(upsertDeskHourlyVolumeSnapshot([], fallA), fallB);
    expect(bothFallback.map((row) => `${row.hour}${row.offset}`)).toEqual([
      "2026-11-01T01-04:00",
      "2026-11-01T01-05:00",
    ]);
  });
});

describe("recordDeskHourlyVolumeFromDetail", () => {
  it("refuses an all-null hour and does not invent $0", async () => {
    const store = new MemoryDeskHourlyVolumeSnapshotStore();
    const result = await recordDeskHourlyVolumeFromDetail(store, detail({}), "2026-09-28T21:10:00.000Z");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/all-null/);
    expect(await store.load()).toEqual([]);
  });

  it("reports unchanged when the same hour is already stored", async () => {
    const row = deskHourlyVolumeSnapshotFromDetail(detail({ volume24hUsd: 10 }), "2026-09-28T21:10:00.000Z");
    expect(row).toBeTruthy();
    if (!row) return;
    const store = new MemoryDeskHourlyVolumeSnapshotStore([row]);
    const again = await recordDeskHourlyVolumeFromDetail(
      store,
      detail({ volume24hUsd: 10 }),
      "2026-09-28T21:10:00.000Z",
    );
    expect(again.ok && again.unchanged).toBe(true);
    expect(await store.load()).toHaveLength(1);
  });
});

describe("hourly totals stay off the closed-day chart", () => {
  it("drops an hourly row from the daily parser so it cannot open an Eastern day", () => {
    const row = deskHourlyVolumeSnapshotFromDetail(
      detail({ volume24hUsd: 50_000_000 }),
      "2026-09-29T01:48:00.000Z",
    );
    expect(row).toBeTruthy();
    if (!row) return;
    const day = {
      date: "2026-09-27",
      t: Date.parse("2026-09-27T00:00:00.000Z") / 1000,
      publicEquity24hUsd: 10,
      private24hUsd: null,
      etfIndex24hUsd: null,
      combined24hUsd: 10,
      publicMintCount: null,
      publicPoolCount: null,
      generatedAt: "2026-09-28T03:59:00.000Z",
    };
    const snapshots = parseDeskVolumeSnapshotRecords({ version: 1, records: [day, row] });
    expect(snapshots.map((item) => item.date)).toEqual(["2026-09-27"]);
    const history = buildSnapshotEquityVolumeHistory({
      snapshots,
      liveCombined24hUsd: row.combined24hUsd,
      nowT: Date.parse("2026-09-30T16:00:00.000Z") / 1000,
      generatedAt: "2026-09-30T16:00:00.000Z",
    });
    expect(history.points.map((point) => point.volumeUsd)).toEqual([10]);
    expect(history.available).toBe(true);
  });

  it("does not let the daily file store read solana-hourly.json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sotb-hourly-isolate-"));
    const row = deskHourlyVolumeSnapshotFromDetail(detail({ volume24hUsd: 12 }), "2026-09-28T21:10:00.000Z");
    expect(row).toBeTruthy();
    if (!row) return;
    await writeFile(join(dir, "solana-hourly.json"), serializeDeskHourlyVolumeSnapshots([row]), "utf8");
    await writeFile(join(dir, "solana.json"), '{"version":1,"records":[]}\n', "utf8");
    expect(await new FileDeskVolumeSnapshotStore(dir).load()).toEqual([]);
    expect(await new FileDeskHourlyVolumeSnapshotStore(dir).load()).toHaveLength(1);
  });
});

function hourlyRow(
  hour: string,
  combined24hUsd: number | null,
  offset = "-04:00",
): DeskHourlyVolumeSnapshot {
  return {
    hour,
    offset,
    t: easternHourStartUnix(hour, offset),
    publicEquity24hUsd: combined24hUsd === null ? null : 1,
    private24hUsd: null,
    etfIndex24hUsd: null,
    combined24hUsd,
    publicLiquidityUsd: null,
    privateLiquidityUsd: null,
    etfIndexLiquidityUsd: null,
    combinedLiquidityUsd: null,
    generatedAt: "2026-09-29T22:00:00.000Z",
  };
}

describe("buildHourlyRollingVolumeHistory", () => {
  const nowT = easternHourStartUnix("2026-09-29T18", "-04:00");
  const rows = [
    hourlyRow("2026-09-28T17", 99),
    hourlyRow("2026-09-28T18", 1),
    hourlyRow("2026-09-29T08", 8),
    hourlyRow("2026-09-29T10", 10),
    hourlyRow("2026-09-29T11", 4),
    hourlyRow("2026-09-29T11", 11),
    hourlyRow("2026-09-29T17", null),
    hourlyRow("2026-09-29T18", 18),
    hourlyRow("2026-09-29T19", 19),
  ];

  it("keeps Eastern hours inside the last 24h and drops the rest", () => {
    const points = buildHourlyRollingVolumeHistory(rows, nowT);
    expect(points.map((point) => point.t)).toEqual([
      easternHourStartUnix("2026-09-28T18", "-04:00"),
      easternHourStartUnix("2026-09-29T08", "-04:00"),
      easternHourStartUnix("2026-09-29T10", "-04:00"),
      easternHourStartUnix("2026-09-29T11", "-04:00"),
      easternHourStartUnix("2026-09-29T18", "-04:00"),
    ]);
    expect(points.every((point) => point.kind === "rolling_24h")).toBe(true);
    expect(points.map((point) => point.volumeUsd)).toEqual([1, 8, 10, 11, 18]);
    expect(points.some((point) => point.volumeUsd === 1 && point.t === easternHourStartUnix("2026-09-29T08", "-04:00"))).toBe(
      false,
    );
  });

  it("lists every Eastern hour in the window, including hours with no snapshot", () => {
    const slots = easternRollingHourStarts(nowT);
    expect(slots[0]).toBe(easternHourStartUnix("2026-09-28T18", "-04:00"));
    expect(slots.at(-1)).toBe(nowT);
    expect(slots).toHaveLength(25);
    expect(slots).toContain(easternHourStartUnix("2026-09-29T09", "-04:00"));
    expect(slots).toContain(easternHourStartUnix("2026-09-29T17", "-04:00"));
    const points = buildHourlyRollingVolumeHistory(rows, nowT);
    for (const t of slots) {
      const captured = points.some((point) => point.t === t);
      const row = rows.find((item) => item.t === t && item.combined24hUsd !== null && item.hour !== "2026-09-28T17");
      if (!captured) {
        expect(row?.combined24hUsd ?? null).toBeNull();
      }
    }
    expect(points.some((point) => point.t === easternHourStartUnix("2026-09-29T09", "-04:00"))).toBe(false);
    expect(easternRollingHourStarts(Number.NaN)).toEqual([]);
  });

  it("keeps both fall-back hours and does not invent the spring-forward gap", () => {
    const fallNow = Date.parse("2026-11-01T08:30:00.000Z") / 1000;
    const fallSlots = easternRollingHourStarts(fallNow).map((t) => easternHourStamp(t));
    const labels = fallSlots.map((stamp) => (stamp ? `${stamp.hour}${stamp.offset}` : ""));
    expect(labels).toContain("2026-11-01T01-04:00");
    expect(labels).toContain("2026-11-01T01-05:00");
    const springNow = Date.parse("2026-03-08T09:00:00.000Z") / 1000;
    const springHours = easternRollingHourStarts(springNow).map((t) => easternHourStamp(t)?.hour);
    expect(springHours).toContain("2026-03-08T01");
    expect(springHours).toContain("2026-03-08T03");
    expect(springHours).not.toContain("2026-03-08T02");
  });

  it("leaves T09 and T17 gaps absent and skips a null combined total", () => {
    const points = buildHourlyRollingVolumeHistory(rows, nowT);
    const missing = [
      easternHourStartUnix("2026-09-29T09", "-04:00"),
      easternHourStartUnix("2026-09-29T17", "-04:00"),
    ];
    for (const t of missing) {
      expect(points.some((point) => point.t === t)).toBe(false);
    }
    const t08 = easternHourStartUnix("2026-09-29T08", "-04:00");
    const t10 = easternHourStartUnix("2026-09-29T10", "-04:00");
    expect(t10 - t08).toBe(7_200);
    expect(points.filter((point) => point.t === t08 || point.t === t10)).toHaveLength(2);
  });

  it("returns nothing for an invalid clock and does not treat a negative total as zero", () => {
    expect(buildHourlyRollingVolumeHistory(rows, Number.NaN)).toEqual([]);
    expect(buildHourlyRollingVolumeHistory(rows, 0)).toEqual([]);
    const negative = hourlyRow("2026-09-29T12", -5);
    expect(buildHourlyRollingVolumeHistory([negative], nowT)).toEqual([]);
    const zero = hourlyRow("2026-09-29T12", 0);
    expect(buildHourlyRollingVolumeHistory([zero], nowT)).toEqual([
      { t: zero.t, volumeUsd: 0, kind: "rolling_24h" },
    ]);
  });

  it("builds an hourly history object without inventing points when the window is empty", () => {
    const history = buildHourlyRollingEquityVolumeHistory({
      snapshots: rows,
      nowT,
      generatedAt: "2026-09-29T22:00:00.000Z",
    });
    expect(history.available).toBe(true);
    expect(history.points.at(-1)).toEqual({
      t: easternHourStartUnix("2026-09-29T18", "-04:00"),
      volumeUsd: 18,
      kind: "rolling_24h",
    });
    expect(history.volume24hUsd).toBe(18);
    expect(history.definition).toMatch(/rolling h24/);
    expect(history.definition).toMatch(/not volume during the hour alone/);
    expect(history.sourceLabel).toMatch(/rolling 24h/);
    expect(history.emptyReason).toBeNull();

    const empty = buildHourlyRollingEquityVolumeHistory({
      snapshots: [hourlyRow("2026-09-29T17", null)],
      nowT,
      generatedAt: "2026-09-29T22:00:00.000Z",
    });
    expect(empty.available).toBe(false);
    expect(empty.points).toEqual([]);
    expect(empty.emptyReason).toMatch(/not invented/);
  });
});

describe("resolvePinnedEasternHour", () => {
  const duringNextHour = Date.parse("2026-09-23T13:10:00.000Z") / 1000;

  it("accepts the current hour and the hour the clock just left", () => {
    expect(resolvePinnedEasternHour("  ", duringNextHour)).toEqual({ ok: true, stamp: null });
    const current = resolvePinnedEasternHour("2026-09-23T09", duringNextHour);
    expect(current.ok && current.stamp?.hour).toBe("2026-09-23T09");
    expect(current.ok && current.stamp?.offset).toBe("-04:00");
    const previous = resolvePinnedEasternHour("2026-09-23T08-04:00", duringNextHour);
    expect(previous.ok && previous.stamp?.hour).toBe("2026-09-23T08");
    expect(previous.ok && previous.stamp?.t).toBe(Date.parse("2026-09-23T08:00:00-04:00") / 1000);
    const twoBack = resolvePinnedEasternHour("2026-09-23T07", duringNextHour);
    expect(twoBack.ok && twoBack.stamp?.hour).toBe("2026-09-23T07");
  });

  it("refuses a future hour, a backfill, a spring-forward gap, and an ambiguous fall-back hour", () => {
    const future = resolvePinnedEasternHour("2026-09-23T10", duringNextHour);
    expect(future.ok).toBe(false);
    if (!future.ok) expect(future.reason).toMatch(/future/);

    const old = resolvePinnedEasternHour("2026-09-23T06", duringNextHour);
    expect(old.ok).toBe(false);
    if (!old.ok) expect(old.reason).toMatch(/not backfilled/);

    const gap = resolvePinnedEasternHour("2026-03-08T02", Date.parse("2026-03-08T07:30:00.000Z") / 1000);
    expect(gap.ok).toBe(false);
    if (!gap.ok) expect(gap.reason).toMatch(/not a real/);

    const ambiguous = resolvePinnedEasternHour("2026-11-01T01", Date.parse("2026-11-01T06:30:00.000Z") / 1000);
    expect(ambiguous.ok).toBe(false);
    if (!ambiguous.ok) expect(ambiguous.reason).toMatch(/ambiguous/);

    const first = resolvePinnedEasternHour("2026-11-01T01-04:00", Date.parse("2026-11-01T06:30:00.000Z") / 1000);
    const second = resolvePinnedEasternHour("2026-11-01T01-05:00", Date.parse("2026-11-01T06:30:00.000Z") / 1000);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok || !first.stamp || !second.stamp) return;
    expect(first.stamp.offset).toBe("-04:00");
    expect(second.stamp.offset).toBe("-05:00");
    expect(first.stamp.t).not.toBe(second.stamp.t);
  });
});

describe("FileDeskHourlyVolumeSnapshotStore", () => {
  it("round-trips one compact row and fails closed on garbage", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sotb-hourly-"));
    const store = new FileDeskHourlyVolumeSnapshotStore(dir);
    expect(await store.load()).toEqual([]);
    const row = deskHourlyVolumeSnapshotFromDetail(
      detail({ volume24hUsd: 5, privateVolume24hUsd: 1, displayedLiquidityUsd: 8 }),
      "2026-09-28T21:10:00.000Z",
    );
    expect(row).toBeTruthy();
    if (!row) return;
    await store.save(upsertDeskHourlyVolumeSnapshot([], row));
    const loaded = await store.load();
    expect(loaded).toEqual([row]);
    const raw = await readFile(join(dir, "solana-hourly.json"), "utf8");
    expect(raw).toContain('"kind": "rolling_h24_totals"');
    expect(raw).not.toContain("pairAddress");
    expect(raw).not.toContain('"assets"');
    expect(raw.split("\n").some((line) => line.includes('"hour":"2026-09-28T17"'))).toBe(true);
    expect(parseDeskHourlyVolumeSnapshotRecords(JSON.parse(raw))).toHaveLength(1);
  });

  it("parses the committed hourly file as captured hours only", () => {
    const text = readFileSync(join(process.cwd(), "data/volume-snapshots/solana-hourly.json"), "utf8");
    const raw = JSON.parse(text) as {
      hourKey: string;
      kind: string;
      records: { hour: string }[];
    };
    expect(raw.hourKey).toBe("America/New_York");
    expect(raw.kind).toBe("rolling_h24_totals");
    const parsed = parseDeskHourlyVolumeSnapshotRecords(raw);
    expect(parsed.map((row) => row.hour)).toEqual(raw.records.map((row) => row.hour));
    expect(serializeDeskHourlyVolumeSnapshots(parsed)).toBe(text);
    const latest = parsed[parsed.length - 1];
    expect(latest).toBeTruthy();
    if (!latest) return;
    const points = buildHourlyRollingVolumeHistory(parsed, latest.t);
    const captured = new Set(parsed.map((row) => row.t));
    expect(points.every((point) => captured.has(point.t) && point.kind === "rolling_24h")).toBe(true);
    for (const hour of ["2026-09-29T09", "2026-09-29T17"]) {
      if (parsed.some((row) => row.hour === hour)) continue;
      expect(points.some((point) => point.t === easternHourStartUnix(hour, "-04:00"))).toBe(false);
    }
  });
});
