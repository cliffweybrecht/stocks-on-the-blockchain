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
  source: string;
  error: string | null;
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

export interface LendingDeskModel {
  date: string | null;
  capturedAt: string | null;
  readError: string | null;
  rows: LendingRow[];
  chains: LendingChainGroup[];
  totals: LendingTotals;
  failures: LendingSourceNote[];
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
  const mins = rows.map((row) => row.borrowApyMin).filter((value): value is number => value !== null);
  const maxes = rows.map((row) => row.borrowApyMax).filter((value): value is number => value !== null);
  return {
    collateralUsd,
    stableBorrowedUsd,
    utilization,
    borrowApy: band.borrowApy,
    borrowApyMin: mins.length > 0 ? Math.min(...mins) : band.borrowApyMin,
    borrowApyMax: maxes.length > 0 ? Math.max(...maxes) : band.borrowApyMax,
    stockBorrowedUsd,
  };
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

export function buildLendingDeskModel(
  file: LendingDaySnapshot | null,
  readError?: string,
): LendingDeskModel {
  if (!file) return emptyLendingDeskModel(readError);
  const rows = file.rows;
  return {
    date: file.date,
    capturedAt: file.capturedAt,
    readError: readError ?? null,
    rows,
    chains: groupLendingRows(rows),
    totals: aggregateLendingTotals(rows),
    failures: file.failures,
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
    source: asNonEmptyString(row.source) ?? "",
    error: asNonEmptyString(row.error),
  };
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
  return `Stock tokens borrowed ${formatUsdCompact(value)}`;
}
