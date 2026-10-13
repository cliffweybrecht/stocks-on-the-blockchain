import { formatUsdCompact } from "./format";
import { LENDING_FULLNESS_TEXT } from "./lending-glossary";
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
  /**
   * How full this venue's dollar pool is, as a fraction.
   * When lendSupplyUsd is set, this is stableBorrowedUsd / lendSupplyUsd.
   * A shared pool may still report how full that shared pool is while lendSupplyUsd stays null.
   */
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
   * How a price drop is figured for this venue.
   * Positions store bucketed health, not wallets. Absent on snapshots taken before loan health was captured.
   */
  loanHealth?: LendingLoanHealth | null;
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
  /** Token count deposited, when the source reports one. Null when it only reports dollars. */
  collateralTokens: number | null;
  /** Max borrow as a fraction of collateral. 0.7 means $70 per $100 of stock. */
  maxLtv: number | null;
  /** Why collateralUsd is missing, when the source was checked and still had no price. */
  priceNote?: string | null;
}

export interface LendingBorrowEstimate {
  method: string;
  /** ISO time the estimate was measured. May be earlier than the snapshot. */
  asOf: string;
  lowerBoundUsd: number | null;
}

/** Collateral that first crosses the liquidation line at this whole-percent drop. 101 means a 100% drop stays inside. */
export interface LendingHealthBand {
  dropPct: number;
  collateralUsd: number;
}

export interface LendingLoanHealth {
  method: "positions" | "pool";
  asOf: string;
  source: string;
  /** Loans with a collateral price. Null on a pool estimate. */
  loanCount: number | null;
  /** Stock dollars in those loans, before a drop. Null on a pool estimate. */
  collateralCoveredUsd: number | null;
  /** Loans skipped because collateral dollars or health were missing. */
  unpricedLoanCount: number | null;
  bands: LendingHealthBand[];
  /** Why this venue uses the pool estimate. Null when each loan was counted. */
  fallback: string | null;
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
  if (!(supplyUsd > 0) || !Number.isFinite(borrowedUsd) || borrowedUsd < 0) return null;
  return borrowedUsd / supplyUsd;
}

function measurableLendPool(
  row: Pick<LendingRow, "stableBorrowedUsd" | "lendSupplyUsd">,
): row is Pick<LendingRow, "stableBorrowedUsd" | "lendSupplyUsd"> & { stableBorrowedUsd: number; lendSupplyUsd: number } {
  return (
    typeof row.stableBorrowedUsd === "number" &&
    Number.isFinite(row.stableBorrowedUsd) &&
    row.stableBorrowedUsd >= 0 &&
    typeof row.lendSupplyUsd === "number" &&
    Number.isFinite(row.lendSupplyUsd) &&
    row.lendSupplyUsd > 0
  );
}

/**
 * How full the dollar pools are.
 * Sum of stablecoins borrowed, divided by the sum of stablecoins supplied to lend,
 * for venues that publish both. Collateral is not the denominator.
 * A shared pool with no lend-side supply is left out of both sides.
 * A missing supply is not replaced with a borrow-weighted average of utilization rates.
 */
export function lendingDeskUtilization(rows: readonly Pick<LendingRow, "stableBorrowedUsd" | "lendSupplyUsd">[]): number | null {
  const pools = rows.filter(measurableLendPool);
  if (pools.length === 0) return null;
  return lendingUtilization(
    sumNullable(pools.map((row) => row.stableBorrowedUsd)),
    sumNullable(pools.map((row) => row.lendSupplyUsd)),
  );
}

/** Venues that borrowed, or reported how full, but did not publish their own lend supply. */
export function lendingUtilizationOmissions(
  rows: readonly Pick<LendingRow, "venue" | "stableBorrowedUsd" | "lendSupplyUsd" | "utilization">[],
): string[] {
  const names = new Set<string>();
  for (const row of rows) {
    if (measurableLendPool(row)) continue;
    const borrowed = typeof row.stableBorrowedUsd === "number" && row.stableBorrowedUsd > 0;
    const reported = row.utilization !== null;
    if (borrowed || reported) names.add(row.venue);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

/** Who is left out of the desk how-full number. Null when every reported pool has its own supply. */
export function lendingOmissionSentence(
  rows: readonly Pick<LendingRow, "venue" | "stableBorrowedUsd" | "lendSupplyUsd" | "utilization">[],
): string | null {
  const leftOut = lendingUtilizationOmissions(rows);
  if (leftOut.length === 0) return null;
  const names = joinNames(leftOut);
  const verb = leftOut.length === 1 ? "is" : "are";
  const own = leftOut.length === 1 ? "it does not publish its" : "they do not publish their";
  return `${names} ${verb} left out of how full because ${own} own lend supply.`;
}

/** Standing definition, plus who is left out of this snapshot. */
export function lendingFullnessNote(
  rows: readonly Pick<LendingRow, "venue" | "stableBorrowedUsd" | "lendSupplyUsd" | "utilization">[],
): string {
  const omission = lendingOmissionSentence(rows);
  return omission ? `${LENDING_FULLNESS_TEXT} ${omission}` : LENDING_FULLNESS_TEXT;
}

export function aggregateLendingTotals(rows: readonly LendingRow[]): LendingTotals {
  const collateralUsd = sumNullable(rows.map((row) => row.collateralUsd));
  const stableBorrowedUsd = sumNullable(rows.map((row) => row.stableBorrowedUsd));
  const stockBorrowedUsd = sumNullable(rows.map((row) => row.stockBorrowedUsd));
  const utilization = lendingDeskUtilization(rows);
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

export type LendingHistorySeries =
  | { kind: "empty" }
  | { kind: "single"; point: LendingHistoryPoint }
  | { kind: "line"; points: LendingHistoryPoint[] };

/** One stored day is a sentence. Two or more are a line. Nothing here is filled in. */
export function lendingHistorySeries(history: readonly LendingHistoryPoint[]): LendingHistorySeries {
  if (history.length === 0) return { kind: "empty" };
  const [only] = history;
  if (history.length === 1 && only) return { kind: "single", point: only };
  return { kind: "line", points: [...history] };
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
    loanHealth: parseLoanHealth(row.loanHealth),
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
      collateralTokens: nullableUsd(asset.collateralTokens),
      maxLtv: nullableFraction(asset.maxLtv),
      priceNote: asNonEmptyString(asset.priceNote),
    });
  }
  return assets;
}

function parseLoanHealth(value: unknown): LendingLoanHealth | null {
  if (!value || typeof value !== "object") return null;
  const health = value as Partial<LendingLoanHealth>;
  if (health.method !== "positions" && health.method !== "pool") return null;
  const asOf = asNonEmptyString(health.asOf);
  const source = asNonEmptyString(health.source);
  if (!asOf || source === null) return null;
  const bands: LendingHealthBand[] = [];
  if (Array.isArray(health.bands)) {
    for (const item of health.bands) {
      if (!item || typeof item !== "object") continue;
      const band = item as Partial<LendingHealthBand>;
      const dropPct = asReportedNumber(band.dropPct);
      const collateralUsd = nullableUsd(band.collateralUsd);
      if (dropPct === null || !Number.isInteger(dropPct) || dropPct < 0 || dropPct > 101 || collateralUsd === null) continue;
      bands.push({ dropPct, collateralUsd });
    }
  }
  bands.sort((a, b) => a.dropPct - b.dropPct || a.collateralUsd - b.collateralUsd);
  return {
    method: health.method,
    asOf,
    source,
    loanCount: nullableCount(health.loanCount),
    collateralCoveredUsd: nullableUsd(health.collateralCoveredUsd),
    unpricedLoanCount: nullableCount(health.unpricedLoanCount),
    bands,
    fallback: asNonEmptyString(health.fallback),
  };
}

function nullableCount(value: unknown): number | null {
  const parsed = asReportedNumber(value);
  if (parsed === null || !Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
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
  if (totals.borrowApy === null) return "No typical yearly cost yet.";
  const typical = formatLendingFractionPct(totals.borrowApy);
  const low = totals.borrowApyMin;
  const high = totals.borrowApyMax;
  const spread =
    low !== null && high !== null && Math.abs(high - low) >= 0.005
      ? ` Bigger pools run from ${formatLendingFractionPct(low)} to ${formatLendingFractionPct(high)}.`
      : "";
  const venus = hasEstimate ? " Venus is not included." : "";
  return `A typical loan costs about ${typical} a year.${spread}${venus}`;
}

export function lendingFullSentence(rows: readonly LendingRow[], utilization: number | null): string {
  if (utilization === null) return "How full is unknown until a pool reports both dollars borrowed and dollars supplied to lend.";
  const omission = lendingOmissionSentence(rows);
  const lead = `${formatLendingFractionPct(utilization)} of the dollars supplied to lend are already borrowed.`;
  return omission ? `${lead} ${omission}` : lead;
}

/** Totals a nightly snapshot check should print. Utilization is lendingDeskUtilization, never borrowed divided by collateral. */
export function lendingSnapshotSanity(day: Pick<LendingDaySnapshot, "date" | "rows">): {
  date: string;
  collateralUsd: number | null;
  stableBorrowedUsd: number | null;
  utilization: number | null;
  fullnessNote: string;
  omittedVenues: readonly string[];
} {
  const totals = aggregateLendingTotals(day.rows);
  return {
    date: day.date,
    collateralUsd: totals.collateralUsd,
    stableBorrowedUsd: totals.stableBorrowedUsd,
    utilization: totals.utilization,
    fullnessNote: lendingFullnessNote(day.rows),
    omittedVenues: lendingUtilizationOmissions(day.rows),
  };
}

export function lendingHeadline(rows: readonly LendingRow[], totals: LendingTotals): LendingHeadline {
  const estimate = lendingBorrowEstimateUsd(rows);
  const collateral = totals.collateralUsd;
  const borrowed = totals.stableBorrowedUsd;
  const full = totals.utilization;
  return {
    collateralSentence:
      collateral === null
        ? "No stock total yet."
        : `People locked ${formatUsdCompact(collateral)} of stock tokens to borrow against.`,
    borrowedSentence:
      borrowed === null
        ? "No borrow total yet."
        : estimate === null
          ? `They borrowed ${formatUsdCompact(borrowed)} of dollar coins.`
          : `They borrowed ${formatUsdCompact(borrowed)} of dollar coins. About ${formatLendingEstimateUsd(estimate)} is a Venus estimate.`,
    fullSentence: lendingFullSentence(rows, full),
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
