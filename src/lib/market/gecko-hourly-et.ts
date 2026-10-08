import { easternDayKey, easternMidnightUnix } from "./volume-snapshots";

/** Marks per-asset rows summed from GeckoTerminal hourly candles on an Eastern day. */
export const GECKO_HOURLY_ET_BACKFILL_SOURCE = "gecko-hourly-et-backfill";

export interface HourlyVolumeCandle {
  /** Unix seconds of the candle open. */
  t: number;
  volumeUsd: number;
}

export interface EasternDayVolume {
  volumeUsd: number;
  /** Hourly candles whose open fell in that America/New_York day. */
  hours: number;
}

/**
 * Unix instant of 00:00:00 America/New_York on `dayKey`.
 * The day runs until the next Eastern midnight, exclusive.
 */
export function easternDayStartUnix(dayKey: string): number {
  return easternMidnightUnix(dayKey);
}

export function easternDayKeysInclusive(fromDay: string, throughDay: string): string[] {
  const start = easternDayStartUnix(fromDay);
  const end = easternDayStartUnix(throughDay);
  if (start <= 0 || end <= 0 || end < start) return [];
  const keys: string[] = [];
  for (let t = start; t <= end; t += 24 * 3600) {
    const key = easternDayKey(t + 3600);
    if (!key || (keys.length > 0 && key === keys[keys.length - 1])) continue;
    if (key > throughDay) break;
    keys.push(key);
  }
  if (keys[0] !== fromDay || keys[keys.length - 1] !== throughDay) {
    const rebuilt: string[] = [];
    let cursor = fromDay;
    while (cursor && cursor <= throughDay && rebuilt.length < 400) {
      rebuilt.push(cursor);
      const next = easternDayKey(easternDayStartUnix(cursor) + 26 * 3600);
      if (!next || next === cursor) break;
      cursor = next;
    }
    return rebuilt;
  }
  return keys;
}

/**
 * Sum hourly candle volume into America/New_York calendar days.
 * A candle belongs to the Eastern day of its open. UTC daily candles are not accepted here.
 * Duplicate opens keep the last volume. Days with no candle are omitted, not written as $0.
 */
export function sumHourlyVolumeByEasternDay(
  candles: readonly HourlyVolumeCandle[],
  fromDay: string,
  throughDay: string,
): Record<string, EasternDayVolume> {
  const allowed = new Set(easternDayKeysInclusive(fromDay, throughDay));
  const byOpen = new Map<number, number>();
  for (const candle of candles) {
    if (!Number.isFinite(candle.t) || candle.t <= 0) continue;
    if (!Number.isFinite(candle.volumeUsd) || candle.volumeUsd < 0) continue;
    byOpen.set(Math.trunc(candle.t), candle.volumeUsd);
  }
  const totals = new Map<string, EasternDayVolume>();
  for (const [t, volumeUsd] of byOpen) {
    const date = easternDayKey(t);
    if (!date || !allowed.has(date)) continue;
    const current = totals.get(date) ?? { volumeUsd: 0, hours: 0 };
    current.volumeUsd += volumeUsd;
    current.hours += 1;
    totals.set(date, current);
  }
  const out: Record<string, EasternDayVolume> = {};
  for (const [date, total] of totals) {
    out[date] = {
      volumeUsd: roundUsd(total.volumeUsd),
      hours: total.hours,
    };
  }
  return out;
}

/** A pool's candle span reaches this Eastern day, even when that day itself has no trades. */
export function hourlySeriesCoversEasternDay(
  candles: readonly HourlyVolumeCandle[],
  dayKey: string,
): boolean {
  const start = easternDayStartUnix(dayKey);
  if (start <= 0) return false;
  const end = easternDayStartUnix(easternDayKey(start + 26 * 3600));
  if (end <= start) return false;
  let min = Infinity;
  let max = -Infinity;
  for (const candle of candles) {
    if (!Number.isFinite(candle.t) || candle.t <= 0) continue;
    const t = Math.trunc(candle.t);
    if (t < min) min = t;
    if (t > max) max = t;
    if (t >= start && t < end) return true;
  }
  return min <= start && max >= start;
}

function roundUsd(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
