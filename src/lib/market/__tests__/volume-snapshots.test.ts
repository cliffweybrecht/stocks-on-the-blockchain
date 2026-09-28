import { readFileSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { deskRangeVolumeHeadline, filterVolumeRange, formatVolumeChartTick, volumeChartXTicks } from "../daily-volume-view";
import { UTC_DAY_SECONDS } from "../volume-history";
import { FileDeskVolumeSnapshotStore } from "../volume-snapshot-store";
import {
  buildSnapshotEquityVolumeHistory,
  deskVolumeSnapshotFromChain,
  overlayLiveDesk24h,
  parseDeskVolumeSnapshotRecords,
  pointsFromDeskVolumeSnapshots,
  recordDeskVolumeFromChain,
  upsertDeskVolumeSnapshot,
  MemoryDeskVolumeSnapshotStore,
  type DeskVolumeSnapshot,
} from "../volume-snapshots";

const DAY0 = Date.UTC(2026, 8, 14) / 1000;
const DAY1 = DAY0 + UTC_DAY_SECONDS;

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
      DAY1,
    );
    expect(row.t).toBe(DAY1);
    expect(row.date).toBe("2026-09-15");
    expect(row.combined24hUsd).toBeCloseTo(127_000_000);
    expect(row.publicEquity24hUsd).toBe(86_200_000);

    const allNull = deskVolumeSnapshotFromChain(chain({}), generatedAt, DAY1);
    expect(allNull.combined24hUsd).toBeNull();
    expect(allNull.publicEquity24hUsd).toBeNull();
  });

  it("keeps a reported 0 and still omits missing legs", () => {
    const row = deskVolumeSnapshotFromChain(
      chain({ volume24hUsd: 0, privateVolume24hUsd: null, etfVolume24hUsd: null }),
      "2026-09-15T12:00:00.000Z",
      DAY1,
    );
    expect(row.combined24hUsd).toBe(0);
  });
});

describe("upsertDeskVolumeSnapshot", () => {
  it("replaces the same UTC day and refuses to persist an all-null day", () => {
    const first = deskVolumeSnapshotFromChain(
      chain({ volume24hUsd: 100 }),
      "2026-09-15T01:00:00.000Z",
      DAY1,
    );
    const richer = deskVolumeSnapshotFromChain(
      chain({ volume24hUsd: 150, privateVolume24hUsd: 20 }),
      "2026-09-15T02:00:00.000Z",
      DAY1,
    );
    const afterNull = deskVolumeSnapshotFromChain(chain({}), "2026-09-15T03:00:00.000Z", DAY1);
    const prior = deskVolumeSnapshotFromChain(
      chain({ volume24hUsd: 9 }),
      "2026-09-14T12:00:00.000Z",
      DAY0,
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
    expect(twoDays.map((row) => row.t)).toEqual([DAY0, DAY1]);
  });
});

describe("pointsFromDeskVolumeSnapshots and overlayLiveDesk24h", () => {
  it("builds chart points only from stored snapshots and does not fill gaps as $0", () => {
    const points = pointsFromDeskVolumeSnapshots([
      snap({ t: DAY0, combined24hUsd: 10 }),
      snap({ t: DAY1 + UTC_DAY_SECONDS, combined24hUsd: 40, date: "2026-09-16" }),
    ]);
    expect(points).toEqual([
      { t: DAY0, volumeUsd: 10, kind: "calendar_day" },
      { t: DAY1 + UTC_DAY_SECONDS, volumeUsd: 40, kind: "calendar_day" },
    ]);
    expect(points.some((point) => point.volumeUsd === 0)).toBe(false);
  });

  it("overlays today’s live DexScreener 24h without inventing the days in between", () => {
    const stored = pointsFromDeskVolumeSnapshots([snap({ t: DAY0, combined24hUsd: 10 })]);
    const overlaid = overlayLiveDesk24h(stored, 99, DAY1 + 3_600);
    expect(overlaid).toEqual([
      { t: DAY0, volumeUsd: 10, kind: "calendar_day" },
      { t: DAY1, volumeUsd: 99, kind: "rolling_24h" },
    ]);
    expect(overlayLiveDesk24h(stored, null, DAY1)).toEqual(stored);
  });
});

describe("buildSnapshotEquityVolumeHistory", () => {
  it("uses snapshots plus the live tip and never falls back to Gecko candles", () => {
    const history = buildSnapshotEquityVolumeHistory({
      snapshots: [snap({ t: DAY0, combined24hUsd: 10, publicEquity24hUsd: 10 })],
      liveCombined24hUsd: 126_900_000,
      livePublic24hUsd: 86_200_000,
      nowT: DAY1 + 100,
      generatedAt: "2026-09-15T12:00:00.000Z",
      mintCount: 96,
      poolCount: 40,
    });
    expect(history.available).toBe(true);
    expect(history.points).toEqual([
      { t: DAY0, volumeUsd: 10, kind: "calendar_day" },
      { t: DAY1, volumeUsd: 126_900_000, kind: "rolling_24h" },
    ]);
    expect(history.seriesByMint).toEqual({});
    expect(history.sourceLabel).not.toMatch(/GeckoTerminal/);
    expect(history.definition).toMatch(/DexScreener 24h snapshots/);
    expect(history.definition).toMatch(/not invented from GeckoTerminal/);
    expect(history.volume24hUsd).toBe(86_200_000);
  });

  it("stays empty when there are no snapshots and no live 24h — does not invent history", () => {
    const history = buildSnapshotEquityVolumeHistory({
      snapshots: [],
      liveCombined24hUsd: null,
      nowT: DAY1,
      generatedAt: "2026-09-15T12:00:00.000Z",
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
      DAY1,
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
      DAY1,
    );
    expect(richer.ok).toBe(true);
    if (richer.ok) {
      expect(richer.written).toBe(true);
      expect(richer.snapshot.combined24hUsd).toBeCloseTo(130_800_000);
    }
    expect(await store.load()).toHaveLength(1);

    const refused = await recordDeskVolumeFromChain(store, chain({}), "2026-09-15T20:00:00.000Z", DAY1);
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
      DAY1,
    );
    const again = await recordDeskVolumeFromChain(
      store,
      chain({ volume24hUsd: 10 }),
      "2026-09-15T12:00:00.000Z",
      DAY1,
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
    ]);
    expect(snapshots.map((row) => row.combined24hUsd)).toEqual([
      173522731.07,
      121018931.03999996,
      115145253.47000003,
      56268835.52999999,
      76080265.64999995,
    ]);
    const sep23 = snapshots[0];
    expect(sep23?.publicEquity24hUsd).toBeNull();
    expect(sep23?.private24hUsd).toBeNull();
    expect(sep23?.etfIndex24hUsd).toBeNull();
  });

  it("plots and labels every snapshot day on 7D, 14D, and 30D, including Sep 26", () => {
    const history = buildSnapshotEquityVolumeHistory({
      snapshots,
      liveCombined24hUsd: 97_900_000,
      nowT: Date.parse("2026-09-28T16:00:00.000Z") / 1000,
      generatedAt: "2026-09-28T16:00:00.000Z",
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
        "Sep 28",
      ]);
      const sep26 = visible.find((point) => new Date(point.t * 1000).toISOString().startsWith("2026-09-26"));
      expect(sep26?.volumeUsd).toBeCloseTo(56_268_835.53);
      const headline = deskRangeVolumeHeadline(visible, range);
      expect(headline.volumeUsd).toBeCloseTo(visible.reduce((sum, point) => sum + point.volumeUsd, 0));
      expect(headline.caption.startsWith(range === "7d" ? "7D" : range === "14d" ? "14D" : "30D")).toBe(true);
    }
    expect(history.points.filter((point) => point.t < Date.parse("2026-09-23T00:00:00.000Z") / 1000)).toEqual([]);
    expect(history.points.some((point) => point.volumeUsd === 0)).toBe(false);
  });
});

describe("FileDeskVolumeSnapshotStore", () => {
  it("round-trips records and fails closed on garbage", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sotb-vol-"));
    const store = new FileDeskVolumeSnapshotStore(dir);
    expect(await store.load()).toEqual([]);
    const row = deskVolumeSnapshotFromChain(chain({ volume24hUsd: 5 }), "2026-09-15T12:00:00.000Z", DAY1);
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
    const first = deskVolumeSnapshotFromChain(chain({ volume24hUsd: 5 }), "2026-09-15T12:00:00.000Z", DAY1);
    const second = deskVolumeSnapshotFromChain(chain({ volume24hUsd: 9 }), "2026-09-14T12:00:00.000Z", DAY0);
    await Promise.all([
      store.save(upsertDeskVolumeSnapshot([], first)),
      store.save(upsertDeskVolumeSnapshot([], second)),
    ]);
    const loaded = await store.load();
    expect(loaded.length).toBeGreaterThan(0);
    expect(loaded.every((row) => row.combined24hUsd !== null)).toBe(true);
  });
});
