"use client";

import { useState, type PointerEvent } from "react";
import Link from "next/link";
import { CHART_PLOT_FRAME_CLASS, DESK_CHART_STROKE, monotoneLinePath } from "@/lib/desk/chart-curve";
import {
  VOLUME_CHART_HEIGHT,
  VOLUME_CHART_INNER_H,
  VOLUME_CHART_PAD,
  VOLUME_CHART_WIDTH,
} from "@/lib/market/daily-volume-view";
import { formatChartDay, formatUsdCompact, formatUsdFull } from "@/lib/market/format";
import { maxNullable } from "@/lib/market/numbers";
import type { PerpsTickerPageModel, PerpsTickerPoint, PerpsTickerVenueShare } from "@/lib/market/perps-ticker";
import type { PerpsTier } from "@/lib/market/perps-snapshot";

function formatFunding(rate: number | null): string {
  if (rate === null) return "—";
  const pct = rate * 100;
  const digits = Math.abs(pct) >= 1 ? 2 : 3;
  return `${pct >= 0 ? "" : "−"}${Math.abs(pct).toFixed(digits)}%`;
}

function tierGroups(rows: readonly PerpsTickerVenueShare[], tickerVolume: number | null): {
  tier: PerpsTier;
  tierLabel: string;
  tierVolumeUsd: number | null;
  share: number | null;
  venues: string[];
}[] {
  const order: PerpsTier[] = ["onchain", "cex-direct", "cex-coingecko", "long-tail"];
  return order.flatMap((tier) => {
    const group = rows.filter((row) => row.tier === tier);
    const first = group[0];
    if (!first) return [];
    const share =
      tickerVolume !== null && tickerVolume > 0 && first.tierVolumeUsd !== null ? first.tierVolumeUsd / tickerVolume : null;
    return [
      {
        tier,
        tierLabel: first.tierLabel,
        tierVolumeUsd: first.tierVolumeUsd,
        share,
        venues: group.map((row) => row.venue),
      },
    ];
  });
}

function formatShare(share: number | null): string {
  if (share === null || !Number.isFinite(share)) return "—";
  return `${(share * 100).toFixed(share >= 0.1 ? 0 : 1)}%`;
}

function SeriesChart({
  points,
  value,
  label,
  empty,
}: {
  points: readonly PerpsTickerPoint[];
  value: (point: PerpsTickerPoint) => number | null;
  label: string;
  empty: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const plotted = points.flatMap((point, index) => {
    const amount = value(point);
    return amount === null ? [] : [{ point, index, amount }];
  });
  const maxY = Math.max(maxNullable(plotted.map((row) => row.amount)) ?? 0, 1);
  const plotBottom = VOLUME_CHART_PAD.top + VOLUME_CHART_INNER_H;
  const plotLeft = VOLUME_CHART_PAD.left;
  const plotWidth = VOLUME_CHART_WIDTH - VOLUME_CHART_PAD.left - VOLUME_CHART_PAD.right;
  const slot = plotted.length > 0 ? plotWidth / plotted.length : plotWidth;
  const yOf = (amount: number) => plotBottom - (amount / maxY) * VOLUME_CHART_INNER_H;
  const bars = plotted.map((row, index) => {
    const cx = plotLeft + slot * index + slot / 2;
    return { ...row, cx, y: yOf(row.amount) };
  });
  const curve = bars.length >= 2 ? monotoneLinePath(bars.map((bar) => ({ x: bar.cx, y: bar.y }))) : "";
  const hovered = hover === null ? null : bars.find((bar) => bar.index === hover) ?? null;

  function hoverFromClient(plot: HTMLDivElement, clientX: number) {
    const svg = plot.querySelector("svg");
    const matrix = svg?.getScreenCTM();
    if (!matrix || bars.length === 0) return;
    const point = new DOMPoint(clientX, 0).matrixTransform(matrix.inverse());
    let nearest = bars[0]?.index ?? 0;
    let best = Number.POSITIVE_INFINITY;
    for (const bar of bars) {
      const distance = Math.abs(bar.cx - point.x);
      if (distance < best) {
        best = distance;
        nearest = bar.index;
      }
    }
    setHover(nearest);
  }

  if (bars.length === 0) {
    return (
      <div className={`flex h-[180px] items-center justify-center border border-dashed border-border bg-muted/20 px-6 text-center ${CHART_PLOT_FRAME_CLASS}`}>
        <p className="max-w-md text-sm text-muted-foreground">{empty}</p>
      </div>
    );
  }

  return (
    <div
      className={`relative cursor-crosshair ${CHART_PLOT_FRAME_CLASS}`}
      onPointerLeave={() => setHover(null)}
      onPointerMove={(event: PointerEvent<HTMLDivElement>) => hoverFromClient(event.currentTarget, event.clientX)}
    >
      <svg
        viewBox={`0 0 ${VOLUME_CHART_WIDTH} ${VOLUME_CHART_HEIGHT}`}
        preserveAspectRatio="none"
        className="pointer-events-none h-[220px] w-full"
        role="img"
        aria-label={label}
      >
        {bars.map((bar) => (
          <circle key={bar.point.date} cx={bar.cx} cy={bar.y} r="3" fill="var(--volume)" />
        ))}
        {curve ? (
          <path d={curve} fill="none" stroke={DESK_CHART_STROKE} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        ) : null}
        {bars.map((bar) => (
          <text key={`${bar.point.date}-label`} x={bar.cx} y={VOLUME_CHART_HEIGHT - 8} textAnchor="middle" className="fill-muted-foreground" fontSize="10">
            {formatChartDay(bar.point.t)}
          </text>
        ))}
        {hovered ? <circle cx={hovered.cx} cy={hovered.y} r="4.5" fill={DESK_CHART_STROKE} /> : null}
      </svg>
      {hovered ? (
        <div className="pointer-events-none absolute top-2 right-2 z-20 rounded-md border border-border bg-background/95 px-2 py-1 text-xs shadow-sm">
          <p>{formatChartDay(hovered.point.t)}{hovered.point.closed ? "" : " · day open"}</p>
          <p className="num text-foreground">{formatUsdFull(hovered.amount)}</p>
        </div>
      ) : null}
    </div>
  );
}

export function PerpsTickerView({ model }: { model: PerpsTickerPageModel }) {
  const latest = model.latest;
  const onchain = latest?.onchainUsd ?? null;
  const cex = latest?.cexUsd ?? null;
  const splitMax = Math.max((onchain ?? 0) + (cex ?? 0), 1);
  return (
    <div className="space-y-6" data-perps-ticker={model.group}>
      <header className="space-y-2">
        <nav className="text-sm text-muted-foreground" data-perps-ticker-breadcrumb>
          <Link href="/perps" className="hover:text-foreground">
            Perps
          </Link>
          <span className="px-2">/</span>
          <span>{model.group}</span>
        </nav>
        <p className="text-[10px] font-medium tracking-wide text-primary">EQUITY PERP</p>
        <h2 className="font-heading text-2xl font-semibold tracking-tight">{model.group}</h2>
        <p className="text-sm text-muted-foreground" data-perps-ticker-category>
          {model.categoryLabel}
          {latest ? ` · latest stored day ${latest.date}` : ""}
        </p>
        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground" data-perps-ticker-status={model.status}>
          {model.message}
        </p>
      </header>

      {latest ? (
        <section className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-perps-ticker-stats>
          <Stat label="Volume" value={latest.volumeUsd} />
          <Stat label="Open interest" value={latest.openInterestUsd} />
          <Stat label="Onchain" value={latest.onchainUsd} />
          <Stat label="CEX" value={latest.cexUsd} />
        </section>
      ) : null}

      <section className="space-y-3 rounded-xl border border-border bg-card/80 px-4 py-4 sm:px-5" data-perps-ticker-volume>
        <h3 className="font-heading text-lg font-medium">Volume</h3>
        <SeriesChart
          points={model.points}
          value={(point) => point.volumeUsd}
          label={`${model.group} equity perp volume`}
          empty={model.status === "stored" ? "No reported volume in the stored days." : model.message}
        />
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-card/80 px-4 py-4 sm:px-5" data-perps-ticker-oi>
        <h3 className="font-heading text-lg font-medium">Open interest</h3>
        <SeriesChart
          points={model.points}
          value={(point) => point.openInterestUsd}
          label={`${model.group} equity perp open interest`}
          empty="No open interest is stored for this name."
        />
      </section>

      <section className="space-y-3" data-perps-ticker-split>
        <h3 className="font-heading text-lg font-medium">Onchain vs CEX</h3>
        <p className="max-w-3xl text-[11px] leading-snug text-muted-foreground">
          Latest stored day. CEX here is major CEX, Binance+Bybit, and long-tail together. Long-tail is not in the desk headline.
        </p>
        {latest && ((onchain ?? 0) > 0 || (cex ?? 0) > 0) ? (
          <div className="space-y-2 rounded-xl bg-card px-4 py-3 text-sm ring-1 ring-foreground/10">
            <SplitRow label="Onchain" value={onchain} max={splitMax} color="var(--chart-1)" />
            <SplitRow label="CEX" value={cex} max={splitMax} color="var(--chart-2)" />
            <p className="text-[11px] text-muted-foreground">
              Major CEX {formatUsdCompact(latest.cexDirectUsd)} · Binance+Bybit {formatUsdCompact(latest.cexCoingeckoUsd)} · Long-tail {formatUsdCompact(latest.longTailUsd)}
            </p>
          </div>
        ) : (
          <Empty>No onchain or CEX split is stored for this name.</Empty>
        )}
      </section>

      <section className="space-y-3" data-perps-ticker-venues>
        <h3 className="font-heading text-lg font-medium">Venues</h3>
        <p className="max-w-3xl text-[11px] leading-snug text-muted-foreground">
          {latest && latest.books.length > 0
            ? "Per-venue volume and open interest for this name. Stored for the top names only. A venue outside that list is absent, not zero."
            : "Venues that listed this name on the latest stored day. Share is the tier volume when that tier has one venue. Several venues in one tier share that tier total when the snapshot did not store a per-venue split."}
        </p>
        {latest && latest.books.length > 0 ? (
          <div className="grid gap-2" data-perps-ticker-books>
            {latest.books.map((book) => {
              const share =
                latest.volumeUsd !== null && latest.volumeUsd > 0 && book.volumeUsd !== null
                  ? book.volumeUsd / latest.volumeUsd
                  : null;
              return (
                <div key={book.venue} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-xl bg-card px-4 py-2 text-sm ring-1 ring-foreground/10" data-perps-ticker-book={book.venue}>
                  <p className="min-w-[8rem] flex-1 truncate font-medium">{book.venue}</p>
                  <p className="num text-primary">{formatUsdCompact(book.volumeUsd)}</p>
                  <p className="num text-muted-foreground">{formatUsdCompact(book.openInterestUsd)}</p>
                  <p className="num text-xs text-muted-foreground">{formatShare(share)}</p>
                </div>
              );
            })}
          </div>
        ) : null}
        {latest && latest.books.length > 0 ? null : model.venueShares.length === 0 ? (
          <Empty>No venue list is stored for this name.</Empty>
        ) : (
          <div className="grid gap-2">
            {tierGroups(model.venueShares, latest?.volumeUsd ?? null).map((group) => (
              <div key={group.tier} className="rounded-xl bg-card px-4 py-3 text-sm ring-1 ring-foreground/10" data-perps-ticker-tier={group.tier}>
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-medium">{group.tierLabel}</p>
                  <p className="num text-primary">
                    {formatUsdCompact(group.tierVolumeUsd)}
                    <span className="ml-2 text-muted-foreground">{formatShare(group.share)}</span>
                  </p>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  {group.venues.map((venue) => (
                    <span key={venue} data-perps-ticker-venue={venue} className="mr-2 inline-block">
                      {venue}
                    </span>
                  ))}
                </p>
                {group.venues.length > 1 ? (
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {group.venues.length} venues share this tier. The snapshot does not split the tier total by venue.
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3" data-perps-ticker-funding>
        <h3 className="font-heading text-lg font-medium">Funding</h3>
        <p className="max-w-3xl text-[11px] leading-snug text-muted-foreground">
          {model.fundingDate
            ? `Stored rates on ${model.fundingDate}. Intervals differ by venue. Blank means the feed had no rate.`
            : "No funding rate is stored for this name."}
        </p>
        {model.funding.length === 0 ? (
          <Empty>No funding rate is stored for this name.</Empty>
        ) : (
          <div className="grid gap-2">
            {model.funding.map((row) => (
              <div key={row.venue} className="grid grid-cols-[minmax(0,1fr)_6rem] items-center gap-3 rounded-xl bg-card px-4 py-2 text-sm ring-1 ring-foreground/10" data-perps-ticker-funding-venue={row.venue}>
                <p className="truncate font-medium">{row.venue}</p>
                <p className="num text-right">{formatFunding(row.rate)}</p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="min-w-0 rounded-lg bg-card px-3 py-2 ring-1 ring-foreground/10">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="num mt-0.5 text-sm font-medium">{formatUsdCompact(value)}</p>
    </div>
  );
}

function SplitRow({ label, value, max, color }: { label: string; value: number | null; max: number; color: string }) {
  const width = value !== null && value > 0 ? Math.max(2, (value / max) * 100) : 0;
  return (
    <div className="grid grid-cols-[6rem_minmax(0,1fr)_6rem] items-center gap-3">
      <p>{label}</p>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full" style={{ width: `${width}%`, background: color }} />
      </div>
      <p className="num text-right text-primary">{formatUsdCompact(value)}</p>
    </div>
  );
}

function Empty({ children }: { children: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card px-6 py-10 text-center">
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}
