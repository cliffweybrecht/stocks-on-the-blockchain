import { compareNullableDesc } from "./numbers";
import type { AssetPoolMark, AssetPriceHistoryResult, PriceHistoryPoint, VolumeHistoryPoint } from "./types";

export const ASSET_PRICE_HISTORY_SOURCE_LABEL = "GeckoTerminal pool OHLCV close (USD)";

export const ASSET_PRICE_HISTORY_DEFINITION =
  "Price candles are GeckoTerminal USD closes for the highest-volume DexScreener pool on this mint. Close is the fifth OHLCV element — volume is the sixth. Volume is never treated as a price. Missing candles stay missing; the desk does not interpolate or invent points.";

export const ASSET_VOLUME_HISTORY_EMPTY_REASON =
  "GeckoTerminal did not return usable USD volume for this mint’s primary pool. The desk does not invent volume points.";

export function emptyAssetPriceHistory(
  reason: string,
  generatedAt = new Date().toISOString(),
): AssetPriceHistoryResult {
  return {
    available: false,
    pairAddress: null,
    sourceLabel: ASSET_PRICE_HISTORY_SOURCE_LABEL,
    definition: ASSET_PRICE_HISTORY_DEFINITION,
    daily: [],
    hourly: [],
    dailyVolume: [],
    hourlyVolume: [],
    generatedAt,
    emptyReason: reason,
  };
}

/** Highest-volume pool with a real pair address. Empty address is not a pool. */
export function selectPrimaryPricePool(
  pools: readonly Pick<AssetPoolMark, "pairAddress" | "volume24hUsd">[],
): string | null {
  const usable = pools.filter((pool) => pool.pairAddress.trim().length > 0);
  if (usable.length === 0) return null;
  const ranked = [...usable].sort((a, b) => compareNullableDesc(a.volume24hUsd, b.volume24hUsd));
  return ranked[0]?.pairAddress.trim() ?? null;
}

/**
 * Parse GeckoTerminal pool OHLCV.
 * Tuple is `[timestamp, open, high, low, close, volume]`.
 * Close and volume are independent: a missing sixth element is omitted, not $0.
 */
export function parseGeckoTerminalOhlcvSeries(payload: unknown): {
  prices: PriceHistoryPoint[];
  volumes: VolumeHistoryPoint[];
} {
  if (!payload || typeof payload !== "object") return { prices: [], volumes: [] };
  const data = (payload as { data?: { attributes?: { ohlcv_list?: unknown } } }).data;
  const list = data?.attributes?.ohlcv_list;
  if (!Array.isArray(list)) return { prices: [], volumes: [] };

  const prices: PriceHistoryPoint[] = [];
  const volumes: VolumeHistoryPoint[] = [];
  for (const row of list) {
    if (!Array.isArray(row) || row.length < 5) continue;
    const t = Number(row[0]);
    if (!Number.isFinite(t) || t <= 0) continue;
    const unix = Math.trunc(t);
    const closeUsd = Number(row[4]);
    if (Number.isFinite(closeUsd) && closeUsd > 0) {
      prices.push({ t: unix, priceUsd: closeUsd });
    }
    if (row.length >= 6) {
      const volumeUsd = Number(row[5]);
      if (Number.isFinite(volumeUsd) && volumeUsd >= 0) {
        volumes.push({ t: unix, volumeUsd });
      }
    }
  }

  return { prices: dedupePricePoints(prices), volumes: dedupeVolumePoints(volumes) };
}

/** Close (index 4) only. Volume is never treated as a price. */
export function parseGeckoTerminalPriceOhlcv(payload: unknown): PriceHistoryPoint[] {
  return parseGeckoTerminalOhlcvSeries(payload).prices;
}

function dedupePricePoints(points: PriceHistoryPoint[]): PriceHistoryPoint[] {
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const deduped: PriceHistoryPoint[] = [];
  for (const point of sorted) {
    const last = deduped[deduped.length - 1];
    if (last && last.t === point.t) {
      last.priceUsd = point.priceUsd;
      continue;
    }
    deduped.push({ ...point });
  }
  return deduped;
}

function dedupeVolumePoints(points: VolumeHistoryPoint[]): VolumeHistoryPoint[] {
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const deduped: VolumeHistoryPoint[] = [];
  for (const point of sorted) {
    const last = deduped[deduped.length - 1];
    if (last && last.t === point.t) {
      last.volumeUsd = point.volumeUsd;
      continue;
    }
    deduped.push({ ...point });
  }
  return deduped;
}

export function buildAssetPriceHistory(input: {
  pairAddress: string | null;
  daily: readonly PriceHistoryPoint[];
  hourly: readonly PriceHistoryPoint[];
  dailyVolume?: readonly VolumeHistoryPoint[];
  hourlyVolume?: readonly VolumeHistoryPoint[];
  /** Used only when the same-pool OHLCV payload had no volume element. */
  fallbackDailyVolume?: readonly VolumeHistoryPoint[];
  generatedAt?: string;
  emptyReason?: string;
}): AssetPriceHistoryResult {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const daily = [...input.daily].sort((a, b) => a.t - b.t);
  const hourly = [...input.hourly].sort((a, b) => a.t - b.t);
  const fromCandlesDaily = dedupeVolumePoints([...(input.dailyVolume ?? [])]);
  const fromCandlesHourly = dedupeVolumePoints([...(input.hourlyVolume ?? [])]);
  const fallbackDaily = dedupeVolumePoints([...(input.fallbackDailyVolume ?? [])]);
  const dailyVolume = fromCandlesDaily.length > 0 ? fromCandlesDaily : fallbackDaily;
  const hourlyVolume = fromCandlesHourly;
  const available = daily.length > 0 || hourly.length > 0;
  return {
    available,
    pairAddress: input.pairAddress,
    sourceLabel: ASSET_PRICE_HISTORY_SOURCE_LABEL,
    definition: ASSET_PRICE_HISTORY_DEFINITION,
    daily,
    hourly,
    dailyVolume,
    hourlyVolume,
    generatedAt,
    emptyReason: available
      ? null
      : (input.emptyReason ??
        "GeckoTerminal did not return usable USD closes for this mint’s primary pool."),
  };
}
