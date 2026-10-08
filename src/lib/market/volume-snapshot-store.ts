import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  DEFAULT_VOLUME_SNAPSHOT_DIR,
  mergePreservedSnapshotFile,
  parseDeskVolumeSnapshotRecords,
  serializeDeskVolumeSnapshots,
  SOLANA_VOLUME_SNAPSHOT_FILE,
  type DeskVolumeSnapshot,
  type DeskVolumeSnapshotStore,
} from "./volume-snapshots";

/** File-backed store. Missing or unreadable files fail closed to []. */
export class FileDeskVolumeSnapshotStore implements DeskVolumeSnapshotStore {
  private readonly filePath: string;

  constructor(dir = DEFAULT_VOLUME_SNAPSHOT_DIR) {
    this.filePath = join(dir, SOLANA_VOLUME_SNAPSHOT_FILE);
  }

  async load(): Promise<DeskVolumeSnapshot[]> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return parseDeskVolumeSnapshotRecords(JSON.parse(raw));
    } catch {
      return [];
    }
  }

  async save(records: readonly DeskVolumeSnapshot[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    let previous: string | null = null;
    try {
      previous = await readFile(this.filePath, "utf8");
    } catch {
      previous = null;
    }
    const body = mergePreservedSnapshotFile(serializeDeskVolumeSnapshots(records), previous);
    const tmp = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(tmp, body, "utf8");
    await rename(tmp, this.filePath);
  }
}
