"use client";

import { useMemo, useState, type PointerEvent, type ReactNode } from "react";
import {
  displayPriceChangePct,
  filterPriceRange,
  formatPriceChartTick,
  nearestPricePoint,
  PRICE_CHART_HEIGHT,
  PRICE_CHART_INNER_H,
  PRICE_CHART_PAD,
  PRICE_CHART_RANGES,
  PRICE_CHART_WIDTH,
  priceHistoryNowT,
  scalePricePoints,
} from "@/lib/desk/asset-price-view";
import { formatChartDate, formatPct, formatPrice } from "@/lib/market/format";
import type { AssetPriceHistoryResult, PriceChartRangeId, PriceHistoryPoint } from "@/lib/market/types";
import { pointerToSvgX } from "@/lib/market/daily-volume-view";

function linePath(
  points: readonly PriceHistoryPoint[],
  map: ReturnType<typeof scalePricePoints>,
): string {
  if (points.length === 0) return "";
  return `M ${points.map((point) => `${map.x(point.t).toFixed(2)},${map.y(point.priceUsd).toFixed(2)}`).join(" L ")}`;
}

function changeTone(value: number | null): "up" | "down" | "flat" {
  if (value === null || !Number.isFinite(value) || value === 0) return "flat";
  return value > 0 ? "up" : "down";
}

export function PriceChangeText({
  value,
  className = "",
}: {
  value: number | null;
  className?: string;
}) {
  const tone = changeTone(value);
  const toneClass =
    tone === "up" ? "text-price-up" : tone === "down" ? "text-price-down" : "text-muted-foreground";
  return (
    <span className={`num ${toneClass} ${className}`.trim()} data-price-change={tone}>
      {formatPct(value)}
    </span>
  );
}

export function AssetMarketPanel({
  header,
  priceUsd,
  priceChange24hPct,
  history,
}: {
  header?: ReactNode;
  priceUsd: number | null;
  priceChange24hPct: number | null;
  history: AssetPriceHistoryResult;
}) {
  const [range, setRange] = useState<PriceChartRangeId>("24h");
  const [hover, setHover] = useState<PriceHistoryPoint | null>(null);

  const nowT = useMemo(() => priceHistoryNowT(history), [history]);
  const visible = useMemo(() => filterPriceRange(history, range, nowT), [history, range, nowT]);
  const map = useMemo(() => scalePricePoints(visible), [visible]);
  const latest = visible[visible.length - 1] ?? null;
  const changePct = displayPriceChangePct({ range, visible, priceChange24hPct });
  const tone = changeTone(changePct);
  const stroke =
    tone === "up" ? "var(--price-up)" : tone === "down" ? "var(--price-down)" : "var(--muted-foreground)";
  const hasSeries = visible.length > 0;
  const yTicks = [0, 0.33, 0.66, 1].map((frac) => map.minY + (map.maxY - map.minY) * frac);
  const xTicks =
    visible.length > 1
      ? [0, 0.33, 0.66, 1].map((frac) => {
          const t = map.minT + (map.maxT - map.minT) * frac;
          const closest = nearestPricePoint(visible, map, map.x(t));
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
      PRICE_CHART_WIDTH,
    );
    if (svgX === null) return;
    setHover(nearestPricePoint(visible, map, svgX));
  }

  return (
    <section className="rounded-xl border border-border bg-card/80 px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">{header}</div>
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Price range">
          {PRICE_CHART_RANGES.map((row) => {
            const active = range === row.id;
            return (
              <button
                key={row.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  setRange(row.id);
                  setHover(null);
                }}
                className={`rounded-full px-2.5 py-1 text-xs ${
                  active
                    ? "bg-muted text-foreground ring-1 ring-border"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                }`}
              >
                {row.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-x-3 gap-y-1">
        <p className="num text-3xl font-medium tracking-tight sm:text-4xl" data-asset-spot>
          {formatPrice(priceUsd)}
        </p>
        {changePct !== null ? <PriceChangeText value={changePct} className="text-sm sm:text-base" /> : null}
      </div>

      {hasSeries ? (
        <div
          className="relative mt-3 cursor-crosshair"
          data-price-plot
          onPointerLeave={() => setHover(null)}
          onMouseLeave={() => setHover(null)}
          onPointerMove={(event: PointerEvent<HTMLDivElement>) =>
            setHoverFromClient(event.currentTarget, event.clientX, event.clientY)
          }
          onMouseMove={(event) => setHoverFromClient(event.currentTarget, event.clientX, event.clientY)}
        >
          <svg
            viewBox={`0 0 ${PRICE_CHART_WIDTH} ${PRICE_CHART_HEIGHT}`}
            preserveAspectRatio="none"
            className="pointer-events-none h-[220px] w-full touch-none sm:h-[260px]"
            role="img"
            aria-label="Observed USD close prices for this mint’s primary pool."
          >
            <rect x={0} y={0} width={PRICE_CHART_WIDTH} height={PRICE_CHART_HEIGHT} fill="transparent" />
            {yTicks.map((tick) => (
              <g key={tick}>
                <line
                  x1={PRICE_CHART_PAD.left}
                  x2={PRICE_CHART_WIDTH - PRICE_CHART_PAD.right}
                  y1={map.y(tick)}
                  y2={map.y(tick)}
                  stroke="currentColor"
                  className="text-border"
                  strokeWidth="1"
                />
                <text
                  x={PRICE_CHART_PAD.left - 8}
                  y={map.y(tick) + 3}
                  textAnchor="end"
                  className="fill-muted-foreground"
                  fontSize="10"
                >
                  {formatPrice(tick)}
                </text>
              </g>
            ))}
            {xTicks.map((tick, index) => (
              <text
                key={`${tick}-${index}`}
                x={map.x(tick)}
                y={PRICE_CHART_HEIGHT - 8}
                textAnchor="middle"
                className="fill-muted-foreground"
                fontSize="10"
              >
                {formatPriceChartTick(tick, range)}
              </text>
            ))}
            {latest ? (
              <text
                x={PRICE_CHART_WIDTH - PRICE_CHART_PAD.right + 8}
                y={map.y(latest.priceUsd) + 3}
                className="fill-muted-foreground"
                fontSize="10"
              >
                {formatPrice(latest.priceUsd)}
              </text>
            ) : null}
            {visible.length > 1 ? (
              <path
                d={linePath(visible, map)}
                fill="none"
                stroke={stroke}
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
                pointerEvents="none"
              />
            ) : latest ? (
              <circle cx={map.x(latest.t)} cy={map.y(latest.priceUsd)} r="3.5" fill={stroke} />
            ) : null}
            {hover ? (
              <g pointerEvents="none">
                <line
                  x1={map.x(hover.t)}
                  x2={map.x(hover.t)}
                  y1={PRICE_CHART_PAD.top}
                  y2={PRICE_CHART_PAD.top + PRICE_CHART_INNER_H}
                  stroke={stroke}
                  strokeOpacity="0.45"
                  strokeDasharray="3 3"
                />
                <circle cx={map.x(hover.t)} cy={map.y(hover.priceUsd)} r="3.5" fill={stroke} />
              </g>
            ) : null}
          </svg>
          <div aria-hidden="true" data-price-overlay className="absolute inset-0 z-10 cursor-crosshair" />
          {hover ? (
            <div className="pointer-events-none absolute top-2 right-2 z-20 rounded-md border border-border bg-background/90 px-2.5 py-1.5 text-xs shadow-sm">
              <p className="text-muted-foreground">
                {range === "24h" ? formatPriceChartTick(hover.t, "24h") : formatChartDate(hover.t)}
              </p>
              <p className="num mt-0.5 text-foreground">{formatPrice(hover.priceUsd)}</p>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-4 flex h-[200px] items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 px-6 text-center">
          <p className="max-w-md text-sm text-muted-foreground">
            {history.emptyReason ??
              (history.available
                ? "No GeckoTerminal closes in this window. The desk does not invent points."
                : "Historical close series is unavailable. The desk does not invent prices.")}
          </p>
        </div>
      )}
    </section>
  );
}
