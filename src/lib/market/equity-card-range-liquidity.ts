import { compareAssetsByRank, type RankableRow } from "./aggregate";
import type { VolumeChartRangeId } from "./daily-volume-view";
import {
  EQUITY_CARD_RANGE_WINDOW,
  equityCardClosedSnapshotDates,
  equityCardRangeAddressKey,
  equityCardRangeCoverageHint,
  type EquityCardClosedRangeId,
} from "./equity-card-range-volume";
import { readStoredAssetLiquidityUsd, type ExcludedLiquidityPool } from "./liquidity-sanity";
import { asNonNegativeNumber, compareNullableDesc } from "./numbers";
import { easternDayKey, easternMidnightUnix } from "./volume-snapshots";

/**
 * Per-asset closing liquidity for the desk range toggle.
 *
 * The figure is the stored nightly `displayedLiquidityUsd` (sum of pool
 * `liquidity.usd` across that asset's pools). Gecko pool OHLCV has no
 * reserves, and the hourly backfill file is volume-only, so it can occupy a
 * window day but never contributes a reserve. A missing day is left out of
 * the average. Nothing is invented.
 *
 * 24H is the reserve on the last closed America/New_York day, not an average
 * and not the live desk figure. 7D, 14D, and 30D average the recorded closes
 * inside the same newest-N closed snapshot days the volume cards use.
 */
export interface EquityCardLiquidityPoint {
  date: string;
  /** Unix seconds of America/New_York midnight on `date`. */
  t: number;
  liquidityUsd: number;
}

export interface EquityCardRangeLiquidity {
  /** Average of recorded closes, or the single close for 24H. */
  liquidityUsd: number;
  /** Recorded closes inside the window. Not the window length. */
  days: number;
  /** Oldest first. Days with no stored reserve are omitted, not drawn as $0. */
  series: EquityCardLiquidityPoint[];
}

export interface EquityCardLiquidityHistory {
  /** Yesterday in America/New_York. Empty when `nowT` is not a real instant. */
  lastClosedDay: string;
  /** Closed snapshot days, oldest first. Same dates the volume ranges use. */
  snapshotDays: string[];
  byAsset: Record<string, EquityCardLiquidityPoint[]>;
}

export const EMPTY_EQUITY_CARD_LIQUIDITY: EquityCardLiquidityHistory = {
  lastClosedDay: "",
  snapshotDays: [],
  byAsset: {},
};

const AVG_HINT: Record<EquityCardClosedRangeId, string> = {
  "7d": "avg 7D",
  "14d": "avg 14D",
  "30d": "avg 30D",
};

/** America/New_York date that has already closed. The in-progress day is not this. */
export function lastClosedEasternDay(nowT: number): string {
  const today = easternDayKey(nowT);
  if (!today) return "";
  const start = easternMidnightUnix(today);
  if (start <= 0) return "";
  return easternDayKey(start - 1);
}

/**
 * Small caption under `$X Liq`.
 * A recorded multi-day window says `avg 7D`, and adds `5 of 7 days` when the
 * asset was not on every day of the range. 24H says `24H`. No stored close
 * says `current` so the live desk figure is not presented as a range.
 */
export function equityCardLiquidityHint(range: VolumeChartRangeId, days: number, recorded: boolean): string {
  if (!recorded) return "current";
  if (range === "24h") return "24H";
  const coverage = equityCardRangeCoverageHint(range, days);
  const avg = AVG_HINT[range];
  return coverage ? `${avg} · ${coverage}` : avg;
}

export function equityCardLiquidityForRange(
  history: EquityCardLiquidityHistory | null | undefined,
  address: string,
  range: VolumeChartRangeId,
): EquityCardRangeLiquidity | null {
  if (!history) return null;
  const points = history.byAsset[equityCardRangeAddressKey(address)];
  if (!points || points.length === 0) return null;

  if (range === "24h") {
    if (!history.lastClosedDay || !history.snapshotDays.includes(history.lastClosedDay)) return null;
    const point = points.find((row) => row.date === history.lastClosedDay);
    if (!point) return null;
    return { liquidityUsd: point.liquidityUsd, days: 1, series: [point] };
  }

  const windowDays = EQUITY_CARD_RANGE_WINDOW[range];
  const window =
    history.snapshotDays.length > windowDays
      ? history.snapshotDays.slice(history.snapshotDays.length - windowDays)
      : history.snapshotDays;
  const allowed = new Set(window);
  const series = points.filter((row) => allowed.has(row.date));
  if (series.length === 0) return null;
  const sum = series.reduce((total, row) => total + row.liquidityUsd, 0);
  return {
    liquidityUsd: roundUsd(sum / series.length),
    days: series.length,
    series,
  };
}

/**
 * Sort key for Liquidity mode. The range close or average wins. An asset with
 * no stored closes sorts by the live desk figure, matching the `current` card.
 */
export function equityCardLiquiditySortUsd(
  asset: RankableRow & { contractAddress: string },
  history: EquityCardLiquidityHistory | null | undefined,
  range: VolumeChartRangeId,
): number | null {
  const row = equityCardLiquidityForRange(history, asset.contractAddress, range);
  if (row) return row.liquidityUsd;
  return asNonNegativeNumber(asset.displayedLiquidityUsd);
}

export function compareByEquityCardRangeLiquidity<T extends RankableRow & { contractAddress: string }>(
  a: T,
  b: T,
  history: EquityCardLiquidityHistory | null | undefined,
  range: VolumeChartRangeId,
): number {
  const byLiquidity = compareNullableDesc(
    equityCardLiquiditySortUsd(a, history, range),
    equityCardLiquiditySortUsd(b, history, range),
  );
  if (byLiquidity !== 0) return byLiquidity;
  return compareAssetsByRank(a, b, "displayedLiquidityUsd");
}

/**
 * Closing reserves from nightly `assets[]`. Backfill may extend `snapshotDays`
 * so the window matches volume, but a backfill row never supplies a reserve.
 */
export function equityCardLiquidityHistoryFromSnapshot(
  payload: unknown,
  nowT: number,
  backfill: unknown = null,
): EquityCardLiquidityHistory {
  const snapshotDays = equityCardClosedSnapshotDates(payload, nowT, backfill);
  const byDate = liquidityByDate(payload, new Set(snapshotDays));
  const byAsset: Record<string, EquityCardLiquidityPoint[]> = {};
  for (const date of snapshotDays) {
    const day = byDate.get(date);
    if (!day) continue;
    const t = easternMidnightUnix(date);
    for (const [key, liquidityUsd] of day) {
      const series = byAsset[key] ?? [];
      series.push({ date, t, liquidityUsd });
      byAsset[key] = series;
    }
  }
  return {
    lastClosedDay: lastClosedEasternDay(nowT),
    snapshotDays,
    byAsset,
  };
}

function liquidityByDate(payload: unknown, allowed: ReadonlySet<string>): Map<string, Map<string, number>> {
  const byDate = new Map<string, Map<string, number>>();
  if (!payload || typeof payload !== "object" || allowed.size === 0) return byDate;
  const list = (payload as { records?: unknown }).records;
  if (!Array.isArray(list)) return byDate;
  for (const row of list) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    if (typeof rec.hour === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}$/.test(rec.hour)) continue;
    const date = typeof rec.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rec.date) ? rec.date : "";
    if (!date || !allowed.has(date) || !Array.isArray(rec.assets)) continue;
    const byAsset = byDate.get(date) ?? new Map<string, number>();
    for (const asset of rec.assets) {
      const parsed = readAssetLiquidity(asset);
      if (!parsed) continue;
      byAsset.set(parsed.key, parsed.liquidityUsd);
    }
    if (byAsset.size > 0) byDate.set(date, byAsset);
  }
  return byDate;
}

/**
 * Nightly reserve. `displayedLiquidityUsd` wins, including an explicit 0 from
 * the liquidity sanity guard. Pools are summed only when that field is absent,
 * and pools the guard excluded are not added back.
 */
function readAssetLiquidity(row: unknown): { key: string; liquidityUsd: number } | null {
  if (!row || typeof row !== "object") return null;
  const rec = row as Record<string, unknown>;
  const address =
    (typeof rec.address === "string" && rec.address) ||
    (typeof rec.contractAddress === "string" && rec.contractAddress) ||
    (typeof rec.mint === "string" && rec.mint) ||
    "";
  const key = equityCardRangeAddressKey(address);
  if (!key) return null;
  const displayed = storedDisplayedLiquidity(rec.displayedLiquidityUsd);
  if (displayed !== undefined && displayed !== null) {
    const liquidityUsd = readStoredAssetLiquidityUsd({ displayedLiquidityUsd: displayed });
    if (liquidityUsd === null) return null;
    return { key, liquidityUsd };
  }
  const liquidityUsd = sumPoolsSkippingExcluded(rec.pools, storedExcludedPools(rec.excludedLiquidityPools));
  if (liquidityUsd === null) return null;
  return { key, liquidityUsd };
}

function storedDisplayedLiquidity(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return asNonNegativeNumber(value);
}

function sumPoolsSkippingExcluded(pools: unknown, excludedRows: readonly ExcludedLiquidityPool[] | null): number | null {
  if (!Array.isArray(pools)) return null;
  const replacements = new Map<string, number>();
  const excluded = new Set<string>();
  for (const row of excludedRows ?? []) {
    if (row.replacementLiquidityUsd !== undefined) replacements.set(row.poolId, row.replacementLiquidityUsd);
    else excluded.add(row.poolId);
  }
  let sum = 0;
  let any = false;
  for (const pool of pools) {
    if (!pool || typeof pool !== "object") continue;
    const item = pool as { pairAddress?: unknown; poolId?: unknown; liquidityUsd?: unknown };
    const poolId = (typeof item.pairAddress === "string" ? item.pairAddress : typeof item.poolId === "string" ? item.poolId : "").trim();
    if (poolId && excluded.has(poolId)) continue;
    const replacement = poolId ? replacements.get(poolId) : undefined;
    const usd = replacement !== undefined ? replacement : asNonNegativeNumber(item.liquidityUsd);
    if (usd === null) continue;
    sum += usd;
    any = true;
  }
  return any ? roundUsd(sum) : null;
}

function storedExcludedPools(value: unknown): ExcludedLiquidityPool[] | null {
  if (!Array.isArray(value)) return null;
  const rows: ExcludedLiquidityPool[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const item = row as { poolId?: unknown; liquidityUsd?: unknown; reason?: unknown; replacementLiquidityUsd?: unknown };
    if (typeof item.poolId !== "string" || !item.poolId) continue;
    const liquidityUsd = asNonNegativeNumber(item.liquidityUsd);
    if (liquidityUsd === null || typeof item.reason !== "string" || !item.reason) continue;
    const replacement = asNonNegativeNumber(item.replacementLiquidityUsd);
    rows.push({
      poolId: item.poolId,
      liquidityUsd,
      reason: item.reason,
      ...(replacement === null ? {} : { replacementLiquidityUsd: replacement }),
    });
  }
  return rows;
}

function roundUsd(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
