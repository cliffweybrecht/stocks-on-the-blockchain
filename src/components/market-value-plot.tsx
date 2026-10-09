"use client";

import { useMemo, useState, type PointerEvent } from "react";
import { DESK_CHART_STROKE, monotoneVolumePaths } from "@/lib/desk/chart-curve";
import {
  nearestVolumePoint,
  pointerToSvgX,
  scaleVolumePoints,
  volumeChartXTicks,
  VOLUME_CHART_HEIGHT,
  VOLUME_CHART_INNER_H,
  VOLUME_CHART_PAD,
  VOLUME_CHART_WIDTH,
  formatVolumeChartTick,
} from "@/lib/market/daily-volume-view";
import { formatChartDay, formatUsdCompact, formatUsdFull } from "@/lib/market/format";
import { marketValueCaption, type MarketValueRangeView } from "@/lib/market/onchain-market-value";
import type { VolumeHistoryPoint } from "@/lib/market/types";

const LANES = [
  ["public", "Public"],
  ["private", "Private"],
  ["etf", "ETF/Index"],
] as const;

export function marketValueChartPoints(view: MarketValueRangeView): VolumeHistoryPoint[] {
  return view.series
    .filter((point) => point.t > 0 && Number.isFinite(point.marketValueUsd))
    .map((point) => ({ t: point.t, volumeUsd: point.marketValueUsd, kind: "calendar_day" as const }));
}

/** Headline number, subtitle, and Public / Private / ETF-Index splits. */
export function MarketValueHeadline({ view }: { view: MarketValueRangeView }) {
  return (
    <div
      data-market-value-headline-block
      data-market-value-basis={view.recorded ? view.basis : view.totalUsd !== null ? "current" : "empty"}
      data-market-value-hint={view.hint}
    >
      <h2 className="font-heading text-[9px] leading-tight font-medium tracking-wide text-foreground/90">
        Onchain market value
      </h2>
      <p
        className="num mt-1 text-3xl font-medium text-primary"
        aria-live="polite"
        data-market-value-headline
        data-market-value-kind={view.recorded ? view.basis : "empty"}
      >
        {formatUsdCompact(view.totalUsd)}
      </p>
      <p className="mt-1 text-[11px] leading-snug text-muted-foreground" data-market-value-caption>
        {marketValueCaption(view)}
      </p>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs" data-market-value-splits>
        {LANES.map(([id, label]) => {
          const value = id === "public" ? view.publicUsd : id === "private" ? view.privateUsd : view.etfUsd;
          return (
            <span key={id} data-market-value-lane={id}>
              <span className="text-muted-foreground">{label}</span>
              <span className="num ml-1.5 font-medium text-foreground">{formatUsdCompact(value)}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Rounded market-value series inside the existing headline card.
 * One close is a dot. Missing days are omitted, not drawn as $0.
 */
export function MarketValuePlot({
  points,
  frameClass,
}: {
  points: readonly VolumeHistoryPoint[];
  frameClass: string;
}) {
  const [hover, setHover] = useState<VolumeHistoryPoint | null>(null);
  const map = useMemo(() => scaleVolumePoints(points, { xInset: points.length <= 1 ? 1 : 0 }), [points]);
  const paths = useMemo(
    () => monotoneVolumePaths(points, map, VOLUME_CHART_PAD.top + VOLUME_CHART_INNER_H),
    [map, points],
  );
  const xTicks = volumeChartXTicks(points);
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
        data-market-value-plot="empty"
      >
        <p className="max-w-md text-sm text-muted-foreground">
          No closed onchain market value in this range. A missing supply or price stays empty.
        </p>
      </div>
    );
  }

  return (
    <div
      className={`relative mt-3 cursor-crosshair ${frameClass}`}
      data-market-value-plot="series"
      data-market-value-points={points.length}
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
        aria-label="Onchain market value by closed America/New York day. The line is supply times price. Missing days are left empty."
      >
        <defs>
          <linearGradient id="market-value-area" x1="0" x2="0" y1="0" y2="1">
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
        {xTicks.map((tick, index) => {
          const label = formatVolumeChartTick(tick, xTicks);
          const crowded = xTicks.length > 10;
          return (
            <text
              key={`${tick}-${index}`}
              x={map.x(tick)}
              y={crowded && index % 2 === 1 ? VOLUME_CHART_HEIGHT - 4 : VOLUME_CHART_HEIGHT - (crowded ? 16 : 8)}
              textAnchor="middle"
              className="fill-muted-foreground"
              fontSize={crowded ? 9 : 10}
              data-market-value-tick={label}
            >
              {label}
            </text>
          );
        })}
        <path d={paths.area} fill="url(#market-value-area)" pointerEvents="none" />
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
            data-market-value-point={point.t}
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
          </g>
        ) : null}
      </svg>
      <div aria-hidden="true" className="absolute inset-0 z-10 cursor-crosshair" />
      {hover ? (
        <div
          className="pointer-events-none absolute top-2 right-2 z-20 rounded-md border border-border bg-background/95 px-2 py-1 text-xs shadow-sm"
          data-market-value-tooltip
        >
          <p>{formatChartDay(hover.t)}</p>
          <p className="num text-foreground">{formatUsdFull(hover.volumeUsd)}</p>
        </div>
      ) : null}
    </div>
  );
}
