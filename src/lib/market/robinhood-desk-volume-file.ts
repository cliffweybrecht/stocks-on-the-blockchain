import { readFile } from "node:fs/promises";
import { join } from "node:path";
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
  try {
    const raw = await readFile(join(dir, ROBINHOOD_VOLUME_SNAPSHOT_FILE), "utf8");
    return parseRobinhoodDeskDays(JSON.parse(raw));
  } catch {
    return [];
  }
}

/** Closed Eastern days as of the server clock. Today and later stay off the series. */
export async function loadClosedRobinhoodDeskDays(
  dir = DEFAULT_VOLUME_SNAPSHOT_DIR,
  nowT = Date.now() / 1000,
): Promise<RobinhoodDeskDay[]> {
  return closedRobinhoodDeskDays(await loadRobinhoodDeskDays(dir), nowT);
}
