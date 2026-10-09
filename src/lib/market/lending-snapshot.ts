import { formatUsdCompact } from "./format";
import { asNonEmptyString, asReportedNumber, sumNullable } from "./numbers";
import { easternDayKey } from "./volume-snapshots";

export const LENDING_SNAPSHOT_SCHEMA = "equity-lending-v1";

/** CEX margin books that do not publish usage. They are not rows. */
export const EXCLUDED_CEX_MARGIN_VENUES = ["Binance", "Bybit", "Kraken", "Bitget"] as const;

export const LENDING_CHAIN_ORDER = [
  "solana",
  "base",
  "robinhood-chain",
  "ethereum",
  "hyperevm",
  "bnb",
] as const;

const CHAIN_LABELS: Record<string, string> = {
  solana: "Solana",
  base: "Base",
  "robinhood-chain": "Robinhood Chain",
  ethereum: "Ethereum",
  hyperevm: "HyperEVM",
  bnb: "BNB",
};

export interface LendingRow {
  id: string;
  venue: string;
  chainId: string;
  chainLabel: string;
  /** Stock tokens supplied as collateral, USD. */
  collateralUsd: number | null;
  /** Stablecoins borrowed against that collateral, USD. */
  stableBorrowedUsd: number | null;
  /**
   * Stablecoin lend-side supply in this venue's own pool, USD.
   * Null when borrows draw from a shared pool that is not this book.
   */
  lendSupplyUsd: number | null;
  /** Borrowed / lend-side supply, as a fraction. */
  utilization: number | null;
  /** Borrow-weighted stablecoin borrow APY, as a fraction. */
  borrowApy: number | null;
  borrowApyMin: number | null;
  borrowApyMax: number | null;
  /** Stock tokens borrowed, when the source reports a short book. */
  stockBorrowedUsd: number | null;
  /** Stock tokens this venue accepts, with max LTV when the source reports it. */
  assets?: LendingAsset[];
  /** Plain note about a gap in the row. Not a place for invented numbers. */
  note?: string | null;
  /**
   * Set when stableBorrowedUsd is an estimate, not a pool total.
   * The dollars still live on stableBorrowedUsd so the desk total can include them.
   */
  borrowEstimate?: LendingBorrowEstimate | null;
  source: string;
  error: string | null;
}

export interface LendingAsset {
  symbol: string;
  address: string;
  collateralUsd: number | null;
  /** Max borrow as a fraction of collateral. 0.7 means $70 per $100 of stock. */
  maxLtv: number | null;
}

export interface LendingBorrowEstimate {
  method: string;
  /** ISO time the estimate was measured. May be earlier than the snapshot. */
  asOf: string;
  lowerBoundUsd: number | null;
}

export interface LendingSourceNote {
  source: string;
  message: string;
}

export interface LendingDaySnapshot {
  schema: typeof LENDING_SNAPSHOT_SCHEMA;
  date: string;
  capturedAt: string;
  rows: LendingRow[];
  failures: LendingSourceNote[];
}

export interface LendingTotals {
  collateralUsd: number | null;
  stableBorrowedUsd: number | null;
  utilization: number | null;
  borrowApy: number | null;
  borrowApyMin: number | null;
  borrowApyMax: number | null;
  stockBorrowedUsd: number | null;
}

export interface LendingChainGroup {
  chainId: string;
  chainLabel: string;
  rows: LendingRow[];
  totals: LendingTotals;
}

export interface LendingHistoryPoint {
  date: string;
  capturedAt: string;
  collateralUsd: number | null;
  stableBorrowedUsd: number | null;
}

export interface LendingDeskModel {
  date: string | null;
  capturedAt: string | null;
  readError: string | null;
  rows: LendingRow[];
  chains: LendingChainGroup[];
  totals: LendingTotals;
  failures: LendingSourceNote[];
  history: LendingHistoryPoint[];
}

export function lendingChainLabel(chainId: string): string {
  return CHAIN_LABELS[chainId] ?? chainId;
}

export function emptyLendingTotals(): LendingTotals {
  return {
    collateralUsd: null,
    stableBorrowedUsd: null,
    utilization: null,
    borrowApy: null,
    borrowApyMin: null,
    borrowApyMax: null,
    stockBorrowedUsd: null,
  };
}

export function emptyLendingDeskModel(readError?: string): LendingDeskModel {
  return {
    date: null,
    capturedAt: null,
    readError: readError ?? null,
    rows: [],
    chains: [],
    totals: emptyLendingTotals(),
    failures: [],
    history: [],
  };
}

/** Borrow-weighted APY. The displayed band ignores books under 5% of borrows. */
export function lendingApyBand(
  points: readonly { apy: number | null; weight: number | null }[],
): { borrowApy: number | null; borrowApyMin: number | null; borrowApyMax: number | null } {
  const usable = points.filter(
    (point): point is { apy: number; weight: number } =>
      typeof point.apy === "number" &&
      Number.isFinite(point.apy) &&
      typeof point.weight === "number" &&
      Number.isFinite(point.weight) &&
      point.weight > 0,
  );
  const weight = usable.reduce((sum, point) => sum + point.weight, 0);
  if (!(weight > 0)) return { borrowApy: null, borrowApyMin: null, borrowApyMax: null };
  const borrowApy = usable.reduce((sum, point) => sum + point.apy * point.weight, 0) / weight;
  const material = usable.filter((point) => point.weight / weight >= 0.05);
  const band = material.length > 0 ? material : usable;
  return {
    borrowApy,
    borrowApyMin: Math.min(...band.map((point) => point.apy)),
    borrowApyMax: Math.max(...band.map((point) => point.apy)),
  };
}

/**
 * Utilization is stablecoin borrows divided by stablecoin supply.
 * Collateral is not the denominator. A missing side stays missing.
 */
export function lendingUtilization(borrowedUsd: number | null, supplyUsd: number | null): number | null {
  if (borrowedUsd === null || supplyUsd === null) return null;
  if (!(supplyUsd > 0) || !Number.isFinite(borrowedUsd)) return null;
  return borrowedUsd / supplyUsd;
}

export function aggregateLendingTotals(rows: readonly LendingRow[]): LendingTotals {
  const collateralUsd = sumNullable(rows.map((row) => row.collateralUsd));
  const stableBorrowedUsd = sumNullable(rows.map((row) => row.stableBorrowedUsd));
  const stockBorrowedUsd = sumNullable(rows.map((row) => row.stockBorrowedUsd));
  const utilization = aggregateUtilization(rows);
  const band = lendingApyBand(rows.map((row) => ({ apy: row.borrowApy, weight: row.stableBorrowedUsd })));
  const spread = materialApySpread(rows);
  return {
    collateralUsd,
    stableBorrowedUsd,
    utilization,
    borrowApy: band.borrowApy,
    borrowApyMin: spread ? spread.min : band.borrowApyMin,
    borrowApyMax: spread ? spread.max : band.borrowApyMax,
    stockBorrowedUsd,
  };
}

/** Min and max of venues that are at least 5% of borrows. A dust book does not set the floor. */
function materialApySpread(rows: readonly LendingRow[]): { min: number; max: number } | null {
  const priced = rows.filter(
    (row): row is LendingRow & { stableBorrowedUsd: number; borrowApy: number } =>
      row.borrowApy !== null && row.stableBorrowedUsd !== null && row.stableBorrowedUsd > 0,
  );
  const weight = priced.reduce((sum, row) => sum + row.stableBorrowedUsd, 0);
  if (!(weight > 0)) return null;
  const material = priced.filter((row) => row.stableBorrowedUsd / weight >= 0.05);
  const band = material.length > 0 ? material : priced;
  const lows = band.map((row) => row.borrowApyMin ?? row.borrowApy);
  const highs = band.map((row) => row.borrowApyMax ?? row.borrowApy);
  return { min: Math.min(...lows), max: Math.max(...highs) };
}

function aggregateUtilization(rows: readonly LendingRow[]): number | null {
  const withUtil = rows.filter(
    (row): row is LendingRow & { utilization: number; stableBorrowedUsd: number } =>
      row.utilization !== null && row.stableBorrowedUsd !== null && row.stableBorrowedUsd > 0,
  );
  if (withUtil.length === 0) return weightedUtilization(rows);
  const allHaveSupply = withUtil.every((row) => row.lendSupplyUsd !== null && row.lendSupplyUsd > 0);
  if (allHaveSupply) {
    return lendingUtilization(
      sumNullable(withUtil.map((row) => row.stableBorrowedUsd)),
      sumNullable(withUtil.map((row) => row.lendSupplyUsd)),
    );
  }
  return weightedUtilization(withUtil);
}

function weightedUtilization(rows: readonly LendingRow[]): number | null {
  const points = rows.filter(
    (row): row is LendingRow & { utilization: number; stableBorrowedUsd: number } =>
      row.utilization !== null && row.stableBorrowedUsd !== null && row.stableBorrowedUsd > 0,
  );
  const weight = points.reduce((sum, row) => sum + row.stableBorrowedUsd, 0);
  if (!(weight > 0)) return null;
  return points.reduce((sum, row) => sum + row.utilization * row.stableBorrowedUsd, 0) / weight;
}

function chainRank(chainId: string): number {
  const index = LENDING_CHAIN_ORDER.indexOf(chainId as (typeof LENDING_CHAIN_ORDER)[number]);
  return index === -1 ? LENDING_CHAIN_ORDER.length : index;
}

export function groupLendingRows(rows: readonly LendingRow[]): LendingChainGroup[] {
  const byChain = new Map<string, LendingRow[]>();
  for (const row of rows) {
    const list = byChain.get(row.chainId) ?? [];
    list.push(row);
    byChain.set(row.chainId, list);
  }
  return [...byChain.entries()]
    .sort((a, b) => chainRank(a[0]) - chainRank(b[0]) || a[0].localeCompare(b[0]))
    .map(([chainId, chainRows]) => {
      const sorted = [...chainRows].sort((a, b) => {
        const byCollateral = (b.collateralUsd ?? -1) - (a.collateralUsd ?? -1);
        if (byCollateral !== 0) return byCollateral;
        return a.venue.localeCompare(b.venue);
      });
      return {
        chainId,
        chainLabel: sorted[0]?.chainLabel ?? lendingChainLabel(chainId),
        rows: sorted,
        totals: aggregateLendingTotals(sorted),
      };
    });
}

export function lendingHistoryFromDays(days: readonly LendingDaySnapshot[]): LendingHistoryPoint[] {
  return [...days]
    .sort((a, b) => a.date.localeCompare(b.date) || a.capturedAt.localeCompare(b.capturedAt))
    .map((day) => {
      const totals = aggregateLendingTotals(day.rows);
      return {
        date: day.date,
        capturedAt: day.capturedAt,
        collateralUsd: totals.collateralUsd,
        stableBorrowedUsd: totals.stableBorrowedUsd,
      };
    });
}

export function buildLendingDeskModel(
  file: LendingDaySnapshot | null,
  readError?: string,
  history?: readonly LendingDaySnapshot[],
): LendingDeskModel {
  if (!file) return emptyLendingDeskModel(readError);
  const rows = file.rows;
  const days = history && history.length > 0 ? history : [file];
  return {
    date: file.date,
    capturedAt: file.capturedAt,
    readError: readError ?? null,
    rows,
    chains: groupLendingRows(rows),
    totals: aggregateLendingTotals(rows),
    failures: file.failures,
    history: lendingHistoryFromDays(days),
  };
}

export function lendingDayFromCapture(capturedAtMs: number, rows: LendingRow[], failures: LendingSourceNote[]): LendingDaySnapshot {
  const capturedAt = new Date(capturedAtMs).toISOString();
  return {
    schema: LENDING_SNAPSHOT_SCHEMA,
    date: easternDayKey(capturedAtMs / 1000),
    capturedAt,
    rows,
    failures,
  };
}

export function lendingSnapshotFileName(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Lending snapshot date is not an Eastern day: ${date}`);
  return `${date}.json`;
}

function parseRow(value: unknown): LendingRow | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<LendingRow>;
  const id = asNonEmptyString(row.id);
  const venue = asNonEmptyString(row.venue);
  const chainId = asNonEmptyString(row.chainId);
  if (!id || !venue || !chainId) return null;
  return {
    id,
    venue,
    chainId,
    chainLabel: asNonEmptyString(row.chainLabel) ?? lendingChainLabel(chainId),
    collateralUsd: nullableUsd(row.collateralUsd),
    stableBorrowedUsd: nullableUsd(row.stableBorrowedUsd),
    lendSupplyUsd: nullableUsd(row.lendSupplyUsd),
    utilization: nullableFraction(row.utilization),
    borrowApy: nullableFraction(row.borrowApy),
    borrowApyMin: nullableFraction(row.borrowApyMin),
    borrowApyMax: nullableFraction(row.borrowApyMax),
    stockBorrowedUsd: nullableUsd(row.stockBorrowedUsd),
    assets: parseAssets(row.assets),
    note: asNonEmptyString(row.note),
    borrowEstimate: parseBorrowEstimate(row.borrowEstimate),
    source: asNonEmptyString(row.source) ?? "",
    error: asNonEmptyString(row.error),
  };
}

function parseAssets(value: unknown): LendingAsset[] {
  if (!Array.isArray(value)) return [];
  const assets: LendingAsset[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const asset = item as Partial<LendingAsset>;
    const address = asNonEmptyString(asset.address);
    if (!address) continue;
    assets.push({
      symbol: asNonEmptyString(asset.symbol) ?? address,
      address,
      collateralUsd: nullableUsd(asset.collateralUsd),
      maxLtv: nullableFraction(asset.maxLtv),
    });
  }
  return assets;
}

function parseBorrowEstimate(value: unknown): LendingBorrowEstimate | null {
  if (!value || typeof value !== "object") return null;
  const estimate = value as Partial<LendingBorrowEstimate>;
  const method = asNonEmptyString(estimate.method);
  const asOf = asNonEmptyString(estimate.asOf);
  if (!method || !asOf) return null;
  return { method, asOf, lowerBoundUsd: nullableUsd(estimate.lowerBoundUsd) };
}

function nullableUsd(value: unknown): number | null {
  const parsed = asReportedNumber(value);
  if (parsed === null || parsed < 0) return null;
  return parsed;
}

function nullableFraction(value: unknown): number | null {
  const parsed = asReportedNumber(value);
  if (parsed === null || parsed < 0) return null;
  return parsed;
}

function parseFailure(value: unknown): LendingSourceNote | null {
  if (!value || typeof value !== "object") return null;
  const row = value as { source?: unknown; message?: unknown };
  const source = asNonEmptyString(row.source);
  const message = asNonEmptyString(row.message);
  if (!source || !message) return null;
  return { source, message };
}

export function parseLendingSnapshot(payload: unknown): LendingDaySnapshot | null {
  if (!payload || typeof payload !== "object") return null;
  const body = payload as Partial<LendingDaySnapshot>;
  if (body.schema !== LENDING_SNAPSHOT_SCHEMA) return null;
  const date = asNonEmptyString(body.date);
  const capturedAt = asNonEmptyString(body.capturedAt);
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !capturedAt) return null;
  const rows = Array.isArray(body.rows) ? body.rows.map(parseRow).filter((row): row is LendingRow => row !== null) : [];
  const failures = Array.isArray(body.failures)
    ? body.failures.map(parseFailure).filter((row): row is LendingSourceNote => row !== null)
    : [];
  return { schema: LENDING_SNAPSHOT_SCHEMA, date, capturedAt, rows, failures };
}

export function serializeLendingSnapshot(day: LendingDaySnapshot): string {
  const body: LendingDaySnapshot = {
    schema: LENDING_SNAPSHOT_SCHEMA,
    date: day.date,
    capturedAt: day.capturedAt,
    rows: day.rows,
    failures: day.failures,
  };
  return `${JSON.stringify(body, null, 2)}\n`;
}

export function formatLendingCapturedAt(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(ms));
}

export function formatLendingFractionPct(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const pct = value * 100;
  if (pct >= 99.95 && pct < 100.05) return "100%";
  return `${pct.toFixed(1)}%`;
}

export function formatLendingApy(row: Pick<LendingTotals, "borrowApy" | "borrowApyMin" | "borrowApyMax">): string {
  const low = row.borrowApyMin ?? row.borrowApy;
  const high = row.borrowApyMax ?? row.borrowApy;
  if (low === null || high === null) return "—";
  if (Math.abs(high - low) < 0.005) return formatLendingFractionPct(row.borrowApy ?? low);
  return `${formatLendingFractionPct(low).replace("%", "")}–${formatLendingFractionPct(high)}`;
}

/** Shown only when a source reports stock-token borrows above zero. A zero stays hidden. */
export function formatStockBorrowedNote(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value) || !(value > 0)) return null;
  return `Stock tokens lent for shorting ${formatUsdCompact(value)}`;
}

/** Compact estimate. Missing stays a dash. $255,389 reads as ~$0.26M. */
export function formatLendingEstimateUsd(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 100_000) return `~$${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `~$${(value / 1_000).toFixed(0)}K`;
  return `~${formatUsdCompact(value)}`;
}

export function lendingBorrowEstimateUsd(rows: readonly LendingRow[]): number | null {
  const amounts = rows
    .filter((row) => row.borrowEstimate && row.stableBorrowedUsd !== null)
    .map((row) => row.stableBorrowedUsd);
  return sumNullable(amounts);
}

export interface LendingHeadline {
  collateralSentence: string;
  borrowedSentence: string;
  fullSentence: string;
  costSentence: string;
}

function costSentence(totals: LendingTotals, hasEstimate: boolean): string {
  if (totals.borrowApy === null) return "We do not have a typical yearly borrow cost yet.";
  const typical = formatLendingFractionPct(totals.borrowApy);
  const low = totals.borrowApyMin;
  const high = totals.borrowApyMax;
  const spread =
    low !== null && high !== null && Math.abs(high - low) >= 0.005
      ? ` The bigger pools charge from ${formatLendingFractionPct(low)} to ${formatLendingFractionPct(high)}.`
      : "";
  const venus = hasEstimate ? " Venus is not in this average." : "";
  return `A typical borrower pays about ${typical} a year. Bigger loans count more than tiny ones.${spread}${venus}`;
}

export function lendingHeadline(rows: readonly LendingRow[], totals: LendingTotals): LendingHeadline {
  const estimate = lendingBorrowEstimateUsd(rows);
  const collateral = totals.collateralUsd;
  const borrowed = totals.stableBorrowedUsd;
  const full = totals.utilization;
  return {
    collateralSentence:
      collateral === null
        ? "We do not have a total yet for stock tokens locked up so people can borrow."
        : `People put in ${formatUsdCompact(collateral)} of stock tokens so they could borrow dollars against them.`,
    borrowedSentence:
      borrowed === null
        ? "We do not have a total yet for dollars borrowed against that stock."
        : estimate === null
          ? `People borrowed ${formatUsdCompact(borrowed)} of stablecoins (USDC, USDG, PYUSD, and similar) against that stock.`
          : `People borrowed ${formatUsdCompact(borrowed)} of stablecoins (USDC, USDG, PYUSD, and similar) against that stock. About ${formatLendingEstimateUsd(estimate)} of that is estimated, because Venus mixes these stocks with other coins.`,
    fullSentence:
      full === null
        ? "We cannot say how full the dollar pools are until both the dollars supplied and the dollars borrowed are known."
        : estimate === null
          ? `${formatLendingFractionPct(full)} of the dollars in these lending pools is already lent out.`
          : `${formatLendingFractionPct(full)} of the dollars in these lending pools is already lent out. Venus is left out of this, because its pool is shared.`,
    costSentence: costSentence(totals, estimate !== null),
  };
}

export function lendingMaxLtvRange(rows: readonly LendingRow[]): { min: number; max: number } | null {
  const values: number[] = [];
  for (const row of rows) {
    for (const asset of row.assets ?? []) {
      if (asset.maxLtv !== null && Number.isFinite(asset.maxLtv) && asset.maxLtv > 0 && asset.maxLtv <= 1.05) {
        values.push(asset.maxLtv);
      }
    }
  }
  if (values.length === 0) return null;
  return { min: Math.min(...values), max: Math.max(...values) };
}

export function formatLtvPerHundred(fraction: number): string {
  return `$${Math.round(fraction * 100)}`;
}

/** Plain LTV line for the explainer. No dollar example when the snapshot has no max LTV. */
export function lendingLtvExplainer(rows: readonly LendingRow[]): string {
  const range = lendingMaxLtvRange(rows);
  if (!range) {
    return "Each token has a limit on how many dollars you can borrow for every $100 of stock. That limit is called LTV.";
  }
  const low = formatLtvPerHundred(range.min);
  const high = formatLtvPerHundred(range.max);
  if (low === high) return `You can borrow up to ${low} for every $100 of stock. That limit is called LTV.`;
  return `You can borrow up to ${low}–${high} for every $100 of stock, depending on the token. That limit is called LTV.`;
}

export function lendingStockBorrows(rows: readonly LendingRow[]): { venue: string; chainLabel: string; usd: number }[] {
  return rows
    .filter((row): row is LendingRow & { stockBorrowedUsd: number } => typeof row.stockBorrowedUsd === "number" && row.stockBorrowedUsd > 0)
    .map((row) => ({ venue: row.venue, chainLabel: row.chainLabel, usd: row.stockBorrowedUsd }))
    .sort((a, b) => b.usd - a.usd || a.venue.localeCompare(b.venue));
}
