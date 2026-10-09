import { readFileSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { deskRangeVolumeHeadline, filterVolumeRange, formatVolumeChartTick, volumeChartXTicks } from "../daily-volume-view";
import { UTC_DAY_SECONDS } from "../volume-history";
import { FileDeskVolumeSnapshotStore } from "../volume-snapshot-store";
import {
  buildSnapshotEquityVolumeHistory,
  clipVolumeThroughEasternDay,
  closedSnapshotVolumePoints,
  deskSnapshotAssetsFromSummaries,
  deskVolumeSnapshotFromChain,
  easternDayKey,
  parseDeskVolumeSnapshotRecords,
  pointsFromDeskVolumeSnapshots,
  recordDeskVolumeFromChain,
  upsertDeskVolumeSnapshot,
  utcInstantForDayKey,
  MemoryDeskVolumeSnapshotStore,
  type DeskVolumeSnapshot,
} from "../volume-snapshots";

const DAY0 = Date.UTC(2026, 8, 14) / 1000;
const DAY1 = DAY0 + UTC_DAY_SECONDS;

/** 16:00Z is noon in New York, so the Eastern date matches this UTC midnight. */
function noonOnUtcDay(utcMidnight: number): number {
  return utcMidnight + 16 * 3_600;
}

function chain(partial: {
  volume24hUsd?: number | null;
  privateVolume24hUsd?: number | null;
  etfVolume24hUsd?: number | null;
}) {
  return {
    volume24hUsd: partial.volume24hUsd ?? null,
    privateVolume24hUsd: partial.privateVolume24hUsd ?? null,
    etfVolume24hUsd: partial.etfVolume24hUsd ?? null,
    assetCount: 12,
    reportedPoolCount: 40,
  };
}

function snap(partial: Partial<DeskVolumeSnapshot> & Pick<DeskVolumeSnapshot, "t" | "combined24hUsd">): DeskVolumeSnapshot {
  return {
    date: new Date(partial.t * 1000).toISOString().slice(0, 10),
    publicEquity24hUsd: partial.publicEquity24hUsd ?? partial.combined24hUsd,
    private24hUsd: partial.private24hUsd ?? null,
    etfIndex24hUsd: partial.etfIndex24hUsd ?? null,
    publicMintCount: 12,
    publicPoolCount: 40,
    generatedAt: "2026-09-15T00:00:00.000Z",
    ...partial,
  };
}

describe("deskVolumeSnapshotFromChain", () => {
  it("sums reported legs and omits nulls instead of writing $0", () => {
    const generatedAt = "2026-09-15T12:00:00.000Z";
    const row = deskVolumeSnapshotFromChain(
      chain({ volume24hUsd: 86_200_000, privateVolume24hUsd: 8_700_000, etfVolume24hUsd: 32_100_000 }),
      generatedAt,
      noonOnUtcDay(DAY1),
    );
    expect(row.t).toBe(utcInstantForDayKey("2026-09-15"));
    expect(row.date).toBe("2026-09-15");
    expect(row.combined24hUsd).toBeCloseTo(127_000_000);
    expect(row.publicEquity24hUsd).toBe(86_200_000);

    const allNull = deskVolumeSnapshotFromChain(chain({}), generatedAt, noonOnUtcDay(DAY1));
    expect(allNull.combined24hUsd).toBeNull();
    expect(allNull.publicEquity24hUsd).toBeNull();
  });

  it("keeps a reported 0 and still omits missing legs", () => {
    const row = deskVolumeSnapshotFromChain(
      chain({ volume24hUsd: 0, privateVolume24hUsd: null, etfVolume24hUsd: null }),
      "2026-09-15T12:00:00.000Z",
      noonOnUtcDay(DAY1),
    );
    expect(row.combined24hUsd).toBe(0);
  });

  it("keys the row to America/New_York so 00:00Z does not open the next Eastern day", () => {
    const evening = Date.parse("2026-09-29T01:48:00.000Z") / 1000;
    expect(easternDayKey(evening)).toBe("2026-09-28");
    const row = deskVolumeSnapshotFromChain(
      chain({ volume24hUsd: 114_000_000 }),
      "2026-09-29T01:48:00.000Z",
      evening,
    );
    expect(row.date).toBe("2026-09-28");
    expect(row.t).toBe(utcInstantForDayKey("2026-09-28"));
    expect(new Date(row.t * 1000).toISOString()).toBe("2026-09-28T04:00:00.000Z");
    expect(row.date).not.toBe("2026-09-29");
  });

  it("uses America/New_York midnight in EST as well as EDT", () => {
    expect(new Date(utcInstantForDayKey("2026-01-15") * 1000).toISOString()).toBe("2026-01-15T05:00:00.000Z");
    expect(easternDayKey(utcInstantForDayKey("2026-01-15"))).toBe("2026-01-15");
    expect(easternDayKey(utcInstantForDayKey("2026-01-15") - 1)).toBe("2026-01-14");
    expect(easternDayKey(utcInstantForDayKey("2026-11-01"))).toBe("2026-11-01");
    expect(new Date(utcInstantForDayKey("2026-11-01") * 1000).toISOString()).toBe("2026-11-01T04:00:00.000Z");
  });

  it("stores Base-shaped per-asset rows from the live desk sample", () => {
    const row = deskVolumeSnapshotFromChain(
      chain({ volume24hUsd: 10 }),
      "2026-09-15T12:00:00.000Z",
      noonOnUtcDay(DAY1),
      [
        {
          contractAddress: "mint-b",
          symbol: "BBBx",
          issuer: "xstocks",
          instrumentKind: "equity",
          volume24hUsd: 0,
          displayedLiquidityUsd: null,
          pools: [{ pairAddress: "pair-b", dexId: "raydium", volume24hUsd: 0, liquidityUsd: null }],
        },
        {
          contractAddress: "mint-a",
          symbol: "AAAx",
          issuer: null,
          instrumentKind: "etf",
          volume24hUsd: 12.345,
          displayedLiquidityUsd: 4,
          pools: [
            { pairAddress: "pair-a", dexId: "orca", volume24hUsd: 12.345, liquidityUsd: 4 },
            { pairAddress: "pair-a", dexId: "orca", volume24hUsd: 99, liquidityUsd: 1 },
          ],
        },
        {
          contractAddress: "mint-c",
          symbol: "CCCx",
          issuer: null,
          instrumentKind: "private",
          volume24hUsd: null,
          displayedLiquidityUsd: null,
          pools: [],
        },
      ],
    );
    expect(row.date).toBe("2026-09-15");
    expect(row.t).toBe(utcInstantForDayKey("2026-09-15"));
    expect(row.combined24hUsd).toBe(10);
    expect(row.assets?.map((asset) => asset.symbol)).toEqual(["AAAx", "BBBx"]);
    expect(row.assets?.[0]).toMatchObject({
      address: "mint-a",
      instrumentKind: "etf",
      volume24hUsd: 12.35,
      displayedLiquidityUsd: 4,
    });
    expect(row.assets?.[0]?.issuer).toBeUndefined();
    expect(row.assets?.[0]?.pools).toEqual([
      { pairAddress: "pair-a", dexId: "orca", volume24hUsd: 12.35, liquidityUsd: 4 },
    ]);
    expect(row.assets?.[1]).toMatchObject({
      address: "mint-b",
      issuer: "xstocks",
      instrumentKind: "equity",
      volume24hUsd: 0,
    });
    expect(deskSnapshotAssetsFromSummaries([])).toEqual([]);
  });
});

describe("upsertDeskVolumeSnapshot", () => {
  it("replaces the same Eastern day and refuses to persist an all-null day", () => {
    const first = deskVolumeSnapshotFromChain(
      chain({ volume24hUsd: 100 }),
      "2026-09-15T01:00:00.000Z",
      noonOnUtcDay(DAY1),
    );
    const richer = deskVolumeSnapshotFromChain(
      chain({ volume24hUsd: 150, privateVolume24hUsd: 20 }),
      "2026-09-15T02:00:00.000Z",
      noonOnUtcDay(DAY1),
    );
    const afterNull = deskVolumeSnapshotFromChain(chain({}), "2026-09-15T03:00:00.000Z", noonOnUtcDay(DAY1));
    const prior = deskVolumeSnapshotFromChain(
      chain({ volume24hUsd: 9 }),
      "2026-09-14T12:00:00.000Z",
      noonOnUtcDay(DAY0),
    );

    const once = upsertDeskVolumeSnapshot([], first);
    expect(once).toHaveLength(1);
    const updated = upsertDeskVolumeSnapshot(once, richer);
    expect(updated).toHaveLength(1);
    expect(updated[0]?.combined24hUsd).toBe(170);
    expect(updated[0]?.generatedAt).toBe("2026-09-15T02:00:00.000Z");

    const refused = upsertDeskVolumeSnapshot(updated, afterNull);
    expect(refused).toHaveLength(1);
    expect(refused[0]?.combined24hUsd).toBe(170);

    const twoDays = upsertDeskVolumeSnapshot(refused, prior);
    expect(twoDays.map((row) => row.t)).toEqual([
      utcInstantForDayKey("2026-09-14"),
      utcInstantForDayKey("2026-09-15"),
    ]);
  });

  it("keeps nightly asset rows when a later totals-only rewrite omits them", () => {
    const nightly = deskVolumeSnapshotFromChain(
      chain({ volume24hUsd: 10 }),
      "2026-09-15T12:00:00.000Z",
      noonOnUtcDay(DAY1),
      [
        {
          contractAddress: "mint-a",
          symbol: "AAAx",
          issuer: "ondo",
          instrumentKind: "equity",
          volume24hUsd: 10,
          displayedLiquidityUsd: 2,
          pools: [{ pairAddress: "pair-a", dexId: "raydium", volume24hUsd: 10, liquidityUsd: 2 }],
        },
      ],
    );
    const totalsOnly = deskVolumeSnapshotFromChain(
      chain({ volume24hUsd: 20 }),
      "2026-09-15T18:00:00.000Z",
      noonOnUtcDay(DAY1),
    );
    const kept = upsertDeskVolumeSnapshot([nightly], totalsOnly);
    expect(kept).toHaveLength(1);
    expect(kept[0]?.combined24hUsd).toBe(20);
    expect(kept[0]?.assets).toEqual(nightly.assets);

    const replaced = deskVolumeSnapshotFromChain(
      chain({ volume24hUsd: 30 }),
      "2026-09-15T23:00:00.000Z",
      noonOnUtcDay(DAY1),
      [
        {
          contractAddress: "mint-new",
          symbol: "NEWx",
          issuer: "rhj",
          instrumentKind: "private",
          volume24hUsd: 30,
          displayedLiquidityUsd: null,
          pools: [],
        },
      ],
    );
    const next = upsertDeskVolumeSnapshot(kept, replaced);
    expect(next[0]?.combined24hUsd).toBe(30);
    expect(next[0]?.assets?.map((asset) => asset.address)).toEqual(["mint-new"]);
    expect(next[0]?.assets?.[0]?.instrumentKind).toBe("private");
  });
});

describe("pointsFromDeskVolumeSnapshots and closedSnapshotVolumePoints", () => {
  it("builds chart points only from stored snapshots and does not fill gaps as $0", () => {
    const points = pointsFromDeskVolumeSnapshots([
      snap({ t: DAY0, combined24hUsd: 10 }),
      snap({ t: DAY1 + UTC_DAY_SECONDS, combined24hUsd: 40, date: "2026-09-16" }),
    ]);
    expect(points).toEqual([
      { t: utcInstantForDayKey("2026-09-14"), volumeUsd: 10, kind: "calendar_day" },
      { t: utcInstantForDayKey("2026-09-16"), volumeUsd: 40, kind: "calendar_day" },
    ]);
    expect(points.some((point) => point.volumeUsd === 0)).toBe(false);
  });

  it("plots the stored Eastern date when the snapshot instant has rolled into the next UTC day", () => {
    const points = pointsFromDeskVolumeSnapshots([
      snap({
        t: Date.parse("2026-09-29T00:30:00.000Z") / 1000,
        date: "2026-09-28",
        combined24hUsd: 10,
      }),
    ]);
    expect(points).toEqual([{ t: utcInstantForDayKey("2026-09-28"), volumeUsd: 10, kind: "calendar_day" }]);
  });

  it("does not append a live rolling tip for the in-progress Eastern day", () => {
    const stored = pointsFromDeskVolumeSnapshots([snap({ t: DAY0, combined24hUsd: 10 })]);
    // 16:00Z is noon in New York. Sep 15 has no snapshot, so the live 24h must not open it.
    const noonEt = Date.parse("2026-09-15T16:00:00.000Z") / 1000;
    expect(easternDayKey(noonEt)).toBe("2026-09-15");
    expect(closedSnapshotVolumePoints(stored, noonEt)).toEqual(stored);
    expect(
      closedSnapshotVolumePoints(
        [...stored, { t: DAY1, volumeUsd: 99, kind: "rolling_24h" }],
        noonEt,
      ),
    ).toEqual(stored);
  });

  it("omits the in-progress Eastern day and does not plot a UTC tomorrow", () => {
    const sep28 = Date.UTC(2026, 8, 28) / 1000;
    const sep29 = Date.UTC(2026, 8, 29) / 1000;
    const stored = pointsFromDeskVolumeSnapshots([
      snap({ t: Date.UTC(2026, 8, 27) / 1000, combined24hUsd: 76_080_265, date: "2026-09-27" }),
      snap({ t: sep28, combined24hUsd: 114_000_000, date: "2026-09-28" }),
      snap({ t: sep29, combined24hUsd: 114_000_000, date: "2026-09-29" }),
    ]);
    // 01:30Z on Sep 29 is 21:30 ET on Sep 28. UTC "today" is already Sep 29.
    const eveningEt = Date.parse("2026-09-29T01:30:00.000Z") / 1000;
    expect(easternDayKey(eveningEt)).toBe("2026-09-28");
    const duringSep28 = closedSnapshotVolumePoints(
      [
        ...stored,
        { t: sep28, volumeUsd: 999, kind: "rolling_24h" },
        { t: sep29, volumeUsd: 114_000_000, kind: "rolling_24h" },
      ],
      eveningEt,
    );
    expect(duringSep28.map((point) => utcDay(point.t))).toEqual(["2026-09-27"]);
    // This helper still keeps a UTC day once New York's calendar has reached it.
    // The asset 7D/30D chart does not use it — that series waits for a closed Eastern day.
    // Here Sep 28 is still in progress, and Sep 29 has not started.
    expect(
      clipVolumeThroughEasternDay(
        [
          { t: Date.UTC(2026, 8, 27) / 1000, volumeUsd: 76_080_265, kind: "calendar_day" },
          { t: sep28, volumeUsd: 114_000_000, kind: "calendar_day" },
          { t: sep29, volumeUsd: 114_000_000, kind: "calendar_day" },
        ],
        eveningEt,
      ).map((point) => utcDay(point.t)),
    ).toEqual(["2026-09-27", "2026-09-28"]);

    // 04:10Z is 00:10 ET on Sep 29. Sep 28 has closed; Sep 29 has not.
    const justAfterMidnight = Date.parse("2026-09-29T04:10:00.000Z") / 1000;
    expect(easternDayKey(justAfterMidnight)).toBe("2026-09-29");
    expect(closedSnapshotVolumePoints(stored, justAfterMidnight).map((point) => utcDay(point.t))).toEqual([
      "2026-09-27",
      "2026-09-28",
    ]);
  });
});

function utcDay(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

describe("buildSnapshotEquityVolumeHistory", () => {
  it("uses closed snapshots and ignores the live rollup", () => {
    const history = buildSnapshotEquityVolumeHistory({
      snapshots: [snap({ t: DAY0, combined24hUsd: 10, publicEquity24hUsd: 10 })],
      liveCombined24hUsd: 126_900_000,
      livePublic24hUsd: 86_200_000,
      nowT: Date.parse("2026-09-15T16:00:00.000Z") / 1000,
      generatedAt: "2026-09-15T16:00:00.000Z",
      mintCount: 96,
      poolCount: 40,
    });
    expect(history.available).toBe(true);
    expect(history.points).toEqual([
      { t: utcInstantForDayKey("2026-09-14"), volumeUsd: 10, kind: "calendar_day" },
    ]);
    expect(history.points.some((point) => point.kind === "rolling_24h")).toBe(false);
    expect(history.seriesByMint).toEqual({});
    expect(history.sourceLabel).not.toMatch(/GeckoTerminal/);
    expect(history.definition).toMatch(/DexScreener 24h snapshots/);
    expect(history.definition).toMatch(/not invented from GeckoTerminal/);
    expect(history.definition).toMatch(/in-progress Eastern day is omitted/);
    expect(history.volume24hUsd).toBe(86_200_000);
  });

  it("stays empty when there are no snapshots — a live 24h does not invent a tip", () => {
    const history = buildSnapshotEquityVolumeHistory({
      snapshots: [],
      liveCombined24hUsd: 126_900_000,
      nowT: Date.parse("2026-09-15T16:00:00.000Z") / 1000,
      generatedAt: "2026-09-15T16:00:00.000Z",
    });
    expect(history.available).toBe(false);
    expect(history.points).toEqual([]);
    expect(history.emptyReason).toMatch(/not invented from GeckoTerminal/);
  });
});

describe("recordDeskVolumeFromChain", () => {
  it("upserts public / private / ETF legs and refuses an all-null day", async () => {
    const store = new MemoryDeskVolumeSnapshotStore();
    const written = await recordDeskVolumeFromChain(
      store,
      chain({ volume24hUsd: 86_200_000, privateVolume24hUsd: 8_700_000, etfVolume24hUsd: 32_100_000 }),
      "2026-09-15T12:00:00.000Z",
      noonOnUtcDay(DAY1),
    );
    expect(written.ok).toBe(true);
    if (written.ok) {
      expect(written.written).toBe(true);
      expect(written.snapshot.combined24hUsd).toBeCloseTo(127_000_000);
      expect(written.snapshot.publicEquity24hUsd).toBe(86_200_000);
      expect(written.snapshot.private24hUsd).toBe(8_700_000);
      expect(written.snapshot.etfIndex24hUsd).toBe(32_100_000);
    }

    const richer = await recordDeskVolumeFromChain(
      store,
      chain({ volume24hUsd: 90_000_000, privateVolume24hUsd: 8_700_000, etfVolume24hUsd: 32_100_000 }),
      "2026-09-15T18:00:00.000Z",
      noonOnUtcDay(DAY1),
    );
    expect(richer.ok).toBe(true);
    if (richer.ok) {
      expect(richer.written).toBe(true);
      expect(richer.snapshot.combined24hUsd).toBeCloseTo(130_800_000);
    }
    expect(await store.load()).toHaveLength(1);

    const refused = await recordDeskVolumeFromChain(store, chain({}), "2026-09-15T20:00:00.000Z", noonOnUtcDay(DAY1));
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.reason).toMatch(/all-null/);
      expect(refused.reason).toMatch(/not \$0/);
    }
    expect((await store.load())[0]?.combined24hUsd).toBeCloseTo(130_800_000);
  });

  it("treats an identical same-day write as success without rewriting", async () => {
    const store = new MemoryDeskVolumeSnapshotStore();
    const first = await recordDeskVolumeFromChain(
      store,
      chain({ volume24hUsd: 10 }),
      "2026-09-15T12:00:00.000Z",
      noonOnUtcDay(DAY1),
    );
    const again = await recordDeskVolumeFromChain(
      store,
      chain({ volume24hUsd: 10 }),
      "2026-09-15T12:00:00.000Z",
      noonOnUtcDay(DAY1),
    );
    expect(first.ok && first.written).toBe(true);
    expect(again.ok && again.unchanged).toBe(true);
    expect(await store.load()).toHaveLength(1);
  });
});

describe("committed Solana desk snapshots", () => {
  const raw = JSON.parse(readFileSync(join(process.cwd(), "data/volume-snapshots/solana.json"), "utf8"));
  const snapshots = parseDeskVolumeSnapshotRecords(raw);

  it("keeps every honest recorded day, including the Sep 23 CLI total and days later commits had replaced away", () => {
    expect(snapshots.map((row) => row.date)).toEqual([
      "2026-09-23",
      "2026-09-24",
      "2026-09-25",
      "2026-09-26",
      "2026-09-27",
      "2026-09-28",
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
      "2026-10-08",
    ]);
    expect(snapshots.map((row) => row.combined24hUsd)).toEqual([
      133612028.33,
      129580787.39,
      120374995.69,
      62039972.79,
      78641445.28,
      127747228.91,
      229372144.68,
      168707228.1,
      165151241.64,
      126725920.37,
      37019510.68,
      88289243.29,
      92076794.59,
      115642562.14,
      85958147.02,
      113121327.45,
    ]);
    const sep23 = snapshots[0];
    expect(sep23?.publicEquity24hUsd).toBeCloseTo(94_444_200.04, 2);
    expect(sep23?.private24hUsd).toBeCloseTo(18_309_288.95, 2);
    expect(sep23?.etfIndex24hUsd).toBeCloseTo(20_858_539.34, 2);
    expect(sep23?.correction?.previousCombined24hUsd).toBe(173522731.07);
    expect(sep23?.assets?.length).toBeGreaterThan(0);
    const oct3 = snapshots.find((row) => row.date === "2026-10-03");
    expect(oct3?.assets?.length).toBeGreaterThan(0);
    expect(oct3?.assets?.[0]).toEqual(
      expect.objectContaining({
        address: expect.any(String),
        symbol: expect.any(String),
        instrumentKind: expect.any(String),
      }),
    );
    expect(oct3?.assets?.some((asset) => asset.volume24hUsd !== null)).toBe(true);
    expect(snapshots.find((row) => row.date === "2026-10-07")?.assets?.length).toBeGreaterThan(0);
    const oct8 = snapshots.find((row) => row.date === "2026-10-08");
    expect(oct8?.t).toBe(1_791_432_000);
    expect(oct8?.generatedAt).toBe("2026-10-09T04:20:08.601Z");
    expect(oct8?.assets?.length).toBeGreaterThan(0);
    expect(oct8?.assets?.some((asset) => asset.displayedLiquidityUsd !== null)).toBe(true);
    expect(oct8?.assets?.some((asset) => asset.pools.some((pool) => pool.liquidityUsd !== null))).toBe(true);
  });

  it("holds the stored Sep 28 snapshot off 7D, 14D, and 30D while that Eastern day is in progress", () => {
    const throughSep27 = snapshots
      .filter((row) => row.date < "2026-09-28")
      .reduce((sum, row) => sum + (row.combined24hUsd ?? 0), 0);
    const sep28Usd = snapshots.find((row) => row.date === "2026-09-28")?.combined24hUsd ?? 0;
    const history = buildSnapshotEquityVolumeHistory({
      snapshots,
      liveCombined24hUsd: 97_900_000,
      nowT: Date.parse("2026-09-28T16:00:00.000Z") / 1000,
      generatedAt: "2026-09-28T16:00:00.000Z",
    });
    const dates = history.points.map((point) => new Date(point.t * 1000).toISOString().slice(0, 10));
    expect(dates).toEqual(["2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27"]);
    expect(history.points.every((point) => point.kind === "calendar_day")).toBe(true);
    for (const range of ["7d", "14d", "30d"] as const) {
      const visible = filterVolumeRange(history.points, range);
      expect(visible).toHaveLength(history.points.length);
      const ticks = volumeChartXTicks(visible);
      expect(ticks.map((t) => formatVolumeChartTick(t, ticks))).toEqual([
        "Sep 23",
        "Sep 24",
        "Sep 25",
        "Sep 26",
        "Sep 27",
      ]);
      const sep26 = visible.find((point) => new Date(point.t * 1000).toISOString().startsWith("2026-09-26"));
      expect(sep26?.volumeUsd).toBeCloseTo(62_039_972.79);
      const headline = deskRangeVolumeHeadline(visible, range);
      expect(headline.volumeUsd).toBeCloseTo(throughSep27);
      expect(headline.volumeUsd).not.toBeCloseTo(throughSep27 + sep28Usd);
      expect(headline.volumeUsd).not.toBeCloseTo(throughSep27 + 97_900_000);
      expect(headline.caption.startsWith(range === "7d" ? "7D" : range === "14d" ? "14D" : "30D")).toBe(true);
    }
    expect(history.points.filter((point) => point.t < Date.parse("2026-09-23T00:00:00.000Z") / 1000)).toEqual([]);
    expect(history.points.some((point) => point.volumeUsd === 0)).toBe(false);
  });

  it("keeps the stored Sep 28 row off the series while America/New_York is still Sep 28 and does not plot Sep 29", () => {
    const history = buildSnapshotEquityVolumeHistory({
      snapshots,
      liveCombined24hUsd: 114_000_000,
      nowT: Date.parse("2026-09-29T01:48:00.000Z") / 1000,
      generatedAt: "2026-09-29T01:48:00.000Z",
    });
    const dates = history.points.map((point) => new Date(point.t * 1000).toISOString().slice(0, 10));
    expect(dates).toEqual(["2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27"]);
    expect(history.points[history.points.length - 1]).toMatchObject({
      volumeUsd: 78_641_445.28,
      kind: "calendar_day",
    });
    for (const range of ["7d", "14d", "30d"] as const) {
      const visible = filterVolumeRange(history.points, range);
      const ticks = volumeChartXTicks(visible);
      const labels = ticks.map((t) => formatVolumeChartTick(t, ticks));
      expect(labels).not.toContain("Sep 28");
      expect(labels).not.toContain("Sep 29");
      expect(labels[labels.length - 1]).toBe("Sep 27");
      const headline = deskRangeVolumeHeadline(visible, range);
      expect(headline.volumeUsd).toBeCloseTo(visible.reduce((sum, point) => sum + point.volumeUsd, 0));
      expect(headline.volumeUsd).not.toBeCloseTo(
        visible.reduce((sum, point) => sum + point.volumeUsd, 0) + 114_000_000,
      );
    }
    expect(easternDayKey(Date.parse("2026-09-29T03:59:59.000Z") / 1000)).toBe("2026-09-28");
    expect(easternDayKey(Date.parse("2026-09-29T04:00:00.000Z") / 1000)).toBe("2026-09-29");
  });

  it("plots the stored Sep 28 snapshot once that Eastern day has closed and does not add the Sep 29 rollup", () => {
    const history = buildSnapshotEquityVolumeHistory({
      snapshots,
      liveCombined24hUsd: 114_000_000,
      nowT: Date.parse("2026-09-29T04:10:00.000Z") / 1000,
      generatedAt: "2026-09-29T04:10:00.000Z",
    });
    const dates = history.points.map((point) => new Date(point.t * 1000).toISOString().slice(0, 10));
    expect(dates).toEqual([
      "2026-09-23",
      "2026-09-24",
      "2026-09-25",
      "2026-09-26",
      "2026-09-27",
      "2026-09-28",
    ]);
    expect(history.points[history.points.length - 1]).toMatchObject({
      volumeUsd: 127_747_228.91,
      kind: "calendar_day",
    });
    for (const range of ["7d", "14d", "30d"] as const) {
      const visible = filterVolumeRange(history.points, range);
      const ticks = volumeChartXTicks(visible);
      const labels = ticks.map((t) => formatVolumeChartTick(t, ticks));
      expect(labels).not.toContain("Sep 29");
      expect(labels[labels.length - 1]).toBe("Sep 28");
      const headline = deskRangeVolumeHeadline(visible, range);
      expect(headline.volumeUsd).toBeCloseTo(visible.reduce((sum, point) => sum + point.volumeUsd, 0));
      expect(headline.volumeUsd).not.toBeCloseTo(
        visible.reduce((sum, point) => sum + point.volumeUsd, 0) + 114_000_000,
      );
    }
  });

  it("does not label Sep 29 or add the live rollup while that Eastern day is in progress", () => {
    const liveUsd = 113_963_983.24;
    const throughSep27 = snapshots
      .filter((row) => row.date < "2026-09-28")
      .reduce((sum, row) => sum + (row.combined24hUsd ?? 0), 0);
    const throughSep28 = snapshots
      .filter((row) => row.date <= "2026-09-28")
      .reduce((sum, row) => sum + (row.combined24hUsd ?? 0), 0);
    const cases = [
      {
        generatedAt: "2026-09-29T01:48:00.000Z", // 21:48 ET Sep 28; UTC date is already Sep 29
        date: "2026-09-28",
        labels: ["Sep 23", "Sep 24", "Sep 25", "Sep 26", "Sep 27"],
        headlineUsd: throughSep27,
      },
      {
        generatedAt: "2026-09-29T04:10:00.000Z", // 00:10 ET Sep 29; Sep 28 has closed, Sep 29 is still in progress
        date: "2026-09-29",
        labels: ["Sep 23", "Sep 24", "Sep 25", "Sep 26", "Sep 27", "Sep 28"],
        headlineUsd: throughSep28,
      },
    ] as const;
    for (const { generatedAt, date, labels: expectedLabels, headlineUsd } of cases) {
      const nowT = Date.parse(generatedAt) / 1000;
      const live = deskVolumeSnapshotFromChain(
        chain({
          volume24hUsd: 80_000_000,
          privateVolume24hUsd: 20_000_000,
          etfVolume24hUsd: liveUsd - 100_000_000,
        }),
        generatedAt,
        nowT,
      );
      expect(easternDayKey(nowT)).toBe(date);
      expect(live.date).toBe(date);
      expect(live.t).toBe(utcInstantForDayKey(date));
      const history = buildSnapshotEquityVolumeHistory({
        snapshots: upsertDeskVolumeSnapshot(snapshots, live),
        liveCombined24hUsd: liveUsd,
        nowT,
        generatedAt,
      });
      const sep28 = history.points.find((point) => new Date(point.t * 1000).toISOString().startsWith("2026-09-28"));
      if (date === "2026-09-29") {
        expect(sep28?.volumeUsd).toBeCloseTo(127_747_228.91);
      } else {
        expect(sep28).toBeUndefined();
      }
      for (const range of ["7d", "14d", "30d"] as const) {
        const visible = filterVolumeRange(history.points, range);
        const ticks = volumeChartXTicks(visible);
        const labels = ticks.map((t) => formatVolumeChartTick(t, ticks));
        expect(labels).toEqual([...expectedLabels]);
        expect(labels).not.toContain("Sep 29");
        const headline = deskRangeVolumeHeadline(visible, range);
        expect(headline.volumeUsd).toBeCloseTo(headlineUsd);
        expect(headline.volumeUsd).not.toBeCloseTo(headlineUsd + liveUsd);
      }
    }
  });

  it("keeps 7D to the last 7 closed days after Sep 30 has closed", () => {
    const history = buildSnapshotEquityVolumeHistory({
      snapshots,
      liveCombined24hUsd: 150_000_000,
      nowT: Date.parse("2026-10-01T04:10:00.000Z") / 1000,
      generatedAt: "2026-10-01T04:10:00.000Z",
    });
    const dayKey = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
    const dates = history.points.map((point) => dayKey(point.t));
    expect(dates).toEqual([
      "2026-09-23",
      "2026-09-24",
      "2026-09-25",
      "2026-09-26",
      "2026-09-27",
      "2026-09-28",
      "2026-09-29",
      "2026-09-30",
    ]);
    const seven = filterVolumeRange(history.points, "7d");
    expect(seven.map((point) => dayKey(point.t))).toEqual([
      "2026-09-24",
      "2026-09-25",
      "2026-09-26",
      "2026-09-27",
      "2026-09-28",
      "2026-09-29",
      "2026-09-30",
    ]);
    const sep23 = snapshots.find((row) => row.date === "2026-09-23")?.combined24hUsd ?? 0;
    const allClosed = history.points.reduce((sum, point) => sum + point.volumeUsd, 0);
    const headline = deskRangeVolumeHeadline(seven, "7d");
    expect(headline.volumeUsd).toBeCloseTo(allClosed - sep23);
    expect(headline.volumeUsd).not.toBeCloseTo(allClosed);
    expect(headline.volumeUsd).not.toBeCloseTo(allClosed - sep23 + 150_000_000);
    for (const range of ["14d", "30d"] as const) {
      expect(filterVolumeRange(history.points, range).map((point) => dayKey(point.t))).toEqual(dates);
    }
  });
});

describe("FileDeskVolumeSnapshotStore", () => {
  it("round-trips records and fails closed on garbage", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sotb-vol-"));
    const store = new FileDeskVolumeSnapshotStore(dir);
    expect(await store.load()).toEqual([]);
    const row = deskVolumeSnapshotFromChain(chain({ volume24hUsd: 5 }), "2026-09-15T12:00:00.000Z", noonOnUtcDay(DAY1));
    await store.save(upsertDeskVolumeSnapshot([], row));
    const loaded = await store.load();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.combined24hUsd).toBe(5);
    const raw = await readFile(join(dir, "solana.json"), "utf8");
    expect(parseDeskVolumeSnapshotRecords(JSON.parse(raw))).toHaveLength(1);
  });

  it("uses unique temp files so overlapping saves do not throw ENOENT", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sotb-vol-"));
    const store = new FileDeskVolumeSnapshotStore(dir);
    const first = deskVolumeSnapshotFromChain(chain({ volume24hUsd: 5 }), "2026-09-15T12:00:00.000Z", noonOnUtcDay(DAY1));
    const second = deskVolumeSnapshotFromChain(chain({ volume24hUsd: 9 }), "2026-09-14T12:00:00.000Z", noonOnUtcDay(DAY0));
    await Promise.all([
      store.save(upsertDeskVolumeSnapshot([], first)),
      store.save(upsertDeskVolumeSnapshot([], second)),
    ]);
    const loaded = await store.load();
    expect(loaded.length).toBeGreaterThan(0);
    expect(loaded.every((row) => row.combined24hUsd !== null)).toBe(true);
  });

  it("keeps per-asset rows when a later total save does not include them", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sotb-vol-"));
    const file = join(dir, "solana.json");
    const assets = [{ address: "mint-a", symbol: "AAPLx", volume24hUsd: 12.5 }];
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        dayKey: "America/New_York",
        records: [
          {
            date: "2026-10-03",
            t: 1,
            combined24hUsd: 10,
            publicEquity24hUsd: 10,
            private24hUsd: null,
            etfIndex24hUsd: null,
            publicMintCount: 1,
            publicPoolCount: 1,
            generatedAt: "2026-10-04T04:00:00.000Z",
            assets,
          },
        ],
      }),
      "utf8",
    );
    const store = new FileDeskVolumeSnapshotStore(dir);
    const loaded = await store.load();
    const updated = loaded.map((row) => (row.date === "2026-10-03" ? { ...row, combined24hUsd: 15 } : row));
    await store.save(updated);
    const raw = JSON.parse(await readFile(file, "utf8")) as {
      dayKey?: string;
      records: Array<{ date: string; t?: number; combined24hUsd: number; assets?: unknown }>;
    };
    expect(raw.dayKey).toBe("America/New_York");
    const text = await readFile(file, "utf8");
    expect(text.indexOf('"dayKey"')).toBeGreaterThan(-1);
    expect(text.indexOf('"dayKey"')).toBeLessThan(text.indexOf('"records"'));
    expect(raw.records.find((row) => row.date === "2026-10-03")).toMatchObject({
      t: utcInstantForDayKey("2026-10-03"),
      combined24hUsd: 15,
      assets,
    });
  });

  it("round-trips nightly per-asset rows and leaves lane totals in place", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sotb-vol-"));
    const store = new FileDeskVolumeSnapshotStore(dir);
    const row = deskVolumeSnapshotFromChain(
      chain({ volume24hUsd: 8, privateVolume24hUsd: 2 }),
      "2026-10-07T03:59:00.000Z",
      Date.parse("2026-10-07T03:59:00.000Z") / 1000,
      [
        {
          contractAddress: "MintCaseSensitive",
          symbol: "TSLAx",
          issuer: "xstocks",
          instrumentKind: "equity",
          volume24hUsd: 8,
          displayedLiquidityUsd: 3,
          pools: [{ pairAddress: "pair-1", dexId: "raydium", volume24hUsd: 8, liquidityUsd: 3 }],
        },
      ],
    );
    expect(row.date).toBe("2026-10-06");
    await store.save([row]);
    const loaded = await store.load();
    expect(loaded[0]?.combined24hUsd).toBe(10);
    expect(loaded[0]?.publicEquity24hUsd).toBe(8);
    expect(loaded[0]?.private24hUsd).toBe(2);
    expect(loaded[0]?.assets).toEqual([
      {
        address: "MintCaseSensitive",
        symbol: "TSLAx",
        issuer: "xstocks",
        instrumentKind: "equity",
        volume24hUsd: 8,
        displayedLiquidityUsd: 3,
        pools: [{ pairAddress: "pair-1", dexId: "raydium", volume24hUsd: 8, liquidityUsd: 3 }],
      },
    ]);
  });
});
