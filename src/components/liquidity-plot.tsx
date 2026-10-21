"use client";

import { useMemo, useState, type PointerEvent } from "react";
import { DateAxisLabels } from "@/components/date-axis-labels";
import { DESK_CHART_STROKE, monotoneVolumePaths } from "@/lib/desk/chart-curve";
import { selectDateAxisLabelTicks } from "@/lib/desk/date-axis";
import {
  nearestVolumePoint,
  pointerToSvgX,
  scaleVolumePoints,
  volumeChartXTicks,
  VOLUME_CHART_HEIGHT,
  VOLUME_CHART_INNER_H,
  VOLUME_CHART_PAD,
  VOLUME_CHART_WIDTH,
  type VolumeChartRangeId,
} from "@/lib/market/daily-volume-view";
import type { DeskLiquidityRangeView } from "@/lib/market/desk-liquidity-chart";
import { formatChartDay, formatUsdCompact, formatUsdFull } from "@/lib/market/format";
import type { VolumeHistoryPoint } from "@/lib/market/types";

export function liquidityChartPoints(view: DeskLiquidityRangeView): VolumeHistoryPoint[] {
  return view.series
    .filter((point) => point.t > 0 && Number.isFinite(point.liquidityUsd))
    .map((point) => ({ t: point.t, volumeUsd: point.liquidityUsd, kind: "calendar_day" as const }));
}

/** Headline for the liquidity pill. The figure is a close or an average, never a sum of days. */
export function LiquidityHeadline({ view }: { view: DeskLiquidityRangeView }) {
  return (
    <div data-liquidity-headline-block data-liquidity-basis={view.basis}>
      <h2 className="font-heading text-[9px] leading-tight font-medium tracking-wide text-foreground/90">
        Total liquidity
      </h2>
      <p
        className="num mt-1 text-3xl font-medium text-primary"
        aria-live="polite"
        data-liquidity-headline
        data-liquidity-kind={view.basis}
      >
        {formatUsdCompact(view.liquidityUsd)}
      </p>
      <p className="mt-1 text-[11px] leading-snug text-muted-foreground" data-liquidity-caption>
        {view.caption}
      </p>
    </div>
  );
}

/**
 * Rounded liquidity series. One close is a dot. Missing days are omitted, not drawn as $0.
 * 24H is the latest 11:59 PM ET close.
 */
export function LiquidityPlot({
  points,
  frameClass,
  range,
}: {
  points: readonly VolumeHistoryPoint[];
  frameClass: string;
  range: VolumeChartRangeId;
}) {
  const [hover, setHover] = useState<VolumeHistoryPoint | null>(null);
  const map = useMemo(() => scaleVolumePoints(points, { xInset: points.length <= 1 ? 1 : 0 }), [points]);
  const paths = useMemo(
    () => monotoneVolumePaths(points, map, VOLUME_CHART_PAD.top + VOLUME_CHART_INNER_H),
    [map, points],
  );
  const xTicks = selectDateAxisLabelTicks(
    volumeChartXTicks(points),
    range === "24h" ? "7d" : range,
    (tick) => map.x(tick),
  );
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((frac) => map.maxY * frac);

  function setHoverFromClient(plot: Element, clientX: number, clientY: number) {
    const svg = plot.querySelector("svg");
    const svgX = pointerToSvgX(clientX, clientY, svg?.getScreenCTM?.() ?? null, plot.getBoundingClientRect());
    if (svgX === null) return;
    setHover(nearestVolumePoint(points, map, svgX));
  }

  if (points.length === 0) {
    return (
      <div
        className={`mt-4 flex h-[220px] items-center justify-center border border-dashed border-border bg-muted/20 px-6 text-center ${frameClass}`}
        data-liquidity-plot="empty"
      >
        <p className="max-w-md text-sm text-muted-foreground">
          No closed liquidity in this range. Missing days stay empty.
        </p>
      </div>
    );
  }

  return (
    <div
      className={`relative mt-3 cursor-crosshair ${frameClass}`}
      data-liquidity-plot="series"
      data-liquidity-points={points.length}
      onPointerLeave={() => setHover(null)}
      onMouseLeave={() => setHover(null)}
      onPointerMove={(event: PointerEvent<HTMLDivElement>) =>
        setHoverFromClient(event.currentTarget, event.clientX, event.clientY)
      }
      onMouseMove={(event) => setHoverFromClient(event.currentTarget, event.clientX, event.clientY)}
    >
      <svg
        viewBox={`0 0 ${VOLUME_CHART_WIDTH} ${VOLUME_CHART_HEIGHT}`}
        preserveAspectRatio="none"
        className="pointer-events-none h-[240px] w-full touch-none sm:h-[280px]"
        role="img"
        aria-label="Total displayed liquidity at each closed America/New York day. 24H is the latest 11:59 PM ET close. Missing days are left empty."
      >
        <defs>
          <linearGradient id="liquidity-area" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={DESK_CHART_STROKE} stopOpacity="0.38" />
            <stop offset="100%" stopColor={DESK_CHART_STROKE} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <rect x={0} y={0} width={VOLUME_CHART_WIDTH} height={VOLUME_CHART_HEIGHT} fill="transparent" />
        {yTicks.map((tick) => (
          <g key={tick}>
            <line
              x1={VOLUME_CHART_PAD.left}
              x2={VOLUME_CHART_WIDTH - VOLUME_CHART_PAD.right}
              y1={map.y(tick)}
              y2={map.y(tick)}
              stroke="currentColor"
              className="text-border"
              strokeWidth="1"
            />
            <text
              x={VOLUME_CHART_PAD.left - 8}
              y={map.y(tick) + 3}
              textAnchor="end"
              className="fill-muted-foreground"
              fontSize="10"
            >
              {formatUsdCompact(tick)}
            </text>
          </g>
        ))}
        <DateAxisLabels
          ticks={xTicks}
          x={(tick) => map.x(tick)}
          chartHeight={VOLUME_CHART_HEIGHT}
          label={formatChartDay}
          tickAttr="data-liquidity-tick"
        />
        <path d={paths.area} fill="url(#liquidity-area)" pointerEvents="none" />
        <path
          d={paths.line}
          fill="none"
          stroke={DESK_CHART_STROKE}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          pointerEvents="none"
        />
        {points.map((point) => (
          <circle
            key={point.t}
            cx={map.x(point.t)}
            cy={map.y(point.volumeUsd)}
            r={points.length === 1 ? 4 : 2.5}
            fill={DESK_CHART_STROKE}
            pointerEvents="none"
            data-liquidity-point={point.t}
          />
        ))}
        {hover ? (
          <g pointerEvents="none">
            <line
              x1={map.x(hover.t)}
              x2={map.x(hover.t)}
              y1={VOLUME_CHART_PAD.top}
              y2={VOLUME_CHART_PAD.top + VOLUME_CHART_INNER_H}
              stroke={DESK_CHART_STROKE}
              strokeOpacity="0.45"
              strokeDasharray="3 3"
            />
            <circle cx={map.x(hover.t)} cy={map.y(hover.volumeUsd)} r="3.5" fill={DESK_CHART_STROKE} />
          </g>
        ) : null}
      </svg>
      <div aria-hidden="true" className="absolute inset-0 z-10 cursor-crosshair" />
      {hover ? (
        <div
          className="pointer-events-none absolute top-2 right-2 z-20 rounded-md border border-border bg-background/95 px-2 py-1 text-xs shadow-sm"
          data-liquidity-tooltip
        >
          <p>{formatChartDay(hover.t)}</p>
          <p className="num text-foreground">{formatUsdFull(hover.volumeUsd)}</p>
        </div>
      ) : null}
    </div>
  );
}
