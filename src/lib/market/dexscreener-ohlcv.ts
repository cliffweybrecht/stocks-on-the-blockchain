import type { PriceHistoryPoint, VolumeHistoryPoint } from "./types";

export const DEXSCREENER_OHLCV_SOURCE_LABEL = "DexScreener pair OHLCV (USD)";

export const DEXSCREENER_OHLCV_DEFINITION =
  "Price and volume candles are DexScreener USD OHLCV for one pool on this mint. Close and volume are independent. A bar with no volume field is not stored as $0. Trailing volume.h24 is not a candle and is not plotted.";

/** Uniswap v4 pool ids are 32 bytes. Shorter addresses use the v3 chart path. */
export function dexScreenerAmmVersion(pairAddress: string): "v3" | "v4" {
  const hex = pairAddress.trim().toLowerCase().replace(/^0x/, "");
  return hex.length > 40 ? "v4" : "v3";
}

/**
 * DexScreener chart bars for one pair.
 * `res` is the bar size in minutes. `cb` is how many bars to ask for.
 * A failed response is not a series — callers leave the chart empty.
 */
export function dexScreenerOhlcvPath(
  pairAddress: string,
  options: { timeframe: "day" | "hour"; limit?: number; chain?: string },
): string {
  const chain = options.chain?.trim() || "robinhood";
  const res = options.timeframe === "hour" ? 60 : 1440;
  const limit = options.limit ?? (options.timeframe === "hour" ? 24 : 90);
  const version = dexScreenerAmmVersion(pairAddress);
  const params = new URLSearchParams({
    res: String(res),
    cb: String(limit),
  });
  return `/dex/chart/amm/${version}/${encodeURIComponent(chain)}/${encodeURIComponent(pairAddress.trim())}?${params.toString()}`;
}

function unixSeconds(value: number): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const seconds = value > 1e12 ? Math.trunc(value / 1000) : Math.trunc(value);
  return seconds > 0 ? seconds : null;
}

function readBars(payload: unknown): unknown[] | null {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return null;
  const record = payload as { bars?: unknown; ohlcv?: unknown };
  if (Array.isArray(record.bars)) return record.bars;
  if (Array.isArray(record.ohlcv)) return record.ohlcv;
  return null;
}

function barClose(bar: Record<string, unknown>): number | null {
  const raw = bar.closeUsd ?? bar.close;
  const close = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : Number.NaN;
  return Number.isFinite(close) && close > 0 ? close : null;
}

function barVolume(bar: Record<string, unknown>): number | null {
  if (!Object.prototype.hasOwnProperty.call(bar, "volumeUsd")) return null;
  const raw = bar.volumeUsd;
  const volume = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : Number.NaN;
  return Number.isFinite(volume) && volume >= 0 ? volume : null;
}

function pushPoint(
  prices: PriceHistoryPoint[],
  volumes: VolumeHistoryPoint[],
  t: number | null,
  close: number | null,
  volume: number | null,
): void {
  if (t === null) return;
  if (close !== null) prices.push({ t, priceUsd: close });
  if (volume !== null) volumes.push({ t, volumeUsd: volume });
}

/**
 * DexScreener chart bars.
 * Object bars use `closeUsd` and `volumeUsd`. A missing `volumeUsd` is omitted.
 * Tuples follow `[timestamp, open, high, low, close, volume]`.
 * A pair snapshot (`volume.h24`) is not a bar list and parses to nothing.
 */
export function parseDexScreenerOhlcvBars(payload: unknown): {
  prices: PriceHistoryPoint[];
  volumes: VolumeHistoryPoint[];
} {
  const bars = readBars(payload);
  if (!bars) return { prices: [], volumes: [] };

  const prices: PriceHistoryPoint[] = [];
  const volumes: VolumeHistoryPoint[] = [];
  for (const bar of bars) {
    if (Array.isArray(bar)) {
      if (bar.length < 5) continue;
      const t = unixSeconds(Number(bar[0]));
      const close = Number(bar[4]);
      const volume = bar.length >= 6 ? Number(bar[5]) : null;
      pushPoint(
        prices,
        volumes,
        t,
        Number.isFinite(close) && close > 0 ? close : null,
        volume !== null && Number.isFinite(volume) && volume >= 0 ? volume : null,
      );
      continue;
    }
    if (!bar || typeof bar !== "object") continue;
    const record = bar as Record<string, unknown>;
    const rawT = record.timestamp ?? record.t ?? record.time;
    const t = unixSeconds(typeof rawT === "number" ? rawT : typeof rawT === "string" ? Number(rawT) : Number.NaN);
    pushPoint(prices, volumes, t, barClose(record), barVolume(record));
  }

  return { prices: dedupePrices(prices), volumes: dedupeVolumes(volumes) };
}

function dedupePrices(points: PriceHistoryPoint[]): PriceHistoryPoint[] {
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

function dedupeVolumes(points: VolumeHistoryPoint[]): VolumeHistoryPoint[] {
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
