import { stat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { BASE_DESK } from "./base-desk-volume";
import { BNB_DESK } from "./bnb-desk-volume";
import { bnbBackfillWithoutNightlyDates } from "./bnb-snapshot-cards";
import {
  equityCardLiquidityHistoryFromSnapshot,
  EMPTY_EQUITY_CARD_LIQUIDITY,
  type EquityCardLiquidityHistory,
} from "./equity-card-range-liquidity";
import {
  EMPTY_EQUITY_CARD_PRICE,
  equityCardPriceHistoryFromPayloads,
  type EquityCardPriceHistory,
} from "./equity-card-range-price";
import {
  EMPTY_EQUITY_CARD_VOLUME_SERIES,
  equityCardRangeVolumesFromSnapshot,
  equityCardVolumeHistoryFromSnapshot,
  type EquityCardRangeVolumeMap,
  type EquityCardVolumeHistory,
} from "./equity-card-range-volume";
import { holderSnapshotChainId, parseHolderSnapshotFile, type HolderSnapshotChainId, type HolderSnapshotFile } from "./holder-snapshots";
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
  holderMtimeMs: number;
  dayKey: string;
  volumes: EquityCardRangeVolumeMap;
  liquidity: EquityCardLiquidityHistory;
  volumeSeries: EquityCardVolumeHistory;
  prices: EquityCardPriceHistory;
}

export interface EquityCardRangeMetrics {
  volumes: EquityCardRangeVolumeMap;
  liquidity: EquityCardLiquidityHistory;
  /** Daily volume points behind the card sparkline. */
  volumeSeries: EquityCardVolumeHistory;
  /** Captured DEX closes behind the card price and range move. */
  prices: EquityCardPriceHistory;
}

const EMPTY_RANGE_METRICS: EquityCardRangeMetrics = {
  volumes: {},
  liquidity: EMPTY_EQUITY_CARD_LIQUIDITY,
  volumeSeries: EMPTY_EQUITY_CARD_VOLUME_SERIES,
  prices: EMPTY_EQUITY_CARD_PRICE,
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

/** Production holder paths. Literals so the server trace stays inside this directory. */
function defaultHolderPath(chainId: HolderSnapshotChainId): string {
  switch (chainId) {
    case "solana":
      return join(process.cwd(), "data", "holder-snapshots", "solana.json");
    case "base":
      return join(process.cwd(), "data", "holder-snapshots", "base.json");
    case "bnb":
      return join(process.cwd(), "data", "holder-snapshots", "bnb.json");
    case "robinhood":
      return join(process.cwd(), "data", "holder-snapshots", "robinhood.json");
  }
}

/**
 * Precomputed card ranges for one chain, from the local snapshot file.
 * Volume totals, daily volume points, and closing-liquidity history are parsed together.
 * Captured DEX closes come from the holder snapshot's `priceUsd` on those same days.
 * A sibling Gecko hourly backfill fills volume days only. It has no reserves and no prices.
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
  const holderChain = holderSnapshotChainId(chainId);
  const holderPath = holderChain && dir === DEFAULT_VOLUME_SNAPSHOT_DIR ? defaultHolderPath(holderChain) : null;
  let holderMtimeMs = 0;
  if (holderPath) {
    try {
      holderMtimeMs = (await stat(holderPath)).mtimeMs;
    } catch {
      holderMtimeMs = 0;
    }
  }
  const dayKey = easternDayKey(nowT);
  if (!dayKey) return cloneMetrics(EMPTY_RANGE_METRICS);
  const hit = cache.get(path);
  if (
    hit &&
    hit.mtimeMs === mtimeMs &&
    hit.backfillMtimeMs === backfillMtimeMs &&
    hit.holderMtimeMs === holderMtimeMs &&
    hit.dayKey === dayKey
  ) {
    return cloneMetrics(hit);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(await readFile(path, "utf8"));
  } catch {
    return cloneMetrics(EMPTY_RANGE_METRICS);
  }
  let holderFile: HolderSnapshotFile | null = null;
  if (holderPath && holderChain && holderMtimeMs > 0) {
    try {
      holderFile = parseHolderSnapshotFile(JSON.parse(await readFile(holderPath, "utf8")), holderChain);
    } catch {
      holderFile = null;
    }
  }
  // BNB lane totals on a nightly row already include that day's assets. Backfill on the
  // same date would add contracts the chart did not put in the lane. Days missing from
  // bnb.json stay, so 30D still matches the chart's derived bars.
  const cardBackfill = chainId === BNB_CHAIN_ID ? bnbBackfillWithoutNightlyDates(payload, backfill) : backfill;
  const volumes = equityCardRangeVolumesFromSnapshot(payload, nowT, cardBackfill);
  const liquidity = equityCardLiquidityHistoryFromSnapshot(payload, nowT, cardBackfill);
  const volumeSeries = equityCardVolumeHistoryFromSnapshot(payload, nowT, cardBackfill);
  const prices = equityCardPriceHistoryFromPayloads(payload, holderFile, nowT, cardBackfill);
  // Hand out a copy. The cached maps must stay intact if a later render mutates props.
  const stored = cloneMetrics({ volumes, liquidity, volumeSeries, prices });
  cache.set(path, {
    mtimeMs,
    backfillMtimeMs,
    holderMtimeMs,
    dayKey,
    volumes: stored.volumes,
    liquidity: stored.liquidity,
    volumeSeries: stored.volumeSeries,
    prices: stored.prices,
  });
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
    volumeSeries: structuredClone(metrics.volumeSeries),
    prices: structuredClone(metrics.prices),
  };
}
