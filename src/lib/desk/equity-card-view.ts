import { deskSpotPriceUsd } from "./price-ticker";
import type { AssetSortKey } from "@/lib/market/aggregate";
import type { VolumeChartRangeId } from "@/lib/market/daily-volume-view";
import { sliceEquityCardDayVolumeSeries } from "@/lib/market/equity-card-volume";
import {
  equityCardRangeCoverageHint,
  equityCardRangeLabel,
  type EquityCardClosedRangeId,
} from "@/lib/market/equity-card-range-volume";
import type { AssetSummary, PriceHistoryPoint, VolumeHistoryPoint } from "@/lib/market/types";

const DAY_SECONDS = 24 * 60 * 60;

export type EquityCardMetricKind = "volume" | "liquidity";

export interface EquityCardRangeHeadline {
  id: VolumeChartRangeId;
  /** Null when this asset has no recorded day in the window. */
  volumeUsd: number | null;
  days: number;
}

export interface EquityCardHeadline {
  amountUsd: number | null;
  label: "Vol" | "Liq" | "7D vol" | "14D vol" | "30D vol";
  kind: EquityCardMetricKind;
  /** `n of N days` when the closed window is only partly recorded. */
  coverageHint: string | null;
}

/**
 * Card headline for the Volume | Liquidity toggle.
 * Volume is DexScreener 24h (`volume.h24`, summed on the mint).
 * Liquidity is the desk field `displayedLiquidityUsd` — the sum of DexScreener
 * `liquidity.usd` already used to rank the Liquidity list. Missing stays missing.
 * Pools and RH vs DEX sorts keep the volume headline.
 */
function finiteUsd(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return value;
}

export function equityCardHeadline(
  asset: Pick<AssetSummary, "volume24hUsd" | "displayedLiquidityUsd">,
  sortKey: AssetSortKey,
  range?: EquityCardRangeHeadline | null,
): EquityCardHeadline {
  if (sortKey === "displayedLiquidityUsd") {
    return {
      amountUsd: finiteUsd(asset.displayedLiquidityUsd),
      label: "Liq",
      kind: "liquidity",
      coverageHint: null,
    };
  }
  if (range && range.id !== "24h") {
    const amountUsd = finiteUsd(range.volumeUsd);
    const id = range.id as EquityCardClosedRangeId;
    return {
      amountUsd,
      label: equityCardRangeLabel(id),
      kind: "volume",
      coverageHint: amountUsd === null ? null : equityCardRangeCoverageHint(id, range.days),
    };
  }
  return {
    amountUsd: finiteUsd(asset.volume24hUsd),
    label: "Vol",
    kind: "volume",
    coverageHint: null,
  };
}

/** Reported DexScreener / DEX median spot. Missing stays missing. */
export function equityCardSpotPriceUsd(
  asset: Pick<AssetSummary, "dexMedianPriceUsd">,
): number | null {
  return deskSpotPriceUsd(asset);
}

/** Hide unknown day move. A source-reported 0 is kept. */
export function equityCardDayMovePct(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return value;
}

/**
 * Intra-day price sparkline from observed hourly closes in the last 24h.
 * Needs two real points. Daily candles and a single print are not a day series.
 */
export function equityCardDayPriceSeries(
  points: readonly PriceHistoryPoint[] | null | undefined,
  nowT = Date.now() / 1000,
): PriceHistoryPoint[] | null {
  if (!points || points.length < 2 || !Number.isFinite(nowT) || nowT <= 0) return null;
  const cutoff = nowT - DAY_SECONDS;
  const day = points
    .filter(
      (point) =>
        Number.isFinite(point.t) &&
        point.t >= cutoff &&
        point.t <= nowT &&
        Number.isFinite(point.priceUsd),
    )
    .sort((a, b) => a.t - b.t);
  return day.length >= 2 ? day : null;
}

/** Intra-day volume buckets for the card sparkline. Missing series stays missing. */
export function equityCardDayVolumeSeries(
  points: readonly VolumeHistoryPoint[] | null | undefined,
  nowT = Date.now() / 1000,
): VolumeHistoryPoint[] | null {
  return sliceEquityCardDayVolumeSeries(points, nowT);
}

export function equityCardPriceSparklineDirection(
  points: readonly PriceHistoryPoint[],
): "up" | "down" | "flat" | null {
  if (points.length < 2) return null;
  const first = points[0]?.priceUsd;
  const last = points[points.length - 1]?.priceUsd;
  if (first === undefined || last === undefined || !Number.isFinite(first) || !Number.isFinite(last)) {
    return null;
  }
  if (last > first) return "up";
  if (last < first) return "down";
  return "flat";
}
