import { combinedPublicPrivateVolume24h } from "./aggregate";
import {
  formatChartClock,
  formatChartDate,
  formatChartDay,
  formatChartTick,
  formatUsdCompact,
  formatUsdFull,
} from "./format";
import type { VolumeHistoryPoint } from "./types";
import { utcDayStart } from "./volume-history";

/**
 * 24H headline is the live DexScreener rollup (public + private + ETF/index).
 * The 24H plot is the hour-over-hour change in `hourlyHistory` captures, not the
 * absolute rolling total and not a closed America/New_York day.
 * 7D/14D/30D stay sums of closed desk snapshot days.
 */

/** Footer under the 24H delta bars. The live headline copy stays a separate line. */
export const HOURLY_VOLUME_DELTA_CAPTION =
  "Each point is the change in the DexScreener rolling 24h total vs the prior captured Eastern hour. Missing hours are omitted.";

export const HOURLY_VOLUME_DELTA_ARIA =
  "Hour-over-hour change in the DexScreener rolling 24h total. Each bar is the change versus the prior captured Eastern hour. Missing hours are omitted.";

export const HOURLY_VOLUME_DELTA_EMPTY =
  "Hour-over-hour change needs a prior captured Eastern hour. Missing hours are not invented.";
export const VOLUME_CHART_RANGES = [
  { id: "24h", label: "24H", rolling: true },
  { id: "7d", label: "7D", days: 7 },
  { id: "14d", label: "14D", days: 14 },
  { id: "30d", label: "30D", days: 30 },
] as const;

export type VolumeChartRangeId = (typeof VOLUME_CHART_RANGES)[number]["id"];
export type ClosedVolumeChartRangeId = Exclude<VolumeChartRangeId, "24h">;

/** Live ChainVolume 24h legs. Null is unreported, not zero. */
export interface DeskRolling24hVolumes {
  publicVolume24hUsd: number | null;
  privateVolume24hUsd: number | null;
  etfVolume24hUsd?: number | null;
}

export function isRollingVolumeChartRange(range: VolumeChartRangeId): range is "24h" {
  return range === "24h";
}

export const VOLUME_CHART_WIDTH = 800;
export const VOLUME_CHART_HEIGHT = 280;
export const VOLUME_CHART_PAD = { top: 16, right: 16, bottom: 28, left: 52 };
export const VOLUME_CHART_INNER_W = VOLUME_CHART_WIDTH - VOLUME_CHART_PAD.left - VOLUME_CHART_PAD.right;
export const VOLUME_CHART_INNER_H = VOLUME_CHART_HEIGHT - VOLUME_CHART_PAD.top - VOLUME_CHART_PAD.bottom;

export function filterVolumeRange(
  points: readonly VolumeHistoryPoint[],
  range: VolumeChartRangeId,
): VolumeHistoryPoint[] {
  if (points.length === 0) return [];
  const spec = VOLUME_CHART_RANGES.find((row) => row.id === range);
  if (!spec) return [...points];
  // Rolling 24H is a live total, not a slice of closed snapshot days.
  if (!("days" in spec)) return [];
  const last = points[points.length - 1];
  if (!last) return [...points];
  const cutoff = last.t - spec.days * 86_400;
  const filtered = points.filter((point) => point.t >= cutoff);
  return filtered.length > 0 ? filtered : [...points];
}

export function scaleVolumePoints(points: readonly VolumeHistoryPoint[], options?: { xInset?: number }) {
  const minT = points[0]?.t ?? 0;
  const maxT = points[points.length - 1]?.t ?? 1;
  const finite = points.map((point) => point.volumeUsd).filter((value) => Number.isFinite(value));
  const dataMin = finite.length > 0 ? Math.min(...finite) : 0;
  const dataMax = finite.length > 0 ? Math.max(...finite) : 0;
  // Zero stays in frame so a delta chart has a baseline. Nonnegative series
  // still scale from 0 to the max, matching the closed-day chart.
  const minY = Math.min(0, dataMin);
  const maxY = Math.max(0, dataMax);
  const xInset = Math.max(0, options?.xInset ?? 0);
  const spanT = Math.max(maxT - minT, 1);
  const spanY = maxY - minY > 0 ? maxY - minY : 1;
  const usableW = Math.max(VOLUME_CHART_INNER_W - xInset * 2, 1);
  const centerSingle = points.length <= 1 && xInset > 0;
  return {
    minT,
    maxT,
    minY,
    maxY,
    x: (t: number) =>
      centerSingle
        ? VOLUME_CHART_PAD.left + VOLUME_CHART_INNER_W / 2
        : VOLUME_CHART_PAD.left + xInset + ((t - minT) / spanT) * usableW,
    y: (value: number) =>
      VOLUME_CHART_PAD.top + VOLUME_CHART_INNER_H - ((value - minY) / spanY) * VOLUME_CHART_INNER_H,
  };
}

/** Labels closer than this in the 236px plot collide at 10px type. */
const DELTA_Y_TICK_MIN_GAP = 16;

/**
 * Y ticks for a signed delta axis. Always includes 0. Nonnegative series keep
 * the closed-day quarters of the max. A tiny negative beside a large positive
 * is drawn, but its label is omitted when it would sit on the zero label.
 */
export function volumeDeltaYTicks(minY: number, maxY: number): number[] {
  const lo = Math.min(minY, 0);
  const hi = Math.max(maxY, 0);
  if (lo === 0 && hi === 0) return [0];
  const raw =
    lo === 0
      ? [0, 0.25, 0.5, 0.75, 1].map((frac) => hi * frac)
      : hi === 0
        ? [0, 0.25, 0.5, 0.75, 1].map((frac) => (frac === 0 ? 0 : lo * frac))
        : [lo, lo / 2, 0, hi / 2, hi];
  return spaceDeltaYTicks(raw, lo, hi);
}

function spaceDeltaYTicks(ticks: readonly number[], minY: number, maxY: number): number[] {
  const span = maxY - minY || 1;
  const y = (value: number) => ((maxY - value) / span) * VOLUME_CHART_INNER_H;
  const unique = [...new Set(ticks.map((tick) => (Object.is(tick, -0) ? 0 : tick)))];
  const outward = [...unique].sort((a, b) => Math.abs(y(a) - y(0)) - Math.abs(y(b) - y(0)));
  const kept: number[] = [];
  for (const tick of outward) {
    if (kept.every((other) => Math.abs(y(tick) - y(other)) >= DELTA_Y_TICK_MIN_GAP)) kept.push(tick);
  }
  return kept.sort((a, b) => a - b);
}

/** Compact delta axis label. Positive values carry an explicit plus. */
export function formatDeltaUsdCompact(value: number): string {
  const text = formatUsdCompact(value);
  if (value > 0 && text.startsWith("$")) return `+${text}`;
  return text;
}

/** Tooltip amount for a signed delta. Closed-day tooltips stay on `formatUsdFull`. */
export function formatDeltaUsdFull(value: number): string {
  const text = formatUsdFull(value);
  if (value > 0 && text.startsWith("$")) return `+${text}`;
  return text;
}

/** One plotted 24H bar: change versus the previous captured hour, at the later hour. */
export interface HourlyRollingDeltaPoint extends VolumeHistoryPoint {
  priorT: number;
  kind: "rolling_24h";
}

/**
 * Captured rolling hours the 24H chart is allowed to difference.
 * Drops closed snapshot days, non-finite rows, and negative levels (a rolling
 * total is never negative). Same Eastern hour keeps the last row. Does not
 * insert missing hours and does not call `closedSnapshotVolumePoints`.
 */
export function plottableHourlyRollingPoints(points: readonly VolumeHistoryPoint[]): VolumeHistoryPoint[] {
  const byT = new Map<number, VolumeHistoryPoint>();
  for (const point of points) {
    if (point.kind === "calendar_day") continue;
    if (!Number.isFinite(point.t) || point.t <= 0) continue;
    if (!Number.isFinite(point.volumeUsd) || point.volumeUsd < 0) continue;
    byT.set(point.t, { t: point.t, volumeUsd: point.volumeUsd, kind: point.kind ?? "rolling_24h" });
  }
  return [...byT.values()].sort((a, b) => a.t - b.t);
}

/**
 * Hour-over-hour change of the rolling 24h snapshot total.
 * For each consecutive captured pair, plot `volumeUsd[i] - volumeUsd[i-1]` at `t[i]`.
 * The first capture has no prior and is omitted — not drawn as zero.
 * A gap stays a gap: the next captured hour is differenced against the prior
 * capture, and no hour is invented in between.
 */
export function hourlyRollingVolumeDeltas(points: readonly VolumeHistoryPoint[]): HourlyRollingDeltaPoint[] {
  const rows = plottableHourlyRollingPoints(points);
  const deltas: HourlyRollingDeltaPoint[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    const prior = rows[index - 1];
    const current = rows[index];
    if (!prior || !current) continue;
    deltas.push({
      t: current.t,
      priorT: prior.t,
      volumeUsd: current.volumeUsd - prior.volumeUsd,
      kind: "rolling_24h",
    });
  }
  return deltas;
}

export type VolumeChartScale = ReturnType<typeof scaleVolumePoints>;

export function nearestVolumePoint(
  points: readonly VolumeHistoryPoint[],
  map: VolumeChartScale,
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

/** Map a pointer through the SVG screen CTM so letterboxed viewBoxes still track. */
export function pointerToViewBoxX(
  clientX: number,
  clientY: number,
  ctm: { a: number; b: number; c: number; d: number; e: number; f: number } | null,
): number | null {
  if (!ctm) return null;
  const det = ctm.a * ctm.d - ctm.b * ctm.c;
  if (!Number.isFinite(det) || det === 0) return null;
  const x = clientX - ctm.e;
  const y = clientY - ctm.f;
  return (ctm.d * x - ctm.c * y) / det;
}

/** Prefer the SVG CTM; if it is missing, stretch-map through the rendered box. */
export function pointerToSvgX(
  clientX: number,
  clientY: number,
  ctm: { a: number; b: number; c: number; d: number; e: number; f: number } | null,
  rect: { left: number; width: number },
  viewBoxWidth = VOLUME_CHART_WIDTH,
): number | null {
  const fromCtm = pointerToViewBoxX(clientX, clientY, ctm);
  if (fromCtm !== null) return fromCtm;
  if (!Number.isFinite(rect.width) || rect.width <= 0) return null;
  return ((clientX - rect.left) / rect.width) * viewBoxWidth;
}

export function volumeHeadlineCopy(point: VolumeHistoryPoint): { caption: string; isRolling24h: boolean } {
  if (point.kind === "rolling_24h") {
    return { caption: "24h · DexScreener snapshot", isRolling24h: true };
  }
  return { caption: `Calendar day · ${formatChartDate(point.t)}`, isRolling24h: false };
}

export type DeskVolumeHeadlineKind = "combined_24h" | "rolling_24h" | "calendar_day";

export function deskVolumeHeadline(input: {
  publicVolume24hUsd: number | null;
  privateVolume24hUsd: number | null;
  etfVolume24hUsd?: number | null;
  hover: VolumeHistoryPoint | null;
  latest: VolumeHistoryPoint | null;
}): { volumeUsd: number | null; caption: string; kind: DeskVolumeHeadlineKind } {
  if (input.hover) {
    if (input.hover.kind === "rolling_24h") {
      return {
        volumeUsd: input.hover.volumeUsd,
        caption: "24h · DexScreener snapshot · public + private + ETF/index",
        kind: "rolling_24h",
      };
    }
    return {
      volumeUsd: input.hover.volumeUsd,
      caption: `Calendar day · ${formatChartDate(input.hover.t)} · DexScreener snapshot`,
      kind: "calendar_day",
    };
  }

  const combined = combinedPublicPrivateVolume24h(
    input.publicVolume24hUsd,
    input.privateVolume24hUsd,
    input.etfVolume24hUsd ?? null,
  );
  if (combined !== null) {
    return {
      volumeUsd: combined,
      caption: "24h · public + private + ETF/index",
      kind: "combined_24h",
    };
  }

  if (input.latest) {
    const copy = volumeHeadlineCopy(input.latest);
    return {
      volumeUsd: input.latest.volumeUsd,
      caption: copy.caption,
      kind: input.latest.kind === "rolling_24h" ? "rolling_24h" : "calendar_day",
    };
  }

  return {
    volumeUsd: null,
    caption: "24h · no reported public, private, or ETF/index volume",
    kind: "combined_24h",
  };
}

/**
 * "10:00 PM" at 10px is about 56 viewBox units wide. Centers closer than this
 * collide on the 800-wide chart, including the newest hour parked beside the
 * previous 3-hour tick.
 */
const HOURLY_TICK_MIN_GAP_PX = 72;

/**
 * Eastern hour labels, thinned so neighbors do not overlap.
 * Does not insert hours the desk did not record. The newest capture stays
 * labeled when it would otherwise sit on the previous tick.
 */
export function hourlyVolumeChartXTicks(points: readonly VolumeHistoryPoint[], xInset = 0): number[] {
  if (points.length === 0) return [];
  const step = points.length > 16 ? 3 : points.length > 8 ? 2 : 1;
  const chosen: number[] = [];
  for (let index = 0; index < points.length; index += step) chosen.push(index);
  const lastIndex = points.length - 1;
  const previous = chosen[chosen.length - 1];
  if (previous !== lastIndex) {
    if (lastIndex - previous < step) chosen[chosen.length - 1] = lastIndex;
    else chosen.push(lastIndex);
  }
  return spaceHourlyTickTimes(
    chosen.map((index) => points[index]!.t),
    points,
    xInset,
  );
}

/** Drop any remaining pair whose centers would overlap. Keep the later hour. */
function spaceHourlyTickTimes(
  ticks: readonly number[],
  points: readonly VolumeHistoryPoint[],
  xInset = 0,
): number[] {
  if (ticks.length <= 1) return [...ticks];
  const map = scaleVolumePoints(points, { xInset });
  const kept: number[] = [];
  for (const t of ticks) {
    const prev = kept[kept.length - 1];
    if (prev === undefined || map.x(t) - map.x(prev) >= HOURLY_TICK_MIN_GAP_PX) {
      kept.push(t);
      continue;
    }
    const before = kept[kept.length - 2];
    if (before === undefined || map.x(t) - map.x(before) >= HOURLY_TICK_MIN_GAP_PX) {
      kept[kept.length - 1] = t;
    }
  }
  return kept;
}

/** Eastern clock label for an hourly desk capture. Closed-day charts stay on calendar days. */
export function formatHourlyVolumeChartTick(unixSeconds: number): string {
  return formatChartClock(unixSeconds);
}

/**
 * Every unique desk day in the visible series, oldest first.
 * Points sit on UTC midnight of the America/New_York date, so these ticks
 * label that Eastern day. Mid-series days stay labeled; density does not drop ticks.
 */
export function volumeChartXTicks(points: readonly VolumeHistoryPoint[]): number[] {
  if (points.length === 0) return [];
  const byDay = new Map<number, number>();
  for (const point of points) {
    const day = utcDayStart(point.t);
    if (day <= 0) continue;
    if (!byDay.has(day)) byDay.set(day, point.t);
  }
  return [...byDay.keys()].sort((a, b) => a - b).map((day) => byDay.get(day)!);
}

/**
 * Sum of plotted closed snapshot days. A live rolling-24h tip is not a snapshot
 * day and is left out of the headline even if it is still in `points`.
 */
export function sumVolumePoints(points: readonly VolumeHistoryPoint[]): number | null {
  if (points.length === 0) return null;
  let sum = 0;
  let counted = 0;
  for (const point of points) {
    if (point.kind === "rolling_24h") continue;
    if (!Number.isFinite(point.volumeUsd) || point.volumeUsd < 0) continue;
    sum += point.volumeUsd;
    counted += 1;
  }
  return counted > 0 ? sum : null;
}

export function deskRangeVolumeHeadline(
  points: readonly VolumeHistoryPoint[],
  range: ClosedVolumeChartRangeId,
): { volumeUsd: number | null; caption: string; kind: "range_sum" } {
  const label = VOLUME_CHART_RANGES.find((row) => row.id === range)?.label ?? "7D";
  const volumeUsd = sumVolumePoints(points);
  if (volumeUsd === null) {
    return {
      volumeUsd: null,
      caption: `${label} · no desk snapshots in this window`,
      kind: "range_sum",
    };
  }
  return {
    volumeUsd,
    caption: `${label} · sum of desk snapshot days · public + private + ETF/index`,
    kind: "range_sum",
  };
}

/**
 * 24H reads the live rolling desk total. Closed ranges sum the plotted snapshot days.
 * A rolling selection does not fall through to those days when the live legs are null.
 */
export function deskChartHeadline(
  range: VolumeChartRangeId,
  visibleClosedPoints: readonly VolumeHistoryPoint[],
  rolling: DeskRolling24hVolumes | null,
):
  | ReturnType<typeof deskVolumeHeadline>
  | ReturnType<typeof deskRangeVolumeHeadline> {
  if (isRollingVolumeChartRange(range)) {
    return deskVolumeHeadline({
      publicVolume24hUsd: rolling?.publicVolume24hUsd ?? null,
      privateVolume24hUsd: rolling?.privateVolume24hUsd ?? null,
      etfVolume24hUsd: rolling?.etfVolume24hUsd ?? null,
      hover: null,
      latest: null,
    });
  }
  return deskRangeVolumeHeadline(visibleClosedPoints, range);
}

/**
 * Month+year when those labels are unique across the ticks.
 * Month+day when month+year would collide (a window inside one month).
 */
export function formatVolumeChartTick(unixSeconds: number, allTicks: readonly number[]): string {
  if (!Number.isFinite(unixSeconds)) return "";
  const monthYear = allTicks.map(formatChartTick);
  if (new Set(monthYear).size === allTicks.length) return formatChartTick(unixSeconds);
  return formatChartDay(unixSeconds);
}
