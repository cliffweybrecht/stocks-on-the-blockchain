"use client";

import { useMemo, useState, type PointerEvent } from "react";
import Link from "next/link";
import { DateAxisLabels } from "@/components/date-axis-labels";
import { CHART_PLOT_FRAME_CLASS, DESK_CHART_STROKE, monotoneLinePath } from "@/lib/desk/chart-curve";
import { selectDateAxisLabelTicks } from "@/lib/desk/date-axis";
import {
  VOLUME_CHART_HEIGHT,
  VOLUME_CHART_INNER_H,
  VOLUME_CHART_PAD,
  VOLUME_CHART_RANGES,
  VOLUME_CHART_WIDTH,
  type VolumeChartRangeId,
} from "@/lib/market/daily-volume-view";
import { PERPS_CSV_FILES } from "@/lib/market/perps-csv";
import {
  perpsChainShareSeries,
  perpsListingChanges,
  perpsOiSeries,
  perpsVenueShareSeries,
} from "@/lib/market/perps-history";
import { PERPS_JSON_FILES } from "@/lib/market/perps-json";
import { formatChartDay, formatUsdCompact, formatUsdFull, volumeShare } from "@/lib/market/format";
import { maxNullable } from "@/lib/market/numbers";
import { perpCategoryLabel, type PerpsCategory } from "@/lib/market/perps-classify";
import { formatAnnualizedPercent, formatFundingPercent } from "@/lib/market/perps-funding";
import { HIP3_BUILDERS, PERP_PLACES } from "@/lib/market/perps-meta";
import { PERPS_HELD_OUT, perpsFeedKind } from "@/lib/market/perps-sources";
import { perpsTickerHref } from "@/lib/market/perps-ticker";
import {
  formatPerpsEt,
  perpsAsOfLine,
  perpsSourceStamps,
  perpsTierLabel,
  perpsVenueQuality,
  selectPerpsRange,
  shortPerpsSource,
  type PerpsDeskModel,
  type PerpsSharePoint,
  type PerpsVenueRow,
  type PerpsViewDay,
} from "@/lib/market/perps-snapshot";

function roundedTopBar(x: number, top: number, width: number, baseline: number): string {
  const height = baseline - top;
  if (!(height > 0) || !(width > 0)) return "";
  const radius = Math.min(6, width / 2, height);
  const right = x + width;
  const n = (value: number) => value.toFixed(2);
  return `M ${n(x)} ${n(baseline)} L ${n(x)} ${n(top + radius)} Q ${n(x)} ${n(top)} ${n(x + radius)} ${n(top)} L ${n(right - radius)} ${n(top)} Q ${n(right)} ${n(top)} ${n(right)} ${n(top + radius)} L ${n(right)} ${n(baseline)} Z`;
}

function Freshness({ day }: { day: PerpsViewDay }) {
  const stamps = perpsSourceStamps(day.venues);
  return (
    <div className="space-y-0.5 text-[11px] leading-snug text-muted-foreground" data-perps-as-of>
      <p>{perpsAsOfLine(day)}</p>
      {stamps.map((stamp) => (
        <p key={stamp.name}>{stamp.line}</p>
      ))}
    </div>
  );
}

function DataChecks({ day }: { day: PerpsViewDay | null }) {
  const checks = day?.checks;
  return (
    <section className="rounded-xl border border-border bg-card/80 px-4 py-3 sm:px-5" data-perps-checks>
      <h3 className="font-heading text-sm font-medium">Data checks</h3>
      {checks === undefined ? (
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
          No checks stored on this row. The next capture writes them.
        </p>
      ) : checks.length === 0 ? (
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">No flags versus the prior day.</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {checks.map((check) => (
            <li key={check.code} className="text-[11px] leading-snug text-foreground" data-perps-check={check.code}>
              {check.text}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
        Flags are informational. They do not change the numbers.
      </p>
    </section>
  );
}

function formatVolOi(volume: number | null, openInterest: number | null): string {
  if (volume === null || openInterest === null || !(openInterest > 0)) return "—";
  const ratio = volume / openInterest;
  if (ratio >= 100) return `${ratio.toFixed(0)}×`;
  return `${ratio.toFixed(1)}×`;
}

function chainLabel(chain: string): string {
  if (!chain) return "—";
  if (chain.startsWith("Centralized")) return "Centralized exchange";
  const head = chain.split("(")[0]?.trim() ?? chain;
  return head.length > 42 ? `${head.slice(0, 40)}…` : head;
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
  const [includeLongTail, setIncludeLongTail] = useState(false);
  const [includeUnverified, setIncludeUnverified] = useState(false);
  const [onchainOnly, setOnchainOnly] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const view = useMemo(
    () => selectPerpsRange(model.days, range, excludeLeveraged, includeLongTail, includeUnverified),
    [model.days, range, excludeLeveraged, includeLongTail, includeUnverified],
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
  const volumeVenues = view.venues.filter((venue) => !venue.noEquity);
  const quietVenues = view.venues.filter((venue) => venue.noEquity);
  const maxVenue = maxNullable(volumeVenues.map((venue) => venue.volumeUsd));
  const underlyings = onchainOnly ? view.onchainUnderlyings : view.underlyings;
  const maxUnderlying = maxNullable(underlyings.map((row) => row.volumeUsd));
  const hovered = hover === null ? null : bars.find((bar) => bar.index === hover) ?? null;
  const dateLabels = range === "24h" ? bars : selectDateAxisLabelTicks(bars, range, (bar) => bar.cx);
  const historyDates = [...model.days].map((day) => day.date).sort((a, b) => a.localeCompare(b));
  const latestDay = historyDates.length > 0 ? (model.days.find((day) => day.date === historyDates[historyDates.length - 1]) ?? null) : null;

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
          tokenized stock. These numbers are not added to the home spot total or Chain volume. Commodities,
          FX, bonds, and vol are excluded. Pre-IPO is a side stat. The headline is onchain, Binance+Bybit,
          and other major CEXs. Long-tail CoinGecko venues are opt-in. A venue whose volume is more than
          25× open interest, or whose open interest is under $5M with volume over $100M, is recorded and
          left out.
        </p>
        {latestDay ? <Freshness day={latestDay} /> : null}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm" data-perps-downloads>
          <Link href="/perps/methodology" className="text-primary underline-offset-2 hover:underline" data-perps-methodology-link>
            Methodology
          </Link>
          {PERPS_CSV_FILES.map((file) => (
            <a
              key={file.id}
              href={file.href}
              data-perps-csv={file.id}
              className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              {file.label} CSV
            </a>
          ))}
          {PERPS_JSON_FILES.map((file) => (
            <a
              key={file.id}
              href={file.href}
              data-perps-json={file.id}
              className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              {file.label.replace(" JSON", "")} JSON
            </a>
          ))}
        </div>
      </header>

      <DataChecks day={latestDay} />

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
          <button
            type="button"
            data-perps-long-tail
            aria-pressed={includeLongTail}
            onClick={() => setIncludeLongTail((current) => !current)}
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
              includeLongTail
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground ring-1 ring-border hover:text-foreground"
            }`}
          >
            {includeLongTail ? "Long-tail included" : "Include long-tail"}
          </button>
          <button
            type="button"
            data-perps-unverified
            aria-pressed={includeUnverified}
            onClick={() => setIncludeUnverified((current) => !current)}
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
              includeUnverified
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground ring-1 ring-border hover:text-foreground"
            }`}
          >
            {includeUnverified ? "Unverified included" : "Include unverified"}
          </button>
          {view.leveragedUsd !== null ? (
            <p className="text-[11px] text-muted-foreground" data-perps-leveraged-note>
              {excludeLeveraged
                ? `Hidden leveraged ETF volume ${formatUsdCompact(view.leveragedUsd)}.`
                : `Includes leveraged ETFs ${formatUsdCompact(view.leveragedUsd)}.`}
            </p>
          ) : null}
          {view.longTailUsd !== null && !includeLongTail ? (
            <p className="text-[11px] text-muted-foreground" data-perps-long-tail-note>
              Long-tail {formatUsdCompact(view.longTailUsd)} is not in this total.
            </p>
          ) : null}
          {view.unverifiedUsd !== null && !includeUnverified ? (
            <p className="text-[11px] text-muted-foreground" data-perps-unverified-note>
              Unverified {formatUsdCompact(view.unverifiedUsd)} is not in this total.
            </p>
          ) : null}
          {view.excludedUsd !== null ? (
            <p className="text-[11px] text-muted-foreground" data-perps-excluded-note>
              Excluded by the volume/OI screen {formatUsdCompact(view.excludedUsd)}.
            </p>
          ) : null}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5" data-perps-tiers>
          <TierStat label="Onchain" value={view.onchainUsd} />
          <TierStat label="Binance+Bybit" value={view.cexCoingeckoUsd} />
          <TierStat label="Major CEX" value={view.cexDirectUsd} />
          <TierStat label={includeLongTail ? "Long-tail" : "Long-tail (out)"} value={view.longTailUsd} />
          <TierStat label={includeUnverified ? "Unverified" : "Unverified (out)"} value={view.unverifiedUsd} />
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
              <DateAxisLabels
                ticks={dateLabels.map((bar) => bar.t)}
                x={(tick) => dateLabels.find((bar) => bar.t === tick)?.cx ?? 0}
                chartHeight={VOLUME_CHART_HEIGHT}
                label={formatChartDay}
              />
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
        <p className="mt-2 text-[11px] leading-snug text-muted-foreground" data-perps-history-note>
          {historyDates.length === 0
            ? "No closed days are stored yet."
            : `Stored history is ${historyDates.length} day${historyDates.length === 1 ? "" : "s"}, ${historyDates[0]} through ${historyDates[historyDates.length - 1]}. Ranges longer than that sum only the days that exist. Missing days stay empty.`}
        </p>
        <p className="mt-2 text-[11px] leading-snug text-muted-foreground" data-perps-window-note>
          Venue 24h figures are rolling windows at capture time, except where a venue has no 24h field. Hyperliquid
          hourly candles are base size, not USD, so that row stays on rolling dayNtlVlm. Ostium shows a daily number
          only as the lifetime difference between two consecutive Eastern snapshots.
        </p>
      </section>

      <section className="space-y-3" data-perps-venues>
        <h3 className="font-heading text-lg font-medium">Venues</h3>
        <QualityNote venues={volumeVenues} />
        {volumeVenues.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-card px-6 py-10 text-center">
            <p className="text-sm text-muted-foreground">No venue rows in this snapshot.</p>
          </div>
        ) : (
          <>
          <div className="grid gap-2 md:hidden" data-perps-venue-cards>
            {volumeVenues.map((venue, index) => (
              <VenueCard
                key={venue.venue}
                rank={index + 1}
                venue={venue}
                inHeadline={
                  venue.credible &&
                  (includeLongTail || venue.tier !== "long-tail") &&
                  (includeUnverified || venue.tier !== "unverified")
                }
              />
            ))}
          </div>
          <div className="hidden overflow-x-auto md:block">
            <div className="grid w-full min-w-[84rem] grid-cols-[2.5rem_minmax(13rem,1.4fr)_6.5rem_minmax(6.5rem,0.8fr)_minmax(6rem,0.7fr)_4.5rem_4rem_minmax(9rem,1.1fr)_minmax(8rem,0.9fr)_minmax(8rem,0.7fr)] gap-x-3 gap-y-2">
              {["#", "Venue", "Tier", "Volume", "Open interest", "Vol/OI", "Markets", "Chain / operator", "Source", "As of"].map((label) => (
                <div key={label} className="px-1 text-xs text-muted-foreground">
                  {label}
                </div>
              ))}
              {volumeVenues.map((venue, index) => (
                <VenueRow
                  key={venue.venue}
                  rank={index + 1}
                  venue={venue}
                  maxVolume={maxVenue}
                  inHeadline={
                  venue.credible &&
                  (includeLongTail || venue.tier !== "long-tail") &&
                  (includeUnverified || venue.tier !== "unverified")
                }
                />
              ))}
            </div>
          </div>
          </>
        )}
        {quietVenues.length > 0 ? (
          <p className="max-w-3xl text-[11px] leading-snug text-muted-foreground" data-perps-no-equity>
            Seen this capture, no equity markets: {quietVenues.map((venue) => venue.venue).join(", ")}. A later equity listing on one of these names is the same venue.
          </p>
        ) : null}
      </section>

      <section className="space-y-3" data-perps-underlyings>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h3 className="font-heading text-lg font-medium">Top underlyings</h3>
          <button
            type="button"
            data-perps-onchain-only
            aria-pressed={onchainOnly}
            onClick={() => setOnchainOnly((current) => !current)}
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
              onchainOnly
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground ring-1 ring-border hover:text-foreground"
            }`}
          >
            {onchainOnly ? "Showing onchain" : "Onchain only"}
          </button>
        </div>
        {view.underlyings.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-card px-6 py-10 text-center">
            <p className="text-sm text-muted-foreground">No equity underlyings in this snapshot.</p>
          </div>
        ) : (
          <div className="grid gap-2">
            {underlyings.map((row) => (
              <div
                key={row.group}
                className="grid grid-cols-[minmax(0,1.4fr)_7.5rem_minmax(6rem,0.7fr)_minmax(6rem,0.7fr)] items-center gap-3 rounded-xl bg-card px-4 py-2.5 text-sm ring-1 ring-foreground/10"
                data-perps-underlying={row.group}
              >
                <div className="min-w-0">
                  <Link href={perpsTickerHref(row.group)} className="block truncate font-medium hover:text-primary" data-perps-underlying-link={row.group}>
                    {row.group}
                  </Link>
                  <p className="text-[10px] text-muted-foreground">
                    {perpCategoryLabel(row.category)}
                    {row.venueCount > 0 ? ` · ${row.venueCount} ${row.venueCount === 1 ? "venue" : "venues"}` : ""}
                  </p>
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

      <OiSection
        days={model.days}
        excludeLeveraged={excludeLeveraged}
        includeLongTail={includeLongTail}
        includeUnverified={includeUnverified}
      />
      <ListingSection days={model.days} />
      <ShareSection points={view.share} empty={model.days.length === 0} range={range} />
      <HistoryShareSection
        days={model.days}
        excludeLeveraged={excludeLeveraged}
        includeLongTail={includeLongTail}
        includeUnverified={includeUnverified}
      />
      <ChainSection view={view} empty={model.days.length === 0} />
      <CategorySection view={view} empty={model.days.length === 0} />
      <FundingSection view={view} empty={model.days.length === 0} />
      <PlacesSection />
    </div>
  );
}

function EmptyPanel({ children }: { children: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card px-6 py-10 text-center">
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

const SHARE_LAYERS: {
  key: keyof Pick<PerpsSharePoint, "onchainUsd" | "majorCexUsd" | "binanceBybitUsd" | "longTailUsd" | "unverifiedUsd">;
  label: string;
  color: string;
}[] = [
  { key: "onchainUsd", label: "Onchain", color: "var(--chart-1)" },
  { key: "binanceBybitUsd", label: "Binance+Bybit", color: "var(--chart-3)" },
  { key: "majorCexUsd", label: "Major CEX", color: "var(--chart-2)" },
  { key: "longTailUsd", label: "Long-tail", color: "var(--chart-4)" },
  { key: "unverifiedUsd", label: "Unverified", color: "var(--chart-5)" },
];

function ShareSection({
  points,
  empty,
  range,
}: {
  points: PerpsSharePoint[];
  empty: boolean;
  range: VolumeChartRangeId;
}) {
  const rows = points.filter((point) => SHARE_LAYERS.some((layer) => point[layer.key] !== null));
  const maxY = Math.max(
    ...rows.map((point) => SHARE_LAYERS.reduce((sum, layer) => sum + (point[layer.key] ?? 0), 0)),
    1,
  );
  const plotBottom = VOLUME_CHART_PAD.top + VOLUME_CHART_INNER_H;
  const plotLeft = VOLUME_CHART_PAD.left;
  const plotWidth = VOLUME_CHART_WIDTH - VOLUME_CHART_PAD.left - VOLUME_CHART_PAD.right;
  const slot = rows.length > 0 ? plotWidth / rows.length : plotWidth;
  const barWidth = Math.min(36, slot * 0.62);
  const labelRows =
    range === "24h"
      ? rows
      : selectDateAxisLabelTicks(rows, range, (_point, index) => plotLeft + slot * index + slot / 2);
  return (
    <section className="space-y-3" data-perps-share>
      <h3 className="font-heading text-lg font-medium">Onchain vs CEX</h3>
      <p className="max-w-3xl text-[11px] leading-snug text-muted-foreground">
        Share of the headline from each daily snapshot. Long-tail appears only when it is included. Excluded venues stay out.
      </p>
      {rows.length === 0 ? (
        <EmptyPanel>
          {empty
            ? "No equity-perp snapshot yet. The onchain and CEX split appears after the first nightly capture."
            : "No closed Eastern day in this range yet. 24H shows the split once a capture exists."}
        </EmptyPanel>
      ) : (
        <div className={`rounded-xl border border-border bg-card/80 px-2 py-3 ${CHART_PLOT_FRAME_CLASS}`}>
          <svg viewBox={`0 0 ${VOLUME_CHART_WIDTH} ${VOLUME_CHART_HEIGHT}`} className="h-[220px] w-full" role="img" aria-label="Onchain versus CEX equity perp volume">
            {rows.map((point, index) => {
              const x = plotLeft + slot * index + (slot - barWidth) / 2;
              let cursor = plotBottom;
              return (
                <g key={point.date}>
                  {SHARE_LAYERS.map((layer) => {
                    const value = point[layer.key] ?? 0;
                    if (!(value > 0)) return null;
                    const height = (value / maxY) * VOLUME_CHART_INNER_H;
                    cursor -= height;
                    return <rect key={layer.key} x={x} y={cursor} width={barWidth} height={height} fill={layer.color} />;
                  })}
                </g>
              );
            })}
            <DateAxisLabels
              ticks={labelRows.map((point) => point.t)}
              x={(tick) => {
                const index = rows.findIndex((point) => point.t === tick);
                return plotLeft + slot * index + slot / 2;
              }}
              chartHeight={VOLUME_CHART_HEIGHT}
              label={formatChartDay}
            />
          </svg>
          <div className="mt-2 flex flex-wrap gap-3 px-2 text-[11px] text-muted-foreground">
            {SHARE_LAYERS.map((layer) => (
              <span key={layer.key} className="inline-flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: layer.color }} />
                {layer.label}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function ChainSection({
  view,
  empty,
}: {
  view: ReturnType<typeof selectPerpsRange>;
  empty: boolean;
}) {
  const maxChain = maxNullable(view.chains.map((row) => row.volumeUsd));
  const graveyard = HIP3_BUILDERS.filter((builder) => !builder.live);
  return (
    <section className="space-y-3" data-perps-chains>
      <h3 className="font-heading text-lg font-medium">Where the onchain volume runs</h3>
      {view.chains.length === 0 ? (
        <EmptyPanel>
          {empty
            ? "No equity-perp snapshot yet. Chain totals appear after the first nightly capture."
            : "No onchain 24h volume in this range."}
        </EmptyPanel>
      ) : (
        <div className="grid gap-2">
          {view.chains.map((row) => (
            <div key={row.chain} className="grid grid-cols-[minmax(0,1.2fr)_7rem_minmax(5rem,0.6fr)] items-center gap-3 rounded-xl bg-card px-4 py-2 text-sm ring-1 ring-foreground/10" data-perps-chain={row.chain}>
              <p className="truncate font-medium">{row.chain}</p>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: `${volumeShare(row.volumeUsd, maxChain)}%` }} />
              </div>
              <p className="num text-right text-primary">{formatUsdCompact(row.volumeUsd)}</p>
            </div>
          ))}
        </div>
      )}
      <div className="space-y-2" data-perps-builders>
        <h4 className="text-sm font-medium">Hyperliquid HIP-3 builders</h4>
        <p className="max-w-3xl text-[11px] leading-snug text-muted-foreground">
          Each deployer dex is one book on HyperCore. Frontends such as trade.xyz are not counted again.
        </p>
        {view.builders.length === 0 ? (
          <EmptyPanel>
            {empty ? "Builder volume appears after the first Hyperliquid capture." : "No live HIP-3 equity volume in this range."}
          </EmptyPanel>
        ) : (
          <div className="grid gap-2">
            {view.builders.map((row) => {
              const meta = HIP3_BUILDERS.find((builder) => builder.dex === row.dex);
              return (
                <div key={row.dex} className="grid grid-cols-[minmax(0,1.4fr)_6rem_6rem] items-center gap-3 rounded-xl bg-card px-4 py-2 text-sm ring-1 ring-foreground/10" data-perps-builder={row.dex}>
                  <div className="min-w-0">
                    <p className="truncate font-medium">{meta?.name ?? row.dex}</p>
                    <p className="truncate text-[10px] text-muted-foreground">{meta?.deployer ?? row.dex}</p>
                  </div>
                  <p className="num text-right">{formatUsdCompact(row.volumeUsd)}</p>
                  <p className="num text-right text-muted-foreground">{formatUsdCompact(row.openInterestUsd)}</p>
                </div>
              );
            })}
          </div>
        )}
        <p className="text-[11px] text-muted-foreground" data-perps-graveyard>
          Delisted at the last research pass: {graveyard.map((builder) => `${builder.name} (${builder.dex})`).join(", ")}.
        </p>
      </div>
    </section>
  );
}

function CategorySection({
  view,
  empty,
}: {
  view: ReturnType<typeof selectPerpsRange>;
  empty: boolean;
}) {
  const maxMix = maxNullable(view.categories.map((row) => row.volumeUsd));
  const labels: Record<PerpsCategory, string> = {
    stock: "Stocks",
    "leveraged-etf": "Leveraged ETFs",
    etf: "ETFs",
    index: "Indices",
  };
  const any = view.categories.some((row) => row.volumeUsd !== null);
  return (
    <section className="space-y-3" data-perps-mix>
      <h3 className="font-heading text-lg font-medium">Category mix</h3>
      <p className="max-w-3xl text-[11px] leading-snug text-muted-foreground">
        Headline venues. This split still shows leveraged ETFs when that toggle is on, so the bars can be read next to the hidden total.
      </p>
      {!any ? (
        <EmptyPanel>{empty ? "No equity-perp snapshot yet." : "No category volume in this range."}</EmptyPanel>
      ) : (
        <div className="grid gap-2">
          {view.categories.map((row) => (
            <div key={row.category} className="grid grid-cols-[8.5rem_minmax(0,1fr)_6rem] items-center gap-3 rounded-xl bg-card px-4 py-2 text-sm ring-1 ring-foreground/10" data-perps-category={row.category}>
              <p>{labels[row.category]}</p>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: `${volumeShare(row.volumeUsd, maxMix)}%` }} />
              </div>
              <p className="num text-right text-primary">{formatUsdCompact(row.volumeUsd)}</p>
            </div>
          ))}
        </div>
      )}
      <p className="text-[11px] text-muted-foreground" data-perps-preipo>
        Pre-IPO, not in the headline: {formatUsdCompact(view.preipoUsd)}
      </p>
    </section>
  );
}

function FundingSection({
  view,
  empty,
}: {
  view: ReturnType<typeof selectPerpsRange>;
  empty: boolean;
}) {
  return (
    <section className="space-y-3" data-perps-funding>
      <h3 className="font-heading text-lg font-medium">Funding spread</h3>
      <p className="max-w-3xl text-[11px] leading-snug text-muted-foreground">
        Derived. The gap is the widest minus the narrowest 8h-equivalent rate on the newest day in this range. A venue counts only when its interval was stored, or when Hyperliquid&apos;s hourly payment is the documented quote. Native rates that have no interval are left out of the spread. Ticker pages show each venue.
      </p>
      {view.fundingSpreads.length === 0 ? (
        <EmptyPanel>
          {empty
            ? "No equity-perp snapshot yet. Funding appears when a capture includes a rate."
            : "No ticker has two venues with a known funding interval, so an 8h spread is not computed."}
        </EmptyPanel>
      ) : (
        <div className="grid gap-2">
          {view.fundingSpreads.map((row) => (
            <div key={row.group} className="rounded-xl bg-card px-4 py-3 text-sm ring-1 ring-foreground/10" data-perps-funding-spread={row.group}>
              <div className="flex items-start justify-between gap-3">
                <Link href={perpsTickerHref(row.group)} className="font-medium hover:text-primary">
                  {row.group}
                </Link>
                <p className="num text-right text-primary">{formatFundingPercent(row.spreadEightHour)}</p>
              </div>
              <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                {row.lowVenue} to {row.highVenue} · 8h equivalent · Derived
              </p>
              <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                Annualized gap {formatAnnualizedPercent(row.spreadAnnualizedPct)} · Derived
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function PlacesSection() {
  return (
    <section className="space-y-3" data-perps-places>
      <h3 className="font-heading text-lg font-medium">Where it runs</h3>
      <p className="max-w-3xl text-[11px] leading-snug text-muted-foreground">
        Static reference from the Oct 8 2026 venue map. Jurisdiction is what CoinGecko lists unless noted. Oracle sources that were not confirmed in docs stay unverified.
        {PERPS_HELD_OUT.length > 0 ? ` ${PERPS_HELD_OUT.map((row) => `${row.venue}: ${row.reason}`).join(" ")}` : ""}
      </p>
      <div className="grid gap-2 md:hidden">
        {PERP_PLACES.map((place) => (
          <div key={place.venue} className="rounded-xl bg-card px-3 py-3 text-sm ring-1 ring-foreground/10" data-perps-place={place.venue}>
            <p className="font-medium">{place.venue}</p>
            <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{place.chain}</p>
            <p className="mt-1 text-[11px] leading-snug">{place.operator} · {place.jurisdiction}</p>
            <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{place.oracle}</p>
          </div>
        ))}
      </div>
      <div className="hidden overflow-x-auto md:block">
        <div className="grid w-full min-w-[64rem] grid-cols-[minmax(12rem,0.9fr)_minmax(14rem,1.2fr)_minmax(10rem,0.8fr)_minmax(10rem,0.8fr)_minmax(14rem,1.2fr)] gap-x-3 gap-y-2">
          {["Venue", "Chain / exchange", "Operator", "Jurisdiction", "Oracle"].map((label) => (
            <div key={label} className="px-1 text-xs text-muted-foreground">{label}</div>
          ))}
          {PERP_PLACES.map((place) => (
            <div key={place.venue} className="col-span-full grid grid-cols-subgrid items-start rounded-xl bg-card px-3 py-2.5 text-sm ring-1 ring-foreground/10" data-perps-place={place.venue}>
              <p className="font-medium">{place.venue}</p>
              <p className="text-xs leading-snug text-muted-foreground">{place.chain}</p>
              <p className="text-xs leading-snug">{place.operator}</p>
              <p className="text-xs leading-snug text-muted-foreground">{place.jurisdiction}</p>
              <p className="text-xs leading-snug text-muted-foreground">{place.oracle}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function QualityNote({ venues }: { venues: readonly PerpsVenueRow[] }) {
  const counts = { fresh: 0, stale: 0, failed: 0 };
  for (const venue of venues) counts[perpsVenueQuality(venue)] += 1;
  return (
    <p className="max-w-3xl text-[11px] leading-snug text-muted-foreground" data-perps-quality-note>
      {counts.failed + counts.stale === 0
        ? `${counts.fresh} venues reported on this capture. A venue that fails stays on this table with a blank volume. It is not counted as zero.`
        : `${counts.failed} failed and ${counts.stale} stale. Their volume is blank, not zero, and not in the headline. Stale means an earlier capture succeeded.`}
    </p>
  );
}

function QualityPill({ venue }: { venue: PerpsVenueRow }) {
  const quality = perpsVenueQuality(venue);
  const className =
    quality === "failed"
      ? "bg-destructive/15 text-destructive"
      : quality === "stale"
        ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
        : "bg-muted text-muted-foreground";
  return (
    <span className={`mb-0.5 inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-medium ${className}`} data-perps-quality={quality}>
      {quality === "fresh" ? "Fresh" : quality === "stale" ? "Stale" : "Failed"}
    </span>
  );
}

function VenueCard({
  rank,
  venue,
  inHeadline,
}: {
  rank: number;
  venue: PerpsVenueRow;
  inHeadline: boolean;
}) {
  return (
    <div className="rounded-xl bg-card px-3 py-3 text-sm ring-1 ring-foreground/10" data-perps-venue={venue.venue}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">#{rank} {venue.venue}</p>
          <p className="text-[10px] text-muted-foreground">{perpsTierLabel(venue.tier)} · {chainLabel(venue.chain)}</p>
        </div>
        <QualityPill venue={venue} />
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <div>
          <p className="text-[10px] text-muted-foreground">Volume</p>
          <p className="num text-primary">{formatUsdCompact(venue.volumeUsd)}</p>
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground">Open interest</p>
          <p className="num">{formatUsdCompact(venue.openInterestUsd)}</p>
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground">Vol/OI</p>
          <p className="num">{formatVolOi(venue.volumeUsd, venue.openInterestUsd)}</p>
        </div>
      </div>
      <p className="mt-2 text-[10px] text-muted-foreground">
        {venue.marketCount} markets · {perpsFeedKind(venue.source)} · {venue.capturedAt ? formatPerpsEt(venue.capturedAt) : "—"}
        {!venue.credible ? " · Excluded" : !inHeadline ? " · Not in headline" : ""}
        {venue.error ? ` · ${venue.error}` : ""}
      </p>
    </div>
  );
}

function OiSection({
  days,
  excludeLeveraged,
  includeLongTail,
  includeUnverified,
}: {
  days: PerpsDeskModel["days"];
  excludeLeveraged: boolean;
  includeLongTail: boolean;
  includeUnverified: boolean;
}) {
  const series = perpsOiSeries(days, excludeLeveraged, includeLongTail, includeUnverified);
  const latest = series[series.length - 1] ?? null;
  return (
    <section className="space-y-3" data-perps-oi>
      <h3 className="font-heading text-lg font-medium">Open interest</h3>
      <p className="max-w-3xl text-[11px] leading-snug text-muted-foreground">
        Headline venues on each closed day. Open interest is a stock, so it is not summed across days. Vol/OI is that day&apos;s volume divided by that day&apos;s open interest. A missing open interest stays blank.
      </p>
      {latest ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <TierStat label={`OI ${latest.date}`} value={latest.openInterestUsd} />
          <TierStat label="Volume that day" value={latest.volumeUsd} />
          <div className="min-w-0 rounded-lg bg-background/60 px-3 py-2 ring-1 ring-foreground/10">
            <p className="text-[10px] text-muted-foreground">Vol/OI</p>
            <p className="num mt-0.5 text-sm font-medium">{formatVolOi(latest.volumeUsd, latest.openInterestUsd)}</p>
          </div>
        </div>
      ) : (
        <EmptyPanel>No closed day with an open-interest total yet.</EmptyPanel>
      )}
      {series.length > 0 ? (
        <div className="overflow-x-auto">
          <div className="grid min-w-[20rem] gap-2">
            {series.map((point) => (
              <div key={point.date} className="grid grid-cols-3 gap-3 rounded-xl bg-card px-3 py-2 text-sm ring-1 ring-foreground/10" data-perps-oi-day={point.date}>
                <p>{formatChartDay(point.t)}</p>
                <p className="num text-right">{formatUsdCompact(point.openInterestUsd)}</p>
                <p className="num text-right text-muted-foreground">{formatVolOi(point.volumeUsd, point.openInterestUsd)}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ListingSection({ days }: { days: PerpsDeskModel["days"] }) {
  const change = perpsListingChanges(days);
  if (!change) return null;
  const showBook = change.scope === "book" || change.scope === "partial";
  const showCap = change.scope !== "unavailable";
  return (
    <section className="space-y-3" data-perps-listings>
      <h3 className="font-heading text-lg font-medium">Listings and the stored cap</h3>
      <p className="max-w-3xl text-[11px] leading-snug text-muted-foreground" data-perps-listings-note>
        {change.note}
      </p>
      {showBook ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <NameList title="Listed in the book" names={change.listed} empty="No new names in the full book." />
          <NameList title="Delisted from the book" names={change.delisted} empty="No names left the full book." />
        </div>
      ) : null}
      {showCap ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <NameList title="Entered the stored ticker cap" names={change.enteredCap} empty="No name entered the capped list." />
          <NameList title="Left the stored ticker cap" names={change.leftCap} empty="No name left the capped list." />
        </div>
      ) : null}
    </section>
  );
}

function NameList({ title, names, empty }: { title: string; names: readonly string[]; empty: string }) {
  return (
    <div className="rounded-xl bg-card px-4 py-3 text-sm ring-1 ring-foreground/10">
      <p className="font-medium">{title}</p>
      {names.length === 0 ? (
        <p className="mt-1 text-[11px] text-muted-foreground">{empty}</p>
      ) : (
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{names.join(", ")}</p>
      )}
    </div>
  );
}

function HistoryShareSection({
  days,
  excludeLeveraged,
  includeLongTail,
  includeUnverified,
}: {
  days: PerpsDeskModel["days"];
  excludeLeveraged: boolean;
  includeLongTail: boolean;
  includeUnverified: boolean;
}) {
  const venues = perpsVenueShareSeries(days, excludeLeveraged, includeLongTail, 8, includeUnverified);
  const chains = perpsChainShareSeries(days, excludeLeveraged, includeLongTail, includeUnverified);
  const dates = venues.map((column) => column.date);
  return (
    <section className="space-y-3" data-perps-share-history>
      <h3 className="font-heading text-lg font-medium">Share over time</h3>
      <p className="max-w-3xl text-[11px] leading-snug text-muted-foreground">
        Percent of that day&apos;s headline. The venue list is the latest day&apos;s top names. A blank cell means that name was absent, not zero. Chain share is onchain volume divided by the same headline. Long-tail is out unless the toggle includes it.
      </p>
      {dates.length === 0 ? (
        <EmptyPanel>Share by venue and chain appears once a closed day is stored.</EmptyPanel>
      ) : (
        <>
          <ShareTable title="Venues" columns={venues} testId="venue" />
          <ShareTable title="Chains" columns={chains} testId="chain" />
        </>
      )}
    </section>
  );
}

function ShareTable({
  title,
  columns,
  testId,
}: {
  title: string;
  columns: ReturnType<typeof perpsVenueShareSeries>;
  testId: string;
}) {
  const names = columns[0]?.rows.map((row) => row.name) ?? [];
  if (names.length === 0) return null;
  return (
    <div className="overflow-x-auto" data-perps-share-table={testId}>
      <p className="mb-2 text-sm font-medium">{title}</p>
      <table className="w-full min-w-[36rem] border-separate border-spacing-y-2 text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th className="px-3 font-normal">{title.slice(0, -1)}</th>
            {columns.map((column) => (
              <th key={column.date} className="px-2 font-normal">{column.date.slice(5)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {names.map((name) => (
            <tr key={name} className="bg-card ring-1 ring-foreground/10">
              <td className="rounded-l-xl px-3 py-2 font-medium">{name}</td>
              {columns.map((column, index) => {
                const cell = column.rows.find((row) => row.name === name);
                const last = index === columns.length - 1;
                return (
                  <td key={column.date} className={`num px-2 py-2 text-right ${last ? "rounded-r-xl" : ""}`}>
                    {cell?.share === null || cell?.share === undefined ? "—" : `${(cell.share * 100).toFixed(cell.share >= 0.1 ? 0 : 1)}%`}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function VenueRow({
  rank,
  venue,
  maxVolume,
  inHeadline,
}: {
  rank: number;
  venue: PerpsVenueRow;
  maxVolume: number | null;
  inHeadline: boolean;
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
          {!venue.credible ? (
            <span className="rounded-full bg-destructive/15 px-1.5 py-0.5 text-[10px] font-medium text-destructive" title={venue.excludeReason ?? undefined} data-perps-excluded>
              Excluded
            </span>
          ) : !inHeadline ? (
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground" data-perps-not-headline>
              Not in headline
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
      <p className="num text-right text-xs" title={venue.windowNote}>
        {formatVolOi(venue.volumeUsd, venue.openInterestUsd)}
      </p>
      <p className="num text-right">{venue.marketCount}</p>
      <div className="min-w-0" title={venue.chain}>
        <p className="truncate text-xs">{chainLabel(venue.chain)}</p>
        <p className="truncate text-[10px] text-muted-foreground">{venue.operator || "—"}</p>
      </div>
      <div className="min-w-0" title={venue.source} data-perps-source-kind={perpsFeedKind(venue.source)}>
        <p className="truncate text-xs">{perpsFeedKind(venue.source)}</p>
        <p className="truncate text-[10px] text-muted-foreground">{shortPerpsSource(venue.source)}</p>
      </div>
      <div className="text-xs leading-snug text-muted-foreground" data-perps-freshness title={venue.windowNote}>
        <QualityPill venue={venue} />
        <p>{venue.capturedAt ? formatPerpsEt(venue.capturedAt) : "—"}</p>
        {perpsVenueQuality(venue) === "stale" && venue.lastGoodAt ? (
          <p>Last good {formatPerpsEt(venue.lastGoodAt)}</p>
        ) : null}
      </div>
    </div>
  );
}
