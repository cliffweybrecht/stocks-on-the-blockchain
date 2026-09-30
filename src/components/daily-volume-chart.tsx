"use client";

import { useMemo, useState, type PointerEvent } from "react";
import {
  filterVolumeRange,
  formatVolumeChartTick,
  nearestVolumePoint,
  pointerToSvgX,
  scaleVolumePoints,
  deskRangeVolumeHeadline,
  volumeChartXTicks,
  VOLUME_CHART_HEIGHT,
  VOLUME_CHART_INNER_H,
  VOLUME_CHART_PAD,
  VOLUME_CHART_RANGES,
  VOLUME_CHART_WIDTH,
  type VolumeChartRangeId,
} from "@/lib/market/daily-volume-view";
import { formatChartDay, formatUsdCompact, formatUsdFull } from "@/lib/market/format";
import type { EquityVolumeHistoryResult, VolumeHistoryPoint } from "@/lib/market/types";
import { closedSnapshotVolumePoints } from "@/lib/market/volume-snapshots";

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
  hourlyHistory = null,
}: {
  history: EquityVolumeHistoryResult;
  /**
   * Last ~24 Eastern hours of DexScreener rolling h24 desk totals for 24H mode.
   * Plot `hourlyHistory.points` (`kind: "rolling_24h"`, y = `combined24hUsd`, x = Eastern hour start).
   * 7D/14D/30D keep using closed days from `history`.
   */
  hourlyHistory?: EquityVolumeHistoryResult | null;
}) {
  const [range, setRange] = useState<VolumeChartRangeId>("7d");
  const [hover, setHover] = useState<VolumeHistoryPoint | null>(null);

  const points = useMemo(() => {
    const parsedGeneratedAt = Date.parse(history.generatedAt);
    const fallbackT = history.points[history.points.length - 1]?.t ?? 0;
    const nowT = Number.isFinite(parsedGeneratedAt) ? parsedGeneratedAt / 1000 : fallbackT;
    // Closed snapshot days only. A rolling ~24h tip is not an Eastern snapshot day.
    return closedSnapshotVolumePoints(history.points, nowT);
  }, [history.generatedAt, history.points]);

  const visible = useMemo(() => filterVolumeRange(points, range), [points, range]);
  const map = useMemo(() => scaleVolumePoints(visible), [visible]);
  const headline = deskRangeVolumeHeadline(visible, range);
  const hasSeries = points.length > 0;
  const showHeadline = headline.volumeUsd !== null;
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((frac) => map.maxY * frac);
  const xTicks = volumeChartXTicks(visible);

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
    <section
      className="rounded-xl border border-border bg-card/80 px-4 py-4 sm:px-5"
      data-hourly-rolling-count={hourlyHistory?.points.length ?? 0}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-[9px] leading-tight font-medium tracking-wide text-foreground/90">
            Total Daily Tokenized Stock Volume
          </h2>
          {showHeadline ? (
            <>
              <p
                className="num mt-1 text-3xl font-medium text-primary"
                aria-live="polite"
                data-volume-headline
                data-volume-kind={headline.kind}
              >
                {formatUsdCompact(headline.volumeUsd)}
              </p>
              <p className="mt-1 text-[11px] leading-snug text-muted-foreground" data-volume-caption>
                {headline.caption}
              </p>
            </>
          ) : null}
        </div>
        {hasSeries ? (
          <div className="flex flex-wrap gap-1">
            {VOLUME_CHART_RANGES.map((row) => (
              <button
                key={row.id}
                type="button"
                data-volume-range={row.id}
                aria-pressed={range === row.id}
                onClick={() => {
                  setRange(row.id);
                  setHover(null);
                }}
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  range === row.id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {row.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {hasSeries && visible.length > 0 ? (
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
            aria-label="Daily Solana tokenized stock volume from desk DexScreener snapshots. Headline is the sum of snapshot days in the selected range."
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
                  data-volume-tick={label}
                >
                  {label}
                </text>
              );
            })}
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
            <div
              className="pointer-events-none absolute top-2 right-2 z-20 rounded-md border border-border bg-background/95 px-2 py-1 text-xs shadow-sm"
              data-volume-tooltip
            >
              <p data-volume-tooltip-day>{formatChartDay(hover.t)}</p>
              <p className="num text-foreground" data-volume-tooltip-value>
                {formatUsdFull(hover.volumeUsd)}
              </p>
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
      {hasSeries ? (
        <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
          History from closed desk DexScreener snapshots. The in-progress Eastern day is omitted until that America/New_York date has closed.
        </p>
      ) : null}
    </section>
  );
}
