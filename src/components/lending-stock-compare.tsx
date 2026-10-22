"use client";

import { useState } from "react";
import { formatUsdCompact } from "@/lib/market/format";
import {
  LENDING_STOCK_PREVIEW,
  lendingCompareAnswer,
  type LendingCompareModel,
  type LendingComparePlace,
  type LendingStockRank,
} from "@/lib/market/lending-compare";
import { lendingStockLogo, lendingVenueLogo } from "@/lib/market/lending-logos";
import { formatLendingApy, formatLendingFractionPct } from "@/lib/market/lending-snapshot";

export function LendingStockCompare({
  model,
  initialTicker = null,
}: {
  model: LendingCompareModel;
  initialTicker?: string | null;
}) {
  const [ticker, setTicker] = useState<string | null>(initialTicker);
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? model.stocks : model.stocks.slice(0, LENDING_STOCK_PREVIEW);
  const hidden = model.stocks.length - visible.length;
  return (
    <section className="max-w-3xl space-y-4" data-lending-stocks>
      <div className="space-y-1">
        <h3 className="text-base font-medium text-foreground">Stocks people lock up</h3>
        <p className="text-sm leading-6 text-muted-foreground">
          Added up across every venue. Pick one to see where to borrow against it.
        </p>
        <p className="text-xs leading-5 text-muted-foreground" data-lending-freshness="stocks">
          Daily snapshot · {model.timeLabel}
        </p>
      </div>
      {model.stocks.length === 0 ? (
        <p className="text-sm leading-6 text-muted-foreground">No stock tokens are stored in this snapshot.</p>
      ) : (
        <ul className="divide-y divide-border/70">
          {visible.map((stock) => {
            const open = ticker === stock.ticker;
            const places = model.places[stock.ticker] ?? [];
            return (
              <li key={stock.ticker}>
                <StockRow stock={stock} pressed={open} onClick={() => setTicker((current) => (current === stock.ticker ? null : stock.ticker))} />
                {open ? <VenueCompare ticker={stock.ticker} places={places} /> : null}
              </li>
            );
          })}
        </ul>
      )}
      {model.stocks.length > LENDING_STOCK_PREVIEW ? (
        <button type="button" className="text-sm text-foreground underline-offset-2 hover:underline" onClick={() => setShowAll((value) => !value)}>
          {showAll ? "Show the top stocks" : `Show every stock (${hidden} more)`}
        </button>
      ) : null}
    </section>
  );
}

function StockRow({ stock, pressed, onClick }: { stock: LendingStockRank; pressed: boolean; onClick: () => void }) {
  const logo = lendingStockLogo("", stock.ticker);
  return (
    <button
      type="button"
      className={`flex w-full items-center justify-between gap-4 py-3 text-left hover:bg-muted/40 ${pressed ? "bg-muted/40" : ""}`}
      aria-expanded={pressed}
      data-lending-stock={stock.ticker}
      onClick={onClick}
    >
      <span className="flex min-w-0 items-center gap-3">
        <Mark label={stock.ticker} src={logo} />
        <span className="min-w-0">
          <span className="block font-medium text-foreground">{stock.ticker}</span>
          <span className="block text-sm text-muted-foreground">
            {stock.placeCount === 1 ? "1 place" : `${stock.placeCount} places`}
            {stock.unpricedTokens > 0 ? ` · ${stock.unpricedTokens} without a dollar amount` : ""}
          </span>
        </span>
      </span>
      <span className="text-right text-sm tabular-nums text-muted-foreground">
        <span className="block font-medium text-foreground">{formatUsdCompact(stock.collateralUsd)}</span>
        locked
      </span>
    </button>
  );
}

function VenueCompare({ ticker, places }: { ticker: string; places: readonly LendingComparePlace[] }) {
  return (
    <div className="space-y-3 border-t border-border pt-4" data-lending-compare={ticker}>
      <div className="space-y-1">
        <h4 className="text-base font-medium text-foreground">Where to borrow against {ticker}</h4>
        <p className="text-sm leading-6 text-foreground" data-lending-compare-answer>
          {lendingCompareAnswer(places)}
        </p>
        <p className="text-sm leading-6 text-muted-foreground">
          Yearly cost and how full are for the whole pool, not one stock. How full is blank when a pool does not publish its own lend supply. A dash means that number was not reported.
        </p>
      </div>
      <ul className="space-y-3">
        {places.map((place) => (
          <li key={place.venueId} className="rounded-xl border border-border/80 px-4 py-3" data-lending-compare-venue={place.venueId}>
            <div className="flex items-center gap-2">
              <Mark label={place.venue} src={lendingVenueLogo(place.venueId)} />
              <div className="min-w-0">
                <p className="font-medium text-foreground">{place.label}</p>
                <p className="text-sm text-muted-foreground">{place.chainLabel}</p>
              </div>
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-3">
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">Yearly cost</dt>
                <dd className="mt-1 text-sm font-medium tabular-nums text-foreground">{formatLendingApy(place)}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">How full</dt>
                <dd className="mt-1 text-sm font-medium tabular-nums text-foreground">{formatLendingFractionPct(place.howFull)}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">Stock locked</dt>
                <dd className="mt-1 text-sm font-medium tabular-nums text-foreground">{formatUsdCompact(place.collateralUsd)}</dd>
              </div>
            </dl>
            {place.estimate ? (
              <p className="mt-2 text-sm leading-6 text-muted-foreground" data-lending-estimate>
                Borrowed dollars are a pro-rata estimate.
              </p>
            ) : null}
            {place.note ? (
              <p className="mt-2 text-sm leading-6 text-muted-foreground" data-lending-place-note>
                {place.note}
              </p>
            ) : null}
            {place.howFull === null ? (
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {place.lendSupplyUsd === null
                  ? "How full is blank. This pool does not publish its own lend supply."
                  : "How full is blank."}
              </p>
            ) : (
              <p className="mt-2 text-sm leading-6 text-muted-foreground">Pool size {formatUsdCompact(place.lendSupplyUsd)} supplied to lend.</p>
            )}
            {place.unpricedTokens > 0 ? (
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {place.unpricedTokens === 1 ? "1 token" : `${place.unpricedTokens} tokens`} had no dollar amount and {place.unpricedTokens === 1 ? "is" : "are"} not in the stock locked total.
              </p>
            ) : null}
            <p className="mt-2 text-xs leading-5 text-muted-foreground" data-lending-freshness="place">
              {place.sourceHref ? (
                <a className="text-foreground underline-offset-2 hover:underline" href={place.sourceHref} target="_blank" rel="noreferrer">
                  {place.sourceHost}
                </a>
              ) : (
                <span className="text-foreground">{place.sourceHost}</span>
              )}
              {" · "}
              {place.timeLabel}
            </p>
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-muted-foreground">Token addresses</summary>
              <ul className="mt-1 space-y-1">
                {place.tokens.map((token) => (
                  <li key={token.address} className="text-xs leading-5 text-muted-foreground">
                    <span className="text-foreground">{token.symbol}</span>
                    {token.wrapper !== "Not named" ? ` · ${token.wrapper}` : ""} · {formatUsdCompact(token.collateralUsd)} · {token.address}
                  </li>
                ))}
              </ul>
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Mark({ label, src }: { label: string; src: string | null }) {
  const [failed, setFailed] = useState(false);
  const letter = (label.replace(/[^A-Za-z0-9]/g, "")[0] ?? "?").toUpperCase();
  if (!src || failed) {
    return (
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-foreground" aria-hidden>
        {letter}
      </span>
    );
  }
  return (
    // Local file, with the letter circle if it fails to load.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" className="size-8 shrink-0 rounded-full bg-muted object-cover" onError={() => setFailed(true)} />
  );
}
