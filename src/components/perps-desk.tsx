"use client";

import { useMemo, useState, type PointerEvent } from "react";
import { CHART_PLOT_FRAME_CLASS, DESK_CHART_STROKE, monotoneLinePath } from "@/lib/desk/chart-curve";
import {
  VOLUME_CHART_HEIGHT,
  VOLUME_CHART_INNER_H,
  VOLUME_CHART_PAD,
  VOLUME_CHART_RANGES,
  VOLUME_CHART_WIDTH,
  type VolumeChartRangeId,
} from "@/lib/market/daily-volume-view";
import { formatChartDay, formatUsdCompact, formatUsdFull, volumeShare } from "@/lib/market/format";
import { maxNullable } from "@/lib/market/numbers";
import { perpCategoryLabel } from "@/lib/market/perps-classify";
import {
  perpsTierLabel,
  selectPerpsRange,
  shortPerpsSource,
  type PerpsDeskModel,
  type PerpsTier,
} from "@/lib/market/perps-snapshot";

function windowLabel(window: string): string {
  switch (window) {
    case "rolling-24h":
      return "Rolling 24h";
    case "et-day":
      return "ET day";
    case "lifetime":
      return "Lifetime";
    case "lifetime-diff":
      return "Daily diff";
    default:
      return "No 24h";
  }
}

function roundedTopBar(x: number, top: number, width: number, baseline: number): string {
  const height = baseline - top;
  if (!(height > 0) || !(width > 0)) return "";
  const radius = Math.min(6, width / 2, height);
  const right = x + width;
  const n = (value: number) => value.toFixed(2);
  return `M ${n(x)} ${n(baseline)} L ${n(x)} ${n(top + radius)} Q ${n(x)} ${n(top)} ${n(x + radius)} ${n(top)} L ${n(right - radius)} ${n(top)} Q ${n(right)} ${n(top)} ${n(right)} ${n(top + radius)} L ${n(right)} ${n(baseline)} Z`;
}

function TierStat({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="min-w-0 rounded-lg bg-background/60 px-3 py-2 ring-1 ring-foreground/10">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="num mt-0.5 text-sm font-medium">{formatUsdCompact(value)}</p>
    </div>
  );
}

export function PerpsDesk({ model }: { model: PerpsDeskModel }) {
  const [range, setRange] = useState<VolumeChartRangeId>("24h");
  const [excludeLeveraged, setExcludeLeveraged] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const view = useMemo(
    () => selectPerpsRange(model.days, range, excludeLeveraged),
    [model.days, range, excludeLeveraged],
  );
  const plotted = view.chart.filter((point) => point.volumeUsd !== null);
  const maxY = Math.max(maxNullable(plotted.map((point) => point.volumeUsd)) ?? 0, 1);
  const plotBottom = VOLUME_CHART_PAD.top + VOLUME_CHART_INNER_H;
  const plotLeft = VOLUME_CHART_PAD.left;
  const plotWidth = VOLUME_CHART_WIDTH - VOLUME_CHART_PAD.left - VOLUME_CHART_PAD.right;
  const slot = plotted.length > 0 ? plotWidth / plotted.length : plotWidth;
  const barWidth = Math.min(36, slot * 0.62);
  const yOf = (value: number) => plotBottom - (value / maxY) * VOLUME_CHART_INNER_H;
  const bars = plotted.map((point, index) => {
    const cx = plotLeft + slot * index + slot / 2;
    const volume = point.volumeUsd ?? 0;
    return {
      ...point,
      index,
      x: cx - barWidth / 2,
      cx,
      y: yOf(volume),
    };
  });
  const curve =
    bars.length >= 2 ? monotoneLinePath(bars.map((bar) => ({ x: bar.cx, y: bar.y }))) : "";
  const yTicks = [0, 0.5, 1].map((frac) => maxY * frac);
  const maxVenue = maxNullable(view.venues.map((venue) => venue.volumeUsd));
  const maxUnderlying = maxNullable(view.underlyings.map((row) => row.volumeUsd));
  const hovered = hover === null ? null : bars.find((bar) => bar.index === hover) ?? null;

  function hoverFromClient(plot: HTMLDivElement, clientX: number) {
    const svg = plot.querySelector("svg");
    const matrix = svg?.getScreenCTM();
    if (!matrix) return;
    const point = new DOMPoint(clientX, 0).matrixTransform(matrix.inverse());
    let nearest = 0;
    let best = Number.POSITIVE_INFINITY;
    for (const bar of bars) {
      const distance = Math.abs(bar.cx - point.x);
      if (distance < best) {
        best = distance;
        nearest = bar.index;
      }
    }
    setHover(bars.length ? nearest : null);
  }

  return (
    <div className="space-y-4" data-perps-page>
      <header className="space-y-2">
        <p className="text-[10px] font-medium tracking-wide text-primary">SEPARATE FROM TOKENIZED STOCK</p>
        <h2 className="font-heading text-2xl font-semibold tracking-tight">Equity perps</h2>
        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
          Synthetic oracle-priced perpetual futures on single stocks, equity ETFs, and equity indices. Not
          tokenized stock. These numbers are not added to the home spot total or Chain volume. Pre-IPO,
          commodities, FX, bonds, and vol are excluded. Long-tail CoinGecko venues are excluded.
        </p>
      </header>

      <section className="rounded-xl border border-border bg-card/80 px-4 py-4 sm:px-5" data-perps-volume-card>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3">
          <div className="min-w-0">
            <h3 className="font-heading text-[9px] leading-tight font-medium tracking-wide text-foreground/90">
              Equity perp volume
            </h3>
            <p className="num mt-1 text-3xl font-medium text-primary" data-perps-headline>
              {formatUsdCompact(view.headlineUsd)}
            </p>
            <p className="mt-1 text-[11px] leading-snug text-muted-foreground" data-perps-caption>
              {model.readError ? model.readError : view.caption}
            </p>
          </div>
          <div className="flex shrink-0 flex-nowrap items-center justify-end gap-1 justify-self-end self-start" data-perps-ranges>
            {VOLUME_CHART_RANGES.map((row) => (
              <button
                key={row.id}
                type="button"
                data-perps-range={row.id}
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

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-perps-exclude-leveraged
            aria-pressed={excludeLeveraged}
            onClick={() => setExcludeLeveraged((current) => !current)}
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
              excludeLeveraged
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground ring-1 ring-border hover:text-foreground"
            }`}
          >
            {excludeLeveraged ? "Leveraged ETFs excluded" : "Exclude leveraged ETFs"}
          </button>
          {view.leveragedUsd !== null ? (
            <p className="text-[11px] text-muted-foreground" data-perps-leveraged-note>
              {excludeLeveraged
                ? `Hidden leveraged ETF volume ${formatUsdCompact(view.leveragedUsd)}.`
                : `Includes leveraged ETFs ${formatUsdCompact(view.leveragedUsd)}.`}
            </p>
          ) : null}
        </div>

        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3" data-perps-tiers>
          <TierStat label="Onchain" value={view.onchainUsd} />
          <TierStat label="CEX direct" value={view.cexDirectUsd} />
          <TierStat label="Binance+Bybit via CoinGecko" value={view.cexCoingeckoUsd} />
        </div>

        {bars.length > 0 ? (
          <div
            className={`relative mt-3 cursor-crosshair ${CHART_PLOT_FRAME_CLASS}`}
            data-perps-plot
            onPointerLeave={() => setHover(null)}
            onPointerMove={(event: PointerEvent<HTMLDivElement>) => hoverFromClient(event.currentTarget, event.clientX)}
          >
            <svg
              viewBox={`0 0 ${VOLUME_CHART_WIDTH} ${VOLUME_CHART_HEIGHT}`}
              preserveAspectRatio="none"
              className="pointer-events-none h-[240px] w-full sm:h-[280px]"
              role="img"
              aria-label="Equity perpetual volume by Eastern day. Not tokenized stock volume."
            >
              <rect x={0} y={0} width={VOLUME_CHART_WIDTH} height={VOLUME_CHART_HEIGHT} fill="transparent" />
              {yTicks.map((tick) => (
                <g key={tick}>
                  <line
                    x1={plotLeft}
                    x2={VOLUME_CHART_WIDTH - VOLUME_CHART_PAD.right}
                    y1={yOf(tick)}
                    y2={yOf(tick)}
                    stroke="currentColor"
                    className="text-border"
                    strokeWidth="1"
                  />
                  <text x={plotLeft - 8} y={yOf(tick) + 3} textAnchor="end" className="fill-muted-foreground" fontSize="10">
                    {formatUsdCompact(tick)}
                  </text>
                </g>
              ))}
              {bars.map((bar) => (
                <path
                  key={bar.date}
                  d={roundedTopBar(bar.x, bar.y, barWidth, plotBottom)}
                  fill="var(--volume)"
                  fillOpacity={bar.open ? 0.55 : 1}
                  data-perps-bar={bar.date}
                />
              ))}
              {curve ? (
                <path
                  d={curve}
                  fill="none"
                  stroke={DESK_CHART_STROKE}
                  strokeWidth="2"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              ) : null}
              {bars.map((bar) => (
                <text
                  key={`${bar.date}-label`}
                  x={bar.cx}
                  y={VOLUME_CHART_HEIGHT - 8}
                  textAnchor="middle"
                  className="fill-muted-foreground"
                  fontSize="10"
                >
                  {formatChartDay(bar.t)}
                </text>
              ))}
              {hovered ? (
                <circle cx={hovered.cx} cy={hovered.y} r="3.5" fill={DESK_CHART_STROKE} />
              ) : null}
            </svg>
            {hovered ? (
              <div className="pointer-events-none absolute top-2 right-2 z-20 rounded-md border border-border bg-background/95 px-2 py-1 text-xs shadow-sm">
                <p>{formatChartDay(hovered.t)}{hovered.open ? " · day open" : ""}</p>
                <p className="num text-foreground">{formatUsdFull(hovered.volumeUsd)}</p>
              </div>
            ) : null}
          </div>
        ) : (
          <div
            className={`mt-4 flex h-[220px] items-center justify-center border border-dashed border-border bg-muted/20 px-6 text-center ${CHART_PLOT_FRAME_CLASS}`}
            data-perps-plot-empty
          >
            <p className="max-w-md text-sm text-muted-foreground">
              {range === "24h"
                ? "No equity-perp snapshot yet. The nightly capture runs at 11:59 PM America/New_York. Missing volume stays blank."
                : "No closed Eastern day in this range yet. 24H shows the latest capture when one exists. Missing days stay empty."}
            </p>
          </div>
        )}
        <p className="mt-2 text-[11px] leading-snug text-muted-foreground" data-perps-window-note>
          Venue 24h figures are rolling windows at capture time, except where a venue has no 24h field. Hyperliquid
          hourly candles are base size, not USD, so that row stays on rolling dayNtlVlm. Ostium shows a daily number
          only as the lifetime difference between two consecutive Eastern snapshots.
        </p>
      </section>

      <section className="space-y-3" data-perps-venues>
        <h3 className="font-heading text-lg font-medium">Venues</h3>
        {view.venues.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-card px-6 py-10 text-center">
            <p className="text-sm text-muted-foreground">No venue rows in this snapshot.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div className="grid w-full min-w-[64rem] grid-cols-[2.5rem_minmax(14rem,1.5fr)_7rem_minmax(8rem,1fr)_minmax(7rem,0.8fr)_5rem_7rem_minmax(8rem,1fr)] gap-x-3 gap-y-2">
              {["#", "Venue", "Tier", "Volume", "Open interest", "Markets", "Window", "Source"].map((label) => (
                <div key={label} className="px-1 text-xs text-muted-foreground">
                  {label}
                </div>
              ))}
              {view.venues.map((venue, index) => (
                <VenueRow key={venue.venue} rank={index + 1} venue={venue} maxVolume={maxVenue} />
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="space-y-3" data-perps-underlyings>
        <h3 className="font-heading text-lg font-medium">Top underlyings</h3>
        {view.underlyings.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-card px-6 py-10 text-center">
            <p className="text-sm text-muted-foreground">No equity underlyings in this snapshot.</p>
          </div>
        ) : (
          <div className="grid gap-2">
            {view.underlyings.map((row) => (
              <div
                key={row.group}
                className="grid grid-cols-[minmax(0,1.4fr)_7.5rem_minmax(6rem,0.7fr)_minmax(6rem,0.7fr)] items-center gap-3 rounded-xl bg-card px-4 py-2.5 text-sm ring-1 ring-foreground/10"
                data-perps-underlying={row.group}
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{row.group}</p>
                  <p className="text-[10px] text-muted-foreground">{perpCategoryLabel(row.category)}</p>
                </div>
                <div className="min-w-0">
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${volumeShare(row.volumeUsd, maxUnderlying)}%` }}
                    />
                  </div>
                </div>
                <p className="num text-right text-primary">{formatUsdCompact(row.volumeUsd)}</p>
                <p className="num text-right text-muted-foreground">{formatUsdCompact(row.openInterestUsd)}</p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function VenueRow({
  rank,
  venue,
  maxVolume,
}: {
  rank: number;
  venue: {
    venue: string;
    tier: PerpsTier;
    source: string;
    volumeWindow: string;
    windowNote: string;
    error: string | null;
    zeroFee: boolean;
    volumeUsd: number | null;
    openInterestUsd: number | null;
    marketCount: number;
  };
  maxVolume: number | null;
}) {
  return (
    <div className="col-span-full grid grid-cols-subgrid items-center rounded-xl bg-card px-3 py-2.5 text-sm ring-1 ring-foreground/10" data-perps-venue={venue.venue}>
      <div className="num text-xs text-muted-foreground">#{rank}</div>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="truncate font-medium">{venue.venue}</p>
          {venue.zeroFee ? (
            <span
              className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary"
              title="Zero-fee or points program. Volume can run hotter than fee-paying venues."
              data-perps-zero-fee
            >
              0 fee
            </span>
          ) : null}
        </div>
        {venue.error ? <p className="truncate text-[10px] text-destructive">{venue.error}</p> : null}
      </div>
      <div className="text-xs text-muted-foreground">{perpsTierLabel(venue.tier)}</div>
      <div className="min-w-0">
        <p className="num text-right font-medium text-primary">{formatUsdCompact(venue.volumeUsd)}</p>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary" style={{ width: `${volumeShare(venue.volumeUsd, maxVolume)}%` }} />
        </div>
      </div>
      <p className="num text-right">{formatUsdCompact(venue.openInterestUsd)}</p>
      <p className="num text-right">{venue.marketCount}</p>
      <p className="text-xs text-muted-foreground" title={venue.windowNote}>
        {windowLabel(venue.volumeWindow)}
      </p>
      <p className="truncate text-xs text-muted-foreground" title={venue.source}>
        {shortPerpsSource(venue.source)}
      </p>
    </div>
  );
}
