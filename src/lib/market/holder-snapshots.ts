import { asHolderCount } from "./solana-holders";
import { priceTimesSupply } from "./solana-supply";
import { easternDayKey, utcInstantForDayKey } from "./volume-snapshots";
import type { InstrumentKind } from "./types";
import type { VolumeChartRangeId } from "./daily-volume-view";

export const DEFAULT_HOLDER_SNAPSHOT_DIR = "data/holder-snapshots";

export const HOLDER_SNAPSHOT_CHAINS = [
  { id: "solana", file: "solana.json" },
  { id: "base", file: "base.json" },
  { id: "bnb", file: "bnb.json" },
  { id: "robinhood", file: "robinhood.json" },
] as const;

export type HolderSnapshotChainId = (typeof HOLDER_SNAPSHOT_CHAINS)[number]["id"];

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const RAW_UINT = /^(?:0|[1-9]\d*)$/;

export interface HolderSnapshotSources {
  totalSupply: string | null;
  /** Set only when supplyUsd is price × decimal-adjusted supply. */
  supplyUsd: string | null;
  holderCount: string | null;
  price: string | null;
}

/**
 * One token on one Eastern day.
 * `totalSupplyRaw` is the on-chain integer. `totalSupply` is the decimal-adjusted
 * figure the price quotes (SPL `uiAmountString`, including a Token-2022 multiplier).
 * Null is unreported. It is not zero.
 */
export interface HolderSnapshotAsset {
  address: string;
  symbol: string;
  issuer: string | null;
  instrumentKind: InstrumentKind;
  totalSupplyRaw: string | null;
  totalSupplyDecimals: number | null;
  totalSupply: number | null;
  supplyUsd: number | null;
  holderCount: number | null;
  sources: HolderSnapshotSources;
  /** Why a field is null. Absent when every requested field was read. */
  notes: string[];
  capturedAt: string;
}

export interface HolderSnapshotDay {
  date: string;
  /** Unix seconds for midnight on `date` in America/New_York, stored as the UTC instant of that civil date. */
  t: number;
  capturedAt: string;
  /** Sum of per-token holder counts. Not unique wallets. Null when no token reported a count. */
  holderCount: number | null;
  /** Sum of per-token supplyUsd. Null when no token had both supply and a price. */
  supplyUsd: number | null;
  assetCount: number;
  assetsWithHolders: number;
  assetsWithSupplyUsd: number;
  /** Chain-level source choice and its limits for this capture. */
  limits: string[];
  assets: HolderSnapshotAsset[];
}

export interface HolderSnapshotFile {
  version: 1;
  chainId: HolderSnapshotChainId;
  records: HolderSnapshotDay[];
}

export interface HolderUniverseAsset {
  address: string;
  symbol: string;
  issuer: string | null;
  instrumentKind: InstrumentKind;
  /** Desk DexScreener median (or the chain loader's spot). Missing stays null. */
  priceUsd: number | null;
}

const RANGE_DAYS: Record<VolumeChartRangeId, number> = {
  "24h": 1,
  "7d": 7,
  "14d": 14,
  "30d": 30,
};

export function holderSnapshotChainId(chainId: string): HolderSnapshotChainId | null {
  const key = chainId.trim().toLowerCase();
  if (key === "solana" || key === "base" || key === "bnb" || key === "robinhood") return key;
  if (key === "robinhood-chain") return "robinhood";
  return null;
}

export function holderAddressKey(address: string): string {
  const trimmed = address.trim();
  return trimmed.startsWith("0x") || trimmed.startsWith("0X") ? trimmed.toLowerCase() : trimmed;
}

export function isInstrumentKind(value: unknown): value is InstrumentKind {
  return value === "equity" || value === "etf" || value === "private";
}

/** Civil-date shift. Snapshot keys are Eastern calendar dates, not instants. */
export function shiftDayKey(dayKey: string, deltaDays: number): string {
  if (!DAY_KEY.test(dayKey) || !Number.isInteger(deltaDays)) return "";
  const [year, month, day] = dayKey.split("-").map(Number);
  if (!year || !month || !day) return "";
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + deltaDays);
  return date.toISOString().slice(0, 10);
}

export function dayKeySpan(start: string, end: string): number | null {
  if (!DAY_KEY.test(start) || !DAY_KEY.test(end)) return null;
  const startMs = Date.parse(`${start}T00:00:00.000Z`);
  const endMs = Date.parse(`${end}T00:00:00.000Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  return Math.round((endMs - startMs) / 86_400_000);
}

export function easternSnapshotDate(unixSeconds: number): { date: string; t: number } | null {
  const date = easternDayKey(unixSeconds);
  if (!DAY_KEY.test(date)) return null;
  const t = utcInstantForDayKey(date);
  if (t <= 0) return null;
  return { date, t };
}

function finiteSupply(value: number | null): number | null {
  if (value === null || !Number.isFinite(value) || value < 0) return null;
  return value;
}

export function sumReported(values: readonly (number | null | undefined)[]): number | null {
  let sum = 0;
  let any = false;
  for (const value of values) {
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    sum += value;
    any = true;
  }
  return any ? sum : null;
}

export function holderSnapshotTotals(assets: readonly HolderSnapshotAsset[]): {
  holderCount: number | null;
  supplyUsd: number | null;
  assetCount: number;
  assetsWithHolders: number;
  assetsWithSupplyUsd: number;
} {
  return {
    holderCount: sumReported(assets.map((asset) => asset.holderCount)),
    supplyUsd: sumReported(assets.map((asset) => asset.supplyUsd)),
    assetCount: assets.length,
    assetsWithHolders: assets.filter((asset) => asset.holderCount !== null).length,
    assetsWithSupplyUsd: assets.filter((asset) => asset.supplyUsd !== null).length,
  };
}

export function buildHolderSnapshotAsset(input: {
  asset: HolderUniverseAsset;
  totalSupplyRaw: string | null;
  totalSupplyDecimals: number | null;
  totalSupply: number | null;
  priceUsd: number | null;
  holderCount: number | null;
  supplySource: string | null;
  holderSource: string | null;
  priceSource: string | null;
  notes: readonly string[];
  capturedAt: string;
}): HolderSnapshotAsset {
  const totalSupply = finiteSupply(input.totalSupply);
  const supplyUsd = priceTimesSupply(input.priceUsd, totalSupply);
  const holderCount = asHolderCount(input.holderCount);
  const sources: HolderSnapshotSources = {
    totalSupply: totalSupply !== null || input.totalSupplyRaw ? input.supplySource : null,
    supplyUsd: supplyUsd !== null && input.priceSource && input.supplySource ? `${input.priceSource}×${input.supplySource}` : null,
    holderCount: holderCount !== null ? input.holderSource : null,
    price: input.priceUsd !== null && input.priceUsd > 0 ? input.priceSource : null,
  };
  return {
    address: input.asset.address.trim(),
    symbol: input.asset.symbol.trim(),
    issuer: input.asset.issuer?.trim() || null,
    instrumentKind: input.asset.instrumentKind,
    totalSupplyRaw: input.totalSupplyRaw && RAW_UINT.test(input.totalSupplyRaw) ? input.totalSupplyRaw : null,
    totalSupplyDecimals:
      typeof input.totalSupplyDecimals === "number" &&
      Number.isInteger(input.totalSupplyDecimals) &&
      input.totalSupplyDecimals >= 0 &&
      input.totalSupplyDecimals <= 36
        ? input.totalSupplyDecimals
        : null,
    totalSupply,
    supplyUsd,
    holderCount,
    sources,
    notes: [...input.notes],
    capturedAt: input.capturedAt,
  };
}

export function sortHolderAssets(assets: readonly HolderSnapshotAsset[]): HolderSnapshotAsset[] {
  return [...assets].sort(
    (a, b) => a.symbol.toUpperCase().localeCompare(b.symbol.toUpperCase()) || a.address.localeCompare(b.address),
  );
}

/** Same Eastern day is replaced. Other days stay. */
export function upsertHolderSnapshotDay(
  records: readonly HolderSnapshotDay[],
  incoming: HolderSnapshotDay,
): HolderSnapshotDay[] {
  const next = records.filter((row) => row.date !== incoming.date);
  next.push(incoming);
  next.sort((a, b) => a.date.localeCompare(b.date));
  return next;
}

export function serializeHolderSnapshotFile(file: HolderSnapshotFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

function asDay(value: unknown): HolderSnapshotDay | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<HolderSnapshotDay>;
  if (typeof row.date !== "string" || !DAY_KEY.test(row.date)) return null;
  if (!Array.isArray(row.assets)) return null;
  return row as HolderSnapshotDay;
}

export function parseHolderSnapshotFile(payload: unknown, chainId: HolderSnapshotChainId): HolderSnapshotFile {
  if (!payload || typeof payload !== "object") return { version: 1, chainId, records: [] };
  const records = (payload as { records?: unknown }).records;
  if (!Array.isArray(records)) return { version: 1, chainId, records: [] };
  const days: HolderSnapshotDay[] = [];
  for (const row of records) {
    const day = asDay(row);
    if (day) days.push(day);
  }
  days.sort((a, b) => a.date.localeCompare(b.date));
  return { version: 1, chainId, records: days };
}

export interface HolderDaySlot<T> {
  date: string;
  t: number;
  empty: boolean;
  value: T | null;
}

export function rangeDayKeys(endDate: string, range: VolumeChartRangeId): string[] {
  const days = RANGE_DAYS[range];
  if (!DAY_KEY.test(endDate) || !days) return [];
  const keys: string[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const key = shiftDayKey(endDate, -offset);
    if (key) keys.push(key);
  }
  return keys;
}

export function newestHolderDate(records: readonly { date: string }[]): string | null {
  let newest = "";
  for (const row of records) {
    if (DAY_KEY.test(row.date) && row.date > newest) newest = row.date;
  }
  return newest || null;
}

/**
 * One slot per Eastern day in the range, ending on the newest snapshot.
 * A day with no snapshot is an empty slot. Values are not carried across a gap.
 */
export function holderDaySlots<TRecord extends { date: string; t: number }, T>(
  records: readonly TRecord[],
  range: VolumeChartRangeId,
  read: (record: TRecord) => T | null,
): HolderDaySlot<T>[] {
  const end = newestHolderDate(records);
  if (!end) return [];
  const byDate = new Map(records.map((row) => [row.date, row]));
  return rangeDayKeys(end, range).map((date) => {
    const row = byDate.get(date);
    if (!row) return { date, t: utcInstantForDayKey(date), empty: true, value: null };
    return { date, t: row.t, empty: false, value: read(row) };
  });
}

/**
 * Sum of day-over-day changes where both days are real snapshots and they are
 * the next Eastern calendar day. A gap contributes nothing.
 */
export function consecutiveChange(slots: readonly HolderDaySlot<number>[]): number | null {
  let delta = 0;
  let any = false;
  for (let index = 1; index < slots.length; index += 1) {
    const previous = slots[index - 1];
    const current = slots[index];
    if (!previous || !current) continue;
    if (previous.empty || current.empty) continue;
    if (previous.value === null || current.value === null) continue;
    if (dayKeySpan(previous.date, current.date) !== 1) continue;
    const step = current.value - previous.value;
    if (!Number.isFinite(step)) continue;
    delta += step;
    any = true;
  }
  return any ? delta : null;
}

export interface HolderAssetPoint {
  date: string;
  t: number;
  holderCount: number | null;
  totalSupply: number | null;
  supplyUsd: number | null;
}

export type HolderAssetSeriesMap = Record<string, HolderAssetPoint[]>;

export function holderAssetSeries(file: HolderSnapshotFile | null): HolderAssetSeriesMap {
  const map: HolderAssetSeriesMap = {};
  if (!file) return map;
  for (const day of file.records) {
    for (const asset of day.assets) {
      const key = holderAddressKey(asset.address);
      if (!key) continue;
      const list = map[key] ?? [];
      list.push({
        date: day.date,
        t: day.t,
        holderCount: asset.holderCount,
        totalSupply: asset.totalSupply,
        supplyUsd: asset.supplyUsd,
      });
      map[key] = list;
    }
  }
  return map;
}

export function seriesForAddress(
  series: HolderAssetSeriesMap | null | undefined,
  address: string,
): HolderAssetPoint[] {
  if (!series) return [];
  return series[holderAddressKey(address)] ?? [];
}

export interface HolderAssetRangeView {
  holderCount: number | null;
  holderChange: number | null;
  totalSupply: number | null;
  supplyChange: number | null;
  supplyUsd: number | null;
  supplyUsdChange: number | null;
}

/** Latest real row in the window, plus consecutive changes. A lone day has no change. */
export function holderAssetRangeView(
  points: readonly HolderAssetPoint[],
  range: VolumeChartRangeId,
): HolderAssetRangeView {
  const slots = holderDaySlots(points, range, (row) => row as HolderAssetPoint);
  const latest = [...slots].reverse().find((slot) => !slot.empty && slot.value);
  const point = latest?.value ?? null;
  return {
    holderCount: point?.holderCount ?? null,
    holderChange: consecutiveChange(slots.map((slot) => ({ ...slot, value: slot.value?.holderCount ?? null }))),
    totalSupply: point?.totalSupply ?? null,
    supplyChange: consecutiveChange(slots.map((slot) => ({ ...slot, value: slot.value?.totalSupply ?? null }))),
    supplyUsd: point?.supplyUsd ?? null,
    supplyUsdChange: consecutiveChange(slots.map((slot) => ({ ...slot, value: slot.value?.supplyUsd ?? null }))),
  };
}

export interface HolderDeskPoint {
  date: string;
  t: number;
  holderCount: number | null;
  supplyUsd: number | null;
  assetCount: number;
  assetsWithHolders: number;
  assetsWithSupplyUsd: number;
}

/** Desk totals use the same slot shape as an asset. Units are not a chain total. */
export function holderPanelPoints(points: readonly HolderDeskPoint[]): HolderAssetPoint[] {
  return points.map((point) => ({
    date: point.date,
    t: point.t,
    holderCount: point.holderCount,
    totalSupply: null,
    supplyUsd: point.supplyUsd,
  }));
}

export function holderDeskPoints(file: HolderSnapshotFile | null): HolderDeskPoint[] {
  if (!file) return [];
  return file.records.map((day) => ({
    date: day.date,
    t: day.t,
    holderCount: day.holderCount,
    supplyUsd: day.supplyUsd,
    assetCount: day.assetCount,
    assetsWithHolders: day.assetsWithHolders,
    assetsWithSupplyUsd: day.assetsWithSupplyUsd,
  }));
}

/**
 * Home total. Each chain contributes its own per-token sum.
 * A chain with no row that day is omitted, not treated as zero.
 * The day is empty only when every chain is missing.
 */
export function combineHolderDeskPoints(groups: readonly (readonly HolderDeskPoint[])[]): HolderDeskPoint[] {
  const byDate = new Map<string, HolderDeskPoint>();
  for (const group of groups) {
    for (const point of group) {
      const existing = byDate.get(point.date);
      if (!existing) {
        byDate.set(point.date, { ...point });
        continue;
      }
      existing.holderCount = sumReported([existing.holderCount, point.holderCount]);
      existing.supplyUsd = sumReported([existing.supplyUsd, point.supplyUsd]);
      existing.assetCount += point.assetCount;
      existing.assetsWithHolders += point.assetsWithHolders;
      existing.assetsWithSupplyUsd += point.assetsWithSupplyUsd;
      existing.t = point.t || existing.t;
    }
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function rawUint(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return RAW_UINT.test(trimmed) ? trimmed : null;
}

/** ERC-20 integer adjusted by `decimals`. Non-integers and out-of-range decimals stay null. */
export function decimalAdjustedSupply(raw: bigint, decimals: number): number | null {
  if (raw < BigInt(0) || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) return null;
  const text = raw.toString().padStart(decimals + 1, "0");
  const whole = decimals === 0 ? text : text.slice(0, text.length - decimals);
  const frac = decimals === 0 ? "" : text.slice(text.length - decimals).replace(/0+$/, "");
  const rendered = frac ? `${whole}.${frac}` : whole;
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(rendered)) return null;
  const value = Number(rendered);
  return Number.isFinite(value) ? value : null;
}
