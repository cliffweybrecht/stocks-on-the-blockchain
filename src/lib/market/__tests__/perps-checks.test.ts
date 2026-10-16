import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PERPS_CHANGELOG } from "../perps-changelog";
import { classifyPerpUnderlying, normPerpSymbol } from "../perps-classify";
import { compactPerpsDay, encodeCompactDay, parseCompactDay } from "../perps-compact";
import { perpsRowChecks, withPerpsChecks } from "../perps-checks";
import { parseEquityPerpsFeeds, type PerpsFeeds } from "../perps-parse";
import { coingeckoVenueSource } from "../perps-sources";
import {
  buildPerpsDeskModel,
  emptyPerpsSnapshotFile,
  mergePerpsDay,
  parsePerpsSnapshotFile,
  perpsAsOfLine,
  perpsHomeSummary,
  perpsSourceStamps,
  serializePerpsSnapshot,
  type PerpsDaySnapshot,
  type PerpsVenueSnapshot,
  type PerpsViewDay,
  type PerpsViewVenue,
} from "../perps-snapshot";
import type { PerpsArchiveCheck as ArchiveCheck } from "../perps-archive";

function emptyFeeds(overrides: Partial<PerpsFeeds> = {}): PerpsFeeds {
  const skipped = { data: null, error: "skipped" };
  return {
    capturedAt: "2026-10-15T03:59:00.000Z",
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

function stockVenue(
  name: string,
  tier: PerpsVenueSnapshot["tier"],
  source: string,
  volume: number | null,
  oi: number | null,
  capturedAt: string,
  extra: Partial<PerpsVenueSnapshot> = {},
): PerpsVenueSnapshot {
  return {
    venue: name,
    tier,
    source,
    volumeWindow: "rolling-24h",
    windowNote: "",
    capturedAt,
    error: null,
    markets:
      volume === null && oi === null
        ? []
        : [
            {
              symbol: "NVDA",
              underlying: "NVDA",
              category: "stock",
              volume24hUsd: volume,
              openInterestUsd: oi,
              priceUsd: 100,
            },
          ],
    ...extra,
  };
}

function day(date: string, venues: PerpsVenueSnapshot[], archive?: PerpsDaySnapshot["archive"]): PerpsDaySnapshot {
  return {
    date,
    capturedAt: `${date}T04:00:00.000Z`,
    venues,
    ...(archive ? { archive } : {}),
  };
}

function viewVenue(
  name: string,
  volume: number | null,
  oi: number | null,
  tier: PerpsViewVenue["tier"] = "cex-direct",
  source = "https://example.test/api",
  extra: Partial<PerpsViewVenue> = {},
): PerpsViewVenue {
  return {
    venue: name,
    tier,
    source,
    volumeWindow: "rolling-24h",
    windowNote: "",
    capturedAt: "2026-10-15T03:59:00.000Z",
    error: null,
    zeroFee: false,
    credible: true,
    excludeReason: null,
    chain: "",
    operator: "",
    onchainChain: null,
    markets: [],
    ...(volume === null && oi === null
      ? {}
      : { parts: { stock: { markets: 1, ...(volume === null ? {} : { volumeUsd: volume }), ...(oi === null ? {} : { openInterestUsd: oi }) } } }),
    ...extra,
  };
}

function viewDay(date: string, venues: PerpsViewVenue[], extra: Partial<PerpsViewDay> = {}): PerpsViewDay {
  return { date, t: 0, capturedAt: `${date}T04:00:00.000Z`, closed: true, venues, ...extra };
}

const archive: ArchiveCheck = {
  utcDate: "2026-10-13",
  binance: {
    volumeUsd: 100,
    openInterestUsd: null,
    coingeckoVolumeUsd: 132,
    coingeckoVenueUsd: 132,
    symbols: 6,
    covered: 6,
  },
  bybit: {
    volumeUsd: 100,
    openInterestUsd: null,
    coingeckoVolumeUsd: 200,
    coingeckoVenueUsd: 200,
    symbols: 6,
    covered: 4,
  },
  note: null,
};

describe("perps row checks", () => {
  it("flags swings, a vanished book, CoinGecko share, and archive variance without changing volumes", () => {
    const previous = viewDay("2026-10-14", [
      viewVenue("OKX", 100_000_000, 40_000_000),
      viewVenue("Gone", 20_000_000, 8_000_000, "long-tail", coingeckoVenueSource("Gone")),
    ]);
    const current = viewDay(
      "2026-10-15",
      [
        viewVenue("OKX", 160_000_000, 40_000_000),
        viewVenue("Gone", null, null, "long-tail", coingeckoVenueSource("Gone"), { quality: "fresh" }),
      ],
      { archive },
    );
    const before = current.venues.map((venue) => venue.parts?.stock?.volumeUsd ?? null);
    const checks = perpsRowChecks(current, previous);
    expect(current.venues.map((venue) => venue.parts?.stock?.volumeUsd ?? null)).toEqual(before);
    const text = checks.map((row) => row.text);
    expect(text).toContain("Headline +60% d/d: verify");
    expect(text).toContain("Major CEX +60% d/d: verify");
    expect(text).toContain("OKX +60% d/d: verify");
    expect(text).toContain("Gone volume missing vs the prior day: verify");
    expect(text).toContain("Gone open interest missing vs the prior day: verify");
    expect(text).toContain("Binance CoinGecko vs archive +32%: verify");
    expect(text.some((row) => row.startsWith("Bybit"))).toBe(false);
    expect(checks.length).toBeLessThanOrEqual(12);
    const share = perpsRowChecks(
      viewDay("2026-10-15", [
        viewVenue("OKX", 20_000_000, 10_000_000),
        viewVenue("Binance", 80_000_000, 20_000_000, "cex-coingecko", coingeckoVenueSource("Binance (Futures)")),
      ]),
      viewDay("2026-10-14", [
        viewVenue("OKX", 80_000_000, 20_000_000),
        viewVenue("Binance", 20_000_000, 10_000_000, "cex-coingecko", coingeckoVenueSource("Binance (Futures)")),
      ]),
    );
    expect(share.map((row) => row.text)).toContain("CoinGecko share 20% → 80%: verify");
    const zero = perpsRowChecks(
      viewDay("2026-10-15", [viewVenue("OKX", 0, 0)]),
      viewDay("2026-10-14", [viewVenue("OKX", 20_000_000, 8_000_000)]),
    );
    expect(zero.map((row) => row.text)).toContain("OKX volume is zero vs the prior day: verify");
    expect(zero.map((row) => row.text)).toContain("OKX open interest is zero vs the prior day: verify");
  });

  it("does not flag a stale blank or a no-equity book, and skips swings without a prior day", () => {
    const previous = viewDay("2026-10-14", [
      viewVenue("OKX", 20_000_000, 8_000_000),
      viewVenue("Quiet", 12_000_000, 6_000_000, "onchain", "https://api.hyperliquid.xyz/info", { noEquity: true }),
    ]);
    const current = viewDay("2026-10-15", [
      viewVenue("OKX", null, null, "cex-direct", "https://example.test/api", { quality: "stale", error: "down" }),
      viewVenue("Quiet", null, null, "onchain", "https://api.hyperliquid.xyz/info", { noEquity: true }),
    ]);
    expect(perpsRowChecks(current, previous).map((row) => row.code)).toEqual([]);
    const onlyArchive = perpsRowChecks(viewDay("2026-10-15", [viewVenue("OKX", 1, 1)], { archive }), null);
    expect(onlyArchive.map((row) => row.text)).toEqual(["Binance CoinGecko vs archive +32%: verify"]);
  });

  it("stores an empty list when the watchdog ran clean and omits ck on older rows", () => {
    const venue = viewVenue("OKX", 10_000_000, 5_000_000);
    const checks = perpsRowChecks(viewDay("2026-10-15", [venue]), viewDay("2026-10-14", [venue]));
    expect(checks).toEqual([]);
    const captured = "2026-10-16T03:59:00.000Z";
    const base = day("2026-10-15", [
      stockVenue("OKX", "cex-direct", "https://www.okx.com/api/v5/market/tickers?instType=SWAP", 10_000_000, 5_000_000, captured),
    ]);
    const encoded = encodeCompactDay(compactPerpsDay({ ...base, checks: [] }));
    expect(encoded.ck).toEqual([]);
    expect(parseCompactDay(encoded)?.checks).toEqual([]);
    const plain = encodeCompactDay(compactPerpsDay(base));
    expect("ck" in plain).toBe(false);
    expect(parseCompactDay(plain)?.checks).toBeUndefined();
  });

  it("keeps the stored perps file byte-identical and attaches checks only on a new save", () => {
    const text = readFileSync(join(process.cwd(), "data", "perps-snapshots", "perps.json"), "utf8");
    const parsed = parsePerpsSnapshotFile(JSON.parse(text));
    expect(serializePerpsSnapshot(parsed)).toBe(text);
    // Rows written before the watchdog omit checks. A later save stores the list,
    // including an empty list when the watchdog ran clean.
    expect(parsed.records.filter((row) => row.date < "2026-10-15").every((row) => row.checks === undefined)).toBe(true);
    expect(parsed.records.find((row) => row.date === "2026-10-15")?.checks).toEqual([]);
  });

  it("drops the check list when the comparison throws and still returns the day", () => {
    const incoming = day("not-a-date", []);
    const saved = withPerpsChecks(incoming, emptyPerpsSnapshotFile());
    expect(saved).toBe(incoming);
    expect(saved.checks).toBeUndefined();
  });

  it("writes flags from the same headline the desk uses", () => {
    const captured = "2026-10-16T03:59:00.000Z";
    const prior = day("2026-10-14", [
      stockVenue("OKX", "cex-direct", "https://www.okx.com/api/v5/market/tickers?instType=SWAP", 100_000_000, 40_000_000, "2026-10-15T03:59:00.000Z"),
    ]);
    const next = day("2026-10-15", [
      stockVenue("OKX", "cex-direct", "https://www.okx.com/api/v5/market/tickers?instType=SWAP", 160_000_000, 40_000_000, captured),
      stockVenue("Binance", "cex-coingecko", coingeckoVenueSource("Binance (Futures)"), 0, 0, captured),
    ]);
    const file = mergePerpsDay(emptyPerpsSnapshotFile(), prior);
    const checked = withPerpsChecks(next, file);
    expect(checked.venues[0]?.markets[0]?.volume24hUsd).toBe(160_000_000);
    expect(checked.checks?.some((row) => row.text === "OKX +60% d/d: verify")).toBe(true);
    const model = buildPerpsDeskModel(mergePerpsDay(file, checked), Date.parse("2026-10-16T16:00:00.000Z") / 1000);
    const latest = model.days.find((row) => row.date === "2026-10-15");
    expect(latest?.checks?.some((row) => row.text === "OKX +60% d/d: verify")).toBe(true);
    const home = perpsHomeSummary(model);
    expect(home.asOf).toContain("Eastern day 2026-10-15");
    expect(home.asOf).toContain("closed snapshot");
    expect(home.sources.map((row) => row.name)).toEqual(["Direct API", "CoinGecko"]);
  });
});

describe("OKX and Lighter funding", () => {
  it("stores OKX equity funding hours from one bulk payload and ignores crypto swaps", () => {
    const start = 1_700_000_000_000;
    const daySnap = parseEquityPerpsFeeds(
      emptyFeeds({
        okx: {
          error: null,
          oiError: null,
          instruments: {
            data: [
              { instId: "NVDA-USDT-SWAP", instCategory: "3" },
              { instId: "BTC-USDT-SWAP", instCategory: "1" },
            ],
          },
          tickers: {
            data: [
              { instId: "NVDA-USDT-SWAP", last: "100", volCcy24h: "10" },
              { instId: "BTC-USDT-SWAP", last: "60000", volCcy24h: "2" },
            ],
          },
          openInterest: { data: [{ instId: "NVDA-USDT-SWAP", oiUsd: "50" }] },
          funding: {
            data: [
              { instId: "NVDA-USDT-SWAP", fundingRate: "0", fundingTime: String(start), nextFundingTime: String(start + 8 * 3_600_000) },
              { instId: "BTC-USDT-SWAP", fundingRate: "0.0004", fundingTime: String(start), nextFundingTime: String(start + 8 * 3_600_000) },
            ],
          },
          fundingError: null,
        },
      }),
    );
    const markets = daySnap.venues.find((venue) => venue.venue === "OKX")?.markets ?? [];
    expect(markets.map((row) => row.underlying)).toEqual(["NVDA"]);
    expect(markets[0]?.fundingRate).toBe(0);
    expect(markets[0]?.fundingIntervalHours).toBe(8);
  });

  it("leaves OKX unannualized when the funding request fails", () => {
    const daySnap = parseEquityPerpsFeeds(
      emptyFeeds({
        okx: {
          error: null,
          oiError: null,
          instruments: { data: [{ instId: "NVDA-USDT-SWAP", instCategory: "3" }] },
          tickers: { data: [{ instId: "NVDA-USDT-SWAP", last: "100", volCcy24h: "10" }] },
          openInterest: { data: [] },
          funding: null,
          fundingError: "HTTP 500",
        },
      }),
    );
    const market = daySnap.venues.find((venue) => venue.venue === "OKX")?.markets[0];
    expect(market?.underlying).toBe("NVDA");
    expect(market?.fundingRate).toBeUndefined();
    expect(market?.fundingIntervalHours).toBeUndefined();
  });

  it("stores Lighter's own rate with no interval and ignores other exchanges on that list", () => {
    const daySnap = parseEquityPerpsFeeds(
      emptyFeeds({
        gate: {
          error: null,
          tickers: [{ contract: "NVDA_USDT", mark_price: "200", volume_24h_quote: "500", total_size: "1" }],
          contracts: [{ name: "NVDA_USDT", contract_type: "stocks", quanto_multiplier: "1", funding_interval: 28800 }],
        },
        lighter: {
          error: null,
          data: {
            order_book_details: [
              { symbol: "NVDA", status: "active", mark_price: "200", daily_quote_token_volume: "1000", open_interest: "2" },
            ],
          },
        },
        lighterRobinhood: {
          error: null,
          data: {
            order_book_details: [
              { symbol: "NVDA", status: "active", mark_price: "200", daily_quote_token_volume: "400", open_interest: "1" },
            ],
          },
        },
        lighterFunding: {
          error: null,
          data: {
            funding_rates: [
              { market_id: 110, exchange: "lighter", symbol: "NVDA", rate: 0.000032 },
              { market_id: 110, exchange: "binance", symbol: "NVDA", rate: 0.01 },
            ],
          },
        },
      }),
    );
    const lighter = daySnap.venues.find((venue) => venue.venue === "Lighter")?.markets[0];
    const robinhood = daySnap.venues.find((venue) => venue.venue === "Lighter on Robinhood Chain")?.markets[0];
    expect(lighter?.fundingRate).toBe(0.000032);
    expect(lighter?.fundingIntervalHours).toBeUndefined();
    expect(robinhood?.fundingRate).toBeUndefined();
    expect(normPerpSymbol("ZHIPUHKD_USDT")).toBe("ZHIPUHKD");
    expect(normPerpSymbol("ZHIPU_USDT")).toBe("ZHIPU");
    expect(classifyPerpUnderlying("ZHIPUHKD")).toBe("stock");
  });
});

describe("freshness and changelog", () => {
  it("groups last-updated by Hyperliquid, direct APIs, and CoinGecko", () => {
    const stamps = perpsSourceStamps([
      {
        venue: "Hyperliquid HIP-3 (xyz)",
        source: "https://api.hyperliquid.xyz/info",
        capturedAt: "2026-10-16T03:59:00.000Z",
        error: null,
        quality: "fresh",
      },
      {
        venue: "OKX",
        source: "https://www.okx.com/api/v5/market/tickers?instType=SWAP",
        capturedAt: "2026-10-16T03:59:00.000Z",
        error: "down",
        quality: "stale",
        lastGoodAt: "2026-10-15T03:59:00.000Z",
      },
      {
        venue: "Binance",
        source: coingeckoVenueSource("Binance (Futures)"),
        capturedAt: "2026-10-16T03:59:00.000Z",
        error: null,
        quality: "fresh",
      },
    ]);
    expect(stamps.map((row) => row.name)).toEqual(["Hyperliquid", "Direct API", "CoinGecko"]);
    expect(stamps[0]?.line).toContain("Hyperliquid updated");
    expect(stamps[1]?.line).toContain("Direct API last good");
    expect(stamps[1]?.line).toContain("1 stale");
    expect(stamps[2]?.line).toContain("CoinGecko updated");
    expect(perpsAsOfLine({ capturedAt: "2026-10-16T03:59:00.000Z", date: "2026-10-15", closed: true })).toContain(
      "closed snapshot",
    );
  });

  it("documents checks, OKX, Lighter, ZHIPUHKD, and freshness", () => {
    const ids = PERPS_CHANGELOG.map((entry) => entry.id);
    expect(ids).toEqual(expect.arrayContaining(["checks", "okx-interval", "lighter-rate", "zhipuhkd", "freshness"]));
  });
});
