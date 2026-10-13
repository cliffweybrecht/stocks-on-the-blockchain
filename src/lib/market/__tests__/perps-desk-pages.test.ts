import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { classifyPerpUnderlying } from "../perps-classify";
import { buildPerpsCsv, buildPerpsDailyCsv, PERPS_CSV_FILES } from "../perps-csv";
import { parseEquityPerpsFeeds, type PerpsFeeds } from "../perps-parse";
import {
  buildPerpsDeskModel,
  emptyPerpsSnapshotFile,
  mergePerpsDay,
  parsePerpsSnapshotFile,
  PERPS_SNAPSHOT_SCHEMA,
  type PerpsDaySnapshot,
} from "../perps-snapshot";
import {
  coingeckoMarketsNotFetched,
  coingeckoVenueSource,
  hip3DexSource,
  listPerpsSourceCatalog,
  PERPS_HELD_OUT,
  perpsDirectSpec,
} from "../perps-sources";
import { perpsTickerModel } from "../perps-ticker";
import { hip3Dex } from "../perps-meta";

function emptyFeeds(overrides: Partial<PerpsFeeds> = {}): PerpsFeeds {
  const skipped = { data: null, error: "skipped" };
  return {
    capturedAt: "2026-10-08T21:00:00.000Z",
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

function expectedSource(venue: string, source: string): string {
  const dex = hip3Dex(venue);
  if (dex) return hip3DexSource(dex);
  if (venue === "Hyperliquid HIP-3") return source;
  const row = listPerpsSourceCatalog().find((item) => item.venue === venue);
  if (!row) throw new Error(`No catalog row for ${venue}`);
  return row.source;
}

describe("equity perp methodology catalog", () => {
  it("uses the catalog strings when a feed errors", () => {
    const day = parseEquityPerpsFeeds(emptyFeeds());
    const names = new Set(day.venues.map((venue) => venue.venue));
    expect(names.has("Binance")).toBe(true);
    expect(names.has("Bybit")).toBe(true);
    expect(names.has("WEEX")).toBe(false);
    expect(names.has("Coinbase International")).toBe(false);
    for (const venue of day.venues) {
      if (venue.venue === "Hyperliquid HIP-3") {
        expect(venue.source).toBe('POST https://api.hyperliquid.xyz/info {"type":"perpDexs"}');
        expect(venue.tier).toBe(perpsDirectSpec("Hyperliquid HIP-3").tier);
        continue;
      }
      expect(venue.source).toBe(expectedSource(venue.venue, venue.source));
    }
    expect(perpsDirectSpec("Avantis").volumeWindow).toBe("unavailable");
    expect(perpsDirectSpec("Ostium").volumeWindow).toBe("lifetime");
    expect(listPerpsSourceCatalog().find((row) => row.venue === "Binance")?.feed).toBe("CoinGecko");
    expect(coingeckoVenueSource("Binance (Futures)")).toContain("api.coingecko.com");
    expect(PERPS_HELD_OUT).toEqual([]);
    expect(perpsDirectSpec("WEEX").source).toContain("api-contract.weex.com");
    expect(perpsDirectSpec("WEEX").tier).toBe("cex-direct");
    expect(perpsDirectSpec("Coinbase International").source).toContain("api.international.coinbase.com");
    expect(coingeckoMarketsNotFetched()).toEqual(["dYdX Chain", "Gate DEX"]);
  });

  it("classifies the names the ticker page treats as gaps", () => {
    expect(classifyPerpUnderlying("OPENAI")).toBe("preipo");
    expect(classifyPerpUnderlying("GLD")).toBe("etf-nonequity");
    expect(classifyPerpUnderlying("NVDA")).toBe("stock");
  });
});

describe("equity perp csv and ticker pages", () => {
  it("builds daily, venue, and ticker csv from a fixture day", () => {
    const day: PerpsDaySnapshot = {
      date: "2026-01-15",
      capturedAt: "2026-01-16T04:59:00.000Z",
      venues: [
        {
          venue: "OKX",
          tier: "cex-direct",
          source: perpsDirectSpec("OKX").source,
          volumeWindow: "rolling-24h",
          windowNote: perpsDirectSpec("OKX").note,
          capturedAt: "2026-01-16T04:59:00.000Z",
          error: null,
          credible: true,
          markets: [
            {
              symbol: "NVDA-USDT-SWAP",
              underlying: "NVDA",
              category: "stock",
              volume24hUsd: 80,
              openInterestUsd: 40,
              priceUsd: 100,
              fundingRate: 0.0001,
            },
          ],
        },
        {
          venue: "Binance",
          tier: "cex-coingecko",
          source: coingeckoVenueSource("Binance (Futures)"),
          volumeWindow: "rolling-24h",
          windowNote: "CoinGecko only.",
          capturedAt: "2026-01-16T04:59:00.000Z",
          error: null,
          credible: true,
          markets: [
            {
              symbol: "NVDAUSDT",
              underlying: "NVDA",
              category: "stock",
              volume24hUsd: 20,
              openInterestUsd: 10,
              priceUsd: 100,
              fundingRate: 0.0002,
            },
          ],
        },
      ],
    };
    const model = buildPerpsDeskModel(mergePerpsDay(emptyPerpsSnapshotFile(), day), Date.parse("2026-02-01T00:00:00.000Z") / 1000);
    const daily = buildPerpsDailyCsv(model);
    expect(daily.startsWith("date,headlineUsd,onchainUsd,binanceBybitUsd,majorCexUsd,longTailUsd,excludedUsd,leveragedEtfUsd,preipoUsd,closed\n")).toBe(true);
    expect(daily).toContain("2026-01-15,100,,20,80,,,,,true");
    const venues = buildPerpsCsv("venues", model);
    expect(venues.split("\n")[0]).toBe("date,venue,tier,credible,volumeUsd,openInterestUsd,marketCount,feed,source,volumeWindow,capturedAt");
    expect(venues).toContain("OKX,cex-direct,true,80,40,1,Direct API");
    expect(venues).toContain("Binance,cex-coingecko,true,20,10,1,CoinGecko");
    const tickers = buildPerpsCsv("tickers", model);
    expect(tickers).toContain("2026-01-15,NVDA,stock,100,50,,80,20,,100,");
    const page = perpsTickerModel(model, "nvda");
    expect(page.status).toBe("stored");
    expect(page.group).toBe("NVDA");
    expect(page.categoryLabel).toBe("Single stock");
    expect(page.latest?.onchainUsd ?? null).toBeNull();
    expect(page.latest?.cexDirectUsd).toBe(80);
    expect(page.latest?.cexCoingeckoUsd).toBe(20);
    expect(page.funding.map((row) => row.venue).sort()).toEqual(["Binance", "OKX"]);
    expect(perpsTickerModel(model, "ZZZNOTICKER").status).toBe("outside-cap");
    expect(perpsTickerModel(model, "OPENAI").status).toBe("preipo");
    expect(perpsTickerModel(model, "GLD").status).toBe("excluded");
    expect(page.points.length).toBeGreaterThan(0);
  });

  it("reads the stored file without pinning its size or latest date", () => {
    const raw = JSON.parse(readFileSync(join(process.cwd(), "data", "perps-snapshots", "perps.json"), "utf8")) as unknown;
    const file = parsePerpsSnapshotFile(raw);
    expect(file.schema).toBe(PERPS_SNAPSHOT_SCHEMA);
    expect(file.readError).toBeUndefined();
    const model = buildPerpsDeskModel(file, Date.now() / 1000);
    const daily = buildPerpsDailyCsv(model).trim().split("\n");
    expect(daily[0]).toBe(PERPS_CSV_FILES[0] ? "date,headlineUsd,onchainUsd,binanceBybitUsd,majorCexUsd,longTailUsd,excludedUsd,leveragedEtfUsd,preipoUsd,closed" : "");
    expect(daily.length).toBeGreaterThan(1);
    for (const line of daily.slice(1)) {
      expect(line.split(",")[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    const catalog = new Map(listPerpsSourceCatalog().map((row) => [row.venue, row.source]));
    for (const day of model.days) {
      for (const venue of day.venues) {
        expect(PERPS_HELD_OUT.some((row) => row.venue === venue.venue)).toBe(false);
        const dex = hip3Dex(venue.venue);
        if (dex) {
          expect(venue.source).toBe(hip3DexSource(dex));
          continue;
        }
        expect(catalog.get(venue.venue)).toBe(venue.source);
      }
    }
    const stored = model.days.flatMap((day) => day.tickers ?? []).find((ticker) => ticker.group.length > 0);
    expect(stored).toBeTruthy();
    if (stored) {
      const page = perpsTickerModel(model, stored.group);
      expect(page.status).toBe("stored");
      expect(page.points.length).toBeGreaterThan(0);
    }
    const alias = perpsTickerModel(model, "US500");
    if (alias.status === "stored") expect(alias.group).toBe("S&P 500 index");
  });
});
