"use client";

import { useMemo, useState, type PointerEvent } from "react";
import { DESK_CHART_PLOT_FRAME_CLASS, monotoneVolumePaths } from "@/lib/desk/chart-curve";
import { formatChartDay, formatUsdCompact, formatUsdFull } from "@/lib/market/format";
import {
  nearestVolumePoint,
  pointerToSvgX,
  scaleVolumePoints,
  volumeChartXTicks,
  VOLUME_CHART_HEIGHT,
  VOLUME_CHART_INNER_H,
  VOLUME_CHART_PAD,
  VOLUME_CHART_RANGES,
  VOLUME_CHART_WIDTH,
  formatVolumeChartTick,
  type VolumeChartRangeId,
} from "@/lib/market/daily-volume-view";
import {
  ROBINHOOD_DESK_VOLUME_NOTE,
  robinhoodDaysForRange,
  robinhoodDeskHeadline,
  robinhoodDisplayedLiquidity,
  robinhoodIssuerRows,
  robinhoodVolumePoints,
  type RobinhoodDeskDay,
} from "@/lib/market/robinhood-desk-volume";

export function RobinhoodVolumeDesk({
  days,
  initialRange = "7d",
}: {
  /** Closed Eastern snapshot days only. The page drops today and later. */
  days: readonly RobinhoodDeskDay[];
  initialRange?: VolumeChartRangeId;
}) {
  const [range, setRange] = useState<VolumeChartRangeId>(initialRange);
  const [hover, setHover] = useState<{ t: number; volumeUsd: number } | null>(null);
  const visibleDays = useMemo(() => robinhoodDaysForRange(days, range), [days, range]);
  const visible = useMemo(() => robinhoodVolumePoints(visibleDays), [visibleDays]);
  const headline = robinhoodDeskHeadline(visibleDays, range);
  const issuers = useMemo(() => robinhoodIssuerRows(visibleDays), [visibleDays]);
  const liquidity = robinhoodDisplayedLiquidity(visibleDays);
  const charting = range !== "24h";
  const map = useMemo(() => scaleVolumePoints(visible), [visible]);
  const xTicks = volumeChartXTicks(visible);
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((frac) => map.maxY * frac);
  const closedPaths = monotoneVolumePaths(visible, map, VOLUME_CHART_PAD.top + VOLUME_CHART_INNER_H);
  const showHeadline = headline.volumeUsd !== null;
  const unofficial = issuers.some((row) => !row.official);

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
      className="rounded-2xl bg-[#141414] px-4 py-4 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)] sm:px-5"
      data-robinhood-volume-desk
      data-volume-live="closed-day"
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3">
        <div className="min-w-0">
          <h2 className="font-heading text-[9px] leading-tight font-medium tracking-wide text-foreground/90">
            Total Daily Tokenized Stock Volume
          </h2>
          {showHeadline ? (
            <p
              className="num mt-1 text-3xl font-medium text-primary"
              aria-live="polite"
              data-volume-headline
              data-volume-kind={headline.kind}
            >
              {formatUsdCompact(headline.volumeUsd)}
            </p>
          ) : (
            <p className="num mt-1 text-3xl font-medium text-primary" data-volume-headline data-volume-kind="empty">
              —
            </p>
          )}
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground" data-volume-caption>
            {headline.caption}
          </p>
        </div>
        <div
          className="flex shrink-0 flex-nowrap items-center justify-end gap-1 justify-self-end self-start"
          data-volume-ranges
        >
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
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${
                range === row.id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {row.label}
            </button>
          ))}
        </div>
      </div>

      {charting && visible.length > 0 ? (
        <div
          className={`relative mt-3 cursor-crosshair ${DESK_CHART_PLOT_FRAME_CLASS}`}
          data-volume-plot
          data-volume-series="closed-day"
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
            aria-label="Daily Robinhood Chain tokenized stock volume from desk DexScreener snapshots. Headline is the sum of snapshot days in the selected range."
          >
            <defs>
              <linearGradient id="robinhood-volume-area" x1="0" x2="0" y1="0" y2="1">
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
            <path d={closedPaths.area} fill="url(#robinhood-volume-area)" pointerEvents="none" />
            <path
              d={closedPaths.line}
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
          <div aria-hidden="true" data-volume-overlay className="absolute inset-0 z-10 cursor-crosshair" />
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
        <div
          className="mt-4 flex min-h-[220px] items-center justify-center rounded-2xl border border-dashed border-border bg-muted/20 px-6 py-8 text-center"
          data-volume-plot
          data-volume-series={charting ? "closed-day" : "closed-day-kpi"}
        >
          <div className="max-w-md">
            {range === "24h" && visibleDays[0] ? (
              <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3" data-robinhood-lane-split>
                <div>
                  <dt className="text-[10px] tracking-wide text-muted-foreground uppercase">Public</dt>
                  <dd className="num text-sm font-medium">{formatUsdCompact(visibleDays[0].publicEquity24hUsd)}</dd>
                </div>
                <div>
                  <dt className="text-[10px] tracking-wide text-muted-foreground uppercase">Private</dt>
                  <dd className="num text-sm font-medium">{formatUsdCompact(visibleDays[0].private24hUsd)}</dd>
                </div>
                <div>
                  <dt className="text-[10px] tracking-wide text-muted-foreground uppercase">ETF/index</dt>
                  <dd className="num text-sm font-medium">{formatUsdCompact(visibleDays[0].etfIndex24hUsd)}</dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">
                {days.length === 0
                  ? "No Robinhood Chain desk snapshots yet. History starts when this desk records a DexScreener h24 sample. Past days are not invented."
                  : "No closed snapshot days in this range. Missing days stay blank — the desk does not invent points."}
              </p>
            )}
          </div>
        </div>
      )}

      <p className="mt-2 text-[11px] leading-snug text-muted-foreground" data-robinhood-volume-note>
        {ROBINHOOD_DESK_VOLUME_NOTE}
      </p>

      {liquidity ? (
        <p className="mt-2 text-[11px] leading-snug text-muted-foreground" data-robinhood-liquidity>
          Displayed liquidity {liquidity.date}: {formatUsdFull(liquidity.usd)}. DexScreener liquidity.usd, not
          executable size. Missing liquidity does not drop the day.
        </p>
      ) : null}

      <div className="mt-4" data-issuer-lanes>
        <h3 className="text-[10px] tracking-wide text-muted-foreground uppercase">Issuer × type</h3>
        {issuers.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            {days.length === 0
              ? "No issuer split is recorded yet. The desk does not invent issuers."
              : "Issuer × type was not recorded on these snapshot days. Lane totals still count. No issuer split is invented."}
          </p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[28rem] text-left text-sm">
              <caption className="sr-only">
                Robinhood Chain volume by issuer and type for the selected range
              </caption>
              <thead>
                <tr className="text-[10px] tracking-wide text-muted-foreground uppercase">
                  <th scope="col" className="py-1 pr-3 font-medium">
                    Issuer
                  </th>
                  <th scope="col" className="py-1 pr-3 font-medium">
                    Equity
                  </th>
                  <th scope="col" className="py-1 pr-3 font-medium">
                    ETF
                  </th>
                  <th scope="col" className="py-1 font-medium">
                    Private
                  </th>
                </tr>
              </thead>
              <tbody>
                {issuers.map((row) => (
                  <tr key={row.slug} data-issuer={row.slug} data-issuer-official={row.official ? "true" : "false"}>
                    <th scope="row" className="py-1.5 pr-3 font-medium text-foreground">
                      {row.label}
                    </th>
                    <td className="num py-1.5 pr-3">{formatUsdCompact(row.equityUsd)}</td>
                    <td className="num py-1.5 pr-3">{formatUsdCompact(row.etfUsd)}</td>
                    <td className="num py-1.5">{formatUsdCompact(row.privateUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {unofficial ? (
          <p className="mt-2 text-[11px] leading-snug text-muted-foreground" data-ondo-unverified>
            Ondo-named (unverified) is not official Ondo. Those chain 4663 tokens use the on-chain name “(Ondo
            Tokenized)” and stay in the bar until they are dropped. Rialto, launchpad PreStocks/xStock, copycats, and
            Arcus leveraged tokens are not in this split.
          </p>
        ) : null}
      </div>
    </section>
  );
}
