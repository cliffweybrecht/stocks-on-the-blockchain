import { gunzipSync, inflateRawSync } from "node:zlib";

/**
 * Official daily archives for the Binance and Bybit CoinGecko rows.
 * The headline stays on CoinGecko rolling 24h. This check is a prior UTC
 * day (or one day earlier when that dump is not published yet).
 * data.binance.vision and public.bybit.com only. Not www.binance.com, not fapi.
 */

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const SYMBOL_KEY = /^[A-Z0-9]{2,30}USDT$/;

export interface PerpsArchiveSymbol {
  symbol: string;
  /** CoinGecko rolling-24h quote volume for this equity contract. */
  volumeUsd: number | null;
}

export interface PerpsArchiveVenueCheck {
  /** Sum of official archive quote volume for symbols whose file was read. */
  volumeUsd: number | null;
  /** Binance end-of-day open interest in USD. Bybit's trade dump has no open interest. */
  openInterestUsd: number | null;
  /** CoinGecko rolling 24h for the symbols whose archive file was read. */
  coingeckoVolumeUsd: number | null;
  /** CoinGecko rolling 24h for every equity symbol requested, covered or not. */
  coingeckoVenueUsd: number | null;
  symbols: number;
  covered: number;
}

export interface PerpsArchiveCheck {
  utcDate: string;
  binance: PerpsArchiveVenueCheck;
  bybit: PerpsArchiveVenueCheck;
  note: string | null;
}

export interface PerpsArchiveSymbolResult {
  symbol: string;
  coingeckoVolumeUsd: number | null;
  volumeUsd: number | null;
  openInterestUsd: number | null;
}

export function priorUtcDay(capturedAt: string): string | null {
  const t = Date.parse(capturedAt);
  if (!Number.isFinite(t)) return null;
  return new Date(t - 86_400_000).toISOString().slice(0, 10);
}

export function previousUtcDay(day: string): string | null {
  if (!DAY_KEY.test(day)) return null;
  const t = Date.parse(`${day}T00:00:00.000Z`);
  if (!Number.isFinite(t)) return null;
  return new Date(t - 86_400_000).toISOString().slice(0, 10);
}

export function perpsArchiveSymbol(symbol: string): string | null {
  const normalized = symbol.trim().toUpperCase();
  return SYMBOL_KEY.test(normalized) ? normalized : null;
}

export function dedupeArchiveSymbols(rows: readonly PerpsArchiveSymbol[]): PerpsArchiveSymbol[] {
  const map = new Map<string, number | null>();
  for (const row of rows) {
    const symbol = perpsArchiveSymbol(row.symbol);
    if (!symbol) continue;
    const volume = typeof row.volumeUsd === "number" && Number.isFinite(row.volumeUsd) ? row.volumeUsd : null;
    const prev = map.get(symbol);
    if (prev === undefined) {
      map.set(symbol, volume);
      continue;
    }
    if (volume === null) continue;
    map.set(symbol, (prev ?? 0) + volume);
  }
  return [...map.entries()]
    .map(([symbol, volumeUsd]) => ({ symbol, volumeUsd }))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
}

export function binanceKlineUrl(symbol: string, day: string): string {
  const name = perpsArchiveSymbol(symbol);
  if (!name || !DAY_KEY.test(day)) throw new Error("Refusing Binance archive URL.");
  return `https://data.binance.vision/data/futures/um/daily/klines/${name}/1d/${name}-1d-${day}.zip`;
}

export function binanceMetricsUrl(symbol: string, day: string): string {
  const name = perpsArchiveSymbol(symbol);
  if (!name || !DAY_KEY.test(day)) throw new Error("Refusing Binance archive URL.");
  return `https://data.binance.vision/data/futures/um/daily/metrics/${name}/${name}-metrics-${day}.zip`;
}

export function bybitTradeUrl(symbol: string, day: string): string {
  const name = perpsArchiveSymbol(symbol);
  if (!name || !DAY_KEY.test(day)) throw new Error("Refusing Bybit archive URL.");
  return `https://public.bybit.com/trading/${name}/${name}${day}.csv.gz`;
}

function dollars(value: number): number {
  return Math.round(value);
}

export function assembleArchiveVenue(
  rows: readonly PerpsArchiveSymbolResult[],
  withOpenInterest: boolean,
): PerpsArchiveVenueCheck {
  let volume = 0;
  let volumeAny = false;
  let oi = 0;
  let oiAny = false;
  let coveredCg = 0;
  let coveredCgAny = false;
  let venueCg = 0;
  let venueCgAny = false;
  let covered = 0;
  for (const row of rows) {
    if (row.coingeckoVolumeUsd !== null) {
      venueCg += row.coingeckoVolumeUsd;
      venueCgAny = true;
    }
    if (row.volumeUsd === null) continue;
    covered += 1;
    volume += row.volumeUsd;
    volumeAny = true;
    if (row.coingeckoVolumeUsd !== null) {
      coveredCg += row.coingeckoVolumeUsd;
      coveredCgAny = true;
    }
    if (withOpenInterest && row.openInterestUsd !== null) {
      oi += row.openInterestUsd;
      oiAny = true;
    }
  }
  return {
    volumeUsd: volumeAny ? dollars(volume) : null,
    openInterestUsd: withOpenInterest && oiAny ? dollars(oi) : null,
    coingeckoVolumeUsd: coveredCgAny ? dollars(coveredCg) : null,
    coingeckoVenueUsd: venueCgAny ? dollars(venueCg) : null,
    symbols: rows.length,
    covered,
  };
}

/** CoinGecko minus archive, divided by archive. Null when the archive total is missing or zero. */
export function perpsArchiveVariance(coingeckoUsd: number | null, archiveUsd: number | null): number | null {
  if (coingeckoUsd === null || archiveUsd === null || !(archiveUsd > 0)) return null;
  return (coingeckoUsd - archiveUsd) / archiveUsd;
}

export function readZipText(bytes: Uint8Array): string | null {
  if (bytes.length < 30) return null;
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const method = view.getUint16(8, true);
  const compressedSize = view.getUint32(18, true);
  const nameLength = view.getUint16(26, true);
  const extraLength = view.getUint16(28, true);
  const start = 30 + nameLength + extraLength;
  if (compressedSize <= 0 || start + compressedSize > bytes.length) return null;
  const compressed = bytes.subarray(start, start + compressedSize);
  try {
    if (method === 0) return Buffer.from(compressed).toString("utf8");
    if (method === 8) return inflateRawSync(compressed).toString("utf8");
  } catch {
    return null;
  }
  return null;
}

export function readGzipText(bytes: Uint8Array): string | null {
  try {
    return gunzipSync(bytes).toString("utf8");
  } catch {
    return null;
  }
}

export function sumBinanceDailyQuoteVolume(csv: string): number | null {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return null;
  const header = lines[0]?.split(",") ?? [];
  const index = header.indexOf("quote_volume");
  if (index < 0) return null;
  let sum = 0;
  let any = false;
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const cell = line.split(",")[index];
    const value = Number(cell);
    if (!Number.isFinite(value) || value < 0) continue;
    sum += value;
    any = true;
  }
  return any ? sum : null;
}

/** Last metrics row of the UTC day. Summing the intraday rows would not be open interest. */
export function lastBinanceMetricsOpenInterestUsd(csv: string): number | null {
  const lines = csv
    .trim()
    .split(/\r?\n/)
    .filter((line) => line.trim());
  if (lines.length < 2) return null;
  const header = lines[0]?.split(",") ?? [];
  const index = header.indexOf("sum_open_interest_value");
  if (index < 0) return null;
  const last = lines[lines.length - 1]?.split(",")[index];
  const value = Number(last);
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

/** Sum of trade size × price. Bybit's foreignNotional matches that product. */
export function sumBybitTradeNotional(csv: string): number | null {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return null;
  const header = lines[0]?.split(",") ?? [];
  const sizeIndex = header.indexOf("size");
  const priceIndex = header.indexOf("price");
  if (sizeIndex < 0 || priceIndex < 0) return null;
  let sum = 0;
  let any = false;
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const cells = line.split(",");
    const size = Number(cells[sizeIndex]);
    const price = Number(cells[priceIndex]);
    if (!Number.isFinite(size) || !Number.isFinite(price) || size < 0 || price < 0) continue;
    sum += size * price;
    any = true;
  }
  return any ? sum : null;
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function countSlot(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return null;
  return value;
}

export function encodePerpsArchive(check: PerpsArchiveCheck): { arc: unknown[]; arcNote?: string } {
  const binance = check.binance;
  const bybit = check.bybit;
  const encoded: { arc: unknown[]; arcNote?: string } = {
    arc: [
      check.utcDate,
      binance.volumeUsd,
      binance.openInterestUsd,
      binance.coingeckoVolumeUsd,
      binance.coingeckoVenueUsd,
      binance.symbols,
      binance.covered,
      bybit.volumeUsd,
      bybit.coingeckoVolumeUsd,
      bybit.coingeckoVenueUsd,
      bybit.symbols,
      bybit.covered,
    ],
  };
  if (check.note) encoded.arcNote = check.note;
  return encoded;
}

export function decodePerpsArchive(arc: unknown, note: unknown): PerpsArchiveCheck | null {
  if (!Array.isArray(arc) || arc.length < 12) return null;
  const utcDate = arc[0];
  if (typeof utcDate !== "string" || !DAY_KEY.test(utcDate)) return null;
  const binanceSymbols = countSlot(arc[5]);
  const binanceCovered = countSlot(arc[6]);
  const bybitSymbols = countSlot(arc[10]);
  const bybitCovered = countSlot(arc[11]);
  if (binanceSymbols === null || binanceCovered === null || bybitSymbols === null || bybitCovered === null) return null;
  if (binanceCovered > binanceSymbols || bybitCovered > bybitSymbols) return null;
  return {
    utcDate,
    binance: {
      volumeUsd: finiteOrNull(arc[1]),
      openInterestUsd: finiteOrNull(arc[2]),
      coingeckoVolumeUsd: finiteOrNull(arc[3]),
      coingeckoVenueUsd: finiteOrNull(arc[4]),
      symbols: binanceSymbols,
      covered: binanceCovered,
    },
    bybit: {
      volumeUsd: finiteOrNull(arc[7]),
      openInterestUsd: null,
      coingeckoVolumeUsd: finiteOrNull(arc[8]),
      coingeckoVenueUsd: finiteOrNull(arc[9]),
      symbols: bybitSymbols,
      covered: bybitCovered,
    },
    note: typeof note === "string" && note ? note : null,
  };
}
