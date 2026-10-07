"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { DESK_CHART_STROKE, monotoneAreaPath, monotoneLinePath } from "@/lib/desk/chart-curve";
import {
  contiguousHourlyRuns,
  deskChartHeadline,
  filterVolumeRange,
  formatHourlyVolumeChartTick,
  formatVolumeChartTick,
  hourlyVolumeChartXTicks,
  HOURLY_VOLUME_SERIES_ARIA,
  HOURLY_VOLUME_SERIES_CAPTION,
  HOURLY_VOLUME_SERIES_EMPTY,
  isRollingVolumeChartRange,
  nearestVolumePoint,
  plottableHourlyRollingPoints,
  pointerToSvgX,
  scaleVolumePoints,
  volumeChartXTicks,
  VOLUME_CHART_HEIGHT,
  VOLUME_CHART_INNER_H,
  VOLUME_CHART_PAD,
  VOLUME_CHART_RANGES,
  VOLUME_CHART_WIDTH,
  type DeskRolling24hVolumes,
  type VolumeChartRangeId,
  type VolumeChartScale,
} from "@/lib/market/daily-volume-view";
import {
  DESK_VOLUME_24H_LIVE_PATH,
  DESK_VOLUME_24H_POLL_MS,
  DESK_VOLUME_HISTORY_PATH,
  DESK_VOLUME_HISTORY_POLL_MS,
  deskVolumePollDue,
  parseDeskVolumeHistoryPayload,
  parseDeskVolumeLivePayload,
  preferFresherClosedHistory,
  preferFresherHourlyHistory,
} from "@/lib/market/desk-volume-live";
import { formatChartDay, formatUsdCompact, formatUsdFull } from "@/lib/market/format";
import {
  HOME_24H_ROBINHOOD_PLOT_NOTE,
  HOME_CLOSED_RANGE_WITH_ROBINHOOD_FOOTER,
  includeRobinhoodInDeskHeadline,
  lastReportedRobinhoodDay,
  mergeHomeDeskSnapshotPoints,
  snapshotSeriesIncludesRobinhood,
} from "@/lib/market/home-desk-volume";
import { closedRobinhoodDeskDays, type RobinhoodDeskDay } from "@/lib/market/robinhood-desk-volume";
import type { EquityVolumeHistoryResult, VolumeHistoryPoint } from "@/lib/market/types";
import { easternRollingHourStarts } from "@/lib/market/volume-hourly-snapshots";
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

/** Absolute rolling-24h totals. A gap between Eastern hours breaks the curve. */
function HourlyRollingArea({
  points,
  map,
}: {
  points: readonly VolumeHistoryPoint[];
  map: VolumeChartScale;
}) {
  const baseline = map.y(0);
  const runs = contiguousHourlyRuns(points);
  return (
    <g data-volume-rolling-area="true" data-volume-run-count={runs.length}>
      {runs.map((run) => {
        const first = run[0];
        if (!first) return null;
        if (run.length === 1) {
          return (
            <circle
              key={first.t}
              cx={map.x(first.t)}
              cy={map.y(first.volumeUsd)}
              r="3.5"
              fill={DESK_CHART_STROKE}
              data-volume-point="true"
              data-volume-t={first.t}
              data-volume-usd={first.volumeUsd}
              pointerEvents="none"
            />
          );
        }
        const curve = run.map((point) => ({ x: map.x(point.t), y: map.y(point.volumeUsd) }));
        return (
          <g key={first.t} data-volume-run={run.length}>
            <path d={monotoneAreaPath(curve, baseline)} fill="url(#volume-area-24h)" pointerEvents="none" />
            <path
              d={monotoneLinePath(curve)}
              fill="none"
              stroke={DESK_CHART_STROKE}
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
              pointerEvents="none"
            />
            {run.map((point) => (
              <circle
                key={point.t}
                cx={map.x(point.t)}
                cy={map.y(point.volumeUsd)}
                r="0"
                fill={DESK_CHART_STROKE}
                data-volume-point="true"
                data-volume-t={point.t}
                data-volume-usd={point.volumeUsd}
                pointerEvents="none"
              />
            ))}
          </g>
        );
      })}
    </g>
  );
}

export function DailyVolumeChart({
  history: historyProp,
  hourlyHistory: hourlyHistoryProp = null,
  rolling24h: rolling24hProp = null,
  robinhoodDays = null,
  initialRange = "7d",
}: {
  history: EquityVolumeHistoryResult;
  /**
   * Last ~24 Eastern hours of DexScreener h24 desk totals.
   * 24H plots each capture's absolute rolling total (`combined24hUsd`).
   * 7D/14D/30D keep using closed days from `history`. Do not pass these points through closedSnapshotVolumePoints.
   */
  hourlyHistory?: EquityVolumeHistoryResult | null;
  /** Live Solana ChainVolume 24h legs. Used only for the 24H headline. */
  rolling24h?: DeskRolling24hVolumes | null;
  /**
   * Closed Robinhood desk days. Home passes these so 7D/14D/30D add the same
   * Eastern day and 24H adds the newest closed snapshot. Omit on the Solana desk.
   * Robinhood has no hourly series; the 24H area stays Solana.
   */
  robinhoodDays?: readonly RobinhoodDeskDay[] | null;
  /** Closed-day ranges stay the default. Tests pin 24H without a click. */
  initialRange?: VolumeChartRangeId;
}) {
  const [range, setRange] = useState<VolumeChartRangeId>(initialRange);
  const [hover, setHover] = useState<VolumeHistoryPoint | null>(null);
  const [polledHistory, setPolledHistory] = useState<EquityVolumeHistoryResult | null>(null);
  const [polledHourly, setPolledHourly] = useState<EquityVolumeHistoryResult | null>(null);
  const [rolling24h, setRolling24h] = useState(rolling24hProp);
  const rollingFromPoll = useRef(false);
  const rolling = isRollingVolumeChartRange(range);
  const history = preferFresherClosedHistory(historyProp, polledHistory) ?? historyProp;
  const hourlyHistory = preferFresherHourlyHistory(hourlyHistoryProp, polledHourly);

  useEffect(() => {
    if (rollingFromPoll.current) return;
    setRolling24h(rolling24hProp ?? null);
  }, [rolling24hProp]);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    let lastPull = 0;
    const intervalMs = rolling ? DESK_VOLUME_24H_POLL_MS : DESK_VOLUME_HISTORY_POLL_MS;

    const pull = async () => {
      const now = Date.now();
      if (!deskVolumePollDue(now, lastPull)) return;
      lastPull = now;
      try {
        const response = await fetch(rolling ? DESK_VOLUME_24H_LIVE_PATH : DESK_VOLUME_HISTORY_PATH, {
          cache: "no-store",
        });
        if (!response.ok) return;
        const body = await response.json();
        if (cancelled) return;
        if (rolling) {
          const parsed = parseDeskVolumeLivePayload(body);
          if (!parsed) return;
          setPolledHourly((current) => preferFresherHourlyHistory(current, parsed.hourlyHistory));
          if (parsed.rolling24h) {
            rollingFromPoll.current = true;
            setRolling24h(parsed.rolling24h);
          }
          return;
        }
        const parsed = parseDeskVolumeHistoryPayload(body);
        if (!parsed) return;
        setPolledHistory((current) => preferFresherClosedHistory(current, parsed));
      } catch {
        // Keep the last series. A failed poll must not clear captured days or hours.
      }
    };

    const arm = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (cancelled || document.visibilityState === "hidden") return;
        void pull().finally(() => {
          if (!cancelled && document.visibilityState !== "hidden") arm();
        });
      }, intervalMs);
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

  const deskNowT = useMemo(() => {
    const parsedGeneratedAt = Date.parse(history.generatedAt);
    const fallbackT = history.points[history.points.length - 1]?.t ?? 0;
    return Number.isFinite(parsedGeneratedAt) ? parsedGeneratedAt / 1000 : fallbackT;
  }, [history.generatedAt, history.points]);
  const robinhoodClosed = useMemo(
    () => closedRobinhoodDeskDays(robinhoodDays ?? [], deskNowT),
    [deskNowT, robinhoodDays],
  );
  const points = useMemo(() => {
    // Closed snapshot days only. A rolling ~24h tip is not an Eastern snapshot day.
    const closed = closedSnapshotVolumePoints(history.points, deskNowT);
    return mergeHomeDeskSnapshotPoints(closed, robinhoodClosed);
  }, [deskNowT, history.points, robinhoodClosed]);

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
  const visible = useMemo(() => {
    if (isRollingVolumeChartRange(range)) return hourlyCaptures;
    return filterVolumeRange(points, range);
  }, [hourlyCaptures, points, range]);
  const showHourlyAxis = rolling && hourSlots.length > 0 && hourlyCaptures.length > 0;
  const map = useMemo(
    () =>
      scaleVolumePoints(visible, {
        domainT: showHourlyAxis ? hourSlots : undefined,
      }),
    [hourSlots, showHourlyAxis, visible],
  );
  // 24H headline ignores the plotted series and reads the live Solana rollup,
  // then adds Robinhood's newest closed snapshot when the home desk passed days.
  // Closed ranges mention Robinhood only when a visible day actually includes it.
  const robinhoodInView = rolling
    ? lastReportedRobinhoodDay(robinhoodClosed) !== null
    : snapshotSeriesIncludesRobinhood(visible, robinhoodClosed);
  const headline = robinhoodInView
    ? includeRobinhoodInDeskHeadline(
        deskChartHeadline(range, rolling ? points : visible, rolling24h),
        range,
        robinhoodClosed,
      )
    : deskChartHeadline(range, rolling ? points : visible, rolling24h);
  const robinhoodInSeries = snapshotSeriesIncludesRobinhood(points, robinhoodClosed);
  const hasDaily = points.length > 0;
  const showRanges = hasDaily || hourlyCaptures.length > 0;
  const showHeadline = headline.volumeUsd !== null;
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((frac) => map.maxY * frac);
  const xTicks = showHourlyAxis
    ? hourlyVolumeChartXTicks(hourSlots.map((t) => ({ t, volumeUsd: 0, kind: "rolling_24h" as const })))
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
        hourSlots.length > 1 ? Math.abs(map.x(hourSlots[1]!) - map.x(hourSlots[0]!)) : 16;
      setHover(nearestVolumePoint(hourlyCaptures, map, svgX, slot / 2));
      return;
    }
    setHover(nearestVolumePoint(visible, map, svgX));
  }

  return (
    <section
      className="rounded-xl border border-border bg-card/80 px-4 py-4 sm:px-5"
      data-hourly-rolling-count={hourlyHistory?.points.length ?? 0}
      data-hourly-axis-count={hourSlots.length}
      data-hourly-point-count={hourlyCaptures.length}
      data-volume-refresh-ms={rolling ? DESK_VOLUME_24H_POLL_MS : DESK_VOLUME_HISTORY_POLL_MS}
      data-volume-live={rolling ? "24h" : "closed-day"}
      data-volume-includes-robinhood={robinhoodInView ? "true" : "false"}
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
          data-volume-series={rolling ? "hourly-rolling" : "closed-day"}
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
                ? HOURLY_VOLUME_SERIES_ARIA
                : robinhoodInView
                  ? "Daily tokenized stock volume from Solana and Robinhood Chain desk DexScreener snapshots. Headline is the sum of snapshot days in the selected range. Robinhood bars are trailing h24 samples, not a true 12:00 AM–11:59 PM ET window."
                  : "Daily Solana tokenized stock volume from desk DexScreener snapshots. Headline is the sum of snapshot days in the selected range."
            }
          >
            <defs>
              <linearGradient id="volume-area" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="var(--volume)" stopOpacity="0.38" />
                <stop offset="100%" stopColor="var(--volume)" stopOpacity="0.02" />
              </linearGradient>
              <linearGradient id="volume-area-24h" x1="0" x2="0" y1="0" y2="1">
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
                  data-volume-y={formatUsdCompact(tick)}
                >
                  {formatUsdCompact(tick)}
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
              <HourlyRollingArea points={hourlyCaptures} map={map} />
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
                  stroke={rolling ? DESK_CHART_STROKE : "var(--volume)"}
                  strokeOpacity="0.45"
                  strokeDasharray="3 3"
                />
                <circle
                  cx={map.x(hover.t)}
                  cy={map.y(hover.volumeUsd)}
                  r="3.5"
                  fill={rolling ? DESK_CHART_STROKE : "var(--volume)"}
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
              <p className="num text-foreground" data-volume-tooltip-value>
                {formatUsdFull(hover.volumeUsd)}
              </p>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-4 flex h-[220px] items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 px-6 text-center">
          <p className="max-w-md text-sm text-muted-foreground">
            {rolling
              ? (hourlyHistory?.emptyReason ?? HOURLY_VOLUME_SERIES_EMPTY)
              : (history.emptyReason ?? "Historical volume series is unavailable. The desk does not invent points.")}
          </p>
        </div>
      )}
      {showHourlyAxis ? (
        <p className="mt-2 text-[11px] leading-snug text-muted-foreground" data-volume-hourly-note>
          {HOURLY_VOLUME_SERIES_CAPTION}
        </p>
      ) : null}
      {rolling && robinhoodInView ? (
        <p className="mt-2 text-[11px] leading-snug text-muted-foreground" data-volume-robinhood-24h-note>
          {HOME_24H_ROBINHOOD_PLOT_NOTE}
        </p>
      ) : null}
      {!rolling && hasDaily ? (
        <p className="mt-2 text-[11px] leading-snug text-muted-foreground" data-volume-history-note>
          {robinhoodInSeries
            ? HOME_CLOSED_RANGE_WITH_ROBINHOOD_FOOTER
            : "History from closed desk DexScreener snapshots. The in-progress Eastern day is omitted until that America/New_York date has closed."}
        </p>
      ) : null}
    </section>
  );
}
