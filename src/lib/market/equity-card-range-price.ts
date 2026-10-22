import type { VolumeChartRangeId } from "./daily-volume-view";
import {
  EQUITY_CARD_RANGE_WINDOW,
  equityCardClosedSnapshotDates,
  equityCardRangeAddressKey,
  type EquityCardClosedRangeId,
} from "./equity-card-range-volume";
import { shiftDayKey, type HolderSnapshotFile } from "./holder-snapshots";
import { easternMidnightUnix } from "./volume-snapshots";

/**
 * Captured DEX closes for the equity-card footer.
 * The price is the holder snapshot's `priceUsd`. Supply × price is a market
 * value, not a price, and a missing close is not divided back out of `supplyUsd`.
 * Days the asset did not record are omitted. They are not $0.
 */
export interface EquityCardPricePoint {
  date: string;
  /** Unix seconds of America/New_York midnight on `date`. */
  t: number;
  priceUsd: number;
}

export interface EquityCardPriceHistory {
  /** Newest closed volume-snapshot day. Empty when that file has no closed day. */
  latestSnapshotDay: string;
  /** Closed volume-snapshot days, oldest first. The card ranges share this list. */
  snapshotDays: string[];
  byAsset: Record<string, EquityCardPricePoint[]>;
}

export const EMPTY_EQUITY_CARD_PRICE: EquityCardPriceHistory = {
  latestSnapshotDay: "",
  snapshotDays: [],
  byAsset: {},
};

export interface EquityCardRangePrice {
  /** Last recorded close in the window. */
  priceUsd: number;
  /** Null when the window has fewer than two recorded closes. A flat move stays 0. */
  changePct: number | null;
  direction: "up" | "down" | "flat" | null;
  /** Oldest first. Missing days are omitted, not drawn as $0. */
  series: EquityCardPricePoint[];
}

function positivePrice(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

/**
 * Closes on the volume file's closed Eastern days.
 * A holder day the volume window does not include stays out, so 7D/14D/30D
 * match the desk toggle. The in-progress Eastern day is already absent from
 * `snapshotDays`. Nothing is invented from supply.
 */
export function equityCardPriceHistoryFromPayloads(
  volumePayload: unknown,
  holderFile: HolderSnapshotFile | null,
  nowT: number,
  backfill: unknown = null,
): EquityCardPriceHistory {
  const snapshotDays = equityCardClosedSnapshotDates(volumePayload, nowT, backfill);
  const allowed = new Set(snapshotDays);
  const byAsset: Record<string, EquityCardPricePoint[]> = {};
  for (const day of holderFile?.records ?? []) {
    if (!allowed.has(day.date)) continue;
    const t = day.t > 0 ? day.t : easternMidnightUnix(day.date);
    if (t <= 0) continue;
    for (const asset of day.assets) {
      const priceUsd = positivePrice(asset.priceUsd);
      const key = equityCardRangeAddressKey(asset.address);
      if (!key || priceUsd === null) continue;
      const series = byAsset[key] ?? [];
      const previous = series[series.length - 1];
      if (previous && previous.date === day.date) {
        previous.priceUsd = priceUsd;
        previous.t = t;
        continue;
      }
      series.push({ date: day.date, t, priceUsd });
      byAsset[key] = series;
    }
  }
  for (const series of Object.values(byAsset)) series.sort((a, b) => a.date.localeCompare(b.date));
  return {
    latestSnapshotDay: snapshotDays[snapshotDays.length - 1] ?? "",
    snapshotDays,
    byAsset,
  };
}

function windowDates(snapshotDays: readonly string[], range: EquityCardClosedRangeId): string[] {
  const windowDays = EQUITY_CARD_RANGE_WINDOW[range];
  return snapshotDays.length > windowDays ? snapshotDays.slice(snapshotDays.length - windowDays) : [...snapshotDays];
}

/**
 * Price, direction, and percent move for the selected desk range.
 * 24H is the close on the newest snapshot day. Its move needs the previous
 * Eastern day's close. An older close is not a 24H move.
 * 7D, 14D, and 30D move from the first recorded close in the window to the last.
 * One close has a price and no move. No close stays null.
 */
export function equityCardPriceForRange(
  history: EquityCardPriceHistory | null | undefined,
  address: string,
  range: VolumeChartRangeId,
): EquityCardRangePrice | null {
  if (!history) return null;
  const points = history.byAsset[equityCardRangeAddressKey(address)];
  if (!points || points.length === 0) return null;

  let series: EquityCardPricePoint[];
  if (range === "24h") {
    if (!history.latestSnapshotDay) return null;
    const close = points.find((point) => point.date === history.latestSnapshotDay);
    if (!close) return null;
    const priorDate = shiftDayKey(history.latestSnapshotDay, -1);
    const prior = priorDate ? points.find((point) => point.date === priorDate) : undefined;
    series = prior ? [prior, close] : [close];
  } else {
    const allowed = new Set(windowDates(history.snapshotDays, range));
    series = points.filter((point) => allowed.has(point.date));
  }
  if (series.length === 0) return null;
  const first = series[0];
  const last = series[series.length - 1];
  if (!first || !last) return null;
  if (series.length < 2 || first.priceUsd <= 0) {
    return { priceUsd: last.priceUsd, changePct: null, direction: null, series };
  }
  const changePct = ((last.priceUsd - first.priceUsd) / first.priceUsd) * 100;
  if (!Number.isFinite(changePct)) {
    return { priceUsd: last.priceUsd, changePct: null, direction: null, series };
  }
  const direction = last.priceUsd > first.priceUsd ? "up" : last.priceUsd < first.priceUsd ? "down" : "flat";
  return { priceUsd: last.priceUsd, changePct, direction, series };
}
