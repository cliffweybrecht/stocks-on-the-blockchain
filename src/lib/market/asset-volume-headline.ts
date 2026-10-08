import type { PriceChartRangeId, VolumeHistoryPoint } from "./types";
import { isClosedEasternSnapshotDay } from "./volume-snapshots";

export type AssetVolumeHeadlineScope = "all_markets" | "primary_pool" | "observed_pools";

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
 * Closed Gecko UTC-day buckets inside the window.
 * A day is plotted only after America/New_York has moved on — the same closed-day
 * rule as the desk snapshot chart. Gecko's latest day candle is volume so far
 * on an open UTC bucket, not a closed Eastern day, and a rolling 24h tip is
 * never drawn as that date. Does not add or rewrite a candle.
 */
function closedDailyPointsInWindow(
  points: readonly (Pick<VolumeHistoryPoint, "t" | "volumeUsd"> & { kind?: VolumeHistoryPoint["kind"] })[],
  nowT: number,
  windowSeconds: number,
): VolumeHistoryPoint[] {
  const closed = points.filter(
    (point) => point.kind !== "rolling_24h" && isClosedEasternSnapshotDay(point.t, nowT),
  );
  return volumePointsInWindow(closed, nowT, windowSeconds);
}

function poolAddressSet(addresses: readonly string[]): Set<string> {
  return new Set(addresses.map((address) => address.trim()).filter((address) => address.length > 0));
}

/**
 * A DexScreener pool list may gain or drop a few pairs between refreshes.
 * That wobble is not a new asset. A much smaller list is a partial payload and is not compatible.
 * Exact membership is compatible. A handful of adds and removals is compatible when most pools are shared.
 */
export function allMarketsPoolSetCompatible(saved: readonly string[], live: readonly string[]): boolean {
  const savedSet = poolAddressSet(saved);
  const liveSet = poolAddressSet(live);
  if (savedSet.size === 0 || liveSet.size === 0) return false;
  let shared = 0;
  for (const address of liveSet) {
    if (savedSet.has(address)) shared += 1;
  }
  if (shared === savedSet.size && shared === liveSet.size) return true;
  const added = liveSet.size - shared;
  const removed = savedSet.size - shared;
  const larger = Math.max(savedSet.size, liveSet.size);
  const allowance = Math.max(2, Math.round(larger * 0.1));
  if (added > allowance || removed > allowance) return false;
  return shared * 2 >= larger;
}

/**
 * The live list is too small to replace a saved fill.
 * A partial DexScreener payload must not restart or hide that fill.
 * A compatible wobble is not partial — the fill reconciles onto the live list.
 */
export function allMarketsLiveSetIsPartial(saved: readonly string[], live: readonly string[]): boolean {
  if (allMarketsPoolSetCompatible(saved, live)) return false;
  const savedSize = poolAddressSet(saved).size;
  const liveSize = poolAddressSet(live).size;
  return savedSize > liveSize && liveSize > 0;
}

/** Add candle volumes that share a timestamp. Missing timestamps stay missing. */
export function mergeVolumeSeries(
  base: readonly Pick<VolumeHistoryPoint, "t" | "volumeUsd">[],
  extra: readonly Pick<VolumeHistoryPoint, "t" | "volumeUsd">[],
): VolumeHistoryPoint[] {
  const merged = new Map<number, number>();
  for (const point of [...base, ...extra]) {
    const volumeUsd = reportedVolumeUsd(point.volumeUsd);
    if (volumeUsd === null || !Number.isFinite(point.t) || point.t <= 0) continue;
    const t = Math.trunc(point.t);
    merged.set(t, (merged.get(t) ?? 0) + volumeUsd);
  }
  return [...merged.entries()]
    .map(([t, volumeUsd]) => ({ t, volumeUsd }))
    .sort((a, b) => a.t - b.t);
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
 * 7D and 30D sum the closed Gecko daily candles across every pool when that
 * series is complete. The in-progress Eastern day is left out. Otherwise the
 * headline is the primary-pool candle sum and the label does not say all-markets.
 * A complete all-markets series with nothing in the window stays null — it
 * does not fall back to the primary pool and it does not become $0.
 */
export function selectAssetVolumeHeadline(input: {
  range: PriceChartRangeId;
  nowT: number;
  windowSeconds: number;
  allMarkets24hUsd: number | null | undefined;
  primaryPoolPoints: readonly Pick<VolumeHistoryPoint, "volumeUsd">[];
  allMarketsDaily: readonly VolumeHistoryPoint[] | null;
  /**
   * In-window sum of pools that already returned candles.
   * Used only when the primary series is empty and all-markets is not ready.
   * It is not labeled all-markets.
   */
  observedPoints?: readonly Pick<VolumeHistoryPoint, "volumeUsd">[] | null;
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

  if (input.allMarketsDaily !== null && input.allMarketsDaily.length > 0) {
    const inWindow = closedDailyPointsInWindow(input.allMarketsDaily, input.nowT, input.windowSeconds);
    return {
      volumeUsd: sumObservedVolumeUsd(inWindow),
      label: headlineLabel(input.range, "all_markets"),
      scope: "all_markets",
    };
  }

  const primarySum = sumObservedVolumeUsd(input.primaryPoolPoints);
  if (primarySum === null && input.observedPoints && input.observedPoints.length > 0) {
    return {
      volumeUsd: sumObservedVolumeUsd(input.observedPoints),
      label: headlineLabel(input.range, "observed_pools"),
      scope: "observed_pools",
    };
  }
  return {
    volumeUsd: primarySum,
    label: headlineLabel(input.range, "primary_pool"),
    scope: "primary_pool",
  };
}

export interface AssetVolumeSeries {
  points: VolumeHistoryPoint[];
  scope: AssetVolumeHeadlineScope;
}

/**
 * Plotted volume candles.
 * 24H uses summed hourly Gecko volume once every pool has resolved.
 * 7D and 30D use summed daily Gecko volume for closed Eastern days once that
 * series is complete. The open UTC day is not plotted as today.
 * Until then the line stays the primary pool. A complete series with nothing
 * in the window stays empty — it does not fall back to the primary pool.
 * `primaryPoolPoints` are already inside the chart window.
 */
export function selectAssetVolumeSeries(input: {
  range: PriceChartRangeId;
  nowT: number;
  windowSeconds: number;
  primaryPoolPoints: readonly VolumeHistoryPoint[];
  allMarketsDaily: readonly VolumeHistoryPoint[] | null;
  allMarketsHourly: readonly Pick<VolumeHistoryPoint, "t" | "volumeUsd">[] | null;
  /**
   * Already inside the chart window. Plotted only when this range's primary
   * series is empty and the all-markets series is not ready. A finished
   * all-markets window that happens to be empty stays empty.
   */
  observedPoints?: readonly VolumeHistoryPoint[] | null;
}): AssetVolumeSeries {
  if (input.range === "24h" && input.allMarketsHourly !== null) {
    return {
      points: volumePointsInWindow(input.allMarketsHourly, input.nowT, input.windowSeconds),
      scope: "all_markets",
    };
  }
  if ((input.range === "7d" || input.range === "30d") && input.allMarketsDaily !== null && input.allMarketsDaily.length > 0) {
    return {
      points: closedDailyPointsInWindow(input.allMarketsDaily, input.nowT, input.windowSeconds),
      scope: "all_markets",
    };
  }
  if (input.primaryPoolPoints.length === 0 && input.observedPoints && input.observedPoints.length > 0) {
    return {
      points: input.observedPoints.map((point) => ({ t: point.t, volumeUsd: point.volumeUsd })),
      scope: "observed_pools",
    };
  }
  return {
    points: input.primaryPoolPoints.map((point) => ({ t: point.t, volumeUsd: point.volumeUsd })),
    scope: "primary_pool",
  };
}

export interface PlottedAssetVolume {
  series: AssetVolumeSeries;
  /** The only observed point was withheld so the chart does not draw a single dot. */
  withheldLonePoint: boolean;
}

function copyVolumePoints(points: readonly VolumeHistoryPoint[]): VolumeHistoryPoint[] {
  return points.map((point) => ({ t: point.t, volumeUsd: point.volumeUsd }));
}

/**
 * A line needs two closed days. One point is not plotted.
 * While all-markets is empty or still pending, a longer primary-pool or
 * per-asset snapshot series supplies the shape. A finished all-markets
 * series that simply has nothing inside the window stays empty.
 */
export function selectPlottedAssetVolume(input: {
  selected: AssetVolumeSeries;
  allMarketsDaily: readonly VolumeHistoryPoint[] | null;
  primaryPoints: readonly VolumeHistoryPoint[];
  snapshotPoints: readonly VolumeHistoryPoint[];
}): PlottedAssetVolume {
  if (input.selected.points.length >= 2) {
    return { series: input.selected, withheldLonePoint: false };
  }
  const finishedEmptyWindow =
    input.selected.scope === "all_markets" &&
    (input.allMarketsDaily?.length ?? 0) > 0 &&
    input.selected.points.length === 0;
  if (finishedEmptyWindow) {
    return { series: input.selected, withheldLonePoint: false };
  }
  if (input.primaryPoints.length >= 2) {
    return {
      series: { points: copyVolumePoints(input.primaryPoints), scope: "primary_pool" },
      withheldLonePoint: false,
    };
  }
  if (input.snapshotPoints.length >= 2) {
    return {
      series: { points: copyVolumePoints(input.snapshotPoints), scope: "primary_pool" },
      withheldLonePoint: false,
    };
  }
  const lone =
    input.selected.points.length === 1 ||
    input.primaryPoints.length === 1 ||
    input.snapshotPoints.length === 1;
  return {
    series: { points: [], scope: input.selected.scope },
    withheldLonePoint: lone,
  };
}
