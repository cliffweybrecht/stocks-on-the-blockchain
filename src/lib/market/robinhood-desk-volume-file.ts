import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { readSnapshotBackfill, withDerivedRobinhoodDays } from "./asset-backfill-desk-file";
import { DEFAULT_VOLUME_SNAPSHOT_DIR } from "./volume-snapshots";
import {
  ROBINHOOD_VOLUME_SNAPSHOT_FILE,
  closedRobinhoodDeskDays,
  parseRobinhoodDeskDays,
  type RobinhoodDeskDay,
} from "./robinhood-desk-volume";

/** Missing or unreadable `robinhood.json` is an empty series, not a thrown desk. */
export async function loadRobinhoodDeskDays(
  dir = DEFAULT_VOLUME_SNAPSHOT_DIR,
): Promise<RobinhoodDeskDay[]> {
  let snapshot: unknown = null;
  let days: RobinhoodDeskDay[] = [];
  try {
    const raw = await readFile(join(dir, ROBINHOOD_VOLUME_SNAPSHOT_FILE), "utf8");
    snapshot = JSON.parse(raw) as unknown;
    days = parseRobinhoodDeskDays(snapshot);
  } catch {
    days = [];
  }
  const { backfill } = await readSnapshotBackfill(ROBINHOOD_VOLUME_SNAPSHOT_FILE, dir);
  if (!backfill) return days;
  return withDerivedRobinhoodDays(days, snapshot, backfill);
}

/** Closed Eastern days as of the server clock. Today and later stay off the series. */
export async function loadClosedRobinhoodDeskDays(
  dir = DEFAULT_VOLUME_SNAPSHOT_DIR,
  nowT = Date.now() / 1000,
): Promise<RobinhoodDeskDay[]> {
  return closedRobinhoodDeskDays(await loadRobinhoodDeskDays(dir), nowT);
}
