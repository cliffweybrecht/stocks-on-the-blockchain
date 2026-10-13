import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  assembleArchiveVenue,
  binanceKlineUrl,
  binanceMetricsUrl,
  bybitTradeUrl,
  decodePerpsArchive,
  encodePerpsArchive,
  lastBinanceMetricsOpenInterestUsd,
  perpsArchiveVariance,
  previousUtcDay,
  priorUtcDay,
  readZipText,
  sumBinanceDailyQuoteVolume,
  sumBybitTradeNotional,
  type PerpsArchiveCheck,
} from "../perps-archive";
import { parseEquityPerpsFeeds, weexQuoteVolumeUsd, type PerpsFeeds } from "../perps-parse";
import {
  emptyPerpsSnapshotFile,
  mergePerpsDay,
  parsePerpsSnapshotFile,
  serializePerpsSnapshot,
} from "../perps-snapshot";
import { PERPS_BINANCE_ARCHIVE_SOURCE, PERPS_BYBIT_ARCHIVE_SOURCE } from "../perps-sources";

function emptyFeeds(overrides: Partial<PerpsFeeds> = {}): PerpsFeeds {
  const skipped = { data: null, error: "skipped" };
  return {
    capturedAt: "2026-10-13T03:59:00.000Z",
    hyperliquid: { dexs: [], error: "skipped" },
    bitget: { tickers: null, contracts: null, error: "skipped" },
    okx: { instruments: null, tickers: null, openInterest: null, oiError: null, error: "skipped" },
    gate: { tickers: null, contracts: null, error: "skipped" },
    mexc: { ticker: null, detail: null, error: "skipped" },
    aster: { ticker: null, exchangeInfo: null, error: "skipped" },
    kucoin: skipped,
    extended: skipped,
    lighter: skipped,
    lighterRobinhood: skipped,
    ondo: skipped,
    variational: skipped,
    kraken: skipped,
    bingx: skipped,
    coingecko: skipped,
    ostium: skipped,
    avantis: skipped,
    ...overrides,
  };
}

function zipText(name: string, text: string): Uint8Array {
  const data = Buffer.from(text);
  const compressed = deflateRawSync(data);
  const nameBytes = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  return Buffer.concat([local, nameBytes, compressed]);
}

describe("WEEX direct quote volume", () => {
  it("keeps quoteVolume when it is volume times a price inside the bar", () => {
    expect(
      weexQuoteVolumeUsd({
        volume: "182966.67",
        quoteVolume: "23867120.5891",
        lastPrice: "123.71",
        markPrice: "123.71",
        highPrice: "142.22",
        lowPrice: "120.39",
      }),
    ).toBeCloseTo(23867120.5891, 4);
  });

  it("rejects a quote that is not volume times a price in the bar", () => {
    expect(
      weexQuoteVolumeUsd({
        volume: "100",
        quoteVolume: "1800000",
        lastPrice: "123",
        markPrice: "123",
        highPrice: "130",
        lowPrice: "120",
      }),
    ).toBe(12300);
  });

  it("stores a tagged WEEX book and applies the credibility screen", () => {
    const day = parseEquityPerpsFeeds(
      emptyFeeds({
        weex: {
          tickers: [
            {
              symbol: "SOXLUSDT",
              volume: "100",
              quoteVolume: "12300",
              lastPrice: "123",
              markPrice: "123",
              highPrice: "130",
              lowPrice: "120",
            },
            {
              symbol: "USOUSDT",
              volume: "10",
              quoteVolume: "700",
              lastPrice: "70",
              markPrice: "70",
              highPrice: "71",
              lowPrice: "69",
            },
            {
              symbol: "BTCUSDT",
              volume: "5",
              quoteVolume: "500000",
              lastPrice: "100000",
              markPrice: "100000",
              highPrice: "101000",
              lowPrice: "99000",
            },
          ],
          exchangeInfo: {
            symbols: [
              { symbol: "SOXLUSDT", baseAsset: "SOXL", contractType: "TRADIFI_PERPETUAL", underlyingType: "Indices" },
              { symbol: "USOUSDT", baseAsset: "USO", contractType: "TRADIFI_PERPETUAL", underlyingType: "Indices" },
              { symbol: "BTCUSDT", baseAsset: "BTC", contractType: "PERPETUAL", underlyingType: "COIN" },
            ],
          },
          openInterest: [{ symbol: "SOXLUSDT", openInterest: "10" }],
          error: null,
        },
      }),
    );
    const weex = day.venues.find((venue) => venue.venue === "WEEX");
    expect(weex?.tier).toBe("cex-direct");
    expect(weex?.markets.map((market) => market.underlying)).toEqual(["SOXL"]);
    expect(weex?.markets[0]?.volume24hUsd).toBe(12300);
    expect(weex?.markets[0]?.openInterestUsd).toBe(1230);
    expect(weex?.credible).toBe(true);
    expect(day.archiveSymbols?.binance).toEqual([]);
  });
});

describe("archive symbol list", () => {
  it("keeps the exchange symbol from CoinGecko, not the index id", () => {
    const day = parseEquityPerpsFeeds(
      emptyFeeds({
        kucoin: {
          data: [
            { symbol: "NVDAUSDTM", assetClass: "STOCK", status: "Open", markPrice: "100", turnoverOf24h: 1 },
            { symbol: "TSLAUSDTM", assetClass: "STOCK", status: "Open", markPrice: "100", turnoverOf24h: 1 },
          ],
          error: null,
        },
        coingecko: {
          data: [
            {
              market: "Binance (Futures)",
              contract_type: "perpetual",
              symbol: "NVDAUSDT",
              index_id: "NVDA",
              price: "100",
              volume_24h: 20,
              open_interest: 10,
            },
            {
              market: "Bybit (Futures)",
              contract_type: "perpetual",
              symbol: "TSLAUSDT",
              index_id: "TSLA",
              price: "100",
              volume_24h: 5,
              open_interest: 4,
            },
            {
              market: "WEEX (Futures)",
              contract_type: "perpetual",
              symbol: "NVDAUSDT",
              index_id: "NVDA",
              price: "100",
              volume_24h: 999,
              open_interest: 1,
            },
          ],
          error: null,
        },
      }),
    );
    expect(day.archiveSymbols).toEqual({
      binance: [{ symbol: "NVDAUSDT", volumeUsd: 20 }],
      bybit: [{ symbol: "TSLAUSDT", volumeUsd: 5 }],
    });
    expect(day.venues.some((venue) => venue.venue === "WEEX")).toBe(false);
  });
});

describe("Coinbase International paused book", () => {
  it("records paused equity instruments at $0 and skips crypto", () => {
    const day = parseEquityPerpsFeeds(
      emptyFeeds({
        coinbase: {
          data: [
            {
              symbol: "NVDA-PERP",
              type: "PERP",
              underlying_type: "EQUITY",
              base_asset_name: "NVDA",
              trading_state: "PAUSED",
              notional_24hr: "0",
              open_interest: "4578.1",
            },
            {
              symbol: "OPENAI-PERP",
              type: "PERP",
              underlying_type: "PREIPO",
              base_asset_name: "OPENAI",
              trading_state: "PAUSED",
              notional_24hr: "0",
            },
            {
              symbol: "BTC-PERP",
              type: "PERP",
              underlying_type: "SPOT",
              base_asset_name: "BTC",
              trading_state: "PAUSED",
              notional_24hr: "0",
            },
            {
              symbol: "COIN50-PERP",
              type: "PERP",
              underlying_type: "INDEX",
              base_asset_name: "COIN50",
              trading_state: "PAUSED",
              notional_24hr: "0",
            },
          ],
          error: null,
        },
      }),
    );
    const venue = day.venues.find((row) => row.venue === "Coinbase International");
    expect(venue?.error).toBeNull();
    expect(venue?.markets.map((market) => [market.underlying, market.category, market.volume24hUsd])).toEqual([
      ["NVDA", "stock", 0],
      ["OPENAI", "preipo", 0],
    ]);
    expect(venue?.credible).toBe(true);
    expect(venue?.windowNote).toContain("$0");
  });

  it("keeps an active notional instead of forcing zero", () => {
    const day = parseEquityPerpsFeeds(
      emptyFeeds({
        coinbase: {
          data: [
            {
              symbol: "NVDA-PERP",
              type: "PERP",
              underlying_type: "EQUITY",
              base_asset_name: "NVDA",
              trading_state: "TRADING",
              notional_24hr: "50",
            },
          ],
          error: null,
        },
      }),
    );
    const venue = day.venues.find((row) => row.venue === "Coinbase International");
    expect(venue?.markets[0]?.volume24hUsd).toBe(50);
    expect(venue?.windowNote).not.toContain("All 1 equity");
  });
});

describe("Binance and Bybit archive cross-check", () => {
  it("uses the official hosts and the prior UTC day", () => {
    expect(PERPS_BINANCE_ARCHIVE_SOURCE).toContain("data.binance.vision");
    expect(PERPS_BINANCE_ARCHIVE_SOURCE).not.toContain("www.binance.com");
    expect(PERPS_BYBIT_ARCHIVE_SOURCE).toContain("public.bybit.com");
    expect(PERPS_BYBIT_ARCHIVE_SOURCE).not.toContain("api.bybit.com");
    expect(priorUtcDay("2026-10-14T03:59:00.000Z")).toBe("2026-10-13");
    expect(previousUtcDay("2026-10-13")).toBe("2026-10-12");
    expect(binanceKlineUrl("TSLAUSDT", "2026-10-11")).toBe(
      "https://data.binance.vision/data/futures/um/daily/klines/TSLAUSDT/1d/TSLAUSDT-1d-2026-10-11.zip",
    );
    expect(binanceMetricsUrl("TSLAUSDT", "2026-10-11")).toContain("/daily/metrics/TSLAUSDT/");
    expect(bybitTradeUrl("NVDAUSDT", "2026-10-11")).toBe(
      "https://public.bybit.com/trading/NVDAUSDT/NVDAUSDT2026-10-11.csv.gz",
    );
    expect(() => binanceKlineUrl("https://www.binance.com/fapi", "2026-10-11")).toThrow();
  });

  it("sums kline quote volume, the last metrics open interest, and Bybit size times price", () => {
    const kline = "open_time,quote_volume\n1,10.5\n2,1.5\n";
    expect(sumBinanceDailyQuoteVolume(kline)).toBe(12);
    const zipped = readZipText(zipText("TSLAUSDT-1d-2026-10-11.csv", kline));
    expect(zipped && sumBinanceDailyQuoteVolume(zipped)).toBe(12);
    const metrics = "create_time,sum_open_interest_value\n2026-10-11 00:00:00,10\n2026-10-11 23:50:00,42.5\n";
    expect(lastBinanceMetricsOpenInterestUsd(metrics)).toBe(42.5);
    const trades = "timestamp,symbol,side,size,price\n1,TSLAUSDT,Sell,0.05,382.56\n2,TSLAUSDT,Buy,2,10\n";
    expect(sumBybitTradeNotional(trades)).toBeCloseTo(0.05 * 382.56 + 20, 6);
  });

  it("compares CoinGecko on the covered symbols and stays off the headline row", () => {
    const venue = assembleArchiveVenue(
      [
        { symbol: "NVDAUSDT", coingeckoVolumeUsd: 30.4, volumeUsd: 10.2, openInterestUsd: 4 },
        { symbol: "TSLAUSDT", coingeckoVolumeUsd: 5, volumeUsd: null, openInterestUsd: 9 },
      ],
      true,
    );
    expect(venue).toEqual({
      volumeUsd: 10,
      openInterestUsd: 4,
      coingeckoVolumeUsd: 30,
      coingeckoVenueUsd: 35,
      symbols: 2,
      covered: 1,
    });
    expect(perpsArchiveVariance(venue.coingeckoVolumeUsd, venue.volumeUsd)).toBeCloseTo(2, 5);
    const check: PerpsArchiveCheck = {
      utcDate: "2026-10-12",
      binance: venue,
      bybit: assembleArchiveVenue(
        [{ symbol: "NVDAUSDT", coingeckoVolumeUsd: 8, volumeUsd: 4, openInterestUsd: 99 }],
        false,
      ),
      note: null,
    };
    expect(check.bybit.openInterestUsd).toBeNull();
    const encoded = encodePerpsArchive(check);
    expect(JSON.stringify(encoded).length).toBeLessThan(400);
    expect(decodePerpsArchive(encoded.arc, encoded.arcNote)).toEqual(check);
    const day = parseEquityPerpsFeeds(emptyFeeds());
    day.archive = check;
    const file = parsePerpsSnapshotFile(JSON.parse(serializePerpsSnapshot(mergePerpsDay(emptyPerpsSnapshotFile(), day))));
    const stored = file.records.find((row) => row.date === day.date);
    expect(stored && "archive" in stored ? stored.archive : null).toEqual(check);
    const plain = parseEquityPerpsFeeds(emptyFeeds());
    const plainFile = JSON.parse(serializePerpsSnapshot(mergePerpsDay(emptyPerpsSnapshotFile(), plain))) as {
      records: { arc?: unknown }[];
    };
    expect(plainFile.records.every((row) => row.arc === undefined)).toBe(true);
  });
});
