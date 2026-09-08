import { compareNullableDesc } from "./numbers";
import type { AssetSummary, EquityVolumeHistoryResult, VolumeHistoryPoint } from "./types";

/** Cumulative GeckoTerminal daily USD volume across classified Solana equity pools. */
export const EQUITY_VOLUME_HISTORY_DEFINITION =
  "Cumulative GeckoTerminal daily USD volume across classified Solana public-equity pools, from each pool's first indexed candle. Not issuance-genesis. ETF lane excluded.";

export const EQUITY_VOLUME_HISTORY_SOURCE_LABEL = "GeckoTerminal pool OHLCV (USD)";

export interface EquityVolumePoolTarget {
  pairAddress: string;
  mint: string;
  volume24hUsd: number | null;
}

export interface OhlcvCandle {
  t: number;
  volumeUsd: number;
}

export function emptyEquityVolumeHistory(
  reason: string,
  generatedAt = new Date().toISOString(),
): EquityVolumeHistoryResult {
  return {
    available: false,
    points: [],
    definition: EQUITY_VOLUME_HISTORY_DEFINITION,
    sourceLabel: EQUITY_VOLUME_HISTORY_SOURCE_LABEL,
    poolCount: 0,
    poolCountAttempted: 0,
    mintCount: 0,
    firstObservableAt: null,
    lastObservableAt: null,
    generatedAt,
    emptyReason: reason,
  };
}

/**
 * Unique Solana pools on classified public-equity rows only.
 * ETF / index products are never admitted. Empty pair addresses are dropped.
 */
export function collectEquityVolumeTargets(
  assets: readonly AssetSummary[],
): EquityVolumePoolTarget[] {
  const byPair = new Map<string, EquityVolumePoolTarget>();
  for (const asset of assets) {
    if (asset.instrumentKind !== "equity") continue;
    for (const pool of asset.pools) {
      const pairAddress = pool.pairAddress.trim();
      if (!pairAddress) continue;
      const existing = byPair.get(pairAddress);
      if (
        !existing ||
        (pool.volume24hUsd !== null &&
          (existing.volume24hUsd === null || pool.volume24hUsd > existing.volume24hUsd))
      ) {
        byPair.set(pairAddress, {
          pairAddress,
          mint: asset.contractAddress,
          volume24hUsd: pool.volume24hUsd,
        });
      }
    }
  }
  return [...byPair.values()].sort((a, b) => compareNullableDesc(a.volume24hUsd, b.volume24hUsd));
}

export function rankEquityVolumeTargets(
  targets: readonly EquityVolumePoolTarget[],
  maxPools: number,
): EquityVolumePoolTarget[] {
  const limit = Number.isFinite(maxPools) && maxPools > 0 ? Math.floor(maxPools) : 0;
  if (limit === 0) return [];
  return targets.slice(0, limit);
}

/**
 * Parse a GeckoTerminal pool OHLCV payload. Fail closed: unknown shapes
 * and non-finite candles are dropped, never invented.
 */
export function parseGeckoTerminalOhlcv(payload: unknown): OhlcvCandle[] {
  if (!payload || typeof payload !== "object") return [];
  const data = (payload as { data?: { attributes?: { ohlcv_list?: unknown } } }).data;
  const list = data?.attributes?.ohlcv_list;
  if (!Array.isArray(list)) return [];

  const candles: OhlcvCandle[] = [];
  for (const row of list) {
    if (!Array.isArray(row) || row.length < 6) continue;
    const t = Number(row[0]);
    const volumeUsd = Number(row[5]);
    if (!Number.isFinite(t) || t <= 0) continue;
    if (!Number.isFinite(volumeUsd) || volumeUsd < 0) continue;
    candles.push({ t: Math.trunc(t), volumeUsd });
  }

  candles.sort((a, b) => a.t - b.t);
  const deduped: OhlcvCandle[] = [];
  for (const candle of candles) {
    const last = deduped[deduped.length - 1];
    if (last && last.t === candle.t) {
      last.volumeUsd = candle.volumeUsd;
      continue;
    }
    deduped.push({ ...candle });
  }
  return deduped;
}

/**
 * Sum same-day pool volumes, then walk the observed days in order.
 * Days with no returned candle are omitted — we do not fill gaps.
 */
export function aggregateCumulativeVolume(
  seriesByPool: readonly { pairAddress: string; candles: readonly OhlcvCandle[] }[],
): VolumeHistoryPoint[] {
  const byDay = new Map<number, number>();
  for (const series of seriesByPool) {
    if (!series.pairAddress.trim()) continue;
    for (const candle of series.candles) {
      if (!Number.isFinite(candle.t) || candle.t <= 0) continue;
      if (!Number.isFinite(candle.volumeUsd) || candle.volumeUsd < 0) continue;
      const day = Math.trunc(candle.t);
      byDay.set(day, (byDay.get(day) ?? 0) + candle.volumeUsd);
    }
  }

  const days = [...byDay.keys()].sort((a, b) => a - b);
  let cumulativeUsd = 0;
  const points: VolumeHistoryPoint[] = [];
  for (const t of days) {
    const volumeUsd = byDay.get(t);
    if (volumeUsd === undefined) continue;
    cumulativeUsd += volumeUsd;
    points.push({ t, volumeUsd, cumulativeUsd });
  }
  return points;
}

export function buildEquityVolumeHistory(input: {
  seriesByPool: readonly { pairAddress: string; candles: readonly OhlcvCandle[] }[];
  attemptedPoolCount: number;
  mintCount: number;
  universePoolCount?: number;
  generatedAt?: string;
  emptyReason?: string;
}): EquityVolumeHistoryResult {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const usable = input.seriesByPool.filter((row) => row.candles.length > 0);
  const points = aggregateCumulativeVolume(usable);
  if (points.length === 0) {
    return emptyEquityVolumeHistory(
      input.emptyReason ??
        "GeckoTerminal did not return a usable daily volume series for classified Solana equity pools.",
      generatedAt,
    );
  }

  const first = points[0];
  const last = points[points.length - 1];
  const universe = input.universePoolCount ?? input.attemptedPoolCount;
  const fetchedNote =
    usable.length === input.attemptedPoolCount
      ? `${usable.length} fetched highest-volume pool${usable.length === 1 ? "" : "s"}`
      : `${usable.length} of ${input.attemptedPoolCount} fetched highest-volume pools`;
  const universeNote =
    universe > input.attemptedPoolCount
      ? ` (${universe} classified equity pools / ${input.mintCount} mints in this snapshot)`
      : "";
  const poolNote = ` This snapshot: ${fetchedNote}${universeNote}.`;

  return {
    available: true,
    points,
    definition: `${EQUITY_VOLUME_HISTORY_DEFINITION}${poolNote}`,
    sourceLabel: EQUITY_VOLUME_HISTORY_SOURCE_LABEL,
    poolCount: usable.length,
    poolCountAttempted: input.attemptedPoolCount,
    mintCount: input.mintCount,
    firstObservableAt: first ? new Date(first.t * 1000).toISOString() : null,
    lastObservableAt: last ? new Date(last.t * 1000).toISOString() : null,
    generatedAt,
    emptyReason: null,
  };
}
