import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  buildLendingDeskModel,
  lendingSnapshotFileName,
  parseLendingSnapshot,
  serializeLendingSnapshot,
  type LendingDaySnapshot,
  type LendingDeskModel,
} from "./lending-snapshot";

export const DEFAULT_LENDING_SNAPSHOT_DIR = join(process.cwd(), "data", "lending-snapshots");

export function lendingSnapshotPath(date: string, dir = DEFAULT_LENDING_SNAPSHOT_DIR): string {
  return join(dir, lendingSnapshotFileName(date));
}

export async function saveLendingDay(day: LendingDaySnapshot, dir = DEFAULT_LENDING_SNAPSHOT_DIR): Promise<string> {
  const path = lendingSnapshotPath(day.date, dir);
  await mkdir(dir, { recursive: true });
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, serializeLendingSnapshot(day), "utf8");
  await rename(tmp, path);
  return path;
}

async function readLendingDay(dir: string, date: string): Promise<{ day: LendingDaySnapshot | null; readError?: string }> {
  try {
    const raw = await readFile(join(dir, `${date}.json`), "utf8");
    const day = parseLendingSnapshot(JSON.parse(raw));
    if (!day) return { day: null, readError: `${date}.json is not an equity lending snapshot.` };
    return { day };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unreadable lending snapshot";
    return { day: null, readError: message };
  }
}

export async function loadLendingDays(dir = DEFAULT_LENDING_SNAPSHOT_DIR): Promise<{
  days: LendingDaySnapshot[];
  readError?: string;
}> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code === "ENOENT") return { days: [] };
    const message = error instanceof Error ? error.message : "unreadable lending snapshot directory";
    return { days: [], readError: message };
  }
  const dates = names
    .map((name) => /^(\d{4}-\d{2}-\d{2})\.json$/.exec(name)?.[1])
    .filter((date): date is string => Boolean(date))
    .sort();
  const days: LendingDaySnapshot[] = [];
  let readError: string | undefined;
  for (const date of dates) {
    const loaded = await readLendingDay(dir, date);
    if (loaded.day) days.push(loaded.day);
    else if (date === dates.at(-1)) readError = loaded.readError;
  }
  return { days, readError };
}

export async function loadLatestLendingSnapshot(dir = DEFAULT_LENDING_SNAPSHOT_DIR): Promise<{
  day: LendingDaySnapshot | null;
  readError?: string;
}> {
  const loaded = await loadLendingDays(dir);
  return { day: loaded.days.at(-1) ?? null, readError: loaded.readError };
}

export async function loadLendingDeskModel(dir = DEFAULT_LENDING_SNAPSHOT_DIR): Promise<LendingDeskModel> {
  const loaded = await loadLendingDays(dir);
  return buildLendingDeskModel(loaded.days.at(-1) ?? null, loaded.readError, loaded.days);
}
