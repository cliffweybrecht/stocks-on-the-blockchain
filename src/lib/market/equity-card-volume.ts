import { compareNullableDesc } from "./numbers";
import { selectPrimaryPricePool } from "./asset-price-history";
import type { AssetPoolMark, VolumeHistoryPoint } from "./types";

const DAY_SECONDS = 24 * 60 * 60;

/** Cap Gecko hourly fetches so the list does not request a candle series per mint. */
export const EQUITY_CARD_DAY_VOLUME_SERIES_MAX = 32;

/**
 * Steady gap between card OHLCV calls.
 * A 4-wide burst at 200ms trips GeckoTerminal (429, often `Retry-After: 0`)
 * after a handful of pools, which is why most cards lost their sparkline.
 * The public cap is about 10 calls/minute, so the steady pace stays under that.
 */
export const EQUITY_CARD_VOLUME_SERIES_MIN_GAP_MS = 6_500;

/** After a 429, leave a little more room than the steady pace. */
export const EQUITY_CARD_VOLUME_SERIES_SLOW_GAP_MS = 7_500;

/**
 * `Retry-After: 0` is not a usable hint. Wait out the public minute window
 * once, then continue on the slow gap.
 */
export const EQUITY_CARD_VOLUME_SERIES_RATE_LIMIT_COOLDOWN_MS = 60_000;

/** Extra attempts per pool after the first try. One shared cooldown, not per pool. */
export const EQUITY_CARD_VOLUME_SERIES_RETRIES = 2;

/**
 * Near-empty builds must not sit in the 30-minute history cache.
 * Successes are kept; unresolved pools are retried on this shorter window.
 */
export const EQUITY_CARD_VOLUME_SERIES_SPARSE_CACHE_MS = 60_000;

/**
 * Header `0` or a missing header uses `fallbackMs`.
 * A positive Retry-After is seconds, converted to ms.
 */
export function equityCardVolumeRateLimitDelayMs(
  retryAfterHeader: string | null | undefined,
  fallbackMs: number,
): number {
  const retryAfter = Number(retryAfterHeader);
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.round(retryAfter * 1000);
  return Math.max(0, fallbackMs);
}

/** Long TTL only when every selected target resolved. Failures use the short window. */
export function equityCardVolumeSeriesCacheTtlMs(input: {
  targetCount: number;
  failedCount: number;
  fullTtlMs: number;
  sparseTtlMs?: number;
}): number {
  if (input.targetCount <= 0 || input.failedCount <= 0) return input.fullTtlMs;
  const sparseTtlMs = input.sparseTtlMs ?? EQUITY_CARD_VOLUME_SERIES_SPARSE_CACHE_MS;
  return Math.min(Math.max(0, sparseTtlMs), input.fullTtlMs);
}

/** Targets were selected, but at least half the pool fetches failed. */
export function equityCardVolumeSeriesIsSparse(targetCount: number, failedCount: number): boolean {
  return targetCount > 0 && failedCount / targetCount >= 0.5;
}

export interface EquityCardVolumeTarget {
  mint: string;
  pairAddress: string;
}

/**
 * Highest-volume mints with a real primary pool. Order is DexScreener 24h desc.
 * Missing volume ranks last; no pair address is not a target.
 */
export function selectEquityCardVolumeTargets(
  assets: readonly {
    contractAddress: string;
    volume24hUsd: number | null;
    pools: readonly Pick<AssetPoolMark, "pairAddress" | "volume24hUsd">[];
  }[],
  max = EQUITY_CARD_DAY_VOLUME_SERIES_MAX,
): EquityCardVolumeTarget[] {
  const limit = Number.isFinite(max) && max > 0 ? Math.floor(max) : 0;
  if (limit === 0) return [];

  const ranked = [...assets].sort((a, b) => compareNullableDesc(a.volume24hUsd, b.volume24hUsd));
  const seen = new Set<string>();
  const targets: EquityCardVolumeTarget[] = [];
  for (const asset of ranked) {
    const mint = asset.contractAddress.trim();
    if (!mint || seen.has(mint)) continue;
    const pairAddress = selectPrimaryPricePool(asset.pools, asset.contractAddress);
    if (!pairAddress) continue;
    seen.add(mint);
    targets.push({ mint, pairAddress });
    if (targets.length >= limit) break;
  }
  return targets;
}

/**
 * Intra-day volume sparkline from observed hourly buckets in the last 24h.
 * Needs two real points. Daily candles and a single print are not a day series.
 * A source-reported 0 is kept.
 */
export function sliceEquityCardDayVolumeSeries(
  points: readonly VolumeHistoryPoint[] | null | undefined,
  nowT = Date.now() / 1000,
): VolumeHistoryPoint[] | null {
  if (!points || points.length < 2 || !Number.isFinite(nowT) || nowT <= 0) return null;
  const cutoff = nowT - DAY_SECONDS;
  const day = points
    .filter(
      (point) =>
        Number.isFinite(point.t) &&
        point.t >= cutoff &&
        point.t <= nowT &&
        Number.isFinite(point.volumeUsd) &&
        point.volumeUsd >= 0,
    )
    .sort((a, b) => a.t - b.t);
  return day.length >= 2 ? day : null;
}
