"use client";

import { useMemo, useState } from "react";
import { formatUsdCompact } from "@/lib/market/format";
import { formatLendingApy, formatLtvPerHundred } from "@/lib/market/lending-snapshot";
import type { LendingStockGroup, LendingStockPlace } from "@/lib/market/lending-stocks";

function placeCost(place: LendingStockPlace): string {
  if (place.costUnavailable) return "n/a";
  return formatLendingApy(place);
}

function placeLimit(place: LendingStockPlace): string {
  if (place.maxLtv === null) return "Limit not listed";
  return `Borrow up to ${formatLtvPerHundred(place.maxLtv)} per $100`;
}

function placeDeposit(place: LendingStockPlace): string {
  if (place.collateralUsd === null) return "Dollars not listed";
  return formatUsdCompact(place.collateralUsd);
}

export function LendingStockPicker({ groups }: { groups: LendingStockGroup[] }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(groups[0]?.ticker ?? "");
  const needle = query.trim().toLowerCase();
  const visible = useMemo(() => {
    if (!needle) return groups;
    return groups.filter(
      (group) =>
        group.ticker.toLowerCase().includes(needle) ||
        group.places.some((place) => place.symbol.toLowerCase().includes(needle) || place.wrapper.toLowerCase().includes(needle)),
    );
  }, [groups, needle]);
  const active = visible.find((group) => group.ticker === selected) ?? visible[0] ?? null;

  if (groups.length === 0) {
    return <p className="text-sm text-muted-foreground">This snapshot does not list stock tokens by name.</p>;
  }

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="text-[10px] tracking-wide text-muted-foreground">Find a stock</span>
        <input
          value={query}
          onChange={(event) => {
            const next = event.target.value;
            setQuery(next);
            const match = groups.find((group) => group.ticker.toLowerCase().startsWith(next.trim().toLowerCase()));
            if (match) setSelected(match.ticker);
          }}
          placeholder="TSLA, NVDA, SPY"
          className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
          data-lending-stock-search
        />
      </label>
      <div className="flex flex-wrap gap-1.5 lg:hidden" data-lending-stock-chips>
        {visible.slice(0, 12).map((group) => {
          const on = active?.ticker === group.ticker;
          return (
            <button
              key={group.ticker}
              type="button"
              onClick={() => setSelected(group.ticker)}
              aria-pressed={on}
              className={`rounded-full border px-2.5 py-1 text-xs ${on ? "border-primary bg-primary/15 text-foreground" : "border-border text-muted-foreground"}`}
            >
              {group.ticker}
            </button>
          );
        })}
      </div>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,240px)_1fr]">
        <ul className="hidden max-h-80 space-y-1 overflow-auto pr-1 lg:block" data-lending-stock-list>
          {visible.length === 0 ? <li className="text-sm text-muted-foreground">No stock in this snapshot matches that.</li> : null}
          {visible.map((group) => {
            const on = active?.ticker === group.ticker;
            return (
              <li key={group.ticker}>
                <button
                  type="button"
                  onClick={() => setSelected(group.ticker)}
                  aria-pressed={on}
                  className={`flex w-full items-baseline justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm ${on ? "bg-primary/15 text-foreground" : "text-muted-foreground hover:bg-muted/60"}`}
                >
                  <span className="font-medium">{group.ticker}</span>
                  <span className="num text-xs">{group.collateralUsd === null ? "—" : formatUsdCompact(group.collateralUsd)}</span>
                </button>
              </li>
            );
          })}
        </ul>
        {active ? (
          <div data-lending-stock={active.ticker} className="space-y-2">
            <p className="text-xs leading-snug text-muted-foreground">
              {active.collateralUsd === null
                ? "These sources list the token but not the dollars deposited."
                : `${formatUsdCompact(active.collateralUsd)} deposited where a source gave dollars.`}
              {active.unpricedPlaces > 0
                ? ` ${active.unpricedPlaces} ${active.unpricedPlaces === 1 ? "place does" : "places do"} not list dollars.`
                : ""}
            </p>
            <ul className="space-y-2">
              {active.places.map((place) => (
                <li
                  key={`${place.venueId}-${place.symbol}`}
                  className="rounded-xl border border-border bg-background/40 px-3 py-2"
                  data-lending-stock-place={place.venueId}
                >
                  <p className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                    <span className="text-sm font-medium">{place.venue}</span>
                    <span className="text-[11px] text-muted-foreground">{place.chainLabel}</span>
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {place.wrapper} · {place.symbol}
                  </p>
                  <dl className="mt-2 grid grid-cols-1 gap-1 text-xs sm:grid-cols-3">
                    <div>
                      <dt className="text-[10px] tracking-wide text-muted-foreground">Limit</dt>
                      <dd>{placeLimit(place)}</dd>
                    </div>
                    <div>
                      <dt className="text-[10px] tracking-wide text-muted-foreground">Pool yearly cost</dt>
                      <dd className="num">{placeCost(place)}</dd>
                    </div>
                    <div>
                      <dt className="text-[10px] tracking-wide text-muted-foreground">Deposited</dt>
                      <dd className="num">{placeDeposit(place)}</dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
            <p className="text-[11px] leading-snug text-muted-foreground">
              Yearly cost is the pool’s cost for borrowing dollar coins, not a separate rate for this token. “Not listed” means that source did not publish the number.
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No stock in this snapshot matches that.</p>
        )}
      </div>
      <details className="lg:hidden">
        <summary className="cursor-pointer text-xs text-muted-foreground">Scan all {groups.length} stocks</summary>
        <ul className="mt-2 max-h-64 space-y-1 overflow-auto">
          {visible.map((group) => (
            <li key={group.ticker}>
              <button type="button" onClick={() => setSelected(group.ticker)} className="flex w-full items-baseline justify-between gap-2 py-1 text-left text-sm">
                <span>{group.ticker}</span>
                <span className="num text-xs text-muted-foreground">{group.collateralUsd === null ? "—" : formatUsdCompact(group.collateralUsd)}</span>
              </button>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
