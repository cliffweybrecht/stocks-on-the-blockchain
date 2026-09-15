"use client";

import { useMemo, useState, type PointerEvent, type ReactNode } from "react";
import {
  ASSET_CHART_MODES,
  displayPriceChangePct,
  filterPriceRange,
  filterVolumeRange,
  formatPriceChartTick,
  nearestPricePoint,
  nearestVolumePoint,
  PRICE_CHART_HEIGHT,
  PRICE_CHART_INNER_H,
  PRICE_CHART_PAD,
  PRICE_CHART_RANGES,
  PRICE_CHART_WIDTH,
  priceHistoryNowT,
  scalePricePoints,
  scaleVolumePoints,
} from "@/lib/desk/asset-price-view";
import { ASSET_VOLUME_HISTORY_EMPTY_REASON } from "@/lib/market/asset-price-history";
import { formatChartDate, formatPct, formatPrice, formatUsdCompact, formatUsdFull } from "@/lib/market/format";
import type {
  AssetChartMode,
  AssetPriceHistoryResult,
  PriceChartRangeId,
  PriceHistoryPoint,
  VolumeHistoryPoint,
} from "@/lib/market/types";
import { pointerToSvgX } from "@/lib/market/daily-volume-view";

function linePath(
  points: readonly { t: number }[],
  map: ReturnType<typeof scalePricePoints>,
  yOf: (point: { t: number }) => number,
): string {
  if (points.length === 0) return "";
  return `M ${points.map((point) => `${map.x(point.t).toFixed(2)},${yOf(point).toFixed(2)}`).join(" L ")}`;
}

function changeTone(value: number | null): "up" | "down" | "flat" {
  if (value === null || !Number.isFinite(value) || value === 0) return "flat";
  return value > 0 ? "up" : "down";
}

function pillClass(active: boolean): string {
  return `rounded-full px-2.5 py-1 text-xs ${
    active
      ? "bg-muted text-foreground ring-1 ring-border"
      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
  }`;
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
  const [mode, setMode] = useState<AssetChartMode>("price");
  const [hoverPrice, setHoverPrice] = useState<PriceHistoryPoint | null>(null);
  const [hoverVolume, setHoverVolume] = useState<VolumeHistoryPoint | null>(null);

  const nowT = useMemo(() => priceHistoryNowT(history), [history]);
  const visiblePrice = useMemo(() => filterPriceRange(history, range, nowT), [history, range, nowT]);
  const visibleVolume = useMemo(() => filterVolumeRange(history, range, nowT), [history, range, nowT]);
  const priceMap = useMemo(() => scalePricePoints(visiblePrice), [visiblePrice]);
  const volumeMap = useMemo(() => scaleVolumePoints(visibleVolume), [visibleVolume]);
  const isVolume = mode === "volume";
  const visible = isVolume ? visibleVolume : visiblePrice;
  const map = isVolume ? volumeMap : priceMap;
  const latestPrice = visiblePrice[visiblePrice.length - 1] ?? null;
  const latestVolume = visibleVolume[visibleVolume.length - 1] ?? null;
  const changePct = displayPriceChangePct({ range, visible: visiblePrice, priceChange24hPct });
  const tone = changeTone(changePct);
  const stroke = isVolume
    ? "var(--volume)"
    : tone === "up"
      ? "var(--price-up)"
      : tone === "down"
        ? "var(--price-down)"
        : "var(--muted-foreground)";
  const hasSeries = visible.length > 0;
  const yTicks = isVolume
    ? [0, 0.33, 0.66, 1].map((frac) => volumeMap.maxY * frac)
    : [0, 0.33, 0.66, 1].map((frac) => priceMap.minY + (priceMap.maxY - priceMap.minY) * frac);
  const xTicks =
    visible.length > 1
      ? [0, 0.33, 0.66, 1].map((frac) => {
          const t = map.minT + (map.maxT - map.minT) * frac;
          const closest = isVolume
            ? nearestVolumePoint(visibleVolume, volumeMap, volumeMap.x(t))
            : nearestPricePoint(visiblePrice, priceMap, priceMap.x(t));
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
    if (isVolume) {
      setHoverVolume(nearestVolumePoint(visibleVolume, volumeMap, svgX));
      setHoverPrice(null);
      return;
    }
    setHoverPrice(nearestPricePoint(visiblePrice, priceMap, svgX));
    setHoverVolume(null);
  }

  const hoverT = isVolume ? hoverVolume?.t : hoverPrice?.t;
  const hoverY = isVolume
    ? hoverVolume
      ? volumeMap.y(hoverVolume.volumeUsd)
      : null
    : hoverPrice
      ? priceMap.y(hoverPrice.priceUsd)
      : null;
  const latestY = isVolume
    ? latestVolume
      ? volumeMap.y(latestVolume.volumeUsd)
      : null
    : latestPrice
      ? priceMap.y(latestPrice.priceUsd)
      : null;

  const emptyCopy = isVolume
    ? history.dailyVolume.length === 0 && history.hourlyVolume.length === 0
      ? ASSET_VOLUME_HISTORY_EMPTY_REASON
      : "No GeckoTerminal volume in this window. The desk does not invent points."
    : (history.emptyReason ??
      (history.available
        ? "No GeckoTerminal closes in this window. The desk does not invent points."
        : "Historical close series is unavailable. The desk does not invent prices."));

  return (
    <section className="rounded-xl border border-border bg-card/80 px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">{header}</div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex flex-wrap justify-end gap-1" role="tablist" aria-label="Price range">
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
                    setHoverPrice(null);
                    setHoverVolume(null);
                  }}
                  className={pillClass(active)}
                >
                  {row.label}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap justify-end gap-1" role="tablist" aria-label="Chart series">
            {ASSET_CHART_MODES.map((row) => {
              const active = mode === row.id;
              return (
                <button
                  key={row.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  data-chart-mode={row.id}
                  onClick={() => {
                    setMode(row.id);
                    setHoverPrice(null);
                    setHoverVolume(null);
                  }}
                  className={pillClass(active)}
                >
                  {row.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-x-3 gap-y-1">
        {isVolume ? (
          <>
            <p className="num text-3xl font-medium tracking-tight sm:text-4xl" data-asset-volume>
              {latestVolume ? formatUsdCompact(latestVolume.volumeUsd) : "—"}
            </p>
            <p className="text-sm text-muted-foreground">Pool USD volume</p>
          </>
        ) : (
          <>
            <p className="num text-3xl font-medium tracking-tight sm:text-4xl" data-asset-spot>
              {formatPrice(priceUsd)}
            </p>
            {changePct !== null ? <PriceChangeText value={changePct} className="text-sm sm:text-base" /> : null}
          </>
        )}
      </div>

      {hasSeries ? (
        <div
          className="relative mt-3 cursor-crosshair"
          data-price-plot={isVolume ? undefined : true}
          data-volume-plot={isVolume ? true : undefined}
          onPointerLeave={() => {
            setHoverPrice(null);
            setHoverVolume(null);
          }}
          onMouseLeave={() => {
            setHoverPrice(null);
            setHoverVolume(null);
          }}
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
            aria-label={
              isVolume
                ? "Observed USD volume for this mint’s primary pool."
                : "Observed USD close prices for this mint’s primary pool."
            }
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
                  {isVolume ? formatUsdCompact(tick) : formatPrice(tick)}
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
            {latestY !== null ? (
              <text
                x={PRICE_CHART_WIDTH - PRICE_CHART_PAD.right + 8}
                y={latestY + 3}
                className="fill-muted-foreground"
                fontSize="10"
              >
                {isVolume && latestVolume
                  ? formatUsdCompact(latestVolume.volumeUsd)
                  : latestPrice
                    ? formatPrice(latestPrice.priceUsd)
                    : ""}
              </text>
            ) : null}
            {visible.length > 1 ? (
              <path
                d={linePath(visible, map, (point) =>
                  isVolume
                    ? volumeMap.y((point as VolumeHistoryPoint).volumeUsd)
                    : priceMap.y((point as PriceHistoryPoint).priceUsd),
                )}
                fill="none"
                stroke={stroke}
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
                pointerEvents="none"
              />
            ) : latestY !== null ? (
              <circle
                cx={map.x(isVolume ? latestVolume!.t : latestPrice!.t)}
                cy={latestY}
                r="3.5"
                fill={stroke}
              />
            ) : null}
            {hoverT !== undefined && hoverY !== null ? (
              <g pointerEvents="none">
                <line
                  x1={map.x(hoverT)}
                  x2={map.x(hoverT)}
                  y1={PRICE_CHART_PAD.top}
                  y2={PRICE_CHART_PAD.top + PRICE_CHART_INNER_H}
                  stroke={stroke}
                  strokeOpacity="0.45"
                  strokeDasharray="3 3"
                />
                <circle cx={map.x(hoverT)} cy={hoverY} r="3.5" fill={stroke} />
              </g>
            ) : null}
          </svg>
          <div aria-hidden="true" data-price-overlay className="absolute inset-0 z-10 cursor-crosshair" />
          {hoverPrice && !isVolume ? (
            <div className="pointer-events-none absolute top-2 right-2 z-20 rounded-md border border-border bg-background/90 px-2.5 py-1.5 text-xs shadow-sm">
              <p className="text-muted-foreground">
                {range === "24h" ? formatPriceChartTick(hoverPrice.t, "24h") : formatChartDate(hoverPrice.t)}
              </p>
              <p className="num mt-0.5 text-foreground">{formatPrice(hoverPrice.priceUsd)}</p>
            </div>
          ) : null}
          {hoverVolume && isVolume ? (
            <div className="pointer-events-none absolute top-2 right-2 z-20 rounded-md border border-border bg-background/90 px-2.5 py-1.5 text-xs shadow-sm">
              <p className="text-muted-foreground">
                {range === "24h" ? formatPriceChartTick(hoverVolume.t, "24h") : formatChartDate(hoverVolume.t)}
              </p>
              <p className="num mt-0.5 text-foreground">{formatUsdFull(hoverVolume.volumeUsd)}</p>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-4 flex h-[200px] items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 px-6 text-center">
          <p className="max-w-md text-sm text-muted-foreground">{emptyCopy}</p>
        </div>
      )}
    </section>
  );
}
