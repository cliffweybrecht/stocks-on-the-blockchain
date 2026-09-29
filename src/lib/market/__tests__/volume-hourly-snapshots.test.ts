import { readFileSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileDeskHourlyVolumeSnapshotStore } from "../volume-hourly-snapshot-store";
import {
  deskHourlyVolumeSnapshotFromDetail,
  easternHourStamp,
  parseDeskHourlyVolumeSnapshotRecords,
  recordDeskHourlyVolumeFromDetail,
  serializeDeskHourlyVolumeSnapshots,
  upsertDeskHourlyVolumeSnapshot,
  MemoryDeskHourlyVolumeSnapshotStore,
  type DeskHourlyVolumeDetail,
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

  it("parses the committed envelope as an empty series", () => {
    const raw = JSON.parse(readFileSync(join(process.cwd(), "data/volume-snapshots/solana-hourly.json"), "utf8"));
    expect(raw.hourKey).toBe("America/New_York");
    expect(raw.kind).toBe("rolling_h24_totals");
    expect(parseDeskHourlyVolumeSnapshotRecords(raw)).toEqual([]);
    expect(serializeDeskHourlyVolumeSnapshots([])).toBe(
      readFileSync(join(process.cwd(), "data/volume-snapshots/solana-hourly.json"), "utf8"),
    );
  });
});
