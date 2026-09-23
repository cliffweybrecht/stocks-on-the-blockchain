import { deskSpotPriceUsd } from "./price-ticker";
import type { AssetSummary, PriceHistoryPoint } from "@/lib/market/types";

const DAY_SECONDS = 24 * 60 * 60;

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
