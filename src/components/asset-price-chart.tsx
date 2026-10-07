"use client";

import { useEffect, useId, useMemo, useState, type PointerEvent, type ReactNode } from "react";
import {
  ASSET_CHART_MODES,
  ASSET_PANEL_RANGE_IDS,
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
import { DESK_CHART_STROKE, monotoneAreaPath, monotoneLinePath } from "@/lib/desk/chart-curve";
import { selectAssetVolumeHeadline, selectAssetVolumeSeries } from "@/lib/market/asset-volume-headline";
import { ASSET_VOLUME_HISTORY_EMPTY_REASON, mergePolledCloses } from "@/lib/market/asset-price-history";
import { formatChartDate, formatPct, formatPrice, formatUsdCompact, formatUsdFull } from "@/lib/market/format";
import type {
  AssetChartMode,
  AssetPriceHistoryResult,
  PriceChartRangeId,
  PriceHistoryPoint,
  VolumeHistoryPoint,
} from "@/lib/market/types";
import { pointerToSvgX } from "@/lib/market/daily-volume-view";
import { Skeleton } from "@/components/ui/skeleton";

const PANEL_RANGES = PRICE_CHART_RANGES.filter((row) =>
  (ASSET_PANEL_RANGE_IDS as readonly string[]).includes(row.id),
);

function changeTone(value: number | null): "up" | "down" | "flat" {
  if (value === null || !Number.isFinite(value) || value === 0) return "flat";
  return value > 0 ? "up" : "down";
}

function pillClass(active: boolean): string {
  return `rounded-full px-2.5 py-1 text-xs ${
    active
      ? "bg-[#B7FF3C]/15 text-[#B7FF3C] ring-1 ring-[#B7FF3C]"
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
  allMarkets24hUsd = null,
  allMarketsSymbol = null,
  allMarketsHref = null,
  initialAllMarketsDaily = null,
  initialAllMarketsHourly = null,
  chartPending = false,
}: {
  header?: ReactNode;
  priceUsd: number | null;
  priceChange24hPct: number | null;
  history: AssetPriceHistoryResult;
  /** DexScreener sum of every pool's volume.h24. Null keeps the 24H label off all-markets. */
  allMarkets24hUsd?: number | null;
  /** Set for Solana so the volume series can fill from the background cache. */
  allMarketsSymbol?: string | null;
  /** Overrides the Solana poll URL. Robinhood Chain uses its own route. */
  allMarketsHref?: string | null;
  /** Warm daily cache from disk. Null means the client may poll. */
  initialAllMarketsDaily?: VolumeHistoryPoint[] | null;
  /** Warm hourly cache from disk. Null means the 24H line may still be the primary pool. */
  initialAllMarketsHourly?: VolumeHistoryPoint[] | null;
  /** Plot area is still loading. Header, range, and the DexScreener 24H total stay visible. */
  chartPending?: boolean;
}) {
  const [range, setRange] = useState<PriceChartRangeId>("24h");
  const [mode, setMode] = useState<AssetChartMode>("volume");
  const [hoverPrice, setHoverPrice] = useState<PriceHistoryPoint | null>(null);
  const [hoverVolume, setHoverVolume] = useState<VolumeHistoryPoint | null>(null);
  const [allMarketsDaily, setAllMarketsDaily] = useState<VolumeHistoryPoint[] | null>(initialAllMarketsDaily);
  const [allMarketsHourly, setAllMarketsHourly] = useState<VolumeHistoryPoint[] | null>(initialAllMarketsHourly);
  const [dailySettled, setDailySettled] = useState(initialAllMarketsDaily !== null);
  const [hourlySettled, setHourlySettled] = useState(initialAllMarketsHourly !== null);
  const [allMarketsFill, setAllMarketsFill] = useState<{ resolvedPools: number; totalPools: number } | null>(null);
  const [hourlyFill, setHourlyFill] = useState<{ resolvedPools: number; totalPools: number } | null>(null);
  const [observedDaily, setObservedDaily] = useState<VolumeHistoryPoint[] | null>(null);
  const [observedHourly, setObservedHourly] = useState<VolumeHistoryPoint[] | null>(null);
  const [polledCloses, setPolledCloses] = useState<{
    daily: PriceHistoryPoint[];
    hourly: PriceHistoryPoint[];
  } | null>(null);

  const pollHref =
    allMarketsHref ??
    (allMarketsSymbol
      ? `/api/solana/asset-all-markets-volume?symbol=${encodeURIComponent(allMarketsSymbol)}`
      : null);

  useEffect(() => {
    if (chartPending || !pollHref || (dailySettled && hourlySettled)) return;
    let cancelled = false;
    let timer = 0;

    const keep = (points: { t: number; volumeUsd: number }[]) =>
      points.filter(
        (point) =>
          Number.isFinite(point.t) &&
          point.t > 0 &&
          Number.isFinite(point.volumeUsd) &&
          point.volumeUsd >= 0,
      );

    const count = (value: unknown) =>
      typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;

    const tick = async () => {
      if (cancelled) return;
      let dailyDone = dailySettled;
      let hourlyDone = hourlySettled;
      try {
        const response = await fetch(pollHref, { cache: "no-store" });
        if (!response.ok) throw new Error("all-markets volume unavailable");
        const body = (await response.json()) as {
          pending?: boolean;
          complete?: boolean;
          daily?: { t: number; volumeUsd: number }[];
          resolvedPools?: number;
          totalPools?: number;
          hourly?: { t: number; volumeUsd: number }[];
          hourlyPending?: boolean;
          hourlyComplete?: boolean;
          hourlyResolvedPools?: number;
          hourlyTotalPools?: number;
          observedDaily?: { t: number; volumeUsd: number }[];
          observedHourly?: { t: number; volumeUsd: number }[];
          priceDaily?: { t: number; priceUsd: number }[];
          priceHourly?: { t: number; priceUsd: number }[];
        };
        if (cancelled) return;
        if (Array.isArray(body.observedDaily)) setObservedDaily(keep(body.observedDaily));
        if (Array.isArray(body.observedHourly)) setObservedHourly(keep(body.observedHourly));
        const keepPrices = (points: { t: number; priceUsd: number }[] | undefined) =>
          (points ?? []).filter(
            (point) =>
              Number.isFinite(point.t) &&
              point.t > 0 &&
              Number.isFinite(point.priceUsd) &&
              point.priceUsd > 0,
          );
        if (Array.isArray(body.priceDaily) || Array.isArray(body.priceHourly)) {
          setPolledCloses({
            daily: keepPrices(body.priceDaily),
            hourly: keepPrices(body.priceHourly),
          });
        }
        const dailyReady = body.complete === true && Array.isArray(body.daily);
        const dailyFailed = body.pending !== true && body.complete !== true;
        if (dailyReady) {
          setAllMarketsDaily(keep(body.daily ?? []));
          setDailySettled(true);
          setAllMarketsFill(null);
          dailyDone = true;
        } else if (body.pending === true) {
          setAllMarketsFill({ resolvedPools: count(body.resolvedPools), totalPools: count(body.totalPools) });
        } else if (dailyFailed) {
          setDailySettled(true);
          setAllMarketsFill(null);
          dailyDone = true;
        }

        const hourlyReady = body.hourlyComplete === true && Array.isArray(body.hourly);
        if (hourlyReady) {
          setAllMarketsHourly(keep(body.hourly ?? []));
          setHourlySettled(true);
          setHourlyFill(null);
          hourlyDone = true;
        } else if (body.hourlyPending === true) {
          setHourlyFill({
            resolvedPools: count(body.hourlyResolvedPools),
            totalPools: count(body.hourlyTotalPools),
          });
        } else if (dailyDone) {
          setHourlySettled(true);
          setHourlyFill(null);
          hourlyDone = true;
        }
      } catch {
        if (cancelled) return;
      }
      if (cancelled || (dailyDone && hourlyDone)) return;
      timer = window.setTimeout(() => {
        void tick();
      }, 3_000);
    };

    void tick();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [chartPending, pollHref, dailySettled, hourlySettled]);

  const plottedHistory = useMemo(() => mergePolledCloses(history, polledCloses), [history, polledCloses]);
  const nowT = useMemo(() => priceHistoryNowT(plottedHistory), [plottedHistory]);
  const visiblePrice = useMemo(
    () => filterPriceRange(plottedHistory, range, nowT),
    [plottedHistory, range, nowT],
  );
  const primaryVolume = useMemo(() => filterVolumeRange(history, range, nowT), [history, range, nowT]);
  const rangeSpec = PRICE_CHART_RANGES.find((row) => row.id === range);
  const resolutionMissing = range === "24h" ? history.hourlyVolume.length === 0 : history.dailyVolume.length === 0;
  const observedWindow = useMemo(
    () =>
      resolutionMissing
        ? filterVolumeRange(
            { dailyVolume: observedDaily ?? [], hourlyVolume: observedHourly ?? [] },
            range,
            nowT,
          )
        : [],
    [observedDaily, observedHourly, nowT, range, resolutionMissing],
  );
  const volumeSeries = useMemo(
    () =>
      selectAssetVolumeSeries({
        range,
        nowT,
        windowSeconds: rangeSpec?.seconds ?? 0,
        primaryPoolPoints: primaryVolume,
        allMarketsDaily,
        allMarketsHourly,
        observedPoints: observedWindow,
      }),
    [allMarketsDaily, allMarketsHourly, nowT, observedWindow, primaryVolume, range, rangeSpec?.seconds],
  );
  const visibleVolume = volumeSeries.points;
  const priceMap = useMemo(() => scalePricePoints(visiblePrice), [visiblePrice]);
  const volumeMap = useMemo(() => scaleVolumePoints(visibleVolume), [visibleVolume]);
  const isVolume = mode === "volume";
  const visible = isVolume ? visibleVolume : visiblePrice;
  const map = isVolume ? volumeMap : priceMap;
  const latestPrice = visiblePrice[visiblePrice.length - 1] ?? null;
  const latestVolume = visibleVolume[visibleVolume.length - 1] ?? null;
  const volumeHeadline = useMemo(
    () =>
      selectAssetVolumeHeadline({
        range,
        nowT,
        windowSeconds: rangeSpec?.seconds ?? 0,
        allMarkets24hUsd,
        primaryPoolPoints: primaryVolume,
        allMarketsDaily,
        observedPoints: observedWindow,
      }),
    [allMarkets24hUsd, allMarketsDaily, nowT, observedWindow, primaryVolume, range, rangeSpec?.seconds],
  );
  const dailyProgressLabel =
    isVolume &&
    (range === "7d" || range === "30d") &&
    (volumeSeries.scope === "primary_pool" || volumeSeries.scope === "observed_pools") &&
    allMarketsFill !== null &&
    allMarketsFill.totalPools > 0
      ? `${allMarketsFill.resolvedPools}/${allMarketsFill.totalPools} markets`
      : null;
  const hourlyProgressLabel =
    isVolume &&
    range === "24h" &&
    (volumeSeries.scope === "primary_pool" || volumeSeries.scope === "observed_pools") &&
    hourlyFill !== null &&
    hourlyFill.totalPools > 0
      ? `Chart ${hourlyFill.resolvedPools}/${hourlyFill.totalPools} markets`
      : null;
  const allMarketsProgressLabel = range === "24h" ? hourlyProgressLabel : dailyProgressLabel;
  const changePct = displayPriceChangePct({ range, visible: visiblePrice, priceChange24hPct });
  const areaGradientId = `assetChartArea${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const yOf = (point: { t: number }) =>
    isVolume
      ? volumeMap.y((point as VolumeHistoryPoint).volumeUsd)
      : priceMap.y((point as PriceHistoryPoint).priceUsd);
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
  const curve = visible.map((point) => ({ x: map.x(point.t), y: yOf(point) }));

  const emptyCopy = isVolume
    ? history.dailyVolume.length === 0 && history.hourlyVolume.length === 0 && observedWindow.length === 0
      ? ASSET_VOLUME_HISTORY_EMPTY_REASON
      : "No GeckoTerminal volume in this window. The desk does not invent points."
    : (plottedHistory.emptyReason ??
      (plottedHistory.available
        ? "No GeckoTerminal closes in this window. The desk does not invent points."
        : "Historical close series is unavailable. The desk does not invent prices."));

  return (
    <section
      className="rounded-xl border border-border bg-card/80 px-4 py-4 sm:px-5"
      data-volume-series-scope={isVolume ? volumeSeries.scope : undefined}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">{header}</div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex flex-wrap justify-end gap-1" role="tablist" aria-label="Price range">
            {PANEL_RANGES.map((row) => {
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
            <p className="num text-3xl font-medium tracking-tight text-foreground sm:text-4xl" data-asset-volume>
              {volumeHeadline.volumeUsd !== null ? formatUsdCompact(volumeHeadline.volumeUsd) : "—"}
            </p>
            <p className="text-sm text-muted-foreground" data-volume-label data-volume-scope={volumeHeadline.scope}>
              {volumeHeadline.label}
            </p>
            {allMarketsProgressLabel ? (
              <p className="w-full text-xs text-muted-foreground" data-all-markets-progress>
                {allMarketsProgressLabel}
              </p>
            ) : null}
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

      {chartPending ? (
        <div
          className="mt-3 h-[220px] sm:h-[260px]"
          aria-busy="true"
          aria-label="Loading chart"
          data-chart-pending
        >
          <Skeleton className="h-full w-full" />
        </div>
      ) : hasSeries ? (
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
                ? volumeSeries.scope === "all_markets"
                  ? range === "24h"
                    ? "Observed hourly USD volume summed across every pool for this mint."
                    : "Observed daily USD volume summed across every pool for this mint."
                  : volumeSeries.scope === "observed_pools"
                    ? "Observed USD volume summed across pools that returned candles. Pools with no candle stay out of the sum."
                    : "Observed USD volume for this mint’s primary pool."
                : "Observed USD close prices for this mint’s primary pool."
            }
          >
            <defs>
              <linearGradient id={areaGradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={DESK_CHART_STROKE} stopOpacity="0.38" />
                <stop offset="55%" stopColor={DESK_CHART_STROKE} stopOpacity="0.12" />
                <stop offset="100%" stopColor={DESK_CHART_STROKE} stopOpacity="0" />
              </linearGradient>
            </defs>
            <rect x={0} y={0} width={PRICE_CHART_WIDTH} height={PRICE_CHART_HEIGHT} fill="transparent" />
            {visible.length > 1 ? (
              <path
                d={monotoneAreaPath(curve, PRICE_CHART_PAD.top + PRICE_CHART_INNER_H)}
                fill={`url(#${areaGradientId})`}
                stroke="none"
              />
            ) : null}
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
            {xTicks.map((tick, index) => {
              const label = formatPriceChartTick(tick, range);
              return (
                <text
                  key={`${tick}-${index}`}
                  x={map.x(tick)}
                  y={PRICE_CHART_HEIGHT - 8}
                  textAnchor="middle"
                  className="fill-muted-foreground"
                  fontSize="10"
                  data-asset-axis-tick={label}
                >
                  {label}
                </text>
              );
            })}
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
                d={monotoneLinePath(curve)}
                fill="none"
                stroke={DESK_CHART_STROKE}
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
                fill={DESK_CHART_STROKE}
              />
            ) : null}
            {hoverT !== undefined && hoverY !== null ? (
              <g pointerEvents="none">
                <line
                  x1={map.x(hoverT)}
                  x2={map.x(hoverT)}
                  y1={PRICE_CHART_PAD.top}
                  y2={PRICE_CHART_PAD.top + PRICE_CHART_INNER_H}
                  stroke={DESK_CHART_STROKE}
                  strokeOpacity="0.45"
                  strokeDasharray="3 3"
                />
                <circle cx={map.x(hoverT)} cy={hoverY} r="3.5" fill={DESK_CHART_STROKE} />
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
