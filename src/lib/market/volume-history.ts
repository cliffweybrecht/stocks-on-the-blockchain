import { compareNullableDesc } from "./numbers";
import type { AssetSummary, EquityVolumeHistoryResult, VolumeHistoryPoint } from "./types";

export const UTC_DAY_SECONDS = 86_400;

/** Closed desk DexScreener 24h snapshots only. GeckoTerminal is not this series. */
export const EQUITY_VOLUME_HISTORY_DEFINITION =
  "History is this desk’s closed DexScreener 24h snapshots (public + private + ETF/index, null omitted not $0). Days before snapshots began have no series — past DexScreener totals are not invented from GeckoTerminal. The in-progress Eastern day is omitted until that America/New_York date has closed.";

export const EQUITY_VOLUME_HISTORY_SOURCE_LABEL = "Desk DexScreener 24h snapshots";

export interface EquityVolumePoolTarget {
  pairAddress: string;
  mint: string;
  volume24hUsd: number | null;
}

export interface OhlcvCandle {
  t: number;
  volumeUsd: number;
}

export function utcDayStart(unixSeconds: number): number {
  if (!Number.isFinite(unixSeconds) || unixSeconds <= 0) return 0;
  return Math.floor(unixSeconds / UTC_DAY_SECONDS) * UTC_DAY_SECONDS;
}

export function emptyEquityVolumeHistory(
  reason: string,
  generatedAt = new Date().toISOString(),
): EquityVolumeHistoryResult {
  return {
    available: false,
    points: [],
    seriesByMint: {},
    definition: EQUITY_VOLUME_HISTORY_DEFINITION,
    sourceLabel: EQUITY_VOLUME_HISTORY_SOURCE_LABEL,
    poolCount: 0,
    poolCountAttempted: 0,
    mintCount: 0,
    volume24hUsd: null,
    firstObservableAt: null,
    lastObservableAt: null,
    generatedAt,
    emptyReason: reason,
  };
}

export const WEEK_VOLUME_DAYS = 7;

export type VolumeSparklineDirection = "up" | "down" | "flat";

export interface PoolVolumeSeries {
  pairAddress: string;
  candles: readonly OhlcvCandle[];
  mint?: string;
}

/** Last `days` UTC calendar days through `throughT`, oldest first. Empty if nothing falls in range. */
export function sliceWeekVolumeSeries(
  points: readonly VolumeHistoryPoint[],
  throughT: number,
  days = WEEK_VOLUME_DAYS,
): VolumeHistoryPoint[] {
  if (points.length === 0) return [];
  if (!Number.isFinite(throughT) || throughT <= 0) return [];
  const end = utcDayStart(throughT);
  if (end <= 0) return [];
  const start = end - (days - 1) * UTC_DAY_SECONDS;
  return points.filter((point) => point.t >= start && point.t <= end);
}

/**
 * Direction of a week volume series: last vs first observed point.
 * Needs two points; a single 24h reading is not a week series.
 */
export function volumeSparklineDirection(
  points: readonly VolumeHistoryPoint[],
): VolumeSparklineDirection | null {
  if (points.length < 2) return null;
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return null;
  if (last.volumeUsd > first.volumeUsd) return "up";
  if (last.volumeUsd < first.volumeUsd) return "down";
  return "flat";
}

/**
 * Per-mint week series from the same GeckoTerminal pool candles as the chain chart.
 * Mints with no candles are omitted — a lone DexScreener 24h is not invented into a week.
 */
export function buildMintWeekVolumeSeries(input: {
  seriesByPool: readonly PoolVolumeSeries[];
  volume24hByMint?: Readonly<Record<string, number | null | undefined>>;
  nowT: number;
  days?: number;
}): Record<string, VolumeHistoryPoint[]> {
  const days = input.days ?? WEEK_VOLUME_DAYS;
  const byMint = new Map<string, PoolVolumeSeries[]>();
  for (const row of input.seriesByPool) {
    const mint = row.mint?.trim();
    if (!mint || !row.pairAddress.trim()) continue;
    const list = byMint.get(mint) ?? [];
    list.push(row);
    byMint.set(mint, list);
  }

  const result: Record<string, VolumeHistoryPoint[]> = {};
  for (const [mint, rows] of byMint) {
    const observed = aggregateDailyVolume(rows);
    if (observed.length === 0) continue;
    const mint24h = input.volume24hByMint?.[mint];
    const aligned = alignLatestDayWithDesk24h(observed, mint24h ?? null, input.nowT);
    const week = sliceWeekVolumeSeries(aligned, input.nowT, days);
    if (week.length >= 2) result[mint] = week;
  }
  return result;
}

/**
 * Unique Solana pools on classified public-equity rows only.
 * ETF / index and private-market products are never admitted. Empty pair addresses are dropped.
 */
export function collectEquityVolumeTargets(
  assets: readonly AssetSummary[],
): EquityVolumePoolTarget[] {
  const byPair = new Map<string, EquityVolumePoolTarget>();
  for (const asset of assets) {
    if (asset.instrumentKind !== "equity") continue;
    for (const pool of asset.pools) {
      const pairAddress = pool.pairAddress.trim();
      if (!pairAddress) continue;
      const existing = byPair.get(pairAddress);
      if (
        !existing ||
        (pool.volume24hUsd !== null &&
          (existing.volume24hUsd === null || pool.volume24hUsd > existing.volume24hUsd))
      ) {
        byPair.set(pairAddress, {
          pairAddress,
          mint: asset.contractAddress,
          volume24hUsd: pool.volume24hUsd,
        });
      }
    }
  }
  return [...byPair.values()].sort((a, b) => compareNullableDesc(a.volume24hUsd, b.volume24hUsd));
}

export function rankEquityVolumeTargets(
  targets: readonly EquityVolumePoolTarget[],
  maxPools: number,
): EquityVolumePoolTarget[] {
  const limit = Number.isFinite(maxPools) && maxPools > 0 ? Math.floor(maxPools) : 0;
  if (limit === 0) return [];
  return targets.slice(0, limit);
}

/** Prefer pools with a reported DexScreener 24h so budget is not spent on unknown volume. */
export function selectEquityVolumeFetchTargets(
  targets: readonly EquityVolumePoolTarget[],
  maxPools: number,
): EquityVolumePoolTarget[] {
  const reported = targets.filter((row) => row.volume24hUsd !== null);
  return rankEquityVolumeTargets(reported.length > 0 ? reported : targets, maxPools);
}

/**
 * Parse a GeckoTerminal pool OHLCV payload. Fail closed: unknown shapes
 * and non-finite candles are dropped, never invented.
 */
export function parseGeckoTerminalOhlcv(payload: unknown): OhlcvCandle[] {
  if (!payload || typeof payload !== "object") return [];
  const data = (payload as { data?: { attributes?: { ohlcv_list?: unknown } } }).data;
  const list = data?.attributes?.ohlcv_list;
  if (!Array.isArray(list)) return [];

  const candles: OhlcvCandle[] = [];
  for (const row of list) {
    if (!Array.isArray(row) || row.length < 6) continue;
    const t = Number(row[0]);
    const volumeUsd = Number(row[5]);
    if (!Number.isFinite(t) || t <= 0) continue;
    if (!Number.isFinite(volumeUsd) || volumeUsd < 0) continue;
    candles.push({ t: Math.trunc(t), volumeUsd });
  }

  candles.sort((a, b) => a.t - b.t);
  const deduped: OhlcvCandle[] = [];
  for (const candle of candles) {
    const last = deduped[deduped.length - 1];
    if (last && last.t === candle.t) {
      last.volumeUsd = candle.volumeUsd;
      continue;
    }
    deduped.push({ ...candle });
  }
  return deduped;
}

/**
 * Sum same UTC calendar-day pool volumes. A source-reported 0 is kept.
 * Does not fill gaps — use fillMissingCalendarDays for a continuous series.
 */
export function aggregateDailyVolume(
  seriesByPool: readonly { pairAddress: string; candles: readonly OhlcvCandle[] }[],
): VolumeHistoryPoint[] {
  const byDay = new Map<number, number>();
  for (const series of seriesByPool) {
    if (!series.pairAddress.trim()) continue;
    for (const candle of series.candles) {
      if (!Number.isFinite(candle.t) || candle.t <= 0) continue;
      if (!Number.isFinite(candle.volumeUsd) || candle.volumeUsd < 0) continue;
      const day = utcDayStart(candle.t);
      if (day <= 0) continue;
      byDay.set(day, (byDay.get(day) ?? 0) + candle.volumeUsd);
    }
  }

  return [...byDay.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, volumeUsd]) => ({ t, volumeUsd, kind: "calendar_day" as const }));
}

/** Insert $0 for every UTC calendar day from the first observed day through `throughT` (or the last observed day). */
export function fillMissingCalendarDays(
  points: readonly VolumeHistoryPoint[],
  throughT?: number,
): VolumeHistoryPoint[] {
  if (points.length === 0) return [];
  const byDay = new Map<number, VolumeHistoryPoint>();
  for (const point of points) {
    const day = utcDayStart(point.t);
    if (day <= 0) continue;
    if (!Number.isFinite(point.volumeUsd) || point.volumeUsd < 0) continue;
    const existing = byDay.get(day);
    if (!existing) {
      byDay.set(day, { t: day, volumeUsd: point.volumeUsd, kind: point.kind ?? "calendar_day" });
      continue;
    }
    byDay.set(day, {
      t: day,
      volumeUsd: existing.volumeUsd + point.volumeUsd,
      kind: existing.kind === "rolling_24h" || point.kind === "rolling_24h" ? "rolling_24h" : "calendar_day",
    });
  }

  const days = [...byDay.keys()].sort((a, b) => a - b);
  const start = days[0];
  const lastObserved = days[days.length - 1];
  if (start === undefined || lastObserved === undefined) return [];
  const end =
    throughT !== undefined && Number.isFinite(throughT) && throughT > 0
      ? Math.max(lastObserved, utcDayStart(throughT))
      : lastObserved;

  const filled: VolumeHistoryPoint[] = [];
  for (let t = start; t <= end; t += UTC_DAY_SECONDS) {
    filled.push(byDay.get(t) ?? { t, volumeUsd: 0, kind: "calendar_day" });
  }
  return filled;
}

/**
 * Replace (or append) today's UTC day with the DexScreener equity 24h rollup.
 * Null / non-finite 24h is left untouched — never coerced to zero.
 */
export function alignLatestDayWithDesk24h(
  points: readonly VolumeHistoryPoint[],
  volume24hUsd: number | null | undefined,
  nowT: number,
): VolumeHistoryPoint[] {
  if (volume24hUsd === null || volume24hUsd === undefined) return fillMissingCalendarDays(points);
  if (!Number.isFinite(volume24hUsd) || volume24hUsd < 0) return fillMissingCalendarDays(points);
  const today = utcDayStart(nowT);
  if (today <= 0) return fillMissingCalendarDays(points);
  const filled = fillMissingCalendarDays(points, today);
  if (filled.length === 0) {
    return [{ t: today, volumeUsd: volume24hUsd, kind: "rolling_24h" }];
  }
  const next = [...filled];
  const lastIndex = next.length - 1;
  const last = next[lastIndex];
  if (last && last.t === today) {
    next[lastIndex] = { t: today, volumeUsd: volume24hUsd, kind: "rolling_24h" };
  }
  return next;
}

function coverageNote(input: {
  usable: number;
  attemptedPoolCount: number;
  universePoolCount: number;
  mintCount: number;
}): string {
  const fetchedNote =
    input.usable === input.attemptedPoolCount
      ? `${input.usable} fetched highest-volume pool${input.usable === 1 ? "" : "s"}`
      : `${input.usable} of ${input.attemptedPoolCount} fetched highest-volume pools`;
  const universeNote =
    input.universePoolCount > input.attemptedPoolCount
      ? ` (${input.universePoolCount} classified equity pools / ${input.mintCount} mints in this snapshot)`
      : "";
  return ` This snapshot: ${fetchedNote}${universeNote}.`;
}

function historyDefinition(input: {
  usable: number;
  attemptedPoolCount: number;
  universePoolCount: number;
  mintCount: number;
  aligned24h: boolean;
  historyOnly?: boolean;
}): string {
  const historical = input.historyOnly
    ? "No GeckoTerminal daily candles were returned for classified Solana equity pools."
    : "Historical days are per-day GeckoTerminal USD volume across classified Solana public-equity pools (same-day candles summed). Missing calendar days are plotted as $0 (no candle / no activity), never as invented nonzero volume.";
  const latest = input.aligned24h
    ? " The latest chart point uses the DexScreener 24h public-equity rollup (rolling 24h, not a UTC calendar day)."
    : " The latest chart point is the last GeckoTerminal UTC calendar day; DexScreener 24h was not reported for this snapshot.";
  return `${historical}${latest} The page headline adds reported private-market and ETF/index 24h (null omitted, not zero). The headline universe is broader than this public-equity chart series.${coverageNote(input)}`;
}

export function buildEquityVolumeHistory(input: {
  seriesByPool: readonly PoolVolumeSeries[];
  attemptedPoolCount: number;
  mintCount: number;
  universePoolCount?: number;
  volume24hUsd?: number | null;
  volume24hByMint?: Readonly<Record<string, number | null | undefined>>;
  nowT?: number;
  generatedAt?: string;
  emptyReason?: string;
}): EquityVolumeHistoryResult {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const nowT = input.nowT ?? Date.parse(generatedAt) / 1000;
  const usable = input.seriesByPool.filter((row) => row.candles.length > 0);
  const observed = aggregateDailyVolume(usable);
  const volume24hUsd =
    input.volume24hUsd !== undefined &&
    input.volume24hUsd !== null &&
    Number.isFinite(input.volume24hUsd) &&
    input.volume24hUsd >= 0
      ? input.volume24hUsd
      : null;
  const aligned24h = volume24hUsd !== null;
  const points = alignLatestDayWithDesk24h(observed, volume24hUsd, nowT);
  const universe = input.universePoolCount ?? input.attemptedPoolCount;
  const seriesByMint = buildMintWeekVolumeSeries({
    seriesByPool: input.seriesByPool,
    volume24hByMint: input.volume24hByMint,
    nowT,
  });

  if (points.length === 0) {
    return emptyEquityVolumeHistory(
      input.emptyReason ??
        "GeckoTerminal did not return a usable daily volume series for classified Solana equity pools.",
      generatedAt,
    );
  }

  const first = points[0];
  const last = points[points.length - 1];

  return {
    available: true,
    points,
    seriesByMint,
    definition: historyDefinition({
      usable: usable.length,
      attemptedPoolCount: input.attemptedPoolCount,
      universePoolCount: universe,
      mintCount: input.mintCount,
      aligned24h,
      historyOnly: observed.length === 0,
    }),
    sourceLabel: EQUITY_VOLUME_HISTORY_SOURCE_LABEL,
    poolCount: usable.length,
    poolCountAttempted: input.attemptedPoolCount,
    mintCount: input.mintCount,
    volume24hUsd,
    firstObservableAt: first ? new Date(first.t * 1000).toISOString() : null,
    lastObservableAt: last ? new Date(last.t * 1000).toISOString() : null,
    generatedAt,
    emptyReason: null,
  };
}
