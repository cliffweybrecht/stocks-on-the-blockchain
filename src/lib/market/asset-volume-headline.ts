import type { PriceChartRangeId, VolumeHistoryPoint } from "./types";

export type AssetVolumeHeadlineScope = "all_markets" | "primary_pool";

export interface AssetVolumeHeadline {
  /** Null when nothing was observed. Never a fabricated $0. */
  volumeUsd: number | null;
  label: string;
  scope: AssetVolumeHeadlineScope;
}

export interface AllMarketsPoolResult {
  pairAddress: string;
  /** DexScreener volume.h24 for this pool. Null is unreported, not zero. */
  volume24hUsd: number | null;
  /**
   * Daily USD candles. Null when the fetch did not resolve.
   * An empty array is a resolved series with no observed candles.
   */
  points: readonly Pick<VolumeHistoryPoint, "t" | "volumeUsd">[] | null;
  /** Gecko rejected the pool (404 and the like). Not a rate limit. */
  definitiveMiss: boolean;
}

const RANGE_LABEL: Record<PriceChartRangeId, string> = {
  "24h": "24H",
  "7d": "7D",
  "30d": "30D",
  "90d": "90D",
};

/** Finite and >= 0. Null, NaN, and negatives are unreported. */
export function reportedVolumeUsd(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

/** Sum of observed points. No points is null, not $0. */
export function sumObservedVolumeUsd(points: readonly Pick<VolumeHistoryPoint, "volumeUsd">[]): number | null {
  let sum = 0;
  let any = false;
  for (const point of points) {
    const volumeUsd = reportedVolumeUsd(point.volumeUsd);
    if (volumeUsd === null) continue;
    sum += volumeUsd;
    any = true;
  }
  return any ? sum : null;
}

export function volumePointsInWindow(
  points: readonly Pick<VolumeHistoryPoint, "t" | "volumeUsd">[],
  nowT: number,
  windowSeconds: number,
): VolumeHistoryPoint[] {
  if (!Number.isFinite(nowT) || nowT <= 0) return [];
  if (!Number.isFinite(windowSeconds) || windowSeconds <= 0) return [];
  const cutoff = nowT - windowSeconds;
  const kept: VolumeHistoryPoint[] = [];
  for (const point of points) {
    const volumeUsd = reportedVolumeUsd(point.volumeUsd);
    if (volumeUsd === null) continue;
    if (!Number.isFinite(point.t) || point.t < cutoff || point.t > nowT) continue;
    kept.push({ t: point.t, volumeUsd });
  }
  return kept;
}

/**
 * One row per pair address. Empty addresses are not pools.
 * Duplicate addresses keep the higher reported 24h volume.
 */
export function uniqueAllMarketsPools<T extends { pairAddress: string; volume24hUsd: number | null }>(
  pools: readonly T[],
): T[] {
  const byPair = new Map<string, T>();
  for (const pool of pools) {
    const pairAddress = pool.pairAddress.trim();
    if (!pairAddress) continue;
    const next = { ...pool, pairAddress };
    const prev = byPair.get(pairAddress);
    if (!prev) {
      byPair.set(pairAddress, next);
      continue;
    }
    const prevVolume = reportedVolumeUsd(prev.volume24hUsd);
    const nextVolume = reportedVolumeUsd(next.volume24hUsd);
    if (nextVolume !== null && (prevVolume === null || nextVolume > prevVolume)) {
      byPair.set(pairAddress, next);
    }
  }
  return [...byPair.values()];
}

/**
 * Sum daily USD volume across pools.
 * Complete only when every pool resolved. A definitive Gecko miss on a pool
 * that DexScreener currently reports above $0 is incomplete — that market's
 * history is missing, so the total must not be labeled all-markets.
 * A definitive miss on a $0 or unreported pool contributes nothing.
 * Unresolved fetches (429, 5xx, timeout) are incomplete.
 * Same-timestamp candles add. Missing days stay missing.
 */
export function assembleAllMarketsDaily(pools: readonly AllMarketsPoolResult[]): {
  complete: boolean;
  daily: VolumeHistoryPoint[];
} {
  for (const pool of pools) {
    if (pool.points !== null) continue;
    if (pool.definitiveMiss) {
      const live = reportedVolumeUsd(pool.volume24hUsd);
      if (live !== null && live > 0) return { complete: false, daily: [] };
      continue;
    }
    return { complete: false, daily: [] };
  }

  const merged = new Map<number, number>();
  for (const pool of pools) {
    for (const point of pool.points ?? []) {
      const volumeUsd = reportedVolumeUsd(point.volumeUsd);
      if (volumeUsd === null) continue;
      if (!Number.isFinite(point.t) || point.t <= 0) continue;
      const t = Math.trunc(point.t);
      merged.set(t, (merged.get(t) ?? 0) + volumeUsd);
    }
  }

  const daily = [...merged.entries()]
    .map(([t, volumeUsd]) => ({ t, volumeUsd }))
    .sort((a, b) => a.t - b.t);
  return { complete: true, daily };
}

function headlineLabel(range: PriceChartRangeId, scope: AssetVolumeHeadlineScope): string {
  const name = RANGE_LABEL[range];
  return scope === "all_markets" ? `${name} volume (all markets)` : `${name} volume`;
}

/**
 * 24H prefers the DexScreener all-markets total (sum of every pool's volume.h24).
 * 7D and 30D use the summed Gecko daily candles across every pool when that
 * series is complete. Otherwise the headline is the primary-pool candle sum
 * and the label does not say all-markets.
 * A complete all-markets series with nothing in the window stays null — it
 * does not fall back to the primary pool and it does not become $0.
 */
export function selectAssetVolumeHeadline(input: {
  range: PriceChartRangeId;
  nowT: number;
  windowSeconds: number;
  allMarkets24hUsd: number | null | undefined;
  primaryPoolPoints: readonly Pick<VolumeHistoryPoint, "volumeUsd">[];
  allMarketsDaily: readonly Pick<VolumeHistoryPoint, "t" | "volumeUsd">[] | null;
}): AssetVolumeHeadline {
  if (input.range === "24h") {
    const allMarkets = reportedVolumeUsd(input.allMarkets24hUsd);
    if (allMarkets !== null) {
      return {
        volumeUsd: allMarkets,
        label: headlineLabel("24h", "all_markets"),
        scope: "all_markets",
      };
    }
    return {
      volumeUsd: sumObservedVolumeUsd(input.primaryPoolPoints),
      label: headlineLabel("24h", "primary_pool"),
      scope: "primary_pool",
    };
  }

  if (input.allMarketsDaily !== null) {
    const inWindow = volumePointsInWindow(input.allMarketsDaily, input.nowT, input.windowSeconds);
    return {
      volumeUsd: sumObservedVolumeUsd(inWindow),
      label: headlineLabel(input.range, "all_markets"),
      scope: "all_markets",
    };
  }

  return {
    volumeUsd: sumObservedVolumeUsd(input.primaryPoolPoints),
    label: headlineLabel(input.range, "primary_pool"),
    scope: "primary_pool",
  };
}
