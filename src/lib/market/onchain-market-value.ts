import type { VolumeChartRangeId } from "./daily-volume-view";
import {
  EQUITY_CARD_RANGE_WINDOW,
  equityCardClosedSnapshotDates,
  equityCardRangeAddressKey,
  equityCardRangeCoverageHint,
  type EquityCardClosedRangeId,
} from "./equity-card-range-volume";
import { compareAssetsByRank, type RankableRow } from "./aggregate";
import {
  marketValueLanes,
  normalizeHolderSnapshotDay,
  sumReported,
  type HolderSnapshotDay,
  type HolderSnapshotFile,
} from "./holder-snapshots";
import { asNonNegativeNumber, compareNullableDesc } from "./numbers";
import { priceTimesSupply } from "./solana-supply";
import { easternDayKey, utcInstantForDayKey } from "./volume-snapshots";

/**
 * Onchain market value is decimal-adjusted token supply × the desk price
 * captured at the same America/New_York close as volume.
 *
 * Solana supply is the SPL mint `uiAmountString`. Base, BNB, and Robinhood
 * Chain supply is ERC-20 `totalSupply`. The nightly holder writer stores that
 * product as `supplyUsd`, plus public / private / ETF-index sums.
 *
 * 24H is the close on the last closed Eastern day, not an average and not a
 * live figure. 7D, 14D, and 30D average the recorded closes inside the same
 * newest closed snapshot days the volume cards use. A missing day is left out
 * of the average. Nothing is invented.
 */

export interface AssetMarketValuePoint {
  date: string;
  t: number;
  marketValueUsd: number;
}

export interface MarketValueClose {
  date: string;
  t: number;
  totalUsd: number | null;
  publicUsd: number | null;
  privateUsd: number | null;
  etfUsd: number | null;
}

export interface OnchainMarketValueHistory {
  /** Yesterday in America/New_York. Empty when `nowT` is not a real instant. */
  lastClosedDay: string;
  /** Closed volume-snapshot days, oldest first. Same dates the volume ranges use. */
  snapshotDays: string[];
  byAsset: Record<string, AssetMarketValuePoint[]>;
  /** One row per snapshot day that stored a market value. Missing days are omitted. */
  chainDays: MarketValueClose[];
}

/** Shown with `—` when this range has no captured supply × price. */
export const MISSING_MARKET_VALUE_NOTE = "No captured supply";

export const EMPTY_ONCHAIN_MARKET_VALUE: OnchainMarketValueHistory = {
  lastClosedDay: "",
  snapshotDays: [],
  byAsset: {},
  chainDays: [],
};

export interface MarketValueRangeView {
  totalUsd: number | null;
  publicUsd: number | null;
  privateUsd: number | null;
  etfUsd: number | null;
  /** Recorded closes inside the window. Not the window length. */
  days: number;
  recorded: boolean;
  /** `24H`, `avg 7D`, `avg 7D · 3 of 7 days`, or `current` when nothing was stored. */
  hint: string;
  /** Oldest first. Days with no stored market value are omitted, not drawn as $0. */
  series: AssetMarketValuePoint[];
  basis: "close" | "average" | "current";
}

const AVG_HINT: Record<EquityCardClosedRangeId, string> = {
  "7d": "avg 7D",
  "14d": "avg 14D",
  "30d": "avg 30D",
};

/** America/New_York date that has already closed. The in-progress day is not this. */
export function lastClosedEasternDay(nowT: number): string {
  const today = easternDayKey(nowT);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) return "";
  const [year, month, day] = today.split("-").map(Number);
  if (!year || !month || !day) return "";
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/**
 * Small caption under the market-value figure.
 * A recorded multi-day window says `avg 7D`, and adds `5 of 7 days` when the
 * close was not on every day of the range. 24H says `24H`. No stored close
 * says `current` so a live figure is not presented as a range.
 */
export function marketValueHint(range: VolumeChartRangeId, days: number, recorded: boolean): string {
  if (!recorded) return "current";
  if (range === "24h") return "24H";
  const coverage = equityCardRangeCoverageHint(range, days);
  const avg = AVG_HINT[range];
  return coverage ? `${avg} · ${coverage}` : avg;
}

export function marketValueCaption(view: MarketValueRangeView): string {
  if (!view.recorded) {
    return "No captured supply in this range. Market value is supply × price from a nightly snapshot.";
  }
  const date = view.series[view.series.length - 1]?.date;
  if (view.basis === "close") {
    return date
      ? `${view.hint} · ${date} America/New_York · last closed supply × price`
      : `${view.hint} · last closed supply × price`;
  }
  return `${view.hint} · average of closed daily supply × price`;
}

function roundUsd(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function average(values: readonly (number | null)[]): number | null {
  const finite = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (finite.length === 0) return null;
  const sum = finite.reduce((total, value) => total + value, 0);
  return roundUsd(sum / finite.length);
}

function windowDates(history: OnchainMarketValueHistory, range: VolumeChartRangeId): string[] {
  if (range === "24h") {
    if (!history.lastClosedDay || !history.snapshotDays.includes(history.lastClosedDay)) return [];
    return [history.lastClosedDay];
  }
  const windowDays = EQUITY_CARD_RANGE_WINDOW[range];
  return history.snapshotDays.length > windowDays
    ? history.snapshotDays.slice(history.snapshotDays.length - windowDays)
    : history.snapshotDays;
}

function emptyView(
  live?: Pick<MarketValueClose, "totalUsd" | "publicUsd" | "privateUsd" | "etfUsd"> | null,
): MarketValueRangeView {
  const total = live?.totalUsd ?? null;
  const showingLive = total !== null;
  return {
    totalUsd: total,
    publicUsd: showingLive ? (live?.publicUsd ?? null) : null,
    privateUsd: showingLive ? (live?.privateUsd ?? null) : null,
    etfUsd: showingLive ? (live?.etfUsd ?? null) : null,
    days: 0,
    recorded: false,
    hint: showingLive ? "current" : "",
    series: [],
    basis: "current",
  };
}

/**
 * Chain (or combined) market value for the selected range.
 * `live` is used only when the window has no stored close. A live total is
 * labeled `current`. No live total stays empty.
 */
export function marketValueRangeView(
  history: OnchainMarketValueHistory | null | undefined,
  range: VolumeChartRangeId,
  live?: Pick<MarketValueClose, "totalUsd" | "publicUsd" | "privateUsd" | "etfUsd"> | null,
): MarketValueRangeView {
  if (!history) return emptyView(live);
  const allowed = windowDates(history, range);
  if (allowed.length === 0) return emptyView(live);
  const byDate = new Map(history.chainDays.map((day) => [day.date, day]));
  const closes = allowed
    .map((date) => byDate.get(date))
    .filter((day): day is MarketValueClose => day !== undefined && day.totalUsd !== null);
  if (closes.length === 0) return emptyView(live);
  const series: AssetMarketValuePoint[] = closes.map((day) => ({
    date: day.date,
    t: day.t,
    marketValueUsd: day.totalUsd as number,
  }));
  if (range === "24h") {
    const day = closes[closes.length - 1];
    if (!day || day.totalUsd === null) return emptyView(live);
    return {
      totalUsd: roundUsd(day.totalUsd),
      publicUsd: day.publicUsd === null ? null : roundUsd(day.publicUsd),
      privateUsd: day.privateUsd === null ? null : roundUsd(day.privateUsd),
      etfUsd: day.etfUsd === null ? null : roundUsd(day.etfUsd),
      days: 1,
      recorded: true,
      hint: marketValueHint(range, 1, true),
      series,
      basis: "close",
    };
  }
  return {
    totalUsd: average(closes.map((day) => day.totalUsd)),
    publicUsd: average(closes.map((day) => day.publicUsd)),
    privateUsd: average(closes.map((day) => day.privateUsd)),
    etfUsd: average(closes.map((day) => day.etfUsd)),
    days: closes.length,
    recorded: true,
    hint: marketValueHint(range, closes.length, true),
    series,
    basis: "average",
  };
}

export function equityCardMarketValueForRange(
  history: OnchainMarketValueHistory | null | undefined,
  address: string,
  range: VolumeChartRangeId,
): { marketValueUsd: number; days: number; series: AssetMarketValuePoint[] } | null {
  if (!history) return null;
  const points = history.byAsset[equityCardRangeAddressKey(address)];
  if (!points || points.length === 0) return null;
  const allowed = new Set(windowDates(history, range));
  if (allowed.size === 0) return null;
  const series = points.filter((point) => allowed.has(point.date));
  if (series.length === 0) return null;
  if (range === "24h") {
    const point = series[series.length - 1];
    if (!point || point.date !== history.lastClosedDay) return null;
    return { marketValueUsd: roundUsd(point.marketValueUsd), days: 1, series: [point] };
  }
  const sum = series.reduce((total, point) => total + point.marketValueUsd, 0);
  return { marketValueUsd: roundUsd(sum / series.length), days: series.length, series };
}

/**
 * Live card figure. Circulating supply × price when the desk has both.
 * Otherwise onchain total supply × price, which is what the nightly writer stores.
 * A missing side stays missing. Liquidity and volume are not substitutes.
 */
export function liveAssetMarketValueUsd(asset: {
  marketCapUsd?: number | null;
  dexMedianPriceUsd?: number | null;
  circulatingSupply?: number | null;
  totalSupply?: number | null;
}): number | null {
  if (typeof asset.marketCapUsd === "number" && Number.isFinite(asset.marketCapUsd) && asset.marketCapUsd >= 0) {
    return asset.marketCapUsd;
  }
  const circulating = priceTimesSupply(asset.dexMedianPriceUsd, asset.circulatingSupply);
  if (circulating !== null) return circulating;
  return priceTimesSupply(asset.dexMedianPriceUsd, asset.totalSupply);
}

export function equityCardMarketValueSortUsd(
  asset: RankableRow & { contractAddress: string },
  history: OnchainMarketValueHistory | null | undefined,
  range: VolumeChartRangeId,
): number | null {
  return equityCardMarketValueForRange(history, asset.contractAddress, range)?.marketValueUsd ?? null;
}

export function compareByEquityCardMarketValue(
  a: RankableRow & {
    contractAddress: string;
    marketCapUsd?: number | null;
    dexMedianPriceUsd?: number | null;
    circulatingSupply?: number | null;
    totalSupply?: number | null;
  },
  b: RankableRow & {
    contractAddress: string;
    marketCapUsd?: number | null;
    dexMedianPriceUsd?: number | null;
    circulatingSupply?: number | null;
    totalSupply?: number | null;
  },
  history: OnchainMarketValueHistory | null | undefined,
  range: VolumeChartRangeId,
): number {
  const byValue = compareNullableDesc(
    equityCardMarketValueSortUsd(a, history, range),
    equityCardMarketValueSortUsd(b, history, range),
  );
  if (byValue !== 0) return byValue;
  return compareAssetsByRank(a, b, "volume24hUsd");
}

function closeFromHolderDay(day: HolderSnapshotDay): MarketValueClose | null {
  const normalized = normalizeHolderSnapshotDay(day);
  const lanes = marketValueLanes(normalized.assets);
  const publicUsd = asNonNegativeNumber(normalized.publicMarketValueUsd) ?? lanes.publicMarketValueUsd;
  const privateUsd = asNonNegativeNumber(normalized.privateMarketValueUsd) ?? lanes.privateMarketValueUsd;
  const etfUsd = asNonNegativeNumber(normalized.etfMarketValueUsd) ?? lanes.etfMarketValueUsd;
  const totalUsd = asNonNegativeNumber(normalized.supplyUsd) ?? sumReported([publicUsd, privateUsd, etfUsd]);
  if (totalUsd === null) return null;
  const t = normalized.t > 0 ? normalized.t : utcInstantForDayKey(normalized.date);
  if (t <= 0) return null;
  return { date: normalized.date, t, totalUsd, publicUsd, privateUsd, etfUsd };
}

/**
 * Market value closes aligned to the volume snapshot's closed Eastern days.
 * A holder row on a day the volume file does not count is left out.
 * A volume day with no holder row is left out of the average, not stored as $0.
 */
export function onchainMarketValueHistoryFromPayloads(
  volumePayload: unknown,
  holderFile: HolderSnapshotFile | null,
  nowT: number,
  backfill: unknown = null,
): OnchainMarketValueHistory {
  const snapshotDays = equityCardClosedSnapshotDates(volumePayload, nowT, backfill);
  const allowed = new Set(snapshotDays);
  const byAsset: Record<string, AssetMarketValuePoint[]> = {};
  const chainDays: MarketValueClose[] = [];
  for (const day of holderFile?.records ?? []) {
    if (!allowed.has(day.date)) continue;
    const close = closeFromHolderDay(day);
    if (close) chainDays.push(close);
    const t = day.t > 0 ? day.t : utcInstantForDayKey(day.date);
    if (t <= 0) continue;
    for (const asset of day.assets) {
      const key = equityCardRangeAddressKey(asset.address);
      const marketValueUsd = asNonNegativeNumber(asset.supplyUsd);
      if (!key || marketValueUsd === null) continue;
      const series = byAsset[key] ?? [];
      series.push({ date: day.date, t, marketValueUsd });
      byAsset[key] = series;
    }
  }
  chainDays.sort((a, b) => a.date.localeCompare(b.date));
  for (const series of Object.values(byAsset)) series.sort((a, b) => a.date.localeCompare(b.date));
  return {
    lastClosedDay: lastClosedEasternDay(nowT),
    snapshotDays,
    byAsset,
    chainDays,
  };
}

/** Home total. A chain with no close that day is omitted, not treated as zero. */
export function combineOnchainMarketValueHistories(
  histories: readonly OnchainMarketValueHistory[],
): OnchainMarketValueHistory {
  const snapshotDays = [...new Set(histories.flatMap((history) => history.snapshotDays))].sort();
  const lastClosedDay = histories.find((history) => history.lastClosedDay)?.lastClosedDay ?? "";
  const byDate = new Map<string, MarketValueClose>();
  for (const history of histories) {
    for (const day of history.chainDays) {
      const existing = byDate.get(day.date);
      if (!existing) {
        byDate.set(day.date, { ...day });
        continue;
      }
      existing.totalUsd = sumReported([existing.totalUsd, day.totalUsd]);
      existing.publicUsd = sumReported([existing.publicUsd, day.publicUsd]);
      existing.privateUsd = sumReported([existing.privateUsd, day.privateUsd]);
      existing.etfUsd = sumReported([existing.etfUsd, day.etfUsd]);
      existing.t = day.t || existing.t;
    }
  }
  const byAsset: Record<string, AssetMarketValuePoint[]> = {};
  for (const history of histories) {
    for (const [key, points] of Object.entries(history.byAsset)) {
      const series = byAsset[key] ?? [];
      series.push(...points);
      series.sort((a, b) => a.date.localeCompare(b.date));
      byAsset[key] = series;
    }
  }
  return {
    lastClosedDay,
    snapshotDays,
    byAsset,
    chainDays: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
}
