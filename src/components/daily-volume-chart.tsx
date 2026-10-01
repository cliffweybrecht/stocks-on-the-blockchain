"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import {
  deskChartHeadline,
  filterVolumeRange,
  formatDeltaUsdCompact,
  formatDeltaUsdFull,
  formatHourlyVolumeChartTick,
  formatVolumeChartTick,
  hourlyRollingVolumeDeltas,
  hourlyVolumeChartXTicks,
  HOURLY_VOLUME_DELTA_ARIA,
  HOURLY_VOLUME_DELTA_CAPTION,
  HOURLY_VOLUME_DELTA_EMPTY,
  isRollingVolumeChartRange,
  nearestVolumePoint,
  plottableHourlyRollingPoints,
  pointerToSvgX,
  scaleVolumePoints,
  volumeChartXTicks,
  volumeDeltaYTicks,
  VOLUME_CHART_HEIGHT,
  VOLUME_CHART_INNER_H,
  VOLUME_CHART_INNER_W,
  VOLUME_CHART_PAD,
  VOLUME_CHART_RANGES,
  VOLUME_CHART_WIDTH,
  type DeskRolling24hVolumes,
  type HourlyRollingDeltaPoint,
  type VolumeChartRangeId,
  type VolumeChartScale,
} from "@/lib/market/daily-volume-view";
import {
  DESK_VOLUME_24H_LIVE_PATH,
  DESK_VOLUME_24H_POLL_MS,
  deskVolumePollDue,
  parseDeskVolumeLivePayload,
  preferFresherHourlyHistory,
} from "@/lib/market/desk-volume-live";
import { formatChartDay, formatUsdCompact, formatUsdFull } from "@/lib/market/format";
import type { EquityVolumeHistoryResult, VolumeHistoryPoint } from "@/lib/market/types";
import { easternRollingHourStarts } from "@/lib/market/volume-hourly-snapshots";
import { closedSnapshotVolumePoints } from "@/lib/market/volume-snapshots";

/** Lime for an up hour. Down hours use the desk price-down token. */
const POSITIVE_DELTA = "#B7FF3C";
const NEGATIVE_DELTA = "var(--price-down)";

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

/** Width of one delta bar. Capped so a short series does not paint a slab. */
function deltaBarWidth(count: number): number {
  if (count <= 1) return 16;
  const slot = VOLUME_CHART_INNER_W / Math.max(count - 1, 1);
  return Math.max(4, Math.min(18, slot * 0.58));
}

function deltaBarX(center: number, width: number): number {
  const left = VOLUME_CHART_PAD.left;
  const right = VOLUME_CHART_WIDTH - VOLUME_CHART_PAD.right - width;
  return Math.min(Math.max(center - width / 2, left), right);
}

function deltaSign(value: number): "up" | "down" | "flat" {
  if (value > 0) return "up";
  if (value < 0) return "down";
  return "flat";
}

function DeltaBars({
  points,
  map,
  width,
  hoverT,
}: {
  points: readonly HourlyRollingDeltaPoint[];
  map: VolumeChartScale;
  width: number;
  hoverT: number | null;
}) {
  const zeroY = map.y(0);
  const plotRight = VOLUME_CHART_WIDTH - VOLUME_CHART_PAD.right;
  return (
    <g data-volume-deltas="true">
      <line
        x1={VOLUME_CHART_PAD.left}
        x2={plotRight}
        y1={zeroY}
        y2={zeroY}
        stroke="currentColor"
        className="text-foreground/55"
        strokeWidth="1.25"
        data-volume-zero="true"
        pointerEvents="none"
      />
      {points.map((point) => {
        const x = deltaBarX(map.x(point.t), width);
        const sign = deltaSign(point.volumeUsd);
        const hovered = hoverT === point.t;
        if (sign === "flat") {
          return (
            <line
              key={point.t}
              x1={x}
              x2={x + width}
              y1={zeroY}
              y2={zeroY}
              stroke="currentColor"
              className="text-muted-foreground"
              strokeWidth="2.5"
              data-volume-bar="true"
              data-volume-t={point.t}
              data-volume-delta={point.volumeUsd}
              data-volume-sign="flat"
              pointerEvents="none"
            />
          );
        }
        const valueY = map.y(point.volumeUsd);
        const height = Math.max(Math.abs(valueY - zeroY), 1.25);
        const y = point.volumeUsd > 0 ? zeroY - height : zeroY;
        return (
          <rect
            key={point.t}
            x={x}
            y={y}
            width={width}
            height={height}
            rx={1.5}
            fill={sign === "up" ? POSITIVE_DELTA : NEGATIVE_DELTA}
            fillOpacity={sign === "up" ? 1 : 0.82}
            stroke={hovered ? "currentColor" : "transparent"}
            className={hovered ? "text-foreground" : undefined}
            strokeWidth={hovered ? 1 : 0}
            data-volume-bar="true"
            data-volume-t={point.t}
            data-volume-delta={point.volumeUsd}
            data-volume-sign={sign}
            pointerEvents="none"
          />
        );
      })}
    </g>
  );
}

export function DailyVolumeChart({
  history,
  hourlyHistory: hourlyHistoryProp = null,
  rolling24h: rolling24hProp = null,
  initialRange = "7d",
}: {
  history: EquityVolumeHistoryResult;
  /**
   * Last ~24 Eastern hours of DexScreener h24 desk totals.
   * 24H plots hour-over-hour change of these captures, not the absolute level.
   * 7D/14D/30D keep using closed days from `history`. Do not pass these points through closedSnapshotVolumePoints.
   */
  hourlyHistory?: EquityVolumeHistoryResult | null;
  /** Live Solana ChainVolume 24h legs. Used only for the 24H headline. */
  rolling24h?: DeskRolling24hVolumes | null;
  /** Closed-day ranges stay the default. Tests pin 24H without a click. */
  initialRange?: VolumeChartRangeId;
}) {
  const [range, setRange] = useState<VolumeChartRangeId>(initialRange);
  const [hover, setHover] = useState<VolumeHistoryPoint | null>(null);
  const [hourlyHistory, setHourlyHistory] = useState(hourlyHistoryProp);
  const [rolling24h, setRolling24h] = useState(rolling24hProp);
  const rollingFromPoll = useRef(false);
  const rolling = isRollingVolumeChartRange(range);

  useEffect(() => {
    setHourlyHistory((current) => preferFresherHourlyHistory(current, hourlyHistoryProp));
  }, [hourlyHistoryProp]);

  useEffect(() => {
    if (rollingFromPoll.current) return;
    setRolling24h(rolling24hProp ?? null);
  }, [rolling24hProp]);

  useEffect(() => {
    if (!rolling) return;
    let cancelled = false;
    let timer = 0;
    let lastPull = 0;

    const pull = async () => {
      const now = Date.now();
      if (!deskVolumePollDue(now, lastPull)) return;
      lastPull = now;
      try {
        const response = await fetch(DESK_VOLUME_24H_LIVE_PATH, { cache: "no-store" });
        if (!response.ok) return;
        const parsed = parseDeskVolumeLivePayload(await response.json());
        if (!parsed || cancelled) return;
        setHourlyHistory((current) => preferFresherHourlyHistory(current, parsed.hourlyHistory));
        if (parsed.rolling24h) {
          rollingFromPoll.current = true;
          setRolling24h(parsed.rolling24h);
        }
      } catch {
        // Keep the last headline and bars. A failed poll must not clear captured hours.
      }
    };

    const arm = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (cancelled || document.visibilityState === "hidden") return;
        void pull().finally(() => {
          if (!cancelled && document.visibilityState !== "hidden") arm();
        });
      }, DESK_VOLUME_24H_POLL_MS);
    };

    const onWake = () => {
      if (document.visibilityState === "hidden") {
        window.clearTimeout(timer);
        return;
      }
      void pull();
      arm();
    };

    onWake();
    window.addEventListener("focus", onWake);
    document.addEventListener("visibilitychange", onWake);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.removeEventListener("focus", onWake);
      document.removeEventListener("visibilitychange", onWake);
    };
  }, [rolling]);

  const points = useMemo(() => {
    const parsedGeneratedAt = Date.parse(history.generatedAt);
    const fallbackT = history.points[history.points.length - 1]?.t ?? 0;
    const nowT = Number.isFinite(parsedGeneratedAt) ? parsedGeneratedAt / 1000 : fallbackT;
    // Closed snapshot days only. A rolling ~24h tip is not an Eastern snapshot day.
    return closedSnapshotVolumePoints(history.points, nowT);
  }, [history.generatedAt, history.points]);

  const hourlyNowT = useMemo(() => {
    const parsed = Date.parse(hourlyHistory?.generatedAt ?? "");
    return Number.isFinite(parsed) && parsed > 0 ? parsed / 1000 : 0;
  }, [hourlyHistory?.generatedAt]);
  const hourSlots = useMemo(() => easternRollingHourStarts(hourlyNowT), [hourlyNowT]);
  const hourSlotSet = useMemo(() => new Set(hourSlots), [hourSlots]);
  const hourlyCaptures = useMemo(
    () =>
      plottableHourlyRollingPoints(hourlyHistory?.points ?? []).filter((point) => hourSlotSet.has(point.t)),
    [hourlyHistory, hourSlotSet],
  );
  const capturedHours = useMemo(() => new Set(hourlyCaptures.map((point) => point.t)), [hourlyCaptures]);
  const hourlyDeltas = useMemo(() => hourlyRollingVolumeDeltas(hourlyCaptures), [hourlyCaptures]);
  const visible = useMemo(() => {
    if (isRollingVolumeChartRange(range)) return hourlyDeltas;
    return filterVolumeRange(points, range);
  }, [hourlyDeltas, points, range]);
  const showHourlyAxis = rolling && hourSlots.length > 0 && hourlyCaptures.length > 0;
  const barWidth = deltaBarWidth(hourSlots.length);
  const xInset = showHourlyAxis ? barWidth / 2 : 0;
  const map = useMemo(
    () =>
      scaleVolumePoints(showHourlyAxis ? hourlyDeltas : visible, {
        xInset,
        domainT: showHourlyAxis ? hourSlots : undefined,
      }),
    [hourlyDeltas, hourSlots, showHourlyAxis, visible, xInset],
  );
  // 24H headline ignores the plotted series and reads the live rollup.
  const headline = deskChartHeadline(range, rolling ? points : visible, rolling24h);
  const hasDaily = points.length > 0;
  const showRanges = hasDaily || hourlyCaptures.length > 0;
  const showHeadline = headline.volumeUsd !== null;
  const yTicks = rolling
    ? volumeDeltaYTicks(map.minY, map.maxY)
    : [0, 0.25, 0.5, 0.75, 1].map((frac) => map.maxY * frac);
  const xTicks = showHourlyAxis
    ? hourlyVolumeChartXTicks(
        hourSlots.map((t) => ({ t, volumeUsd: 0, kind: "rolling_24h" as const })),
        xInset,
      )
    : volumeChartXTicks(visible);
  const plotBottom = VOLUME_CHART_PAD.top + VOLUME_CHART_INNER_H;

  function setHoverFromClient(plot: Element, clientX: number, clientY: number) {
    const svg = plot.querySelector("svg");
    const svgX = pointerToSvgX(
      clientX,
      clientY,
      svg?.getScreenCTM?.() ?? null,
      plot.getBoundingClientRect(),
    );
    if (svgX === null) return;
    if (showHourlyAxis) {
      const slot =
        hourSlots.length > 1 ? Math.abs(map.x(hourSlots[1]!) - map.x(hourSlots[0]!)) : barWidth;
      setHover(nearestVolumePoint(hourlyDeltas, map, svgX, slot / 2));
      return;
    }
    setHover(nearestVolumePoint(visible, map, svgX));
  }

  return (
    <section
      className="rounded-xl border border-border bg-card/80 px-4 py-4 sm:px-5"
      data-hourly-rolling-count={hourlyHistory?.points.length ?? 0}
      data-hourly-axis-count={hourSlots.length}
      data-hourly-delta-count={hourlyDeltas.length}
      data-volume-refresh-ms={rolling ? DESK_VOLUME_24H_POLL_MS : undefined}
      data-volume-live={rolling ? "24h" : undefined}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-[9px] leading-tight font-medium tracking-wide text-foreground/90">
            Total Daily Tokenized Stock Volume
          </h2>
          {showHeadline || rolling ? (
            <>
              {showHeadline ? (
                <p
                  className="num mt-1 text-3xl font-medium text-primary"
                  aria-live="polite"
                  data-volume-headline
                  data-volume-kind={headline.kind}
                >
                  {formatUsdCompact(headline.volumeUsd)}
                </p>
              ) : null}
              <p className="mt-1 text-[11px] leading-snug text-muted-foreground" data-volume-caption>
                {headline.caption}
              </p>
            </>
          ) : null}
        </div>
        {showRanges ? (
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
      {showHourlyAxis || (!rolling && visible.length > 0) ? (
        <div
          className="relative mt-3 cursor-crosshair"
          data-volume-plot
          data-volume-series={rolling ? "hourly-delta" : "closed-day"}
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
            aria-label={
              rolling
                ? HOURLY_VOLUME_DELTA_ARIA
                : "Daily Solana tokenized stock volume from desk DexScreener snapshots. Headline is the sum of snapshot days in the selected range."
            }
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
                  data-volume-y={rolling ? formatDeltaUsdCompact(tick) : formatUsdCompact(tick)}
                >
                  {rolling ? formatDeltaUsdCompact(tick) : formatUsdCompact(tick)}
                </text>
              </g>
            ))}
            {showHourlyAxis
              ? hourSlots.map((t) => (
                  <line
                    key={`hour-${t}`}
                    x1={map.x(t)}
                    x2={map.x(t)}
                    y1={plotBottom}
                    y2={plotBottom + 4}
                    stroke="currentColor"
                    className="text-muted-foreground"
                    strokeWidth="1"
                    data-volume-hour={t}
                    data-volume-hour-empty={capturedHours.has(t) ? "false" : "true"}
                    pointerEvents="none"
                  />
                ))
              : null}
            {xTicks.map((tick, index) => {
              const label = rolling ? formatHourlyVolumeChartTick(tick) : formatVolumeChartTick(tick, xTicks);
              const crowded = !rolling && xTicks.length > 10;
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
            {rolling ? (
              <DeltaBars points={hourlyDeltas} map={map} width={barWidth} hoverT={hover?.t ?? null} />
            ) : (
              <>
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
              </>
            )}
            {hover ? (
              <g pointerEvents="none">
                <line
                  x1={map.x(hover.t)}
                  x2={map.x(hover.t)}
                  y1={VOLUME_CHART_PAD.top}
                  y2={VOLUME_CHART_PAD.top + VOLUME_CHART_INNER_H}
                  stroke={rolling ? (hover.volumeUsd < 0 ? NEGATIVE_DELTA : POSITIVE_DELTA) : "var(--volume)"}
                  strokeOpacity="0.45"
                  strokeDasharray="3 3"
                />
                <circle
                  cx={map.x(hover.t)}
                  cy={map.y(hover.volumeUsd)}
                  r="3.5"
                  fill={rolling ? (hover.volumeUsd < 0 ? NEGATIVE_DELTA : POSITIVE_DELTA) : "var(--volume)"}
                />
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
              <p data-volume-tooltip-day>
                {rolling ? formatHourlyVolumeChartTick(hover.t) : formatChartDay(hover.t)}
              </p>
              <p
                className={`num ${rolling && hover.volumeUsd < 0 ? "text-price-down" : "text-foreground"}`}
                data-volume-tooltip-value
              >
                {rolling ? formatDeltaUsdFull(hover.volumeUsd) : formatUsdFull(hover.volumeUsd)}
              </p>
              {rolling && "priorT" in hover && typeof hover.priorT === "number" ? (
                <p className="text-muted-foreground" data-volume-tooltip-prior>
                  vs {formatHourlyVolumeChartTick(hover.priorT)}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-4 flex h-[220px] items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 px-6 text-center">
          <p className="max-w-md text-sm text-muted-foreground">
            {rolling
              ? hourlyCaptures.length > 0 && hourSlots.length === 0
                ? HOURLY_VOLUME_DELTA_EMPTY
                : (hourlyHistory?.emptyReason ??
                  "Hourly volume series is unavailable. Missing hours are not invented.")
              : (history.emptyReason ?? "Historical volume series is unavailable. The desk does not invent points.")}
          </p>
        </div>
      )}
      {showHourlyAxis ? (
        <p className="mt-2 text-[11px] leading-snug text-muted-foreground" data-volume-hourly-note>
          {HOURLY_VOLUME_DELTA_CAPTION}
        </p>
      ) : null}
      {!rolling && hasDaily ? (
        <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
          History from closed desk DexScreener snapshots. The in-progress Eastern day is omitted until that America/New_York date has closed.
        </p>
      ) : null}
    </section>
  );
}
