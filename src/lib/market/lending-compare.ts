import { classifyLendingSymbol } from "./lending-stocks";
import { lendingVenueLabel } from "./lending-glance";
import {
  formatLendingApy,
  formatLendingCapturedAt,
  lendingPublishesOwnSupply,
  lendingUtilization,
  type LendingAsset,
  type LendingBorrowEstimate,
  type LendingRow,
} from "./lending-snapshot";

export interface LendingCompareToken {
  symbol: string;
  wrapper: string;
  /** Token address stored on the snapshot. Morpho rows stay split by this address. */
  address: string;
  collateralUsd: number | null;
}

export interface LendingComparePlace {
  venueId: string;
  venue: string;
  /** Venue name, plus the chain when the same venue name appears more than once. */
  label: string;
  chainId: string;
  chainLabel: string;
  collateralUsd: number | null;
  /** Tokens at this place whose dollar amount was not reported. */
  unpricedTokens: number;
  borrowApy: number | null;
  borrowApyMin: number | null;
  borrowApyMax: number | null;
  /** Null unless this pool publishes its own lend supply. A shared-pool rate is not copied in. */
  howFull: number | null;
  lendSupplyUsd: number | null;
  /** True when borrowed dollars are an estimate, as on Venus. */
  estimate: boolean;
  source: string;
  sourceHost: string;
  sourceHref: string | null;
  timeLabel: string;
  tokens: LendingCompareToken[];
}

export interface LendingStockRank {
  ticker: string;
  collateralUsd: number | null;
  placeCount: number;
  unpricedTokens: number;
}

export interface LendingCompareModel {
  timeLabel: string;
  stocks: LendingStockRank[];
  places: Record<string, LendingComparePlace[]>;
}

type CompareRow = Pick<
  LendingRow,
  | "id"
  | "venue"
  | "chainId"
  | "chainLabel"
  | "borrowApy"
  | "borrowApyMin"
  | "borrowApyMax"
  | "stableBorrowedUsd"
  | "lendSupplyUsd"
  | "borrowEstimate"
  | "source"
  | "assets"
>;

export type LendingFigureKind = "collateral" | "borrowed" | "full" | "cost";

export interface LendingFigureSource {
  host: string;
  href: string | null;
}

export interface LendingFigureFreshness {
  timeLabel: string;
  sourceLabel: string;
  sources: LendingFigureSource[];
  /** Extra plain note. Null when the figure needs nothing beyond the source and time. */
  note: string | null;
}

/** How many stocks to show before "Show every stock". */
export const LENDING_STOCK_PREVIEW = 8;

export function lendingSourceHost(source: string): LendingFigureSource {
  try {
    const url = new URL(source);
    if (url.protocol !== "http:" && url.protocol !== "https:") return { host: source || "—", href: null };
    return { host: url.host.replace(/^www\./, ""), href: url.toString() };
  } catch {
    return { host: source || "—", href: null };
  }
}

export function lendingSourceLabel(sources: readonly LendingFigureSource[]): string {
  if (sources.length === 0) return "—";
  const [first, second] = sources;
  if (!first) return "—";
  if (sources.length === 1) return first.host;
  if (sources.length === 2 && second) return `${first.host} and ${second.host}`;
  return `${first.host} and ${sources.length - 1} more`;
}

export function lendingFigureLine(freshness: LendingFigureFreshness): string {
  if (freshness.sourceLabel === "—" && freshness.timeLabel === "—") return "—";
  return `${freshness.sourceLabel} · ${freshness.timeLabel}`;
}

type FreshRow = Pick<LendingRow, "venue" | "source" | "collateralUsd" | "stableBorrowedUsd" | "lendSupplyUsd" | "borrowApy" | "borrowEstimate">;

export function lendingFigureFreshness(
  rows: readonly FreshRow[],
  capturedAt: string | null,
  kind: LendingFigureKind,
): LendingFigureFreshness {
  const timeLabel = formatLendingCapturedAt(capturedAt);
  const picked =
    kind === "collateral"
      ? rows.filter((row) => row.collateralUsd !== null)
      : kind === "borrowed"
        ? rows.filter((row) => row.stableBorrowedUsd !== null)
        : kind === "full"
          ? rows.filter((row) => lendingPublishesOwnSupply(row))
          : rows.filter((row) => row.borrowApy !== null && !row.borrowEstimate);
  const sources = uniqueSources(picked);
  return {
    timeLabel,
    sourceLabel: lendingSourceLabel(sources),
    sources,
    note: kind === "borrowed" ? estimateNote(picked, capturedAt) : null,
  };
}

/**
 * Stocks people lock up, and the places that accept each one.
 * A place is one venue. Tokens at that venue stay separate by address.
 * Dollars that were not reported stay null. They are not treated as zero.
 */
export function buildLendingCompare(rows: readonly CompareRow[], capturedAt: string | null): LendingCompareModel {
  const byTicker = new Map<string, Map<string, LendingComparePlace>>();
  for (const row of rows) {
    const tokensByTicker = new Map<string, Map<string, LendingCompareToken>>();
    for (const asset of row.assets ?? []) {
      const classified = classifyLendingSymbol(asset.symbol, row.chainId);
      const tokens = tokensByTicker.get(classified.ticker) ?? new Map<string, LendingCompareToken>();
      const addressKey = asset.address.toLowerCase();
      const current = tokens.get(addressKey);
      if (!current) {
        tokens.set(addressKey, tokenFrom(asset, classified.wrapper));
      } else {
        current.collateralUsd = addKnown(current.collateralUsd, asset.collateralUsd);
      }
      tokensByTicker.set(classified.ticker, tokens);
    }
    for (const [ticker, tokens] of tokensByTicker) {
      const places = byTicker.get(ticker) ?? new Map<string, LendingComparePlace>();
      const list = [...tokens.values()].sort(
        (a, b) => compareKnown(a.collateralUsd, b.collateralUsd) || a.symbol.localeCompare(b.symbol) || a.address.localeCompare(b.address),
      );
      places.set(row.id, placeFrom(row, rows, list, capturedAt));
      byTicker.set(ticker, places);
    }
  }
  const places: Record<string, LendingComparePlace[]> = {};
  const stocks: LendingStockRank[] = [];
  for (const [ticker, venueMap] of byTicker) {
    const list = [...venueMap.values()].sort(comparePlaces);
    places[ticker] = list;
    let collateralUsd: number | null = null;
    let unpricedTokens = 0;
    for (const place of list) {
      collateralUsd = addKnown(collateralUsd, place.collateralUsd);
      unpricedTokens += place.unpricedTokens;
    }
    stocks.push({ ticker, collateralUsd, placeCount: list.length, unpricedTokens });
  }
  stocks.sort((a, b) => compareKnown(a.collateralUsd, b.collateralUsd) || a.ticker.localeCompare(b.ticker));
  return { timeLabel: formatLendingCapturedAt(capturedAt), stocks, places };
}

/** One sentence for the cheapest published yearly cost. A missing cost is not called cheapest. */
export function lendingCompareAnswer(places: readonly LendingComparePlace[]): string {
  const priced = places.filter((place) => place.borrowApy !== null && !place.estimate);
  if (priced.length === 0) return "No venue published a yearly cost for this stock.";
  const [first] = priced;
  if (!first) return "No venue published a yearly cost for this stock.";
  const lowest = formatLendingApy(first);
  const tied = priced.filter((place) => formatLendingApy(place) === lowest);
  if (tied.length === 1) return `The lowest published yearly cost is ${lowest} at ${first.label}.`;
  return `The lowest published yearly cost is ${lowest}, tied at ${joinNames(tied.map((place) => place.label))}.`;
}

function placeFrom(
  row: CompareRow,
  rows: readonly CompareRow[],
  tokens: LendingCompareToken[],
  capturedAt: string | null,
): LendingComparePlace {
  let collateralUsd: number | null = null;
  let unpricedTokens = 0;
  for (const token of tokens) {
    if (token.collateralUsd === null) unpricedTokens += 1;
    else collateralUsd = addKnown(collateralUsd, token.collateralUsd);
  }
  const source = lendingSourceHost(row.source);
  const howFull = lendingPublishesOwnSupply(row) ? lendingUtilization(row.stableBorrowedUsd, row.lendSupplyUsd) : null;
  return {
    venueId: row.id,
    venue: row.venue,
    label: lendingVenueLabel(row, rows),
    chainId: row.chainId,
    chainLabel: row.chainLabel,
    collateralUsd,
    unpricedTokens,
    borrowApy: row.borrowEstimate ? null : row.borrowApy,
    borrowApyMin: row.borrowEstimate ? null : row.borrowApyMin,
    borrowApyMax: row.borrowEstimate ? null : row.borrowApyMax,
    howFull,
    lendSupplyUsd: row.lendSupplyUsd,
    estimate: Boolean(row.borrowEstimate),
    source: row.source,
    sourceHost: source.host,
    sourceHref: source.href,
    timeLabel: formatLendingCapturedAt(row.borrowEstimate?.asOf ?? capturedAt),
    tokens,
  };
}

function tokenFrom(asset: LendingAsset, wrapper: string): LendingCompareToken {
  return {
    symbol: asset.symbol,
    wrapper,
    address: asset.address,
    collateralUsd: asset.collateralUsd,
  };
}

function uniqueSources(rows: readonly { source: string }[]): LendingFigureSource[] {
  const seen = new Map<string, LendingFigureSource>();
  for (const row of rows) {
    const source = lendingSourceHost(row.source);
    const key = source.host.toLowerCase();
    if (!seen.has(key)) seen.set(key, source);
  }
  return [...seen.values()].sort((a, b) => a.host.localeCompare(b.host));
}

function estimateNote(rows: readonly { venue: string; borrowEstimate?: LendingBorrowEstimate | null }[], capturedAt: string | null): string | null {
  const estimated = rows.filter((row) => row.borrowEstimate);
  if (estimated.length === 0) return null;
  const names = [...new Set(estimated.map((row) => row.venue))].sort((a, b) => a.localeCompare(b));
  const lead = `${joinNames(names)} borrow is a pro-rata estimate.`;
  const measured = estimated.find((row) => row.borrowEstimate?.asOf && row.borrowEstimate.asOf !== capturedAt);
  if (!measured?.borrowEstimate?.asOf) return lead;
  return `${lead} Last measured ${formatLendingCapturedAt(measured.borrowEstimate.asOf)}.`;
}

function comparePlaces(a: LendingComparePlace, b: LendingComparePlace): number {
  const aCost = a.estimate ? null : a.borrowApy;
  const bCost = b.estimate ? null : b.borrowApy;
  if (aCost === null && bCost === null) return compareKnown(a.collateralUsd, b.collateralUsd) || a.label.localeCompare(b.label);
  if (aCost === null) return 1;
  if (bCost === null) return -1;
  if (aCost !== bCost) return aCost - bCost;
  return compareKnown(a.collateralUsd, b.collateralUsd) || a.label.localeCompare(b.label);
}

function addKnown(current: number | null, next: number | null): number | null {
  if (next === null) return current;
  if (current === null) return next;
  return current + next;
}

/** Larger known dollars first. A missing amount sorts last and does not become zero. */
function compareKnown(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
}

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}
