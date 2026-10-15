import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isCompactDay, compactPerpsDay, type PerpsCompactDay } from "./perps-compact";
import {
  buildPerpsDeskModel,
  emptyPerpsSnapshotFile,
  mergePerpsDay,
  parsePerpsSnapshotFile,
  PERPS_SNAPSHOT_FILE,
  serializePerpsSnapshot,
  stampPerpsQuality,
  type PerpsDaySnapshot,
  type PerpsDeskModel,
  type PerpsSnapshotFile,
} from "./perps-snapshot";

/** Server-only file store. Kept out of the client desk bundle (no node:fs there). */
export const DEFAULT_PERPS_SNAPSHOT_DIR = join(process.cwd(), "data", "perps-snapshots");

export function perpsSnapshotPath(dir = DEFAULT_PERPS_SNAPSHOT_DIR): string {
  return join(dir, PERPS_SNAPSHOT_FILE);
}

export async function loadPerpsSnapshotFile(dir = DEFAULT_PERPS_SNAPSHOT_DIR): Promise<PerpsSnapshotFile> {
  try {
    const raw = await readFile(perpsSnapshotPath(dir), "utf8");
    return parsePerpsSnapshotFile(JSON.parse(raw));
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code === "ENOENT") return emptyPerpsSnapshotFile();
    const message = error instanceof Error ? error.message : "unreadable equity-perp snapshot";
    return emptyPerpsSnapshotFile(message);
  }
}

export async function savePerpsDay(
  day: PerpsDaySnapshot,
  dir = DEFAULT_PERPS_SNAPSHOT_DIR,
): Promise<PerpsSnapshotFile> {
  const path = perpsSnapshotPath(dir);
  let existing = emptyPerpsSnapshotFile();
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { records?: unknown }).records)) {
      throw new Error(`${path} is not an equity-perp snapshot file.`);
    }
    existing = parsePerpsSnapshotFile(parsed);
    if (existing.readError) throw new Error(existing.readError);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code !== "ENOENT") throw error;
  }
  const prior = [...existing.records].reverse().find((row) => row.date < day.date) ?? null;
  const previous: PerpsCompactDay | null = prior ? (isCompactDay(prior) ? prior : compactPerpsDay(prior)) : null;
  const next = mergePerpsDay(existing, stampPerpsQuality(day, previous));
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, serializePerpsSnapshot(next), "utf8");
  await rename(tmp, path);
  return next;
}

export async function loadPerpsDeskModel(
  dir = DEFAULT_PERPS_SNAPSHOT_DIR,
  nowUnixSeconds = Date.now() / 1000,
): Promise<PerpsDeskModel> {
  const file = await loadPerpsSnapshotFile(dir);
  return buildPerpsDeskModel(file, nowUnixSeconds);
}
