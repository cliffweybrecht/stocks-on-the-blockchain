import { useId } from "react";
import {
  equityCardDayPriceSeries,
  equityCardPriceSparklineDirection,
} from "@/lib/desk/equity-card-view";
import { sparklineGeometryFromValues } from "@/lib/desk/sparkline-path";
import type { PriceHistoryPoint } from "@/lib/market/types";

const WIDTH = 112;
const HEIGHT = 32;

const DIRECTION_COLOR = {
  up: "#22c55e",
  down: "#ef4444",
  flat: "#737373",
} as const;

function rangePriceSeries(points: readonly PriceHistoryPoint[]): PriceHistoryPoint[] | null {
  if (points.length < 2) return null;
  const series: PriceHistoryPoint[] = [];
  for (const point of points) {
    if (!Number.isFinite(point.t) || point.t <= 0) return null;
    if (!Number.isFinite(point.priceUsd) || point.priceUsd <= 0) return null;
    series.push(point);
  }
  return series.length >= 2 ? series : null;
}

export function PriceSparkline({
  points,
  nowT,
  label,
  span = "day",
}: {
  points: readonly PriceHistoryPoint[];
  nowT?: number;
  label?: string;
  /** `day` keeps the last-24h hourly filter. `range` plots the closes it is given. */
  span?: "day" | "range";
}) {
  const series = span === "range" ? rangePriceSeries(points) : equityCardDayPriceSeries(points, nowT);
  const direction = series ? equityCardPriceSparklineDirection(series) : null;
  const geometry = series
    ? sparklineGeometryFromValues(
        series.map((point) => point.priceUsd),
        WIDTH,
        HEIGHT,
      )
    : null;
  const glowId = `price-spark-${useId().replace(/:/g, "")}`;
  if (!series || !direction || !geometry) return null;

  const color = DIRECTION_COLOR[direction];

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      className="h-8 w-28"
      role="img"
      aria-label={label ?? `Day price trend ${direction}`}
    >
      <defs>
        <linearGradient id={glowId} x1="0" x2="0" y1="1" y2="0">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={geometry.area} fill={`url(#${glowId})`} />
      <path
        d={geometry.line}
        fill="none"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
