import { equityCardRangeAddressKey } from "./equity-card-range-volume";
import { GECKO_HOURLY_ET_BACKFILL_SOURCE } from "./gecko-hourly-et";
import { sumNullable } from "./numbers";
import { isEtfOrIndexSymbol, privateCompanySymbol } from "./solana-classifier";
import type { InstrumentKind, VolumeHistoryPoint } from "./types";
import { utcDayKey, utcInstantForDayKey } from "./volume-snapshots";

/** A closed desk day summed from per-asset rows because no nightly snapshot exists. */
export const ASSET_BACKFILL_DESK_SOURCE = "asset-backfill" as const;

export interface DeskLaneDay {
  date: string;
  t: number;
  publicEquity24hUsd: number | null;
  private24hUsd: number | null;
  etfIndex24hUsd: number | null;
  combined24hUsd: number | null;
  source?: typeof ASSET_BACKFILL_DESK_SOURCE;
  assetCount?: number;
}

/**
 * ETF tickers the Robinhood and Base desks list that the Solana symbol set does not.
 * Recorded `instrumentKind` still wins. `isEtfOrIndexSymbol` covers the rest.
 */
const EXTRA_ETF_SYMBOLS = new Set(["INDA", "SOXX", "SPMO", "SPYM", "XNDU"]);

/** Short on-chain symbols for private names the BNB and Robinhood catalogs already split out. */
const PRIVATE_SYMBOL_ALIASES = new Set(["KLSH", "OPAI", "POLY"]);

export function backfillHeadlineNote(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  const days = Math.floor(count);
  return `includes ${days} backfilled ${days === 1 ? "day" : "days"}`;
}

export function countAssetBackfillDays(days: readonly { source?: string }[]): number {
  return days.reduce((sum, day) => sum + (day.source === ASSET_BACKFILL_DESK_SOURCE ? 1 : 0), 0);
}

/** Lane for one backfill asset. A kind already stored on a nightly row wins. */
export function laneLookupFromSnapshot(payload: unknown): (address: string, symbol: string) => InstrumentKind {
  const recorded = new Map<string, InstrumentKind>();
  const records = payload && typeof payload === "object" ? (payload as { records?: unknown }).records : null;
  if (Array.isArray(records)) {
    for (const row of records) {
      if (!row || typeof row !== "object") continue;
      const rec = row as { assets?: unknown; symbolsWithVolume?: unknown };
      for (const list of [rec.assets, rec.symbolsWithVolume]) {
        if (!Array.isArray(list)) continue;
        for (const asset of list) {
          if (!asset || typeof asset !== "object") continue;
          const item = asset as { address?: unknown; instrumentKind?: unknown };
          const address = typeof item.address === "string" ? item.address : "";
          const key = equityCardRangeAddressKey(address);
          const kind = item.instrumentKind;
          if (!key || (kind !== "equity" && kind !== "etf" && kind !== "private")) continue;
          recorded.set(key, kind);
        }
      }
    }
  }
  return (address, symbol) => recorded.get(equityCardRangeAddressKey(address)) ?? classifyBackfillSymbol(symbol);
}

export function classifyBackfillSymbol(symbol: string): InstrumentKind {
  const candidates = symbolCandidates(symbol);
  if (candidates.length === 0) return "equity";
  for (const candidate of candidates) {
    if (privateCompanySymbol(candidate) || PRIVATE_SYMBOL_ALIASES.has(candidate)) return "private";
  }
  for (const candidate of candidates) {
    if (isEtfOrIndexSymbol(candidate) || EXTRA_ETF_SYMBOLS.has(candidate)) return "etf";
  }
  return "equity";
}

/** Chain suffixes and the Base `wt` wrapper, so `SPYB` and `wtQQQM` share the desk ticker. */
function symbolCandidates(symbol: string): string[] {
  const upper = symbol.trim().toUpperCase();
  if (!upper) return [];
  const out = [upper];
  const push = (value: string) => {
    if (value && !out.includes(value)) out.push(value);
  };
  if (upper.length > 2 && upper.endsWith("ON")) push(upper.slice(0, -2));
  if (upper.length > 1 && /[XCB]$/.test(upper)) push(upper.slice(0, -1));
  if (upper.length > 2 && upper.startsWith("WT")) push(upper.slice(2));
  if (upper.length > 3 && upper.startsWith("WT") && /[XCB]$/.test(upper)) push(upper.slice(2, -1));
  return out;
}

interface BackfillAsset {
  address: string;
  symbol: string;
  volumeUsd: number;
}

/**
 * Closed Eastern days that have no nightly desk snapshot.
 * Each day sums per-asset backfill volume into public, private, and ETF/index.
 * A nightly date is left untouched. A day with no asset rows is omitted, not written as $0.
 */
export function derivedDeskLaneDays(
  nightlyDates: ReadonlySet<string>,
  backfill: unknown,
  laneOf: (address: string, symbol: string) => InstrumentKind,
): DeskLaneDay[] {
  const byDate = backfillAssetsByDate(backfill);
  const days: DeskLaneDay[] = [];
  for (const [date, assets] of byDate) {
    if (nightlyDates.has(date)) continue;
    const summed = sumAssetsByLane(assets, laneOf);
    if (summed.combined24hUsd === null) continue;
    const t = utcInstantForDayKey(date);
    if (t <= 0) continue;
    days.push({ date, t, ...summed, source: ASSET_BACKFILL_DESK_SOURCE });
  }
  days.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return days;
}

export function volumePointsWithDerivedDays(
  points: readonly VolumeHistoryPoint[],
  derived: readonly DeskLaneDay[],
): VolumeHistoryPoint[] {
  const seen = new Set<string>();
  const next: VolumeHistoryPoint[] = [];
  for (const point of points) {
    const key = utcDayKey(point.t);
    if (key) seen.add(key);
    next.push(point);
  }
  for (const day of derived) {
    if (day.source !== ASSET_BACKFILL_DESK_SOURCE) continue;
    if (day.combined24hUsd === null || seen.has(day.date)) continue;
    seen.add(day.date);
    next.push({
      t: day.t,
      volumeUsd: day.combined24hUsd,
      kind: "calendar_day",
      source: ASSET_BACKFILL_DESK_SOURCE,
    });
  }
  next.sort((a, b) => a.t - b.t);
  return next;
}

export interface NightlyAssetGap {
  date: string;
  nightlyUsd: number;
  /** Dex per-asset rows plus gecko rows for addresses the nightly file did not list. */
  assetUsd: number;
  /** (assetUsd - nightlyUsd) / nightlyUsd, as a percent. */
  deltaPct: number | null;
  /** True when the nightly row had no per-asset list, so the backfill was not suppressed. */
  geckoOnly: boolean;
}

/**
 * Days that have a nightly combined total and at least one gecko asset row.
 * Gecko rows omit an address when that day's DexScreener asset row already exists.
 * `assetUsd` puts the Dex row back so the sum is the full asset list.
 */
export function nightlyVersusAssetSums(snapshot: unknown, backfill: unknown): NightlyAssetGap[] {
  const geckoByDate = backfillAssetsByDate(backfill);
  const records = snapshot && typeof snapshot === "object" ? (snapshot as { records?: unknown }).records : null;
  if (!Array.isArray(records)) return [];
  const gaps: NightlyAssetGap[] = [];
  for (const row of records) {
    if (!row || typeof row !== "object") continue;
    const rec = row as { date?: unknown; combined24hUsd?: unknown; assets?: unknown; symbolsWithVolume?: unknown };
    const date = typeof rec.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rec.date) ? rec.date : "";
    const nightlyUsd = typeof rec.combined24hUsd === "number" && rec.combined24hUsd >= 0 ? rec.combined24hUsd : null;
    if (!date || nightlyUsd === null) continue;
    const gecko = geckoByDate.get(date);
    if (!gecko || gecko.length === 0) continue;
    const dex = assetRows(rec.assets).length > 0 ? assetRows(rec.assets) : assetRows(rec.symbolsWithVolume);
    const geckoKeys = new Set(gecko.map((asset) => equityCardRangeAddressKey(asset.address)));
    let assetUsd = gecko.reduce((sum, asset) => sum + asset.volumeUsd, 0);
    for (const asset of dex) {
      if (geckoKeys.has(equityCardRangeAddressKey(asset.address))) continue;
      assetUsd += asset.volumeUsd;
    }
    assetUsd = roundUsd(assetUsd);
    gaps.push({
      date,
      nightlyUsd,
      assetUsd,
      deltaPct: nightlyUsd === 0 ? null : ((assetUsd - nightlyUsd) / nightlyUsd) * 100,
      geckoOnly: dex.length === 0,
    });
  }
  gaps.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return gaps;
}

export function summarizeGapPercents(gaps: readonly NightlyAssetGap[]): {
  days: number;
  medianAbsPct: number | null;
  meanAbsPct: number | null;
  maxAbsPct: number | null;
} {
  const values = gaps
    .map((gap) => gap.deltaPct)
    .filter((value): value is number => value !== null && Number.isFinite(value))
    .map((value) => Math.abs(value))
    .sort((a, b) => a - b);
  if (values.length === 0) return { days: 0, medianAbsPct: null, meanAbsPct: null, maxAbsPct: null };
  const mid = Math.floor(values.length / 2);
  const median = values.length % 2 === 1 ? values[mid]! : (values[mid - 1]! + values[mid]!) / 2;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    days: values.length,
    medianAbsPct: median,
    meanAbsPct: mean,
    maxAbsPct: values[values.length - 1]!,
  };
}

export interface TrackedPoolCoverage {
  trackedPools: number;
  poolsWithCandles: number;
  trackedVolumeUsd: number;
  coveredVolumeUsd: number;
  /** Covered pool volume divided by tracked pool volume. */
  share: number | null;
  assetsTracked: number;
  assetsWithAGeckoDay: number;
}

/** How much of the nightly pool list the hourly backfill actually summed. */
export function trackedPoolCoverage(snapshot: unknown, backfill: unknown): TrackedPoolCoverage {
  const coveredPools = new Set<string>();
  const geckoAssets = new Set<string>();
  const byDate = backfillAssetsByDate(backfill);
  for (const assets of byDate.values()) {
    for (const asset of assets) geckoAssets.add(equityCardRangeAddressKey(asset.address));
  }
  const rawAssets = backfill && typeof backfill === "object" ? (backfill as { records?: unknown }).records : null;
  if (Array.isArray(rawAssets)) {
    for (const row of rawAssets) {
      if (!row || typeof row !== "object") continue;
      const assets = (row as { assets?: unknown }).assets;
      if (!Array.isArray(assets)) continue;
      for (const asset of assets) {
        if (!asset || typeof asset !== "object") continue;
        const pools = (asset as { pools?: unknown }).pools;
        if (!Array.isArray(pools)) continue;
        for (const pool of pools) {
          if (typeof pool === "string" && pool.trim()) coveredPools.add(pool.trim());
        }
      }
    }
  }
  const trackedPools = new Map<string, number>();
  const trackedAssets = new Set<string>();
  const records = snapshot && typeof snapshot === "object" ? (snapshot as { records?: unknown }).records : null;
  if (Array.isArray(records)) {
    for (const row of records) {
      if (!row || typeof row !== "object") continue;
      const assets = (row as { assets?: unknown }).assets;
      if (!Array.isArray(assets)) continue;
      for (const asset of assets) {
        if (!asset || typeof asset !== "object") continue;
        const address = (asset as { address?: unknown }).address;
        if (typeof address === "string" && address.trim()) trackedAssets.add(equityCardRangeAddressKey(address));
        const pools = (asset as { pools?: unknown }).pools;
        if (!Array.isArray(pools)) continue;
        for (const pool of pools) {
          if (!pool || typeof pool !== "object") continue;
          const pair = (pool as { pairAddress?: unknown }).pairAddress;
          const volume = (pool as { volume24hUsd?: unknown }).volume24hUsd;
          if (typeof pair !== "string" || !pair.trim()) continue;
          if (typeof volume !== "number" || volume < 0) continue;
          trackedPools.set(pair, (trackedPools.get(pair) ?? 0) + volume);
        }
      }
    }
  }
  let trackedVolumeUsd = 0;
  let coveredVolumeUsd = 0;
  for (const [pool, volume] of trackedPools) {
    trackedVolumeUsd += volume;
    if (coveredPools.has(pool)) coveredVolumeUsd += volume;
  }
  let assetsWithAGeckoDay = 0;
  for (const address of trackedAssets) {
    if (geckoAssets.has(address)) assetsWithAGeckoDay += 1;
  }
  return {
    trackedPools: trackedPools.size,
    poolsWithCandles: coveredPools.size,
    trackedVolumeUsd,
    coveredVolumeUsd,
    share: trackedVolumeUsd > 0 ? coveredVolumeUsd / trackedVolumeUsd : null,
    assetsTracked: trackedAssets.size,
    assetsWithAGeckoDay,
  };
}

function backfillAssetsByDate(backfill: unknown): Map<string, BackfillAsset[]> {
  const byDate = new Map<string, BackfillAsset[]>();
  if (!backfill || typeof backfill !== "object") return byDate;
  const file = backfill as { source?: unknown; records?: unknown };
  if (file.source !== GECKO_HOURLY_ET_BACKFILL_SOURCE || !Array.isArray(file.records)) return byDate;
  for (const row of file.records) {
    if (!row || typeof row !== "object") continue;
    const rec = row as { date?: unknown; assets?: unknown };
    const date = typeof rec.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rec.date) ? rec.date : "";
    if (!date || !Array.isArray(rec.assets)) continue;
    const assets = assetRows(rec.assets).filter((asset) => asset.sourceOk);
    if (assets.length === 0) continue;
    byDate.set(date, assets);
  }
  return byDate;
}

function assetRows(list: unknown): (BackfillAsset & { sourceOk: boolean })[] {
  if (!Array.isArray(list)) return [];
  const rows: (BackfillAsset & { sourceOk: boolean })[] = [];
  for (const asset of list) {
    if (!asset || typeof asset !== "object") continue;
    const item = asset as { address?: unknown; symbol?: unknown; volume24hUsd?: unknown; source?: unknown };
    const address = typeof item.address === "string" ? item.address.trim() : "";
    if (!address) continue;
    const volumeUsd = typeof item.volume24hUsd === "number" && item.volume24hUsd >= 0 ? item.volume24hUsd : null;
    if (volumeUsd === null) continue;
    const sourceOk = item.source === undefined || item.source === GECKO_HOURLY_ET_BACKFILL_SOURCE;
    rows.push({
      address,
      symbol: typeof item.symbol === "string" ? item.symbol : "",
      volumeUsd,
      sourceOk,
    });
  }
  return rows;
}

function sumAssetsByLane(
  assets: readonly BackfillAsset[],
  laneOf: (address: string, symbol: string) => InstrumentKind,
): Pick<DeskLaneDay, "publicEquity24hUsd" | "private24hUsd" | "etfIndex24hUsd" | "combined24hUsd" | "assetCount"> {
  const sums = { equity: 0, etf: 0, private: 0 };
  const counts = { equity: 0, etf: 0, private: 0 };
  for (const asset of assets) {
    const lane = laneOf(asset.address, asset.symbol);
    const key = lane === "etf" ? "etf" : lane === "private" ? "private" : "equity";
    sums[key] += asset.volumeUsd;
    counts[key] += 1;
  }
  const publicEquity24hUsd = counts.equity > 0 ? roundUsd(sums.equity) : null;
  const etfIndex24hUsd = counts.etf > 0 ? roundUsd(sums.etf) : null;
  const private24hUsd = counts.private > 0 ? roundUsd(sums.private) : null;
  return {
    publicEquity24hUsd,
    private24hUsd,
    etfIndex24hUsd,
    combined24hUsd: sumNullable([publicEquity24hUsd, private24hUsd, etfIndex24hUsd]),
    assetCount: counts.equity + counts.etf + counts.private,
  };
}

function roundUsd(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
