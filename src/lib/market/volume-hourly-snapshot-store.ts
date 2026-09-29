import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DEFAULT_VOLUME_SNAPSHOT_DIR } from "./volume-snapshots";
import {
  parseDeskHourlyVolumeSnapshotRecords,
  serializeDeskHourlyVolumeSnapshots,
  SOLANA_HOURLY_VOLUME_SNAPSHOT_FILE,
  type DeskHourlyVolumeSnapshot,
  type DeskHourlyVolumeSnapshotStore,
} from "./volume-hourly-snapshots";

/** Compact hourly totals file. Missing or unreadable files fail closed to []. */
export class FileDeskHourlyVolumeSnapshotStore implements DeskHourlyVolumeSnapshotStore {
  private readonly filePath: string;

  constructor(dir = DEFAULT_VOLUME_SNAPSHOT_DIR) {
    this.filePath = join(dir, SOLANA_HOURLY_VOLUME_SNAPSHOT_FILE);
  }

  async load(): Promise<DeskHourlyVolumeSnapshot[]> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return parseDeskHourlyVolumeSnapshotRecords(JSON.parse(raw));
    } catch {
      return [];
    }
  }

  async save(records: readonly DeskHourlyVolumeSnapshot[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(tmp, serializeDeskHourlyVolumeSnapshots(records), "utf8");
    await rename(tmp, this.filePath);
  }
}
