"use client";

import { CircleHelp, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { LendingBoardRow } from "@/lib/market/lending-stocks";
import { lendingGlossary } from "@/lib/market/lending-glossary";
import { formatTokenAmount, formatUsdCompact } from "@/lib/market/format";
import { lendingChainLogo, lendingStockLogo, lendingVenueLogo } from "@/lib/market/lending-logos";
import {
  LENDING_CHAIN_ORDER,
  formatLendingApy,
  formatLendingFractionPct,
  formatLtvPerHundred,
  formatStockBorrowedNote,
} from "@/lib/market/lending-snapshot";

type GroupBy = "chain" | "venue" | "stock";

const WRAPPER_ORDER = ["xStocks", "Coinbase", "Robinhood", "bStocks", "Ondo", "Centrifuge", "Not named"];

function Hint({ label, text }: { label: string; text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        className="inline-flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
        aria-label={`${label} definition`}
      >
        <CircleHelp className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent>{text}</TooltipContent>
    </Tooltip>
  );
}

function sourceHost(source: string): string {
  try {
    return new URL(source).host.replace(/^www\./, "");
  } catch {
    return source || "snapshot";
  }
}

function chainRank(chainId: string): number {
  const index = LENDING_CHAIN_ORDER.indexOf(chainId as (typeof LENDING_CHAIN_ORDER)[number]);
  return index === -1 ? LENDING_CHAIN_ORDER.length : index;
}

function wrapperRank(wrapper: string): number {
  const index = WRAPPER_ORDER.indexOf(wrapper);
  return index === -1 ? WRAPPER_ORDER.length : index;
}

function compareRows(a: LendingBoardRow, b: LendingBoardRow): number {
  const aUsd = a.collateralUsd === null ? -1 : a.collateralUsd;
  const bUsd = b.collateralUsd === null ? -1 : b.collateralUsd;
  return bUsd - aUsd || a.ticker.localeCompare(b.ticker) || a.symbol.localeCompare(b.symbol);
}

function sumTokens(rows: readonly LendingBoardRow[]): number | null {
  let sum = 0;
  let any = false;
  for (const row of rows) {
    if (row.collateralUsd === null) continue;
    sum += row.collateralUsd;
    any = true;
  }
  return any ? sum : null;
}

function sumVenueCollateral(rows: readonly LendingBoardRow[]): number | null {
  const seen = new Set<string>();
  let sum = 0;
  let any = false;
  for (const row of rows) {
    if (seen.has(row.venueId)) continue;
    seen.add(row.venueId);
    if (row.venueCollateralUsd === null) continue;
    sum += row.venueCollateralUsd;
    any = true;
  }
  return any ? sum : null;
}

function venueIsComplete(visible: readonly LendingBoardRow[], venueId: string, universe: readonly LendingBoardRow[]): boolean {
  const shown = visible.filter((row) => row.venueId === venueId).length;
  const all = universe.filter((row) => row.venueId === venueId).length;
  return all > 0 && shown === all;
}

interface SectionModel {
  id: string;
  title: string;
  description: string;
  rows: LendingBoardRow[];
  totalUsd: number | null;
  countLabel: string;
  usesVenueTotal: boolean;
  icon: string | null;
}

function buildSections(rows: readonly LendingBoardRow[], universe: readonly LendingBoardRow[], groupBy: GroupBy): SectionModel[] {
  const buckets = new Map<string, LendingBoardRow[]>();
  for (const row of rows) {
    const id = groupBy === "chain" ? row.chainId : groupBy === "venue" ? row.venueId : row.ticker;
    const list = buckets.get(id) ?? [];
    list.push(row);
    buckets.set(id, list);
  }
  const sections: SectionModel[] = [];
  for (const [id, list] of buckets) {
    const sorted = [...list].sort(compareRows);
    const first = sorted[0];
    if (!first) continue;
    const title = groupBy === "chain" ? first.chainLabel : groupBy === "venue" ? first.venue : first.ticker;
    const description =
      groupBy === "chain"
        ? "Pools on this chain that accept stock tokens as collateral."
        : groupBy === "venue"
          ? `${first.chainLabel}. One row per stock token this pool accepts.`
          : "Each row is a wrapper of this stock that a pool accepts.";
    const venueIds = [...new Set(sorted.map((row) => row.venueId))];
    const usesVenueTotal = groupBy !== "stock" && venueIds.every((venueId) => venueIsComplete(sorted, venueId, universe));
    const icon =
      groupBy === "chain" ? lendingChainLogo(id) : groupBy === "venue" ? lendingVenueLogo(id) : lendingStockLogo(first.address, first.ticker);
    const totalUsd = usesVenueTotal ? sumVenueCollateral(sorted) : sumTokens(sorted);
    const tickers = new Set(sorted.map((row) => row.ticker));
    const countLabel =
      groupBy === "stock"
        ? `${sorted.length} ${sorted.length === 1 ? "place" : "places"}`
        : `${tickers.size} ${tickers.size === 1 ? "stock" : "stocks"}`;
    sections.push({ id, title, description, rows: sorted, totalUsd, countLabel, usesVenueTotal, icon });
  }
  sections.sort((a, b) => {
    if (groupBy === "chain") return chainRank(a.id) - chainRank(b.id);
    if (groupBy === "venue") return chainRank(a.rows[0]?.chainId ?? "") - chainRank(b.rows[0]?.chainId ?? "") || a.title.localeCompare(b.title);
    const aUsd = a.totalUsd === null ? -1 : a.totalUsd;
    const bUsd = b.totalUsd === null ? -1 : b.totalUsd;
    return bUsd - aUsd || a.title.localeCompare(b.title);
  });
  return sections;
}

function Pill({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-sm ${pressed ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"}`}
    >
      {children}
    </button>
  );
}

function Mark({ label, src, size = "md" }: { label: string; src: string | null; size?: "sm" | "preview" | "md" }) {
  const [failed, setFailed] = useState(false);
  const letter = (label.replace(/[^A-Za-z0-9]/g, "")[0] ?? "?").toUpperCase();
  const box = size === "sm" ? "size-4 text-[9px]" : size === "preview" ? "size-6 text-[10px]" : "size-8 text-xs";
  if (!src || failed) {
    return (
      <span className={`flex ${box} shrink-0 items-center justify-center rounded-full bg-muted font-medium text-foreground`} aria-hidden>
        {letter}
      </span>
    );
  }
  return (
    // Local file, with the letter circle if it fails to load.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" className={`${box} shrink-0 rounded-full bg-muted object-cover`} onError={() => setFailed(true)} />
  );
}

function Fullness({ value, unavailable }: { value: number | null; unavailable: boolean }) {
  if (unavailable) return <span className="text-sm text-muted-foreground">n/a</span>;
  if (value === null || !Number.isFinite(value)) return <span className="text-sm text-muted-foreground">—</span>;
  const pct = Math.max(0, Math.min(value, 1));
  const radius = 7;
  const circumference = 2 * Math.PI * radius;
  const dash = pct * circumference;
  const tone = pct >= 0.85 ? "var(--price-down)" : pct >= 0.6 ? "var(--interpretive)" : "var(--price-up)";
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        <circle cx="9" cy="9" r={radius} fill="none" stroke="var(--muted)" strokeWidth="2" />
        <circle
          cx="9"
          cy="9"
          r={radius}
          fill="none"
          stroke={tone}
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference - dash}`}
          transform="rotate(-90 9 9)"
        />
      </svg>
      <span className="num text-sm text-foreground">{formatLendingFractionPct(value)}</span>
    </span>
  );
}

function StockCell({ row }: { row: LendingBoardRow }) {
  return (
    <div className="flex items-center gap-3">
      <Mark label={row.ticker} src={lendingStockLogo(row.address, row.ticker)} />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">{row.ticker}</span>
        <span className="block text-sm text-muted-foreground">
          {row.symbol} · {row.wrapper}
        </span>
      </span>
    </div>
  );
}

function VenueCell({ row }: { row: LendingBoardRow }) {
  return (
    <span className="min-w-0">
      <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
        <Mark label={row.venue} src={lendingVenueLogo(row.venueId)} size="sm" />
        {row.venue}
      </span>
      <a href={row.source} className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <Mark label={row.chainLabel} src={lendingChainLogo(row.chainId)} size="sm" />
        {row.chainLabel} · {sourceHost(row.source)}
      </a>
    </span>
  );
}

function Cost({ row }: { row: LendingBoardRow }) {
  if (row.costUnavailable) {
    return (
      <span className="text-sm text-muted-foreground" data-lending-estimate>
        n/a
      </span>
    );
  }
  return <span className="num text-sm text-foreground">{formatLendingApy(row)}</span>;
}

function Deposited({ usd, tokens }: { usd: number | null; tokens: number | null }) {
  if (tokens !== null) {
    return (
      <span className="inline-flex flex-col items-end">
        <span className="num text-sm font-medium text-foreground">{formatTokenAmount(tokens)}</span>
        <span className="num text-sm text-muted-foreground" data-missing={usd === null ? "true" : undefined}>
          {formatUsdCompact(usd)}
        </span>
      </span>
    );
  }
  return (
    <span className="num text-sm font-medium text-foreground" data-missing={usd === null ? "true" : undefined}>
      {formatUsdCompact(usd)}
    </span>
  );
}

function MaxBorrow({ value }: { value: number | null }) {
  return <span className="num text-sm text-foreground">{value === null ? "—" : formatLtvPerHundred(value)}</span>;
}

function SectionTable({ section }: { section: SectionModel }) {
  const missingDollars = section.rows.some((row) => row.collateralUsd === null);
  const sharedPool = section.rows.some((row) => row.costUnavailable || row.howFullUnavailable);
  const shorts = [...new Map(section.rows.filter((row) => formatStockBorrowedNote(row.stockBorrowedUsd)).map((row) => [row.venueId, row])).values()];
  const preview = [...new Map(section.rows.map((row) => [row.ticker, row])).values()].slice(0, 4);
  const extra = new Set(section.rows.map((row) => row.ticker)).size - preview.length;
  return (
    <section className="space-y-3" data-lending-section={section.id}>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <Mark label={section.title} src={section.icon} />
          <div className="min-w-0">
            <h3 className="text-base font-medium text-foreground">{section.title}</h3>
            <p className="text-sm leading-6 text-muted-foreground">{section.description}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center" aria-hidden>
            {preview.map((row) => (
              <span key={row.key} className="-ml-1.5 rounded-full ring-2 ring-background first:ml-0">
                <Mark label={row.ticker} src={lendingStockLogo(row.address, row.ticker)} size="preview" />
              </span>
            ))}
            {extra > 0 ? <span className="ml-2 text-sm text-muted-foreground">+{extra}</span> : null}
          </div>
          <p className="text-sm text-muted-foreground">
            {section.countLabel}
            <span className="mx-2 text-border">·</span>
            Stock in <span className="num font-medium text-foreground">{formatUsdCompact(section.totalUsd)}</span>
          </p>
        </div>
      </header>
      <div className="overflow-hidden rounded-xl border border-border/80">
        <ul className="md:hidden">
          {section.rows.map((row) => (
            <li key={row.key} className="space-y-3 border-t border-border/50 px-4 py-4 first:border-t-0" data-lending-row={row.venueId} data-lending-symbol={row.symbol}>
              <div className="flex items-start justify-between gap-3">
                <StockCell row={row} />
                <Fullness value={row.utilization} unavailable={row.howFullUnavailable} />
              </div>
              <VenueCell row={row} />
              <dl className="grid grid-cols-3 gap-3">
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">Borrow cost</dt>
                  <dd className="mt-1">
                    <Cost row={row} />
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">Deposited</dt>
                  <dd className="mt-1">
                    <Deposited usd={row.collateralUsd} tokens={row.collateralTokens} />
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">Max / $100</dt>
                  <dd className="mt-1">
                    <MaxBorrow value={row.maxLtv} />
                  </dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
        <table className="hidden w-full border-separate border-spacing-0 md:table">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-3 font-medium">Stock</th>
              <th className="px-4 py-3 font-medium">Venue</th>
              <th className="px-4 py-3 text-right font-medium">Borrow cost</th>
              <th className="px-4 py-3 text-right font-medium">Deposited</th>
              <th className="px-4 py-3 text-right font-medium">How full</th>
              <th className="px-4 py-3 text-right font-medium">Max / $100</th>
            </tr>
          </thead>
          <tbody>
            {section.rows.map((row) => (
              <tr key={row.key} className="hover:bg-muted/30" data-lending-row={row.venueId} data-lending-symbol={row.symbol}>
                <td className="px-4 py-4">
                  <StockCell row={row} />
                </td>
                <td className="px-4 py-4">
                  <VenueCell row={row} />
                </td>
                <td className="px-4 py-4 text-right">
                  <Cost row={row} />
                </td>
                <td className="px-4 py-4 text-right">
                  <Deposited usd={row.collateralUsd} tokens={row.collateralTokens} />
                </td>
                <td className="px-4 py-4 text-right">
                  <Fullness value={row.utilization} unavailable={row.howFullUnavailable} />
                </td>
                <td className="px-4 py-4 text-right">
                  <MaxBorrow value={row.maxLtv} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {missingDollars || sharedPool || shorts.length > 0 ? (
        <div className="space-y-1 text-sm leading-6 text-muted-foreground">
          {missingDollars ? (
            <p>
              {section.usesVenueTotal
                ? "Some tokens do not list their own dollars. Stock in, above, is what the pools reported."
                : "A dash means that token’s dollars were not listed."}
            </p>
          ) : null}
          {sharedPool ? <p>Yearly cost and how full are n/a when the pool is shared and does not publish its own rate.</p> : null}
          {shorts.map((row) => (
            <p key={row.venueId} data-lending-stock-borrowed={row.venueId}>
              {row.venue}: {formatStockBorrowedNote(row.stockBorrowedUsd)}.
            </p>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function LendingBoard({ rows }: { rows: LendingBoardRow[] }) {
  const [chainId, setChainId] = useState("all");
  const [venueId, setVenueId] = useState("all");
  const [wrapper, setWrapper] = useState("all");
  const [query, setQuery] = useState("");
  const [groupBy, setGroupBy] = useState<GroupBy>("chain");
  const [showSmall, setShowSmall] = useState(false);
  const fullHint = lendingGlossary("utilization");
  const costHint = lendingGlossary("apy");
  const ltvHint = lendingGlossary("ltv");

  const chains = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of rows) seen.set(row.chainId, row.chainLabel);
    return [...seen.entries()].sort((a, b) => chainRank(a[0]) - chainRank(b[0]));
  }, [rows]);
  const venues = useMemo(() => {
    const seen = new Map<string, LendingBoardRow>();
    for (const row of rows) if (!seen.has(row.venueId)) seen.set(row.venueId, row);
    return [...seen.values()].sort((a, b) => chainRank(a.chainId) - chainRank(b.chainId) || a.venue.localeCompare(b.venue));
  }, [rows]);
  const wrappers = useMemo(() => {
    const seen = new Set(rows.map((row) => row.wrapper));
    return [...seen].sort((a, b) => wrapperRank(a) - wrapperRank(b));
  }, [rows]);
  const smallCount = useMemo(() => new Set(rows.filter((row) => row.smallBook).map((row) => row.venueId)).size, [rows]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (!showSmall && row.smallBook && chainId === "all" && venueId === "all" && !needle) return false;
      if (chainId !== "all" && row.chainId !== chainId) return false;
      if (venueId !== "all" && row.venueId !== venueId) return false;
      if (wrapper !== "all" && row.wrapper !== wrapper) return false;
      if (!needle) return true;
      return `${row.ticker} ${row.symbol} ${row.wrapper} ${row.venue} ${row.chainLabel}`.toLowerCase().includes(needle);
    });
  }, [rows, chainId, venueId, wrapper, query, showSmall]);

  const sections = useMemo(() => buildSections(filtered, rows, groupBy), [filtered, rows, groupBy]);

  return (
    <div className="space-y-8" data-lending-board data-lending-group={groupBy}>
      <div className="space-y-3">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-1">
            <Pill pressed={chainId === "all"} onClick={() => setChainId("all")}>
              All chains
            </Pill>
            {chains.map(([id, label]) => (
              <Pill key={id} pressed={chainId === id} onClick={() => setChainId(id)}>
                {label}
              </Pill>
            ))}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="relative min-w-0 sm:w-64">
              <span className="sr-only">Search stocks</span>
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search stocks"
                className="w-full rounded-lg border border-border bg-transparent py-1.5 pr-3 pl-9 text-sm text-foreground placeholder:text-muted-foreground"
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="sr-only">Venue</span>
              <select
                value={venueId}
                onChange={(event) => setVenueId(event.target.value)}
                aria-label="Venue"
                className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground [color-scheme:dark]"
              >
                <option value="all">All venues</option>
                {venues.map((row) => (
                  <option key={row.venueId} value={row.venueId}>
                    {row.venue}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              Group by
              <select
                value={groupBy}
                onChange={(event) => setGroupBy(event.target.value as GroupBy)}
                className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground [color-scheme:dark]"
              >
                <option value="chain">Chain</option>
                <option value="venue">Venue</option>
                <option value="stock">Stock</option>
              </select>
            </label>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <Pill pressed={wrapper === "all"} onClick={() => setWrapper("all")}>
            All wrappers
          </Pill>
          {wrappers.map((name) => (
            <Pill key={name} pressed={wrapper === name} onClick={() => setWrapper(name)}>
              {name}
            </Pill>
          ))}
          {smallCount > 0 ? (
            <Pill pressed={showSmall} onClick={() => setShowSmall((value) => !value)}>
              {showSmall ? "Hide smaller pools" : `Smaller pools (${smallCount})`}
            </Pill>
          ) : null}
        </div>
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            Borrow cost <Hint label={costHint.term} text={`${costHint.text} The figure is for the whole pool.`} />
          </span>
          <span className="inline-flex items-center gap-1">
            Deposited <Hint label="Deposited" text="Token count on top when the source reports one, with dollars underneath. This snapshot often has dollars only. A dash means that figure was not reported." />
          </span>
          <span className="inline-flex items-center gap-1">
            How full <Hint label={fullHint.term} text={`${fullHint.text} The ring is the whole pool, not one stock.`} />
          </span>
          <span className="inline-flex items-center gap-1">
            Max / $100 <Hint label={ltvHint.term} text={ltvHint.text} />
          </span>
        </p>
      </div>
      {sections.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Nothing in this snapshot matches those filters.</p>
      ) : (
        sections.map((section) => <SectionTable key={section.id} section={section} />)
      )}
    </div>
  );
}
