import { combinedPublicPrivateVolume24h } from "./aggregate";
import { formatChartDate, formatChartDay, formatChartTick } from "./format";
import type { VolumeHistoryPoint } from "./types";
import { utcDayStart } from "./volume-history";

export const VOLUME_CHART_RANGES = [
  { id: "7d", label: "7D", days: 7 },
  { id: "30d", label: "30D", days: 30 },
  { id: "90d", label: "90D", days: 90 },
  { id: "180d", label: "180D", days: 180 },
  { id: "all", label: "All", days: null },
] as const;

export type VolumeChartRangeId = (typeof VOLUME_CHART_RANGES)[number]["id"];

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
  if (!spec || spec.days === null) return [...points];
  const last = points[points.length - 1];
  if (!last) return [...points];
  const cutoff = last.t - spec.days * 86_400;
  const filtered = points.filter((point) => point.t >= cutoff);
  return filtered.length > 0 ? filtered : [...points];
}

export function scaleVolumePoints(points: readonly VolumeHistoryPoint[]) {
  const minT = points[0]?.t ?? 0;
  const maxT = points[points.length - 1]?.t ?? 1;
  const maxY = Math.max(...points.map((point) => point.volumeUsd), 0);
  const spanT = Math.max(maxT - minT, 1);
  const spanY = maxY > 0 ? maxY : 1;
  return {
    minT,
    maxT,
    maxY,
    x: (t: number) => VOLUME_CHART_PAD.left + ((t - minT) / spanT) * VOLUME_CHART_INNER_W,
    y: (value: number) => VOLUME_CHART_PAD.top + VOLUME_CHART_INNER_H - (value / spanY) * VOLUME_CHART_INNER_H,
  };
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
    return { caption: "24h · same DexScreener equity rollup as the desk", isRolling24h: true };
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
        caption: "24h · public equity chart point · headline is public + private + ETF/index",
        kind: "rolling_24h",
      };
    }
    return {
      volumeUsd: input.hover.volumeUsd,
      caption: `Calendar day · ${formatChartDate(input.hover.t)} · public history (headline universe is broader)`,
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

/** Evenly spaced unique UTC days from the visible series, oldest first. */
export function volumeChartXTicks(
  points: readonly VolumeHistoryPoint[],
  count = 4,
): number[] {
  if (points.length === 0) return [];
  const byDay = new Map<number, number>();
  for (const point of points) {
    const day = utcDayStart(point.t);
    if (day <= 0) continue;
    if (!byDay.has(day)) byDay.set(day, point.t);
  }
  const days = [...byDay.keys()].sort((a, b) => a - b);
  if (days.length === 0) return [];
  if (days.length === 1) return [byDay.get(days[0]!)!];
  const n = Math.min(count, days.length);
  const ticks: number[] = [];
  for (let i = 0; i < n; i++) {
    const idx = Math.round((i / (n - 1)) * (days.length - 1));
    const t = byDay.get(days[idx]!)!;
    if (ticks[ticks.length - 1] !== t) ticks.push(t);
  }
  return ticks;
}

/**
 * Month+year when those labels are unique across the ticks (All / 180D).
 * Month+day when month+year would collide (7D in one month).
 */
export function formatVolumeChartTick(unixSeconds: number, allTicks: readonly number[]): string {
  if (!Number.isFinite(unixSeconds)) return "";
  const monthYear = allTicks.map(formatChartTick);
  if (new Set(monthYear).size === allTicks.length) return formatChartTick(unixSeconds);
  return formatChartDay(unixSeconds);
}
