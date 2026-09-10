import { compareNullableDesc } from "./numbers";
import type { AssetPoolMark, AssetPriceHistoryResult, PriceHistoryPoint } from "./types";

export const ASSET_PRICE_HISTORY_SOURCE_LABEL = "GeckoTerminal pool OHLCV close (USD)";

export const ASSET_PRICE_HISTORY_DEFINITION =
  "Price candles are GeckoTerminal USD closes for the highest-volume DexScreener pool on this mint. Close is the fifth OHLCV element — volume is never treated as a price. Missing candles stay missing; the desk does not interpolate or invent points.";

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
 * Parse GeckoTerminal pool OHLCV closes.
 * Tuple is `[timestamp, open, high, low, close, volume]`. Volume is ignored.
 */
export function parseGeckoTerminalPriceOhlcv(payload: unknown): PriceHistoryPoint[] {
  if (!payload || typeof payload !== "object") return [];
  const data = (payload as { data?: { attributes?: { ohlcv_list?: unknown } } }).data;
  const list = data?.attributes?.ohlcv_list;
  if (!Array.isArray(list)) return [];

  const points: PriceHistoryPoint[] = [];
  for (const row of list) {
    if (!Array.isArray(row) || row.length < 5) continue;
    const t = Number(row[0]);
    const closeUsd = Number(row[4]);
    if (!Number.isFinite(t) || t <= 0) continue;
    if (!Number.isFinite(closeUsd) || closeUsd <= 0) continue;
    points.push({ t: Math.trunc(t), priceUsd: closeUsd });
  }

  points.sort((a, b) => a.t - b.t);
  const deduped: PriceHistoryPoint[] = [];
  for (const point of points) {
    const last = deduped[deduped.length - 1];
    if (last && last.t === point.t) {
      last.priceUsd = point.priceUsd;
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
  generatedAt?: string;
  emptyReason?: string;
}): AssetPriceHistoryResult {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const daily = [...input.daily].sort((a, b) => a.t - b.t);
  const hourly = [...input.hourly].sort((a, b) => a.t - b.t);
  const available = daily.length > 0 || hourly.length > 0;
  return {
    available,
    pairAddress: input.pairAddress,
    sourceLabel: ASSET_PRICE_HISTORY_SOURCE_LABEL,
    definition: ASSET_PRICE_HISTORY_DEFINITION,
    daily,
    hourly,
    generatedAt,
    emptyReason: available
      ? null
      : (input.emptyReason ??
        "GeckoTerminal did not return usable USD closes for this mint’s primary pool."),
  };
}
