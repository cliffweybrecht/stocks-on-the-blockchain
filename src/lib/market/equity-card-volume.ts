import { compareNullableDesc } from "./numbers";
import { selectPrimaryPricePool } from "./asset-price-history";
import type { AssetPoolMark, VolumeHistoryPoint } from "./types";

const DAY_SECONDS = 24 * 60 * 60;

/** Cap Gecko hourly fetches so the list does not request a candle series per mint. */
export const EQUITY_CARD_DAY_VOLUME_SERIES_MAX = 32;

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
    const pairAddress = selectPrimaryPricePool(asset.pools);
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
