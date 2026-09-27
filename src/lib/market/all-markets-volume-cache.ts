import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { allMarketsLiveSetIsPartial, allMarketsPoolSetCompatible, reportedVolumeUsd } from "./asset-volume-headline";
import type { VolumeHistoryPoint } from "./types";

export const DEFAULT_ALL_MARKETS_VOLUME_DIR = "data/cache/all-markets-volume";

/** How long a complete all-markets daily series may be reused. */
export const ALL_MARKETS_VOLUME_TTL_MS = 30 * 60_000;

/** Hourly fill progress. Daily progress stays on `.progress.json`. */
export const ALL_MARKETS_HOURLY_PROGRESS_SUFFIX = ".hourly.progress.json";

export interface AllMarketsStoredPool {
  pairAddress: string;
  points: VolumeHistoryPoint[];
}

interface StoredAllMarketsVolume {
  mint: string;
  pairAddresses: string[];
  fetchedAt: number;
  daily: VolumeHistoryPoint[];
  /** Absent until the hourly fill completes. Empty means a completed series with no candles. */
  hourly?: VolumeHistoryPoint[];
  /** Per-pool daily candles so a later wobble can reassemble instead of restarting. */
  dailyPools?: AllMarketsStoredPool[];
  hourlyPools?: AllMarketsStoredPool[];
}

export interface StoredAllMarketsSeries {
  daily: VolumeHistoryPoint[];
  hourly: VolumeHistoryPoint[] | null;
  pairAddresses: string[];
  /** Null when this file was written before per-pool candles were stored. */
  dailyPools: AllMarketsStoredPool[] | null;
  hourlyPools: AllMarketsStoredPool[] | null;
}

export function allMarketsPairKey(pairAddresses: readonly string[]): string {
  return [...pairAddresses]
    .map((address) => address.trim())
    .filter((address) => address.length > 0)
    .sort()
    .join("|");
}

function mintCachePath(directory: string, mint: string, suffix: string): string | null {
  const trimmed = mint.trim();
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,48}$/.test(trimmed)) return null;
  return join(directory, `${trimmed}${suffix}`);
}

function cacheFilePath(directory: string, mint: string): string | null {
  return mintCachePath(directory, mint, ".json");
}

/** One read-modify-write at a time per cache file so a daily rewrite cannot drop hourly. */
const cacheWriteTail = new Map<string, Promise<void>>();

function enqueueCacheWrite(path: string, write: () => Promise<boolean>): Promise<boolean> {
  const previous = cacheWriteTail.get(path) ?? Promise.resolve();
  const run = previous.then(write, write);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  cacheWriteTail.set(path, tail);
  void tail.finally(() => {
    if (cacheWriteTail.get(path) === tail) cacheWriteTail.delete(path);
  });
  return run;
}

function progressFilePath(directory: string, mint: string, suffix = ".progress.json"): string | null {
  return mintCachePath(directory, mint, suffix);
}

function parseVolumePoints(raw: unknown): VolumeHistoryPoint[] {
  if (!Array.isArray(raw)) return [];
  const points: VolumeHistoryPoint[] = [];
  for (const point of raw) {
    if (!point || typeof point !== "object") continue;
    const t = (point as { t?: unknown }).t;
    const volumeUsd = reportedVolumeUsd((point as { volumeUsd?: unknown }).volumeUsd as number | null);
    if (typeof t !== "number" || !Number.isFinite(t) || t <= 0 || volumeUsd === null) continue;
    points.push({ t: Math.trunc(t), volumeUsd });
  }
  points.sort((a, b) => a.t - b.t);
  return points;
}

function parseStoredPools(raw: unknown): AllMarketsStoredPool[] | null {
  if (!Array.isArray(raw)) return null;
  const pools: AllMarketsStoredPool[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const pairAddress = (row as { pairAddress?: unknown }).pairAddress;
    if (typeof pairAddress !== "string" || pairAddress.trim().length === 0) continue;
    pools.push({ pairAddress: pairAddress.trim(), points: parseVolumePoints((row as { points?: unknown }).points) });
  }
  return pools;
}

function parseStored(
  payload: unknown,
  mint: string,
  liveAddresses: readonly string[],
  nowMs: number,
  ttlMs: number,
): StoredAllMarketsSeries | null {
  if (!payload || typeof payload !== "object") return null;
  const row = payload as Partial<StoredAllMarketsVolume>;
  if (row.mint !== mint) return null;
  if (!Array.isArray(row.pairAddresses)) return null;
  if (
    !allMarketsPoolSetCompatible(row.pairAddresses, liveAddresses) &&
    !allMarketsLiveSetIsPartial(row.pairAddresses, liveAddresses)
  ) {
    return null;
  }
  if (typeof row.fetchedAt !== "number" || !Number.isFinite(row.fetchedAt)) return null;
  if (ttlMs >= 0 && nowMs - row.fetchedAt > ttlMs) return null;
  if (!Array.isArray(row.daily)) return null;
  return {
    daily: parseVolumePoints(row.daily),
    hourly: Array.isArray(row.hourly) ? parseVolumePoints(row.hourly) : null,
    pairAddresses: row.pairAddresses.map((address) => address.trim()).filter((address) => address.length > 0),
    dailyPools: parseStoredPools(row.dailyPools),
    hourlyPools: parseStoredPools(row.hourlyPools),
  };
}

async function readStoredFile(input: {
  directory: string | null;
  mint: string;
  pairAddresses: readonly string[];
  nowMs?: number;
  ttlMs?: number;
}): Promise<StoredAllMarketsSeries | null> {
  if (!input.directory) return null;
  const path = cacheFilePath(input.directory, input.mint);
  if (!path) return null;
  try {
    const raw = await readFile(path, "utf8");
    return parseStored(
      JSON.parse(raw) as unknown,
      input.mint.trim(),
      input.pairAddresses,
      input.nowMs ?? Date.now(),
      input.ttlMs ?? ALL_MARKETS_VOLUME_TTL_MS,
    );
  } catch {
    return null;
  }
}

/**
 * Fresh complete daily series for this mint.
 * A small pool-list wobble still matches. A much smaller live list still returns the saved series.
 * Missing, stale, or a disjoint pool set is null.
 */
export async function readCompleteAllMarketsDaily(input: {
  directory: string | null;
  mint: string;
  pairAddresses: readonly string[];
  nowMs?: number;
  ttlMs?: number;
}): Promise<VolumeHistoryPoint[] | null> {
  const stored = await readStoredFile(input);
  return stored ? stored.daily : null;
}

/**
 * Fresh daily series plus hourly when that fill has finished.
 * `hourly` is null until the hourly series is stored.
 * A small pool-list wobble still matches. A much smaller live list still returns the saved series.
 * Missing, stale, or a disjoint pool set is null.
 */
export async function readStoredAllMarketsVolume(input: {
  directory: string | null;
  mint: string;
  pairAddresses: readonly string[];
  nowMs?: number;
  ttlMs?: number;
}): Promise<StoredAllMarketsSeries | null> {
  return readStoredFile(input);
}

/** Persist a complete series. False means the file was not replaced. */
export async function writeCompleteAllMarketsDaily(input: {
  directory: string | null;
  mint: string;
  pairAddresses: readonly string[];
  daily: readonly VolumeHistoryPoint[];
  fetchedAt?: number;
  /** Per-pool candles. Omit for a legacy sum that cannot be reassembled. */
  dailyPools?: readonly AllMarketsStoredPool[];
}): Promise<boolean> {
  if (!input.directory) return false;
  const mint = input.mint.trim();
  const path = cacheFilePath(input.directory, mint);
  if (!path) return false;
  return enqueueCacheWrite(path, () => writeCompleteAllMarketsDailyBody({ ...input, mint, path }));
}

async function writeCompleteAllMarketsDailyBody(input: {
  mint: string;
  path: string;
  pairAddresses: readonly string[];
  daily: readonly VolumeHistoryPoint[];
  fetchedAt?: number;
  dailyPools?: readonly AllMarketsStoredPool[];
}): Promise<boolean> {
  const { mint, path } = input;
  let preservedHourly: VolumeHistoryPoint[] | undefined;
  let preservedHourlyPools: AllMarketsStoredPool[] | undefined;
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as Partial<StoredAllMarketsVolume>;
    if (
      parsed.mint === mint &&
      Array.isArray(parsed.pairAddresses) &&
      allMarketsPoolSetCompatible(parsed.pairAddresses, input.pairAddresses)
    ) {
      if (Array.isArray(parsed.hourly)) preservedHourly = parseVolumePoints(parsed.hourly);
      const hourlyPools = parseStoredPools(parsed.hourlyPools);
      if (hourlyPools) preservedHourlyPools = hourlyPools;
    }
  } catch {
    // First write for this mint.
  }
  const stored: StoredAllMarketsVolume = {
    mint,
    pairAddresses: input.pairAddresses.map((address) => address.trim()).filter((address) => address.length > 0).sort(),
    fetchedAt: input.fetchedAt ?? Date.now(),
    daily: input.daily.map((point) => ({ t: point.t, volumeUsd: point.volumeUsd })),
    ...(input.dailyPools
      ? {
          dailyPools: input.dailyPools.map((pool) => ({
            pairAddress: pool.pairAddress.trim(),
            points: pool.points.map((point) => ({ t: point.t, volumeUsd: point.volumeUsd })),
          })),
        }
      : {}),
    ...(preservedHourly ? { hourly: preservedHourly } : {}),
    ...(preservedHourlyPools ? { hourlyPools: preservedHourlyPools } : {}),
  };
  try {
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify(stored)}\n`, "utf8");
    await rename(tmp, path);
    return true;
  } catch {
    // A cache miss retries later. The page does not wait on this file.
    return false;
  }
}

/**
 * Add a finished hourly series onto the daily cache file.
 * False when the daily file is missing or the pool set does not match — hourly is not stored alone.
 */
export async function writeCompleteAllMarketsHourly(input: {
  directory: string | null;
  mint: string;
  pairAddresses: readonly string[];
  hourly: readonly VolumeHistoryPoint[];
  hourlyPools?: readonly AllMarketsStoredPool[];
}): Promise<boolean> {
  if (!input.directory) return false;
  const mint = input.mint.trim();
  const path = cacheFilePath(input.directory, mint);
  if (!path) return false;
  return enqueueCacheWrite(path, () => writeCompleteAllMarketsHourlyBody({ ...input, mint, path }));
}

async function writeCompleteAllMarketsHourlyBody(input: {
  mint: string;
  path: string;
  pairAddresses: readonly string[];
  hourly: readonly VolumeHistoryPoint[];
  hourlyPools?: readonly AllMarketsStoredPool[];
}): Promise<boolean> {
  const { mint, path } = input;
  let existing: StoredAllMarketsVolume;
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as Partial<StoredAllMarketsVolume>;
    if (parsed.mint !== mint || !Array.isArray(parsed.pairAddresses) || !Array.isArray(parsed.daily)) return false;
    if (!allMarketsPoolSetCompatible(parsed.pairAddresses, input.pairAddresses)) return false;
    if (typeof parsed.fetchedAt !== "number" || !Number.isFinite(parsed.fetchedAt)) return false;
    existing = {
      mint,
      pairAddresses: input.pairAddresses.map((address) => address.trim()).filter((address) => address.length > 0).sort(),
      fetchedAt: parsed.fetchedAt,
      daily: parsed.daily,
      ...(Array.isArray(parsed.dailyPools) ? { dailyPools: parseStoredPools(parsed.dailyPools) ?? [] } : {}),
    };
  } catch {
    return false;
  }
  const stored: StoredAllMarketsVolume = {
    ...existing,
    hourly: input.hourly.map((point) => ({ t: point.t, volumeUsd: point.volumeUsd })),
    ...(input.hourlyPools
      ? {
          hourlyPools: input.hourlyPools.map((pool) => ({
            pairAddress: pool.pairAddress.trim(),
            points: pool.points.map((point) => ({ t: point.t, volumeUsd: point.volumeUsd })),
          })),
        }
      : {}),
  };
  try {
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify(stored)}\n`, "utf8");
    await rename(tmp, path);
    return true;
  } catch {
    return false;
  }
}

export interface AllMarketsProgressPool {
  pairAddress: string;
  status: "points" | "definitive_miss";
  points: VolumeHistoryPoint[];
}

export interface AllMarketsProgressRecord {
  pairAddresses: string[];
  pools: AllMarketsProgressPool[];
}

interface StoredAllMarketsProgress {
  mint: string;
  pairAddresses: string[];
  fetchedAt: number;
  pools: AllMarketsProgressPool[];
}

function parseProgress(
  payload: unknown,
  mint: string,
  nowMs: number,
  ttlMs: number,
): AllMarketsProgressRecord | null {
  if (!payload || typeof payload !== "object") return null;
  const row = payload as Partial<StoredAllMarketsProgress>;
  if (row.mint !== mint) return null;
  if (!Array.isArray(row.pairAddresses)) return null;
  if (typeof row.fetchedAt !== "number" || !Number.isFinite(row.fetchedAt)) return null;
  if (ttlMs >= 0 && nowMs - row.fetchedAt > ttlMs) return null;
  if (!Array.isArray(row.pools)) return null;
  const pools: AllMarketsProgressPool[] = [];
  for (const pool of row.pools) {
    if (!pool || typeof pool !== "object") continue;
    const pairAddress = (pool as { pairAddress?: unknown }).pairAddress;
    const status = (pool as { status?: unknown }).status;
    if (typeof pairAddress !== "string" || pairAddress.trim().length === 0) continue;
    if (status !== "points" && status !== "definitive_miss") continue;
    const points: VolumeHistoryPoint[] = [];
    const rawPoints = (pool as { points?: unknown }).points;
    if (Array.isArray(rawPoints)) {
      for (const point of rawPoints) {
        if (!point || typeof point !== "object") continue;
        const t = (point as { t?: unknown }).t;
        const volumeUsd = reportedVolumeUsd((point as { volumeUsd?: unknown }).volumeUsd as number | null);
        if (typeof t !== "number" || !Number.isFinite(t) || t <= 0 || volumeUsd === null) continue;
        points.push({ t: Math.trunc(t), volumeUsd });
      }
    }
    points.sort((a, b) => a.t - b.t);
    pools.push({ pairAddress: pairAddress.trim(), status, points });
  }
  return {
    pairAddresses: row.pairAddresses.map((address) => address.trim()).filter((address) => address.length > 0),
    pools,
  };
}

/**
 * Resolved pools from an in-progress fill. Stale files are null.
 * The saved pair list does not have to equal the live list — callers keep the overlapping pools
 * so one DexScreener membership change does not throw the fill away.
 */
export async function readAllMarketsProgress(input: {
  directory: string | null;
  mint: string;
  pairAddresses: readonly string[];
  nowMs?: number;
  ttlMs?: number;
  /** Defaults to the daily progress file. */
  suffix?: string;
}): Promise<AllMarketsProgressRecord | null> {
  if (!input.directory) return null;
  const path = progressFilePath(input.directory, input.mint, input.suffix);
  if (!path) return null;
  try {
    const raw = await readFile(path, "utf8");
    return parseProgress(
      JSON.parse(raw) as unknown,
      input.mint.trim(),
      input.nowMs ?? Date.now(),
      input.ttlMs ?? ALL_MARKETS_VOLUME_TTL_MS,
    );
  } catch {
    return null;
  }
}

/** Replace the progress file. `fetchedAt` slides forward so a live fill does not expire mid-way. */
export async function writeAllMarketsProgress(input: {
  directory: string | null;
  mint: string;
  pairAddresses: readonly string[];
  pools: readonly AllMarketsProgressPool[];
  fetchedAt?: number;
  /** Defaults to the daily progress file. */
  suffix?: string;
}): Promise<boolean> {
  if (!input.directory) return false;
  const mint = input.mint.trim();
  const path = progressFilePath(input.directory, mint, input.suffix);
  if (!path) return false;
  const stored: StoredAllMarketsProgress = {
    mint,
    pairAddresses: input.pairAddresses.map((address) => address.trim()).filter((address) => address.length > 0).sort(),
    fetchedAt: input.fetchedAt ?? Date.now(),
    pools: input.pools.map((pool) => ({
      pairAddress: pool.pairAddress.trim(),
      status: pool.status,
      points: pool.points.map((point) => ({ t: point.t, volumeUsd: point.volumeUsd })),
    })),
  };
  try {
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify(stored)}\n`, "utf8");
    await rename(tmp, path);
    return true;
  } catch {
    return false;
  }
}

export async function deleteAllMarketsProgress(input: {
  directory: string | null;
  mint: string;
  /** Defaults to the daily progress file. */
  suffix?: string;
}): Promise<void> {
  if (!input.directory) return;
  const path = progressFilePath(input.directory, input.mint, input.suffix);
  if (!path) return;
  try {
    await unlink(path);
  } catch {
    // Already gone. The complete file is the source of truth after that.
  }
}
