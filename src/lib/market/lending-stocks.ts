import { formatUsdCompact } from "./format";
import {
  formatLendingApy,
  formatLendingFractionPct,
  type LendingAsset,
  type LendingRow,
} from "./lending-snapshot";

export interface LendingStockPlace {
  ticker: string;
  venueId: string;
  venue: string;
  chainId: string;
  chainLabel: string;
  symbol: string;
  wrapper: string;
  maxLtv: number | null;
  collateralUsd: number | null;
  borrowApy: number | null;
  borrowApyMin: number | null;
  borrowApyMax: number | null;
  /** True when this pool does not publish a yearly borrow cost. */
  costUnavailable: boolean;
}

export interface LendingStockGroup {
  ticker: string;
  places: LendingStockPlace[];
  /** Sum of places that reported dollars. Null when none did. */
  collateralUsd: number | null;
  /** Places the source lists without a dollar amount. */
  unpricedPlaces: number;
}

const NAMED_SYMBOLS: Record<string, { ticker: string; wrapper: string }> = {
  despxa: { ticker: "SPXA", wrapper: "Centrifuge" },
};

/**
 * Group issuer wrappers that share an underlying ticker.
 * Suffixes are the ones these issuers publish: xStocks `x`, Coinbase `c`,
 * Ondo `on`, bStocks `B` on BNB, and bare tickers on Robinhood Chain.
 * Anything else stays its own symbol and is labeled "Not named".
 */
export function classifyLendingSymbol(symbol: string, chainId: string): { ticker: string; wrapper: string } {
  const raw = symbol.trim();
  const named = NAMED_SYMBOLS[raw.toLowerCase()];
  if (named) return named;
  const wrapped = /^w([A-Za-z][A-Za-z0-9]{0,7})x$/.exec(raw);
  if (wrapped?.[1]) return { ticker: wrapped[1].toUpperCase(), wrapper: "xStocks" };
  const xstock = /^([A-Za-z][A-Za-z0-9]{0,7})x$/.exec(raw);
  if (xstock?.[1]) return { ticker: xstock[1].toUpperCase(), wrapper: "xStocks" };
  const st0x = /^wt([A-Za-z][A-Za-z0-9]{0,7})$/.exec(raw);
  if (st0x?.[1]) return { ticker: st0x[1].toUpperCase(), wrapper: "ST0x" };
  const ondo = /^([A-Za-z][A-Za-z0-9]{0,7})on$/.exec(raw);
  if (ondo?.[1]) return { ticker: ondo[1].toUpperCase(), wrapper: "Ondo" };
  const coinbase = /^([A-Za-z][A-Za-z0-9]{0,7})c$/.exec(raw);
  if (coinbase?.[1]) return { ticker: coinbase[1].toUpperCase(), wrapper: "Coinbase" };
  if (chainId === "bnb") {
    const bstock = /^([A-Za-z][A-Za-z0-9]{1,7})B$/.exec(raw);
    if (bstock?.[1]) return { ticker: bstock[1].toUpperCase(), wrapper: "bStocks" };
  }
  if (chainId === "robinhood-chain" && /^[A-Za-z][A-Za-z0-9]{0,7}$/.test(raw)) {
    return { ticker: raw.toUpperCase(), wrapper: "Robinhood" };
  }
  return { ticker: raw.toUpperCase(), wrapper: "Not named" };
}

type StockRow = Pick<
  LendingRow,
  "id" | "venue" | "chainId" | "chainLabel" | "borrowApy" | "borrowApyMin" | "borrowApyMax" | "assets" | "borrowEstimate"
>;

/** Books smaller than this are tucked behind "Show smaller pools". */
export const SMALL_LENDING_BOOK_USD = 10_000;

export interface LendingBoardRow {
  key: string;
  ticker: string;
  symbol: string;
  address: string;
  wrapper: string;
  venueId: string;
  venue: string;
  chainId: string;
  chainLabel: string;
  collateralUsd: number | null;
  /** Token count, only when that source reported one. */
  collateralTokens: number | null;
  /** Why the dollar amount is missing, when the source was checked. */
  priceNote: string | null;
  maxLtv: number | null;
  borrowApy: number | null;
  borrowApyMin: number | null;
  borrowApyMax: number | null;
  costUnavailable: boolean;
  utilization: number | null;
  /** Shared pools that do not publish their own fullness. */
  howFullUnavailable: boolean;
  /** Venue-level stock deposited. Shared by every token in that book. */
  venueCollateralUsd: number | null;
  venueBorrowedUsd: number | null;
  stockBorrowedUsd: number | null;
  source: string;
  smallBook: boolean;
}

type BoardSource = StockRow &
  Pick<LendingRow, "utilization" | "collateralUsd" | "stableBorrowedUsd" | "stockBorrowedUsd" | "source">;

/**
 * One table row per stock token at a venue. Dollars, limits, and costs are
 * copied from the snapshot. A book is "small" only when both sides are under
 * {@link SMALL_LENDING_BOOK_USD}; an unknown size is not hidden.
 */
export function lendingBoardRows(rows: readonly BoardSource[]): LendingBoardRow[] {
  const out: LendingBoardRow[] = [];
  for (const row of rows) {
    const smallBook = isSmallLendingBook(row.collateralUsd, row.stableBorrowedUsd);
    const merged = new Map<string, LendingBoardRow>();
    for (const asset of row.assets ?? []) {
      const classified = classifyLendingSymbol(asset.symbol, row.chainId);
      const key = `${row.id}|${classified.ticker}|${asset.symbol.toLowerCase()}`;
      const current = merged.get(key);
      if (!current) {
        merged.set(key, {
          key,
          ticker: classified.ticker,
          symbol: asset.symbol,
          address: asset.address,
          wrapper: classified.wrapper,
          venueId: row.id,
          venue: row.venue,
          chainId: row.chainId,
          chainLabel: row.chainLabel,
          collateralUsd: asset.collateralUsd,
          collateralTokens: asset.collateralTokens,
          priceNote: asset.collateralUsd === null ? asset.priceNote ?? null : null,
          maxLtv: asset.maxLtv,
          borrowApy: row.borrowApy,
          borrowApyMin: row.borrowApyMin,
          borrowApyMax: row.borrowApyMax,
          costUnavailable: row.borrowEstimate !== null,
          utilization: row.utilization,
          howFullUnavailable: row.borrowEstimate !== null,
          venueCollateralUsd: row.collateralUsd,
          venueBorrowedUsd: row.stableBorrowedUsd,
          stockBorrowedUsd: row.stockBorrowedUsd,
          source: row.source,
          smallBook,
        });
        continue;
      }
      current.collateralUsd = addCollateral(current.collateralUsd, asset.collateralUsd);
      if (current.collateralUsd !== null) current.priceNote = null;
      else if (asset.priceNote) current.priceNote = current.priceNote ?? asset.priceNote;
      if (asset.collateralTokens !== null) current.collateralTokens = (current.collateralTokens ?? 0) + asset.collateralTokens;
      if (asset.maxLtv !== null && (current.maxLtv === null || asset.maxLtv > current.maxLtv)) current.maxLtv = asset.maxLtv;
    }
    out.push(...merged.values());
  }
  out.sort(
    (a, b) =>
      compareCollateral(a.collateralUsd, b.collateralUsd) ||
      a.chainLabel.localeCompare(b.chainLabel) ||
      a.venue.localeCompare(b.venue) ||
      a.ticker.localeCompare(b.ticker),
  );
  return out;
}

export interface LendingChainSharePart {
  chainId: string;
  chainLabel: string;
  collateralUsd: number;
}

/** Big chains stay named. Books under {@link SMALL_LENDING_BOOK_USD} fold into one smaller-pools total. */
export function lendingChainShareParts(
  chains: readonly { chainId: string; chainLabel: string; collateralUsd: number | null }[],
): { main: LendingChainSharePart[]; smallerUsd: number | null } {
  const main: LendingChainSharePart[] = [];
  let smaller = 0;
  let smallerSeen = false;
  for (const chain of chains) {
    if (chain.collateralUsd === null || !(chain.collateralUsd > 0)) continue;
    if (chain.collateralUsd < SMALL_LENDING_BOOK_USD) {
      smaller += chain.collateralUsd;
      smallerSeen = true;
      continue;
    }
    main.push({ chainId: chain.chainId, chainLabel: chain.chainLabel, collateralUsd: chain.collateralUsd });
  }
  return { main, smallerUsd: smallerSeen ? smaller : null };
}

export function isSmallLendingBook(collateralUsd: number | null, borrowedUsd: number | null): boolean {
  if (collateralUsd === null && borrowedUsd === null) return false;
  return Math.max(collateralUsd ?? 0, borrowedUsd ?? 0) < SMALL_LENDING_BOOK_USD;
}

export function lendingStockGroups(rows: readonly StockRow[]): LendingStockGroup[] {
  const groups = new Map<string, LendingStockGroup>();
  for (const row of rows) {
    const merged = new Map<string, LendingStockPlace>();
    for (const asset of row.assets ?? []) {
      const classified = classifyLendingSymbol(asset.symbol, row.chainId);
      const key = `${classified.ticker}|${asset.symbol.toLowerCase()}`;
      const current = merged.get(key);
      if (!current) {
        merged.set(key, placeFrom(row, asset, classified));
        continue;
      }
      current.collateralUsd = addCollateral(current.collateralUsd, asset.collateralUsd);
      if (asset.maxLtv !== null && (current.maxLtv === null || asset.maxLtv > current.maxLtv)) current.maxLtv = asset.maxLtv;
    }
    for (const place of merged.values()) {
      const group = groups.get(place.ticker) ?? {
        ticker: place.ticker,
        places: [],
        collateralUsd: null,
        unpricedPlaces: 0,
      };
      group.places.push(place);
      if (place.collateralUsd === null) group.unpricedPlaces += 1;
      else group.collateralUsd = (group.collateralUsd ?? 0) + place.collateralUsd;
      groups.set(place.ticker, group);
    }
  }
  const list = [...groups.values()];
  for (const group of list) {
    group.places.sort((a, b) => compareCollateral(a.collateralUsd, b.collateralUsd) || a.venue.localeCompare(b.venue) || a.symbol.localeCompare(b.symbol));
  }
  list.sort((a, b) => compareCollateral(a.collateralUsd, b.collateralUsd) || a.ticker.localeCompare(b.ticker));
  return list;
}

function placeFrom(
  row: StockRow,
  asset: LendingAsset,
  classified: { ticker: string; wrapper: string },
): LendingStockPlace {
  return {
    ticker: classified.ticker,
    venueId: row.id,
    venue: row.venue,
    chainId: row.chainId,
    chainLabel: row.chainLabel,
    symbol: asset.symbol,
    wrapper: classified.wrapper,
    maxLtv: asset.maxLtv,
    collateralUsd: asset.collateralUsd,
    borrowApy: row.borrowApy,
    borrowApyMin: row.borrowApyMin,
    borrowApyMax: row.borrowApyMax,
    costUnavailable: row.borrowApy === null || Boolean(row.borrowEstimate),
  };
}

function addCollateral(current: number | null, next: number | null): number | null {
  if (current === null || next === null) return null;
  return current + next;
}

function compareCollateral(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
}

type ActionRow = Pick<
  LendingRow,
  | "venue"
  | "chainLabel"
  | "utilization"
  | "stableBorrowedUsd"
  | "borrowApy"
  | "borrowApyMin"
  | "borrowApyMax"
  | "stockBorrowedUsd"
  | "borrowEstimate"
  | "assets"
>;

export interface LendingActionChip {
  label: string;
  text: string;
}

/** Short labeled facts from the same rows as {@link lendingActionLines}. */
export function lendingActionChips(rows: readonly ActionRow[]): LendingActionChip[] {
  const chips: LendingActionChip[] = [];
  const full = rows
    .filter((row) => !row.borrowEstimate && row.utilization !== null && row.utilization >= 0.85 && (row.stableBorrowedUsd ?? 0) >= 25_000)
    .sort((a, b) => (b.utilization ?? 0) - (a.utilization ?? 0))
    .slice(0, 2);
  if (full.length > 0) {
    chips.push({
      label: "Nearly full",
      text: full
        .map((row) => {
          const cost = row.borrowApy === null ? "" : ` · ${formatLendingFractionPct(row.borrowApy)}`;
          return `${row.venue} ${formatLendingFractionPct(row.utilization)}${cost}`;
        })
        .join(" · "),
    });
  }

  const room = rows
    .filter(
      (row) =>
        !row.borrowEstimate &&
        row.utilization !== null &&
        row.utilization <= 0.4 &&
        row.borrowApy !== null &&
        row.borrowApy <= 0.02 &&
        (row.stableBorrowedUsd ?? 0) >= 100_000,
    )
    .sort((a, b) => (a.borrowApy ?? 0) - (b.borrowApy ?? 0))
    .slice(0, 2);
  if (room.length > 0) {
    chips.push({
      label: "Room",
      text: room.map((row) => `${row.venue} ${formatLendingFractionPct(row.utilization)} · ${formatLendingApy(row)}`).join(" · "),
    });
  }

  const costly = rows
    .filter((row) => !row.borrowEstimate && row.borrowApy !== null && (row.stableBorrowedUsd ?? 0) >= 100_000)
    .sort((a, b) => (b.borrowApyMax ?? b.borrowApy ?? 0) - (a.borrowApyMax ?? a.borrowApy ?? 0));
  const highest = costly[0];
  if (highest && (highest.borrowApyMax ?? highest.borrowApy ?? 0) >= 0.1) {
    chips.push({
      label: "Highest cost",
      text: `${highest.venue} · ${highest.chainLabel} ${formatLendingApy(highest)}`,
    });
  }

  const shorts = rows
    .filter((row) => (row.stockBorrowedUsd ?? 0) >= 1_000)
    .sort((a, b) => (b.stockBorrowedUsd ?? 0) - (a.stockBorrowedUsd ?? 0));
  if (shorts.length > 0) {
    chips.push({
      label: "Shorting",
      text: shorts.map((row) => `${row.venue} ${formatUsdCompact(row.stockBorrowedUsd)}`).join(" · "),
    });
  }

  const tokens: { symbol: string; venue: string; usd: number }[] = [];
  for (const row of rows) {
    for (const asset of row.assets ?? []) {
      if (asset.collateralUsd !== null && asset.collateralUsd >= 1_000) {
        tokens.push({ symbol: asset.symbol, venue: row.venue, usd: asset.collateralUsd });
      }
    }
  }
  tokens.sort((a, b) => b.usd - a.usd || a.symbol.localeCompare(b.symbol));
  const top = tokens.slice(0, 3);
  if (top.length > 0) {
    chips.push({
      label: "Biggest",
      text: top.map((token) => `${token.symbol} ${formatUsdCompact(token.usd)}`).join(" · "),
    });
  }
  return chips;
}

/** Short, snapshot-driven notes. A category with no matching rows is omitted. */
export function lendingActionLines(rows: readonly ActionRow[]): string[] {
  const lines: string[] = [];
  const full = rows
    .filter((row) => !row.borrowEstimate && row.utilization !== null && row.utilization >= 0.85 && (row.stableBorrowedUsd ?? 0) >= 25_000)
    .sort((a, b) => (b.utilization ?? 0) - (a.utilization ?? 0))
    .slice(0, 2);
  if (full.length > 0) {
    const bits = full.map((row) => {
      const costBit = row.borrowApy === null ? "" : ` at about ${formatLendingFractionPct(row.borrowApy)}`;
      return `${row.venue} on ${row.chainLabel} is ${formatLendingFractionPct(row.utilization)} full${costBit}`;
    });
    lines.push(`Nearly full: ${bits.join("; ")}.`);
  }

  const room = rows
    .filter(
      (row) =>
        !row.borrowEstimate &&
        row.utilization !== null &&
        row.utilization <= 0.4 &&
        row.borrowApy !== null &&
        row.borrowApy <= 0.02 &&
        (row.stableBorrowedUsd ?? 0) >= 100_000,
    )
    .sort((a, b) => (a.borrowApy ?? 0) - (b.borrowApy ?? 0))
    .slice(0, 2);
  if (room.length > 0) {
    const bits = room.map(
      (row) => `${row.venue} on ${row.chainLabel} is ${formatLendingFractionPct(row.utilization)} full at ${formatLendingApy(row)}`,
    );
    lines.push(`Cheap pools with room: ${bits.join("; ")}.`);
  }

  const costly = rows
    .filter((row) => !row.borrowEstimate && row.borrowApy !== null && (row.stableBorrowedUsd ?? 0) >= 100_000)
    .sort((a, b) => (b.borrowApyMax ?? b.borrowApy ?? 0) - (a.borrowApyMax ?? a.borrowApy ?? 0));
  const highest = costly[0];
  if (highest && (highest.borrowApyMax ?? highest.borrowApy ?? 0) >= 0.1) {
    lines.push(
      `${highest.venue} on ${highest.chainLabel} costs ${formatLendingApy(highest)} a year. That is the highest yearly cost among the bigger pools.`,
    );
  }

  const shorts = rows
    .filter((row) => (row.stockBorrowedUsd ?? 0) >= 1_000)
    .sort((a, b) => (b.stockBorrowedUsd ?? 0) - (a.stockBorrowedUsd ?? 0));
  if (shorts.length > 0) {
    lines.push(`Stocks lent for shorting: ${shorts.map((row) => `${row.venue} ${formatUsdCompact(row.stockBorrowedUsd)}`).join(", ")}.`);
  }

  const tokens: { symbol: string; venue: string; usd: number }[] = [];
  for (const row of rows) {
    for (const asset of row.assets ?? []) {
      if (asset.collateralUsd !== null && asset.collateralUsd >= 1_000) {
        tokens.push({ symbol: asset.symbol, venue: row.venue, usd: asset.collateralUsd });
      }
    }
  }
  tokens.sort((a, b) => b.usd - a.usd || a.symbol.localeCompare(b.symbol));
  const top = tokens.slice(0, 3);
  if (top.length > 0) {
    lines.push(`Biggest deposits: ${top.map((token) => `${token.symbol} on ${token.venue} (${formatUsdCompact(token.usd)})`).join(", ")}.`);
  }
  return lines;
}
