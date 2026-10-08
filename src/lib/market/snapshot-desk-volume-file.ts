import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { readSnapshotBackfill, withDerivedSnapshotDays } from "./asset-backfill-desk-file";
import { BASE_DESK } from "./base-desk-volume";
import { BNB_DESK } from "./bnb-desk-volume";
import {
  closedSnapshotDeskDays,
  parseSnapshotDeskDays,
  type SnapshotDeskConfig,
  type SnapshotDeskDay,
} from "./snapshot-desk-volume";
import { DEFAULT_VOLUME_SNAPSHOT_DIR } from "./volume-snapshots";

const DESKS = [BASE_DESK, BNB_DESK];

export function findSnapshotDesk(chainId: string): SnapshotDeskConfig | null {
  return DESKS.find((desk) => desk.chainId === chainId) ?? null;
}

/** Missing or unreadable snapshot file is an empty series, not a thrown desk. */
export async function loadSnapshotDeskDays(
  config: SnapshotDeskConfig,
  dir = DEFAULT_VOLUME_SNAPSHOT_DIR,
): Promise<SnapshotDeskDay[]> {
  let snapshot: unknown = null;
  let days: SnapshotDeskDay[] = [];
  try {
    const raw = await readFile(join(dir, config.file), "utf8");
    snapshot = JSON.parse(raw) as unknown;
    days = parseSnapshotDeskDays(snapshot, config);
  } catch {
    days = [];
  }
  const { backfill } = await readSnapshotBackfill(config.file, dir);
  if (!backfill) return days;
  return withDerivedSnapshotDays(days, snapshot, backfill);
}

/** Closed Eastern days as of the server clock. Today and later stay off the series. */
export async function loadClosedSnapshotDeskDays(
  config: SnapshotDeskConfig,
  dir = DEFAULT_VOLUME_SNAPSHOT_DIR,
  nowT = Date.now() / 1000,
): Promise<SnapshotDeskDay[]> {
  return closedSnapshotDeskDays(await loadSnapshotDeskDays(config, dir), nowT);
}
