import { stat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { BASE_DESK } from "./base-desk-volume";
import { BNB_DESK } from "./bnb-desk-volume";
import {
  equityCardLiquidityHistoryFromSnapshot,
  EMPTY_EQUITY_CARD_LIQUIDITY,
  type EquityCardLiquidityHistory,
} from "./equity-card-range-liquidity";
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
  backfillMtimeMs: number;
  dayKey: string;
  volumes: EquityCardRangeVolumeMap;
  liquidity: EquityCardLiquidityHistory;
}

export interface EquityCardRangeMetrics {
  volumes: EquityCardRangeVolumeMap;
  liquidity: EquityCardLiquidityHistory;
}

const EMPTY_RANGE_METRICS: EquityCardRangeMetrics = {
  volumes: {},
  liquidity: EMPTY_EQUITY_CARD_LIQUIDITY,
};

const cache = new Map<string, RangeVolumeCacheEntry>();

/** Test hook. The desk cache is process-local and keyed by file mtime plus Eastern day. */
export function resetEquityCardRangeVolumeCache(): void {
  cache.clear();
}

export function equityCardSnapshotFile(chainId: string): string | null {
  return SNAPSHOT_FILE_BY_CHAIN[chainId] ?? null;
}

/** Production snapshot paths. Literals so the server trace stays inside this directory. */
function defaultSnapshotPath(chainId: string): string | null {
  switch (chainId) {
    case SOLANA_CHAIN_ID:
      return join(process.cwd(), "data", "volume-snapshots", "solana.json");
    case ROBINHOOD_CHAIN_ID:
      return join(process.cwd(), "data", "volume-snapshots", "robinhood.json");
    case BASE_CHAIN_ID:
      return join(process.cwd(), "data", "volume-snapshots", "base.json");
    case BNB_CHAIN_ID:
      return join(process.cwd(), "data", "volume-snapshots", "bnb.json");
    default:
      return null;
  }
}

/** Sibling of the desk snapshot. Gecko hourly backfill only; DexScreener rows stay in the main file. */
function defaultBackfillPath(chainId: string): string | null {
  switch (chainId) {
    case SOLANA_CHAIN_ID:
      return join(process.cwd(), "data", "volume-snapshots", "solana-asset-daily.json");
    case ROBINHOOD_CHAIN_ID:
      return join(process.cwd(), "data", "volume-snapshots", "robinhood-asset-daily.json");
    case BASE_CHAIN_ID:
      return join(process.cwd(), "data", "volume-snapshots", "base-asset-daily.json");
    case BNB_CHAIN_ID:
      return join(process.cwd(), "data", "volume-snapshots", "bnb-asset-daily.json");
    default:
      return null;
  }
}

function backfillFileName(snapshotFile: string): string {
  return snapshotFile.replace(/\.json$/, "-asset-daily.json");
}

/**
 * Precomputed card ranges for one chain, from the local snapshot file.
 * Volume totals and closing-liquidity history are parsed together.
 * A sibling Gecko hourly backfill fills volume days only. It has no reserves.
 * A missing file is an empty contribution, not a network fetch and not a write.
 * Repeat calls on the same Eastern day reuse the parsed maps.
 */
export async function loadEquityCardRangeMetrics(
  chainId: string,
  nowT = Date.now() / 1000,
  dir = DEFAULT_VOLUME_SNAPSHOT_DIR,
): Promise<EquityCardRangeMetrics> {
  const file = equityCardSnapshotFile(chainId);
  if (!file) return cloneMetrics(EMPTY_RANGE_METRICS);
  const path =
    dir === DEFAULT_VOLUME_SNAPSHOT_DIR
      ? defaultSnapshotPath(chainId)
      : join(/*turbopackIgnore: true*/ dir, file);
  if (!path) return cloneMetrics(EMPTY_RANGE_METRICS);
  const backfillPath =
    dir === DEFAULT_VOLUME_SNAPSHOT_DIR
      ? defaultBackfillPath(chainId)
      : join(/*turbopackIgnore: true*/ dir, backfillFileName(file));
  let mtimeMs: number;
  try {
    mtimeMs = (await stat(path)).mtimeMs;
  } catch {
    return cloneMetrics(EMPTY_RANGE_METRICS);
  }
  let backfillMtimeMs = 0;
  let backfill: unknown = null;
  if (backfillPath) {
    try {
      backfillMtimeMs = (await stat(backfillPath)).mtimeMs;
      backfill = JSON.parse(await readFile(backfillPath, "utf8"));
    } catch {
      backfill = null;
      backfillMtimeMs = 0;
    }
  }
  const dayKey = easternDayKey(nowT);
  if (!dayKey) return cloneMetrics(EMPTY_RANGE_METRICS);
  const hit = cache.get(path);
  if (hit && hit.mtimeMs === mtimeMs && hit.backfillMtimeMs === backfillMtimeMs && hit.dayKey === dayKey) {
    return cloneMetrics(hit);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(await readFile(path, "utf8"));
  } catch {
    return cloneMetrics(EMPTY_RANGE_METRICS);
  }
  const volumes = equityCardRangeVolumesFromSnapshot(payload, nowT, backfill);
  const liquidity = equityCardLiquidityHistoryFromSnapshot(payload, nowT, backfill);
  // Hand out a copy. The cached maps must stay intact if a later render mutates props.
  const stored = cloneMetrics({ volumes, liquidity });
  cache.set(path, { mtimeMs, backfillMtimeMs, dayKey, volumes: stored.volumes, liquidity: stored.liquidity });
  return cloneMetrics(stored);
}

export async function loadEquityCardRangeVolumes(
  chainId: string,
  nowT = Date.now() / 1000,
  dir = DEFAULT_VOLUME_SNAPSHOT_DIR,
): Promise<EquityCardRangeVolumeMap> {
  return (await loadEquityCardRangeMetrics(chainId, nowT, dir)).volumes;
}

function cloneMetrics(metrics: EquityCardRangeMetrics): EquityCardRangeMetrics {
  return {
    volumes: structuredClone(metrics.volumes),
    liquidity: structuredClone(metrics.liquidity),
  };
}
