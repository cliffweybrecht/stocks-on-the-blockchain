import { formatChartClock, formatChartDay } from "@/lib/market/format";
import type {
  AssetChartMode,
  AssetPriceHistoryResult,
  PriceChartRangeId,
  PriceHistoryPoint,
  VolumeHistoryPoint,
} from "@/lib/market/types";
import { utcDayOnOrBeforeEasternToday } from "@/lib/market/volume-snapshots";

export const ASSET_CHART_MODES = [
  { id: "volume", label: "Volume" },
  { id: "price", label: "Price" },
] as const satisfies readonly { id: AssetChartMode; label: string }[];

/** Asset chart pills. 90D stays in the range table for older callers and is not shown. */
export const ASSET_PANEL_RANGE_IDS = ["24h", "7d", "30d"] as const;

export const PRICE_CHART_RANGES = [
  { id: "24h", label: "24H", seconds: 24 * 60 * 60, series: "hourly" },
  { id: "7d", label: "7D", seconds: 7 * 24 * 60 * 60, series: "daily" },
  { id: "30d", label: "30D", seconds: 30 * 24 * 60 * 60, series: "daily" },
  { id: "90d", label: "90D", seconds: 90 * 24 * 60 * 60, series: "daily" },
] as const satisfies readonly {
  id: PriceChartRangeId;
  label: string;
  seconds: number;
  series: "hourly" | "daily";
}[];

export const PRICE_CHART_WIDTH = 800;
export const PRICE_CHART_HEIGHT = 280;
export const PRICE_CHART_PAD = { top: 16, right: 56, bottom: 28, left: 56 };
export const PRICE_CHART_INNER_W = PRICE_CHART_WIDTH - PRICE_CHART_PAD.left - PRICE_CHART_PAD.right;
export const PRICE_CHART_INNER_H = PRICE_CHART_HEIGHT - PRICE_CHART_PAD.top - PRICE_CHART_PAD.bottom;

export function priceHistoryNowT(
  history: Pick<AssetPriceHistoryResult, "generatedAt" | "daily" | "hourly" | "dailyVolume" | "hourlyVolume">,
): number {
  const parsed = Date.parse(history.generatedAt);
  if (Number.isFinite(parsed) && parsed > 0) return parsed / 1000;
  const lastDaily = history.daily[history.daily.length - 1]?.t ?? 0;
  const lastHourly = history.hourly[history.hourly.length - 1]?.t ?? 0;
  const lastDailyVol = history.dailyVolume[history.dailyVolume.length - 1]?.t ?? 0;
  const lastHourlyVol = history.hourlyVolume[history.hourlyVolume.length - 1]?.t ?? 0;
  return Math.max(lastDaily, lastHourly, lastDailyVol, lastHourlyVol);
}

/**
 * Daily candles are UTC-day buckets. Keep a bucket only once that calendar day
 * has started in America/New_York. Hourly 24H points are instants that already
 * happened, so they are not dropped for sharing tomorrow's UTC date.
 */
function observedInRange<T extends { t: number }>(
  points: readonly T[],
  nowT: number,
  windowSeconds: number,
  daily: boolean,
): T[] {
  const cutoff = nowT - windowSeconds;
  return points.filter((point) => {
    if (point.t < cutoff || point.t > nowT) return false;
    if (daily && !utcDayOnOrBeforeEasternToday(point.t, nowT)) return false;
    return true;
  });
}

/** Observed closes inside the selected window. Never fills gaps or invents prices. */
export function filterPriceRange(
  history: Pick<AssetPriceHistoryResult, "daily" | "hourly">,
  range: PriceChartRangeId,
  nowT: number,
): PriceHistoryPoint[] {
  const spec = PRICE_CHART_RANGES.find((row) => row.id === range);
  if (!spec || !Number.isFinite(nowT) || nowT <= 0) return [];
  const source = spec.series === "hourly" ? history.hourly : history.daily;
  return observedInRange(source, nowT, spec.seconds, spec.series === "daily");
}

/** Observed pool USD volume inside the selected window. Never fills gaps or invents $0. */
export function filterVolumeRange(
  history: Pick<AssetPriceHistoryResult, "dailyVolume" | "hourlyVolume">,
  range: PriceChartRangeId,
  nowT: number,
): VolumeHistoryPoint[] {
  const spec = PRICE_CHART_RANGES.find((row) => row.id === range);
  if (!spec || !Number.isFinite(nowT) || nowT <= 0) return [];
  const source = spec.series === "hourly" ? history.hourlyVolume : history.dailyVolume;
  return observedInRange(source, nowT, spec.seconds, spec.series === "daily").filter(
    (point) => Number.isFinite(point.volumeUsd) && point.volumeUsd >= 0,
  );
}

/** Volume y-axis starts at $0 so USD volume is not exaggerated. */
export function scaleVolumePoints(points: readonly VolumeHistoryPoint[]) {
  const minT = points[0]?.t ?? 0;
  const maxT = points[points.length - 1]?.t ?? 1;
  const values = points.map((point) => point.volumeUsd);
  const rawMax = values.length > 0 ? Math.max(...values, 0) : 1;
  const maxY = rawMax > 0 ? rawMax * 1.08 : 1;
  const spanT = Math.max(maxT - minT, 1);
  return {
    minT,
    maxT,
    minY: 0,
    maxY,
    x: (t: number) => PRICE_CHART_PAD.left + ((t - minT) / spanT) * PRICE_CHART_INNER_W,
    y: (value: number) => PRICE_CHART_PAD.top + PRICE_CHART_INNER_H - (value / maxY) * PRICE_CHART_INNER_H,
  };
}

/** First→last observed close in the visible window. Needs two real prices. */
export function priceRangeChangePct(points: readonly PriceHistoryPoint[]): number | null {
  if (points.length < 2) return null;
  const first = points[0]?.priceUsd;
  const last = points[points.length - 1]?.priceUsd;
  if (first === undefined || last === undefined) return null;
  if (!Number.isFinite(first) || !Number.isFinite(last) || first <= 0) return null;
  return ((last - first) / first) * 100;
}

export function scalePricePoints(points: readonly PriceHistoryPoint[]) {
  const minT = points[0]?.t ?? 0;
  const maxT = points[points.length - 1]?.t ?? 1;
  const prices = points.map((point) => point.priceUsd);
  const rawMin = prices.length > 0 ? Math.min(...prices) : 0;
  const rawMax = prices.length > 0 ? Math.max(...prices) : 1;
  const pad = rawMax > rawMin ? (rawMax - rawMin) * 0.08 : Math.max(Math.abs(rawMax) * 0.02, 0.01);
  const minY = rawMin - pad;
  const maxY = rawMax + pad;
  const spanT = Math.max(maxT - minT, 1);
  const spanY = Math.max(maxY - minY, 0.01);
  return {
    minT,
    maxT,
    minY,
    maxY,
    x: (t: number) => PRICE_CHART_PAD.left + ((t - minT) / spanT) * PRICE_CHART_INNER_W,
    y: (value: number) => PRICE_CHART_PAD.top + PRICE_CHART_INNER_H - ((value - minY) / spanY) * PRICE_CHART_INNER_H,
  };
}

export type PriceChartScale = ReturnType<typeof scalePricePoints>;

export function nearestVolumePoint(
  points: readonly VolumeHistoryPoint[],
  map: PriceChartScale,
  svgX: number,
): VolumeHistoryPoint | null {
  if (points.length === 0) return null;
  let best = points[0];
  let bestDist = Number.POSITIVE_INFINITY;
  for (const point of points) {
    const dist = Math.abs(map.x(point.t) - svgX);
    if (dist < bestDist) {
      best = point;
      bestDist = dist;
    }
  }
  return best ?? null;
}

export function nearestPricePoint(
  points: readonly PriceHistoryPoint[],
  map: PriceChartScale,
  svgX: number,
): PriceHistoryPoint | null {
  if (points.length === 0) return null;
  let best = points[0];
  let bestDist = Number.POSITIVE_INFINITY;
  for (const point of points) {
    const dist = Math.abs(map.x(point.t) - svgX);
    if (dist < bestDist) {
      best = point;
      bestDist = dist;
    }
  }
  return best ?? null;
}

/** 24H ticks and hover clocks are America/New_York. 7D/30D stay UTC calendar-day labels. */
export function formatPriceChartTick(unixSeconds: number, range: PriceChartRangeId): string {
  return range === "24h" ? formatChartClock(unixSeconds) : formatChartDay(unixSeconds);
}

export function displayPriceChangePct(input: {
  range: PriceChartRangeId;
  visible: readonly PriceHistoryPoint[];
  priceChange24hPct: number | null;
}): number | null {
  const fromSeries = priceRangeChangePct(input.visible);
  if (fromSeries !== null) return fromSeries;
  if (input.range === "24h") {
    const reported = input.priceChange24hPct;
    if (reported === null || reported === undefined || !Number.isFinite(reported)) return null;
    return reported;
  }
  return null;
}
