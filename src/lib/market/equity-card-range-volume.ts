import { combinedPublicPrivateVolume24h, compareAssetsByRank, type RankableRow } from "./aggregate";
import type { ClosedVolumeChartRangeId } from "./daily-volume-view";
import { GECKO_HOURLY_ET_BACKFILL_SOURCE } from "./gecko-hourly-et";
import { asNonNegativeNumber, compareNullableDesc } from "./numbers";
import { easternDayKey } from "./volume-snapshots";

/**
 * Closed-day window for an equity card, matching the desk toggle.
 * 7D / 14D / 30D are the newest N recorded America/New_York snapshot days,
 * not a rolling millisecond cutoff. 24H stays the live card figure.
 */
export const EQUITY_CARD_RANGE_WINDOW = {
  "7d": 7,
  "14d": 14,
  "30d": 30,
} as const;

export type EquityCardClosedRangeId = ClosedVolumeChartRangeId;

export interface EquityCardRangeTotal {
  /** Sum of recorded daily volumes. A recorded 0 stays 0. */
  volumeUsd: number;
  /** How many window days recorded this asset. */
  days: number;
}

/** Keyed by chain address. EVM keys are lowercased. Solana keys stay case-sensitive. */
export type EquityCardRangeVolumeMap = Record<
  string,
  Partial<Record<EquityCardClosedRangeId, EquityCardRangeTotal>>
>;

const RANGE_LABEL = {
  "7d": "7D vol",
  "14d": "14D vol",
  "30d": "30D vol",
} as const;

export function equityCardRangeLabel(range: EquityCardClosedRangeId): (typeof RANGE_LABEL)[EquityCardClosedRangeId] {
  return RANGE_LABEL[range];
}

/**
 * Partial history hint. A full window, or no recorded days, stays blank.
 * N is the range length (7, 14, 30), even when the desk file itself is shorter.
 */
export function equityCardRangeCoverageHint(range: EquityCardClosedRangeId, days: number): string | null {
  if (!Number.isFinite(days) || days <= 0) return null;
  const windowDays = EQUITY_CARD_RANGE_WINDOW[range];
  if (days >= windowDays) return null;
  return `${Math.floor(days)} of ${windowDays} days`;
}

/** `0x` addresses compare case-insensitively. Solana mints do not. */
export function equityCardRangeAddressKey(address: string): string {
  const trimmed = address.trim();
  if (trimmed.length >= 2 && trimmed[0] === "0" && (trimmed[1] === "x" || trimmed[1] === "X")) {
    return trimmed.toLowerCase();
  }
  return trimmed;
}

export function equityCardRangeTotal(
  volumes: EquityCardRangeVolumeMap | null | undefined,
  address: string,
  range: EquityCardClosedRangeId,
): EquityCardRangeTotal | null {
  if (!volumes) return null;
  const row = volumes[equityCardRangeAddressKey(address)]?.[range];
  if (!row || !Number.isFinite(row.days) || row.days <= 0) return null;
  if (!Number.isFinite(row.volumeUsd) || row.volumeUsd < 0) return null;
  return row;
}

/**
 * Volume ranking for a closed range. The range sum decides order.
 * Equal sums, including two missing series, keep the existing 24h rank.
 */
export function compareByEquityCardRangeVolume<T extends RankableRow & { contractAddress: string }>(
  a: T,
  b: T,
  volumes: EquityCardRangeVolumeMap,
  range: EquityCardClosedRangeId,
): number {
  const left = equityCardRangeTotal(volumes, a.contractAddress, range)?.volumeUsd ?? null;
  const right = equityCardRangeTotal(volumes, b.contractAddress, range)?.volumeUsd ?? null;
  const byVolume = compareNullableDesc(left, right);
  if (byVolume !== 0) return byVolume;
  return compareAssetsByRank(a, b, "volume24hUsd");
}

interface ClosedAssetDay {
  date: string;
  byAsset: Map<string, number>;
}

/**
 * Per-asset sums for 7D, 14D, and 30D from one snapshot file.
 * Each day contributes the recorded `volume24hUsd` for that Eastern date.
 * A missing asset on a day is unknown, not $0. An explicit 0 is kept.
 * The in-progress Eastern day is left out. Days before per-asset rows began
 * stay missing. Nothing is invented.
 */
export function equityCardRangeVolumesFromSnapshot(
  payload: unknown,
  nowT: number,
  backfill: unknown = null,
): EquityCardRangeVolumeMap {
  const days = closedAssetDays(payload, nowT, backfill);
  const volumes: EquityCardRangeVolumeMap = {};
  const ranges = Object.keys(EQUITY_CARD_RANGE_WINDOW) as EquityCardClosedRangeId[];
  for (const range of ranges) {
    const windowDays = EQUITY_CARD_RANGE_WINDOW[range];
    const window = days.length > windowDays ? days.slice(days.length - windowDays) : days;
    const totals = new Map<string, EquityCardRangeTotal>();
    for (const day of window) {
      for (const [key, volumeUsd] of day.byAsset) {
        const current = totals.get(key) ?? { volumeUsd: 0, days: 0 };
        current.volumeUsd += volumeUsd;
        current.days += 1;
        totals.set(key, current);
      }
    }
    for (const [key, total] of totals) {
      const bucket = volumes[key] ?? {};
      bucket[range] = total;
      volumes[key] = bucket;
    }
  }
  return volumes;
}

/**
 * Closed snapshot dates the equity-card ranges share, oldest first.
 * Includes Gecko backfill days the volume window counts, and omits the
 * in-progress Eastern day.
 */
export function equityCardClosedSnapshotDates(
  payload: unknown,
  nowT: number,
  backfill: unknown = null,
): string[] {
  return closedAssetDays(payload, nowT, backfill).map((day) => day.date);
}

function closedAssetDays(payload: unknown, nowT: number, backfill: unknown): ClosedAssetDay[] {
  const today = easternDayKey(nowT);
  if (!today) return [];
  const byDate = new Map<string, Map<string, number>>();
  // Backfill lands first. A DexScreener row for the same address and day replaces it.
  for (const [date, byAsset] of readBackfillDays(backfill, today)) {
    byDate.set(date, byAsset);
  }
  if (payload && typeof payload === "object") {
    const list = (payload as { records?: unknown }).records;
    if (Array.isArray(list)) {
      for (const row of list) {
        const parsed = parseAssetDay(row, today);
        if (!parsed) continue;
        const merged = byDate.get(parsed.date) ?? new Map<string, number>();
        for (const [key, volumeUsd] of parsed.byAsset) merged.set(key, volumeUsd);
        byDate.set(parsed.date, merged);
      }
    }
  }
  return [...byDate.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([date, byAsset]) => ({ date, byAsset }));
}

/** Days from a sibling backfill file. DexScreener snapshot rows are applied later and win. */
function readBackfillDays(payload: unknown, today: string): Map<string, Map<string, number>> {
  const days = new Map<string, Map<string, number>>();
  if (!payload || typeof payload !== "object") return days;
  const file = payload as { source?: unknown; records?: unknown };
  if (file.source !== GECKO_HOURLY_ET_BACKFILL_SOURCE || !Array.isArray(file.records)) return days;
  for (const row of file.records) {
    if (!row || typeof row !== "object") continue;
    const rec = row as { date?: unknown; assets?: unknown };
    const date = typeof rec.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rec.date) ? rec.date : "";
    if (!date || date >= today || !Array.isArray(rec.assets)) continue;
    const byAsset = days.get(date) ?? new Map<string, number>();
    for (const asset of rec.assets) {
      if (!asset || typeof asset !== "object") continue;
      const item = asset as { source?: unknown; address?: unknown; volume24hUsd?: unknown };
      if (item.source !== GECKO_HOURLY_ET_BACKFILL_SOURCE) continue;
      const parsed = readAssetVolume(asset);
      if (!parsed) continue;
      byAsset.set(parsed.key, parsed.volumeUsd);
    }
    days.set(date, byAsset);
  }
  return days;
}

function parseAssetDay(row: unknown, today: string): ClosedAssetDay | null {
  if (!row || typeof row !== "object") return null;
  const rec = row as Record<string, unknown>;
  if (typeof rec.hour === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}$/.test(rec.hour)) return null;
  const date = typeof rec.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rec.date) ? rec.date : "";
  if (!date || date >= today) return null;
  const combined =
    asNonNegativeNumber(rec.combined24hUsd) ??
    combinedPublicPrivateVolume24h(
      asNonNegativeNumber(rec.publicEquity24hUsd),
      asNonNegativeNumber(rec.private24hUsd),
      asNonNegativeNumber(rec.etfIndex24hUsd),
    );
  if (combined === null) return null;
  const byAsset = new Map<string, number>();
  for (const asset of assetRows(rec)) {
    const parsed = readAssetVolume(asset);
    if (!parsed) continue;
    byAsset.set(parsed.key, parsed.volumeUsd);
  }
  return { date, byAsset };
}

/** Prefer the full `assets` list. Older Base days only stored `symbolsWithVolume`. */
function assetRows(rec: Record<string, unknown>): unknown[] {
  if (Array.isArray(rec.assets) && rec.assets.length > 0) return rec.assets;
  if (Array.isArray(rec.symbolsWithVolume) && rec.symbolsWithVolume.length > 0) return rec.symbolsWithVolume;
  return [];
}

function readAssetVolume(row: unknown): { key: string; volumeUsd: number } | null {
  if (!row || typeof row !== "object") return null;
  const rec = row as Record<string, unknown>;
  const address =
    (typeof rec.address === "string" && rec.address) ||
    (typeof rec.contractAddress === "string" && rec.contractAddress) ||
    (typeof rec.mint === "string" && rec.mint) ||
    "";
  const key = equityCardRangeAddressKey(address);
  if (!key) return null;
  const volumeUsd = asNonNegativeNumber(rec.volume24hUsd);
  if (volumeUsd === null) return null;
  return { key, volumeUsd };
}
