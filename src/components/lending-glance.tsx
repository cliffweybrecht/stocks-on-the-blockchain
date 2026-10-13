"use client";

import { useState } from "react";
import { formatAddress, formatTokenAmount, formatUsdCompact } from "@/lib/market/format";
import {
  LENDING_DROP_FRACTIONS,
  lendingDropKey,
  lendingDropPercentLabel,
  type LendingDepth,
  type LendingDepthChain,
  type LendingDepthStock,
  type LendingDepthVenue,
  type LendingDropAnswer,
  type LendingDropFraction,
  type LendingDropScope,
  type LendingFillingFlag,
  type LendingGlanceCopy,
  type LendingSimpleBadge,
  type LendingStaleNote,
} from "@/lib/market/lending-glance";
import { formatLendingApy, formatLendingFractionPct, formatLtvPerHundred, type LendingTotals } from "@/lib/market/lending-snapshot";

type Metric = "collateral" | "borrowed";

type Drill =
  | { kind: "chains"; metric: Metric }
  | { kind: "chain"; chainId: string }
  | { kind: "venue"; venueId: string }
  | { kind: "stock"; ticker: string; venueId?: string };

function usd(value: number | null | undefined): string {
  return formatUsdCompact(value);
}

function limitLabel(maxLtv: number | null): string {
  if (maxLtv === null) return "—";
  return `${formatLtvPerHundred(maxLtv)} per $100`;
}

function sourceHost(source: string): string {
  try {
    return new URL(source).host.replace(/^www\./, "");
  } catch {
    return source || "snapshot";
  }
}

function SourceLine({ source }: { source: string }) {
  let href: string | null = null;
  try {
    const url = new URL(source);
    if (url.protocol === "https:" || url.protocol === "http:") href = url.toString();
  } catch {
    href = null;
  }
  return (
    <p className="text-sm leading-6 text-muted-foreground">
      Source{" "}
      {href ? (
        <a className="text-foreground underline-offset-2 hover:underline" href={href} target="_blank" rel="noreferrer">
          {sourceHost(source)}
        </a>
      ) : (
        <span className="text-foreground">{source || "—"}</span>
      )}
    </p>
  );
}

function HistoryList({ history, empty }: { history: { date: string; collateralUsd: number | null; stableBorrowedUsd: number | null; utilization: number | null; borrowApy: number | null }[]; empty: string }) {
  if (history.length === 0) return <p className="text-sm leading-6 text-muted-foreground">{empty}</p>;
  if (history.length === 1) {
    const point = history[0];
    return (
      <p className="text-sm leading-6 text-muted-foreground">
        One daily snapshot, {point?.date}. Earlier days are not filled in.
      </p>
    );
  }
  return (
    <ul className="space-y-1 text-sm leading-6 text-muted-foreground">
      {history.map((point) => (
        <li key={point.date}>
          <span className="text-foreground">{point.date}</span>
          {": "}
          {usd(point.collateralUsd)} locked, {usd(point.stableBorrowedUsd)} borrowed
          {point.utilization !== null ? `, ${formatLendingFractionPct(point.utilization)} full` : ""}
          {point.borrowApy !== null ? `, ${formatLendingFractionPct(point.borrowApy)} a year` : ""}
        </li>
      ))}
    </ul>
  );
}

function FullnessRing({ fraction }: { fraction: number | null }) {
  const size = 28;
  const stroke = 3;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const portion = fraction === null || !Number.isFinite(fraction) ? 0 : Math.max(0, Math.min(1, fraction));
  const drawn = circumference * portion;
  const center = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0 text-foreground" aria-hidden>
      <circle cx={center} cy={center} r={radius} fill="none" stroke="currentColor" strokeOpacity={0.18} strokeWidth={stroke} />
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${drawn.toFixed(2)} ${(circumference - drawn).toFixed(2)}`}
        transform={`rotate(-90 ${center} ${center})`}
      />
    </svg>
  );
}

function MoneyButton({
  label,
  value,
  pressed,
  stat,
  onClick,
}: {
  label: string;
  value: string;
  pressed: boolean;
  stat: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="rounded-lg px-1 py-1 text-left hover:bg-muted/50"
      aria-expanded={pressed}
      data-lending-stat={stat}
      onClick={onClick}
    >
      <span className="block text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="mt-1 block text-4xl font-semibold tracking-tight text-foreground tabular-nums sm:text-5xl">{value}</span>
      <span className="mt-1 block text-sm text-muted-foreground">See chains</span>
    </button>
  );
}

export function LendingGlancePanel({
  glance,
  flags,
  badges,
  staleNotes,
  scopes,
  answers,
  depth,
  capturedLabel,
  totals,
  riskLine,
  readError,
}: {
  glance: LendingGlanceCopy;
  flags: readonly LendingFillingFlag[];
  badges: readonly LendingSimpleBadge[];
  staleNotes: readonly LendingStaleNote[];
  scopes: readonly LendingDropScope[];
  answers: Record<string, Record<string, LendingDropAnswer>>;
  depth: LendingDepth;
  capturedLabel: string | null;
  totals: LendingTotals;
  riskLine: string;
  readError: string | null;
}) {
  const [scopeId, setScopeId] = useState("all");
  const [drop, setDrop] = useState<LendingDropFraction>(0.2);
  const [drill, setDrill] = useState<Drill | null>(null);
  const answer = answers[scopeId]?.[lendingDropKey(drop)] ?? answers.all?.[lendingDropKey(drop)];
  const nearlyFull = new Set(badges.filter((badge) => badge.kind === "nearly-full").map((badge) => badge.venueId));
  const rateJumped = new Set(badges.filter((badge) => badge.kind === "rate-jumped").map((badge) => badge.venueId));
  const extraFlags = flags.filter((flag) => {
    if (flag.kind === "full" && nearlyFull.has(flag.venueId)) return false;
    if (flag.kind === "rate-jump" && rateJumped.has(flag.venueId)) return false;
    return true;
  });
  const scope = scopes.find((item) => item.id === scopeId) ?? scopes[0];
  const venues = scopes.filter((item) => item.kind === "venue");
  const stocks = scopes.filter((item) => item.kind === "stock");

  function toggleChains(metric: Metric) {
    setDrill((current) => (current?.kind === "chains" && current.metric === metric ? null : { kind: "chains", metric }));
  }

  function openScope() {
    if (!scope || scope.kind === "all") {
      setDrill({ kind: "chains", metric: "collateral" });
      return;
    }
    if (scope.kind === "venue") setDrill({ kind: "venue", venueId: scope.id });
    else setDrill({ kind: "stock", ticker: scope.id.slice("stock:".length) });
  }

  return (
    <div className="space-y-8" data-lending-glance>
      <header className="max-w-3xl space-y-3">
        <p className="text-sm text-muted-foreground">Lending</p>
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm" data-lending-tone={glance.tone}>
          <span
            className={
              glance.tone === "calm"
                ? "inline-flex items-center gap-1.5 font-medium text-price-up"
                : glance.tone === "stretched"
                  ? "inline-flex items-center gap-1.5 font-medium text-interpretive"
                  : "inline-flex items-center gap-1.5 font-medium text-muted-foreground"
            }
          >
            <span className="size-2 shrink-0 rounded-full bg-current" aria-hidden />
            {glance.tone === "stretched" ? "Stretched" : glance.tone === "calm" ? "Calm" : "No snapshot"}
          </span>
          <span className="text-muted-foreground" data-lending-tone-line>
            {glance.toneLine}
          </span>
        </p>
        <h2 className="font-heading text-2xl font-semibold tracking-tight text-foreground sm:text-3xl" data-lending-glance-sentence>
          {glance.sentence}
        </h2>
        {capturedLabel ? (
          <p className="text-sm text-muted-foreground" data-lending-captured>
            {capturedLabel}. A dash means that number was not reported.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground" data-lending-captured>
            No lending snapshot yet.
          </p>
        )}
        {readError ? <p className="text-sm text-muted-foreground">{readError}</p> : null}
      </header>

      <div className="grid max-w-3xl grid-cols-2 gap-6">
        <MoneyButton
          label="Stock locked"
          value={usd(totals.collateralUsd)}
          stat="collateral"
          pressed={drill?.kind === "chains" && drill.metric === "collateral"}
          onClick={() => toggleChains("collateral")}
        />
        <MoneyButton
          label="Borrowed"
          value={usd(totals.stableBorrowedUsd)}
          stat="borrowed"
          pressed={drill?.kind === "chains" && drill.metric === "borrowed"}
          onClick={() => toggleChains("borrowed")}
        />
      </div>

      <div className="flex max-w-3xl flex-wrap items-center gap-x-6 gap-y-2 text-sm" data-lending-summary>
        <p className="inline-flex items-center gap-2" data-lending-stat="full">
          <FullnessRing fraction={totals.utilization} />
          <span className="text-muted-foreground">How full</span>
          <span className="num text-foreground">{formatLendingFractionPct(totals.utilization)}</span>
        </p>
        <p className="inline-flex items-center gap-2" data-lending-stat="cost">
          <span className="text-muted-foreground">Yearly cost</span>
          <span className="num text-foreground">{totals.borrowApy === null ? "—" : formatLendingFractionPct(totals.borrowApy)}</span>
        </p>
      </div>

      {badges.length > 0 || staleNotes.length > 0 || extraFlags.length > 0 ? (
        <ul className="flex flex-wrap gap-2" data-lending-badges>
          {badges.map((badge) => (
            <li key={`${badge.kind}-${badge.venueId}`}>
              <button
                type="button"
                className="rounded-full border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted/50"
                data-lending-badge={badge.kind}
                onClick={() => setDrill({ kind: "venue", venueId: badge.venueId })}
              >
                <span className="font-medium">{badge.label}</span>
                <span className="text-muted-foreground"> {badge.text}</span>
              </button>
            </li>
          ))}
          {staleNotes.map((note) => (
            <li key={note.venueId} data-lending-stale={note.venueId} className="rounded-full border border-border px-3 py-1.5 text-sm">
              <span className="font-medium text-foreground">{note.label}</span>
              <span className="text-muted-foreground"> {note.text}</span>
            </li>
          ))}
          {extraFlags.map((flag) => (
            <li key={flag.venueId} data-lending-flags>
              <button
                type="button"
                className="rounded-full border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted/50"
                onClick={() => setDrill({ kind: "venue", venueId: flag.venueId })}
              >
                {flag.text}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <section className="max-w-3xl space-y-3" data-lending-whatif>
        <h3 className="text-base font-medium text-foreground">What if it drops?</h3>
        <p className="text-lg leading-7 text-foreground" data-lending-risk>
          {riskLine}
        </p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <label className="sr-only" htmlFor="lending-drop-scope">
            Stock or venue
          </label>
          <select
            id="lending-drop-scope"
            className="h-10 max-w-full rounded-md border border-border bg-background px-3 text-sm text-foreground"
            value={scopeId}
            onChange={(event) => setScopeId(event.target.value)}
          >
            <optgroup label="All">
              <option value="all">Everything</option>
            </optgroup>
            {venues.length > 0 ? (
              <optgroup label="Venue">
                {venues.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {stocks.length > 0 ? (
              <optgroup label="Stock">
                {stocks.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Size of the drop">
            {LENDING_DROP_FRACTIONS.map((fraction) => (
              <button
                key={fraction}
                type="button"
                className={
                  drop === fraction
                    ? "h-10 rounded-md bg-foreground px-3 text-sm font-medium text-background"
                    : "h-10 rounded-md border border-border px-3 text-sm text-foreground hover:bg-muted/50"
                }
                aria-pressed={drop === fraction}
                onClick={() => setDrop(fraction)}
              >
                {lendingDropPercentLabel(fraction)}
              </button>
            ))}
          </div>
        </div>
        <p className="text-lg leading-7 text-foreground" data-lending-drop-answer>
          {answer?.sentence ?? "No lending snapshot yet."}
        </p>
        {answer?.methodLine ? (
          <p className="text-sm leading-6 text-muted-foreground" data-lending-drop-method>
            {answer.methodLine}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {scope && scope.kind !== "all" ? (
            <button type="button" className="text-sm text-foreground underline-offset-2 hover:underline" onClick={openScope}>
              See {scope.label}
            </button>
          ) : null}
          <details>
            <summary className="cursor-pointer text-sm text-muted-foreground">How this is figured</summary>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{answer?.method}</p>
          </details>
        </div>
      </section>

      {drill ? (
        <DrillView
          drill={drill}
          depth={depth}
          totals={totals}
          onDrill={setDrill}
          onClose={() => setDrill(null)}
        />
      ) : null}
    </div>
  );
}

function DrillView({
  drill,
  depth,
  totals,
  onDrill,
  onClose,
}: {
  drill: Drill;
  depth: LendingDepth;
  totals: LendingTotals;
  onDrill: (drill: Drill) => void;
  onClose: () => void;
}) {
  const venue = drill.kind === "venue" ? depth.venues.find((item) => item.id === drill.venueId) : drill.kind === "stock" && drill.venueId ? depth.venues.find((item) => item.id === drill.venueId) : undefined;
  const chainId = drill.kind === "chain" ? drill.chainId : venue?.chainId;
  const chain = depth.chains.find((item) => item.chainId === chainId);
  const stock = drill.kind === "stock" ? depth.stocks.find((item) => item.ticker === drill.ticker) : undefined;
  return (
    <section className="max-w-3xl space-y-4 border-t border-border pt-6" data-lending-drill={drill.kind}>
      <nav aria-label="Detail" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
        <button type="button" className="text-foreground underline-offset-2 hover:underline" onClick={onClose}>
          Lending
        </button>
        {chain ? (
          <>
            <span aria-hidden>›</span>
            <button type="button" className="text-foreground underline-offset-2 hover:underline" onClick={() => onDrill({ kind: "chain", chainId: chain.chainId })}>
              {chain.chainLabel}
            </button>
          </>
        ) : null}
        {drill.kind === "chains" ? (
          <>
            <span aria-hidden>›</span>
            <span className="text-foreground">Chains</span>
          </>
        ) : null}
        {venue && (drill.kind === "venue" || drill.kind === "stock") ? (
          <>
            <span aria-hidden>›</span>
            <button type="button" className="text-foreground underline-offset-2 hover:underline" onClick={() => onDrill({ kind: "venue", venueId: venue.id })}>
              {venue.label}
            </button>
          </>
        ) : null}
        {stock ? (
          <>
            <span aria-hidden>›</span>
            <span className="text-foreground">{stock.ticker}</span>
          </>
        ) : null}
      </nav>
      {drill.kind === "chains" ? <ChainList depth={depth} totals={totals} metric={drill.metric} onOpen={(chainId) => onDrill({ kind: "chain", chainId })} /> : null}
      {drill.kind === "chain" && chain ? (
        <ChainDetail chain={chain} venues={depth.venues.filter((item) => item.chainId === chain.chainId)} onOpen={(venueId) => onDrill({ kind: "venue", venueId })} />
      ) : null}
      {drill.kind === "venue" && venue ? <VenueDetail venue={venue} onStock={(ticker) => onDrill({ kind: "stock", ticker, venueId: venue.id })} /> : null}
      {drill.kind === "stock" ? <StockDetail stock={stock} onVenue={(venueId) => onDrill({ kind: "venue", venueId })} /> : null}
    </section>
  );
}

function ChainList({
  depth,
  totals,
  metric,
  onOpen,
}: {
  depth: LendingDepth;
  totals: LendingTotals;
  metric: Metric;
  onOpen: (chainId: string) => void;
}) {
  const chains = [...depth.chains].sort((a, b) => {
    const aValue = metric === "borrowed" ? a.stableBorrowedUsd ?? -1 : a.collateralUsd ?? -1;
    const bValue = metric === "borrowed" ? b.stableBorrowedUsd ?? -1 : b.collateralUsd ?? -1;
    return bValue - aValue;
  });
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-xl font-semibold tracking-tight text-foreground">Every chain</h3>
        <p className="mt-1 text-sm leading-6 text-muted-foreground" data-lending-stat="full">
          Dollar pools are {formatLendingFractionPct(totals.utilization)} full.{" "}
          <span data-lending-stat="cost">A typical loan costs {formatLendingApy(totals)} a year.</span>
        </p>
      </div>
      <ul className="divide-y divide-border/70">
        {chains.map((chain) => (
          <li key={chain.chainId}>
            <button type="button" className="flex w-full items-baseline justify-between gap-4 py-3 text-left hover:bg-muted/40" onClick={() => onOpen(chain.chainId)}>
              <span className="font-medium text-foreground">{chain.chainLabel}</span>
              <span className="text-sm tabular-nums text-muted-foreground">
                <span className="text-foreground">{usd(metric === "borrowed" ? chain.stableBorrowedUsd : chain.collateralUsd)}</span>
                {metric === "borrowed" ? " borrowed" : " locked"}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ChainDetail({ chain, venues, onOpen }: { chain: LendingDepthChain; venues: readonly LendingDepthVenue[]; onOpen: (venueId: string) => void }) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-xl font-semibold tracking-tight text-foreground">{chain.chainLabel}</h3>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          {usd(chain.collateralUsd)} locked, {usd(chain.stableBorrowedUsd)} borrowed
          {chain.utilization !== null ? `, ${formatLendingFractionPct(chain.utilization)} full` : ""}
          {chain.borrowApy !== null ? `, ${formatLendingFractionPct(chain.borrowApy)} a year` : ""}.
        </p>
      </div>
      <ul className="divide-y divide-border/70">
        {venues.map((venue) => (
          <li key={venue.id}>
            <button type="button" className="flex w-full flex-col gap-1 py-3 text-left hover:bg-muted/40 sm:flex-row sm:items-baseline sm:justify-between" onClick={() => onOpen(venue.id)}>
              <span className="font-medium text-foreground">{venue.label}</span>
              <span className="text-sm tabular-nums text-muted-foreground">
                {usd(venue.collateralUsd)} locked · {usd(venue.stableBorrowedUsd)} borrowed
                {venue.utilization !== null ? ` · ${formatLendingFractionPct(venue.utilization)} full` : ""}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div>
        <h4 className="text-sm font-medium text-foreground">History</h4>
        <HistoryList history={chain.history} empty="No daily snapshot for this chain." />
      </div>
    </div>
  );
}

function VenueDetail({ venue, onStock }: { venue: LendingDepthVenue; onStock: (ticker: string) => void }) {
  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-xl font-semibold tracking-tight text-foreground">{venue.label}</h3>
        <p className="text-sm text-muted-foreground">{venue.chainLabel}</p>
      </div>
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Stock locked</dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums text-foreground">{usd(venue.collateralUsd)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Borrowed</dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums text-foreground">{usd(venue.stableBorrowedUsd)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">How full</dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums text-foreground">{formatLendingFractionPct(venue.utilization)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Yearly cost</dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums text-foreground">{formatLendingApy(venue)}</dd>
        </div>
      </dl>
      {venue.ltvLabel ? <p className="text-sm leading-6 text-foreground">Borrowing limit: {venue.ltvLabel}</p> : <p className="text-sm leading-6 text-muted-foreground">No borrowing limit was published for these tokens.</p>}
      {venue.lendSupplyUsd !== null ? <p className="text-sm leading-6 text-muted-foreground">Dollar coins supplied to lend: {usd(venue.lendSupplyUsd)}.</p> : null}
      {venue.stockBorrowedUsd !== null && venue.stockBorrowedUsd > 0 ? (
        <p className="text-sm leading-6 text-muted-foreground">Stock tokens lent for shorting: {usd(venue.stockBorrowedUsd)}.</p>
      ) : null}
      {venue.estimateLabel ? <p className="text-sm leading-6 text-muted-foreground">{venue.estimateLabel}</p> : null}
      {venue.note ? <p className="text-sm leading-6 text-muted-foreground">{venue.note}</p> : null}
      <p className="text-sm leading-6 text-muted-foreground">{venue.positionsNote}</p>
      <div className="space-y-2">
        <h4 className="text-sm font-medium text-foreground">Tokens deposited</h4>
        <ul className="max-h-96 divide-y divide-border/70 overflow-auto">
          {venue.assets.map((asset) => (
            <li key={`${asset.symbol}-${asset.address}`}>
              <button type="button" className="flex w-full flex-col gap-1 py-3 text-left hover:bg-muted/40" onClick={() => onStock(asset.ticker)}>
                <span className="font-medium text-foreground">
                  {asset.symbol} <span className="font-normal text-muted-foreground">{asset.wrapper}</span>
                </span>
                <span className="text-sm tabular-nums text-muted-foreground">
                  {formatTokenAmount(asset.collateralTokens)} tokens · {usd(asset.collateralUsd)} · {limitLabel(asset.maxLtv)}
                </span>
                {asset.priceNote ? <span className="text-sm text-muted-foreground">{asset.priceNote}</span> : null}
                <span className="text-xs text-muted-foreground">{formatAddress(asset.address)}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <SourceLine source={venue.source} />
      <div>
        <h4 className="text-sm font-medium text-foreground">History</h4>
        <HistoryList history={venue.history} empty="No daily snapshot for this venue." />
      </div>
    </div>
  );
}

function StockDetail({ stock, onVenue }: { stock: LendingDepthStock | undefined; onVenue: (venueId: string) => void }) {
  if (!stock) return <p className="text-sm text-muted-foreground">That stock is not in this snapshot.</p>;
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-xl font-semibold tracking-tight text-foreground">{stock.ticker}</h3>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{usd(stock.collateralUsd)} locked across {stock.places.length === 1 ? "1 place" : `${stock.places.length} places`}.</p>
      </div>
      <ul className="divide-y divide-border/70">
        {stock.places.map((place) => (
          <li key={`${place.venueId}-${place.symbol}`}>
            <button type="button" className="flex w-full flex-col gap-1 py-3 text-left hover:bg-muted/40" onClick={() => onVenue(place.venueId)}>
              <span className="font-medium text-foreground">
                {place.venueLabel} <span className="font-normal text-muted-foreground">{place.symbol}</span>
              </span>
              <span className="text-sm tabular-nums text-muted-foreground">
                {formatTokenAmount(place.collateralTokens)} tokens · {usd(place.collateralUsd)} · {limitLabel(place.maxLtv)}
                {place.borrowApy !== null ? ` · ${formatLendingFractionPct(place.borrowApy)} a year` : ""}
                {place.utilization !== null ? ` · ${formatLendingFractionPct(place.utilization)} full` : ""}
              </span>
              {place.priceNote ? <span className="text-sm text-muted-foreground">{place.priceNote}</span> : null}
            </button>
            <SourceLine source={place.source} />
          </li>
        ))}
      </ul>
      <p className="text-sm leading-6 text-muted-foreground">Each person’s loan is not in this snapshot. These are the tokens deposited at each venue.</p>
    </div>
  );
}
