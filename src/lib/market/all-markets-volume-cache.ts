import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { reportedVolumeUsd } from "./asset-volume-headline";
import type { VolumeHistoryPoint } from "./types";

export const DEFAULT_ALL_MARKETS_VOLUME_DIR = "data/cache/all-markets-volume";

/** How long a complete all-markets daily series may be reused. */
export const ALL_MARKETS_VOLUME_TTL_MS = 30 * 60_000;

interface StoredAllMarketsVolume {
  mint: string;
  pairAddresses: string[];
  fetchedAt: number;
  daily: VolumeHistoryPoint[];
}

export function allMarketsPairKey(pairAddresses: readonly string[]): string {
  return [...pairAddresses]
    .map((address) => address.trim())
    .filter((address) => address.length > 0)
    .sort()
    .join("|");
}

function cacheFilePath(directory: string, mint: string): string | null {
  const trimmed = mint.trim();
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,48}$/.test(trimmed)) return null;
  return join(directory, `${trimmed}.json`);
}

function parseStored(payload: unknown, mint: string, pairKey: string, nowMs: number, ttlMs: number): VolumeHistoryPoint[] | null {
  if (!payload || typeof payload !== "object") return null;
  const row = payload as Partial<StoredAllMarketsVolume>;
  if (row.mint !== mint) return null;
  if (!Array.isArray(row.pairAddresses)) return null;
  if (allMarketsPairKey(row.pairAddresses) !== pairKey) return null;
  if (typeof row.fetchedAt !== "number" || !Number.isFinite(row.fetchedAt)) return null;
  if (ttlMs >= 0 && nowMs - row.fetchedAt > ttlMs) return null;
  if (!Array.isArray(row.daily)) return null;
  const daily: VolumeHistoryPoint[] = [];
  for (const point of row.daily) {
    if (!point || typeof point !== "object") continue;
    const t = (point as { t?: unknown }).t;
    const volumeUsd = reportedVolumeUsd((point as { volumeUsd?: unknown }).volumeUsd as number | null);
    if (typeof t !== "number" || !Number.isFinite(t) || t <= 0 || volumeUsd === null) continue;
    daily.push({ t: Math.trunc(t), volumeUsd });
  }
  daily.sort((a, b) => a.t - b.t);
  return daily;
}

/** Fresh complete series for this mint and pool set. Missing, stale, or mismatched pools are null. */
export async function readCompleteAllMarketsDaily(input: {
  directory: string | null;
  mint: string;
  pairAddresses: readonly string[];
  nowMs?: number;
  ttlMs?: number;
}): Promise<VolumeHistoryPoint[] | null> {
  if (!input.directory) return null;
  const path = cacheFilePath(input.directory, input.mint);
  if (!path) return null;
  try {
    const raw = await readFile(path, "utf8");
    return parseStored(
      JSON.parse(raw) as unknown,
      input.mint.trim(),
      allMarketsPairKey(input.pairAddresses),
      input.nowMs ?? Date.now(),
      input.ttlMs ?? ALL_MARKETS_VOLUME_TTL_MS,
    );
  } catch {
    return null;
  }
}

/** Persist a complete series. Failures are ignored so the desk still renders. */
export async function writeCompleteAllMarketsDaily(input: {
  directory: string | null;
  mint: string;
  pairAddresses: readonly string[];
  daily: readonly VolumeHistoryPoint[];
  fetchedAt?: number;
}): Promise<void> {
  if (!input.directory) return;
  const mint = input.mint.trim();
  const path = cacheFilePath(input.directory, mint);
  if (!path) return;
  const stored: StoredAllMarketsVolume = {
    mint,
    pairAddresses: input.pairAddresses.map((address) => address.trim()).filter((address) => address.length > 0).sort(),
    fetchedAt: input.fetchedAt ?? Date.now(),
    daily: input.daily.map((point) => ({ t: point.t, volumeUsd: point.volumeUsd })),
  };
  try {
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify(stored)}\n`, "utf8");
    await rename(tmp, path);
  } catch {
    // A cache miss retries later. The page does not wait on this file.
  }
}
