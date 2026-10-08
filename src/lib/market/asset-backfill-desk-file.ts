import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  derivedDeskLaneDays,
  laneLookupFromSnapshot,
  volumePointsWithDerivedDays,
  type DeskLaneDay,
} from "./asset-backfill-desk";
import type { RobinhoodDeskDay } from "./robinhood-desk-volume";
import type { SnapshotDeskDay } from "./snapshot-desk-volume";
import type { EquityVolumeHistoryResult } from "./types";
import { DEFAULT_VOLUME_SNAPSHOT_DIR, SOLANA_VOLUME_SNAPSHOT_FILE, utcDayKey, utcInstantForDayKey } from "./volume-snapshots";

function backfillName(snapshotFile: string): string {
  return snapshotFile.replace(/\.json$/, "-asset-daily.json");
}

async function readJson(dir: string, file: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(join(dir, file), "utf8")) as unknown;
  } catch {
    return null;
  }
}

/** Nightly dates stay as recorded. Missing Eastern days are summed from the sibling asset file. */
export function withDerivedSnapshotDays(
  nightly: readonly SnapshotDeskDay[],
  snapshot: unknown,
  backfill: unknown,
): SnapshotDeskDay[] {
  const derived = derivedDeskLaneDays(
    new Set(nightly.map((day) => day.date)),
    backfill,
    laneLookupFromSnapshot(snapshot),
  );
  return [...nightly, ...derived.map(toSnapshotDay)].sort((a, b) => a.t - b.t);
}

export function withDerivedRobinhoodDays(
  nightly: readonly RobinhoodDeskDay[],
  snapshot: unknown,
  backfill: unknown,
): RobinhoodDeskDay[] {
  const derived = derivedDeskLaneDays(
    new Set(nightly.map((day) => day.date)),
    backfill,
    laneLookupFromSnapshot(snapshot),
  );
  return [...nightly, ...derived.map(toRobinhoodDay)].sort((a, b) => a.t - b.t);
}

export async function readSnapshotBackfill(
  snapshotFile: string,
  dir = DEFAULT_VOLUME_SNAPSHOT_DIR,
): Promise<{ snapshot: unknown | null; backfill: unknown | null }> {
  const [snapshot, backfill] = await Promise.all([
    readJson(dir, snapshotFile),
    readJson(dir, backfillName(snapshotFile)),
  ]);
  return { snapshot, backfill };
}

/**
 * Adds Solana days that exist only in `solana-asset-daily.json`.
 * A nightly point for that Eastern date is kept.
 */
export async function overlayHistoryWithSolanaAssetBackfill(
  history: EquityVolumeHistoryResult,
  dir = DEFAULT_VOLUME_SNAPSHOT_DIR,
): Promise<EquityVolumeHistoryResult> {
  const { snapshot, backfill } = await readSnapshotBackfill(SOLANA_VOLUME_SNAPSHOT_FILE, dir);
  const nightlyDates = new Set(solanaLaneDays(snapshot).map((day) => day.date));
  for (const point of history.points) {
    const key = utcDayKey(point.t);
    if (key) nightlyDates.add(key);
  }
  const derived = derivedDeskLaneDays(nightlyDates, backfill, laneLookupFromSnapshot(snapshot));
  return {
    ...history,
    points: volumePointsWithDerivedDays(history.points, derived),
  };
}

export async function loadSolanaDeskLaneDays(dir = DEFAULT_VOLUME_SNAPSHOT_DIR): Promise<DeskLaneDay[]> {
  const { snapshot, backfill } = await readSnapshotBackfill(SOLANA_VOLUME_SNAPSHOT_FILE, dir);
  const nightly = solanaLaneDays(snapshot);
  const derived = derivedDeskLaneDays(
    new Set(nightly.map((day) => day.date)),
    backfill,
    laneLookupFromSnapshot(snapshot),
  );
  return [...nightly, ...derived].sort((a, b) => a.t - b.t);
}

function solanaLaneDays(snapshot: unknown): DeskLaneDay[] {
  const records = snapshot && typeof snapshot === "object" ? (snapshot as { records?: unknown }).records : null;
  if (!Array.isArray(records)) return [];
  const days: DeskLaneDay[] = [];
  for (const row of records) {
    if (!row || typeof row !== "object") continue;
    const rec = row as {
      date?: unknown;
      publicEquity24hUsd?: unknown;
      private24hUsd?: unknown;
      etfIndex24hUsd?: unknown;
      combined24hUsd?: unknown;
    };
    const date = typeof rec.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rec.date) ? rec.date : "";
    const t = utcInstantForDayKey(date);
    const combined = finiteOrNull(rec.combined24hUsd);
    if (!date || t <= 0 || combined === null) continue;
    days.push({
      date,
      t,
      publicEquity24hUsd: finiteOrNull(rec.publicEquity24hUsd),
      private24hUsd: finiteOrNull(rec.private24hUsd),
      etfIndex24hUsd: finiteOrNull(rec.etfIndex24hUsd),
      combined24hUsd: combined,
    });
  }
  return days;
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function toSnapshotDay(day: DeskLaneDay): SnapshotDeskDay {
  return {
    date: day.date,
    t: day.t,
    publicEquity24hUsd: day.publicEquity24hUsd,
    private24hUsd: day.private24hUsd,
    etfIndex24hUsd: day.etfIndex24hUsd,
    combined24hUsd: day.combined24hUsd,
    displayedLiquidityUsd: null,
    equity: [],
    etf: [],
    private: [],
    source: "asset-backfill",
  };
}

function toRobinhoodDay(day: DeskLaneDay): RobinhoodDeskDay {
  return {
    date: day.date,
    t: day.t,
    publicEquity24hUsd: day.publicEquity24hUsd,
    private24hUsd: day.private24hUsd,
    etfIndex24hUsd: day.etfIndex24hUsd,
    combined24hUsd: day.combined24hUsd,
    displayedLiquidityUsd: null,
    equity: [],
    etf: [],
    private: [],
    source: "asset-backfill",
  };
}
