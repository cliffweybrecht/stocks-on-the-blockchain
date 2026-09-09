"use client";

import { useMemo, useState, type PointerEvent } from "react";
import {
  filterVolumeRange,
  nearestVolumePoint,
  pointerToSvgX,
  scaleVolumePoints,
  volumeHeadlineCopy,
  VOLUME_CHART_HEIGHT,
  VOLUME_CHART_INNER_H,
  VOLUME_CHART_PAD,
  VOLUME_CHART_RANGES,
  VOLUME_CHART_WIDTH,
  type VolumeChartRangeId,
} from "@/lib/market/daily-volume-view";
import { formatChartTick, formatUsdCompact, formatUsdFull } from "@/lib/market/format";
import type { EquityVolumeHistoryResult, VolumeHistoryPoint } from "@/lib/market/types";
import { alignLatestDayWithDesk24h } from "@/lib/market/volume-history";

function areaPath(
  points: readonly VolumeHistoryPoint[],
  map: ReturnType<typeof scaleVolumePoints>,
): string {
  if (points.length === 0) return "";
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return "";
  const line = points.map((point) => `${map.x(point.t).toFixed(2)},${map.y(point.volumeUsd).toFixed(2)}`).join(" L ");
  return `M ${map.x(first.t).toFixed(2)},${(VOLUME_CHART_PAD.top + VOLUME_CHART_INNER_H).toFixed(2)} L ${line} L ${map.x(last.t).toFixed(2)},${(VOLUME_CHART_PAD.top + VOLUME_CHART_INNER_H).toFixed(2)} Z`;
}

function linePath(
  points: readonly VolumeHistoryPoint[],
  map: ReturnType<typeof scaleVolumePoints>,
): string {
  if (points.length === 0) return "";
  return `M ${points.map((point) => `${map.x(point.t).toFixed(2)},${map.y(point.volumeUsd).toFixed(2)}`).join(" L ")}`;
}

export function DailyVolumeChart({
  history,
  deskVolume24hUsd,
}: {
  history: EquityVolumeHistoryResult;
  deskVolume24hUsd?: number | null;
}) {
  const [range, setRange] = useState<VolumeChartRangeId>("all");
  const [hover, setHover] = useState<VolumeHistoryPoint | null>(null);

  const points = useMemo(() => {
    const volume24h = deskVolume24hUsd !== undefined ? deskVolume24hUsd : history.volume24hUsd;
    const parsedGeneratedAt = Date.parse(history.generatedAt);
    const fallbackT = history.points[history.points.length - 1]?.t ?? 0;
    const nowT = Number.isFinite(parsedGeneratedAt) ? parsedGeneratedAt / 1000 : fallbackT;
    return alignLatestDayWithDesk24h(history.points, volume24h ?? null, nowT);
  }, [deskVolume24hUsd, history.generatedAt, history.points, history.volume24hUsd]);

  const visible = useMemo(() => filterVolumeRange(points, range), [points, range]);
  const map = useMemo(() => scaleVolumePoints(visible), [visible]);
  const latest = visible[visible.length - 1] ?? points[points.length - 1] ?? null;
  const displayed = hover ?? latest;
  const available = points.length > 0;
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((frac) => map.maxY * frac);
  const xTicks =
    visible.length > 1
      ? [0, 0.33, 0.66, 1].map((frac) => {
          const t = map.minT + (map.maxT - map.minT) * frac;
          const closest = nearestVolumePoint(visible, map, map.x(t));
          return closest?.t ?? t;
        })
      : visible[0]
        ? [visible[0].t]
        : [];

  function setHoverFromClient(plot: Element, clientX: number, clientY: number) {
    const svg = plot.querySelector("svg");
    const svgX = pointerToSvgX(
      clientX,
      clientY,
      svg?.getScreenCTM?.() ?? null,
      plot.getBoundingClientRect(),
    );
    if (svgX === null) return;
    setHover(nearestVolumePoint(visible, map, svgX));
  }

  return (
    <section className="rounded-xl border border-border bg-card/80 px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-[8px] leading-none font-medium tracking-tight">
            Total Daily Tokenized Stock Volume
          </h2>
          {available && displayed ? (
            <p
              className="num mt-1 text-3xl font-medium text-primary"
              aria-live="polite"
              data-volume-headline
              data-volume-kind={displayed.kind ?? "calendar_day"}
            >
              {formatUsdCompact(displayed.volumeUsd)}
            </p>
          ) : null}
        </div>
        {available ? (
          <div className="flex flex-wrap gap-1">
            {VOLUME_CHART_RANGES.map((row) => (
              <button
                key={row.id}
                type="button"
                onClick={() => {
                  setRange(row.id);
                  setHover(null);
                }}
                className={`rounded-md px-2 py-1 text-xs ${
                  range === row.id
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {row.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {available && visible.length > 0 ? (
        <div
          className="relative mt-3 cursor-crosshair"
          data-volume-plot
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
            aria-label="Daily Solana tokenized equity volume"
          >
            <defs>
              <linearGradient id="volume-area" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="var(--volume)" stopOpacity="0.38" />
                <stop offset="100%" stopColor="var(--volume)" stopOpacity="0.02" />
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
            {xTicks.map((tick, index) => (
              <text
                key={`${tick}-${index}`}
                x={map.x(tick)}
                y={VOLUME_CHART_HEIGHT - 8}
                textAnchor="middle"
                className="fill-muted-foreground"
                fontSize="10"
              >
                {formatChartTick(tick)}
              </text>
            ))}
            <path d={areaPath(visible, map)} fill="url(#volume-area)" pointerEvents="none" />
            <path
              d={linePath(visible, map)}
              fill="none"
              stroke="var(--volume)"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
              pointerEvents="none"
            />
            {hover ? (
              <g pointerEvents="none">
                <line
                  x1={map.x(hover.t)}
                  x2={map.x(hover.t)}
                  y1={VOLUME_CHART_PAD.top}
                  y2={VOLUME_CHART_PAD.top + VOLUME_CHART_INNER_H}
                  stroke="var(--volume)"
                  strokeOpacity="0.45"
                  strokeDasharray="3 3"
                />
                <circle cx={map.x(hover.t)} cy={map.y(hover.volumeUsd)} r="3.5" fill="var(--volume)" />
              </g>
            ) : null}
          </svg>
          <div
            aria-hidden="true"
            data-volume-overlay
            className="absolute inset-0 z-10 cursor-crosshair"
          />
          {hover ? (
            <div className="pointer-events-none absolute top-2 right-2 z-20 rounded-md border border-border bg-background/90 px-2.5 py-1.5 text-xs shadow-sm">
              <p className="text-muted-foreground">{volumeHeadlineCopy(hover).caption}</p>
              <p className="num mt-0.5 text-foreground">{formatUsdFull(hover.volumeUsd)}</p>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-4 flex h-[220px] items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 px-6 text-center">
          <p className="max-w-md text-sm text-muted-foreground">
            {history.emptyReason ?? "Historical volume series is unavailable. The desk does not invent points."}
          </p>
        </div>
      )}
    </section>
  );
}
