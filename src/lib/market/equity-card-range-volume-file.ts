import { stat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { BASE_DESK } from "./base-desk-volume";
import { BNB_DESK } from "./bnb-desk-volume";
import {
  equityCardRangeVolumesFromSnapshot,
  type EquityCardRangeVolumeMap,
} from "./equity-card-range-volume";
import { ROBINHOOD_VOLUME_SNAPSHOT_FILE } from "./robinhood-desk-volume";
import { BASE_CHAIN_ID, BNB_CHAIN_ID, ROBINHOOD_CHAIN_ID, SOLANA_CHAIN_ID } from "./types";
import { DEFAULT_VOLUME_SNAPSHOT_DIR, SOLANA_VOLUME_SNAPSHOT_FILE, easternDayKey } from "./volume-snapshots";

const SNAPSHOT_FILE_BY_CHAIN: Record<string, string> = {
  [SOLANA_CHAIN_ID]: SOLANA_VOLUME_SNAPSHOT_FILE,
  [ROBINHOOD_CHAIN_ID]: ROBINHOOD_VOLUME_SNAPSHOT_FILE,
  [BASE_CHAIN_ID]: BASE_DESK.file,
  [BNB_CHAIN_ID]: BNB_DESK.file,
};

interface RangeVolumeCacheEntry {
  mtimeMs: number;
  dayKey: string;
  volumes: EquityCardRangeVolumeMap;
}

const cache = new Map<string, RangeVolumeCacheEntry>();

/** Test hook. The desk cache is process-local and keyed by file mtime plus Eastern day. */
export function resetEquityCardRangeVolumeCache(): void {
  cache.clear();
}

export function equityCardSnapshotFile(chainId: string): string | null {
  return SNAPSHOT_FILE_BY_CHAIN[chainId] ?? null;
}

/**
 * Precomputed 7D / 14D / 30D card totals for one chain.
 * Reads the local snapshot file only. A missing file or a chain with no
 * per-asset rows is an empty map, not a network fetch and not a thrown desk.
 * Repeat calls on the same Eastern day reuse the parsed map.
 */
export async function loadEquityCardRangeVolumes(
  chainId: string,
  nowT = Date.now() / 1000,
  dir = DEFAULT_VOLUME_SNAPSHOT_DIR,
): Promise<EquityCardRangeVolumeMap> {
  const file = equityCardSnapshotFile(chainId);
  if (!file) return {};
  const path = join(dir, file);
  let mtimeMs: number;
  try {
    mtimeMs = (await stat(path)).mtimeMs;
  } catch {
    return {};
  }
  const dayKey = easternDayKey(nowT);
  if (!dayKey) return {};
  const hit = cache.get(path);
  if (hit && hit.mtimeMs === mtimeMs && hit.dayKey === dayKey) return hit.volumes;
  let payload: unknown;
  try {
    payload = JSON.parse(await readFile(path, "utf8"));
  } catch {
    return {};
  }
  const volumes = equityCardRangeVolumesFromSnapshot(payload, nowT);
  cache.set(path, { mtimeMs, dayKey, volumes });
  return volumes;
}
