import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatUsdCompact } from "../format";
import { classifyPerpUnderlying, normPerpSymbol } from "../perps-classify";
import { hyperliquidEtDayNotional, matchUntaggedPerp, parseEquityPerpsFeeds, type PerpsFeeds } from "../perps-parse";
import {
  assertPerpsLandSnapshot,
  buildPerpsDeskModel,
  mergePerpsDay,
  parsePerpsSnapshotFile,
  perpsExcludeReason,
  perpsHomeSummary,
  selectPerpsRange,
  serializePerpsSnapshot,
  PERPS_SNAPSHOT_SCHEMA,
  type PerpsDaySnapshot,
  type PerpsRangeView,
  type PerpsSnapshotFile,
} from "../perps-snapshot";
import { assertAppendOnlySnapshot, volumeSnapshotChain } from "../snapshot-land";
import { easternDayKey, utcInstantForDayKey } from "../volume-snapshots";

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

function expectCompactMatches(day: PerpsDaySnapshot, nowUnixSeconds: number) {
  const raw = buildPerpsDeskModel({ schema: PERPS_SNAPSHOT_SCHEMA, records: [day] }, nowUnixSeconds);
  const stored = parsePerpsSnapshotFile(JSON.parse(serializePerpsSnapshot({ schema: PERPS_SNAPSHOT_SCHEMA, records: [day] })));
  const compact = buildPerpsDeskModel(stored, nowUnixSeconds);
  const fields = [
    "headlineUsd",
    "onchainUsd",
    "cexDirectUsd",
    "cexCoingeckoUsd",
    "longTailUsd",
    "excludedUsd",
    "leveragedUsd",
    "preipoUsd",
    "venueCount",
    "marketCount",
  ] as const;
  for (const leveraged of [false, true]) {
    for (const tail of [false, true]) {
      const left = selectPerpsRange(raw.days, "24h", leveraged, tail);
      const right = selectPerpsRange(compact.days, "24h", leveraged, tail);
      for (const field of fields) expect(right[field], field).toBe(left[field]);
      expect(right.venues.map(venueIdentity)).toEqual(left.venues.map(venueIdentity));
      expect(right.underlyings).toEqual(left.underlyings);
      expect(right.onchainUnderlyings).toEqual(left.onchainUnderlyings);
      expect(right.categories).toEqual(left.categories);
      expect(right.chains).toEqual(left.chains);
      expect(right.builders).toEqual(left.builders);
      expect(right.fundingVenues).toEqual(left.fundingVenues);
      expect(right.funding).toEqual(left.funding);
    }
  }
}

function venueIdentity(row: PerpsRangeView["venues"][number]) {
  return [row.venue, row.tier, row.volumeUsd, row.openInterestUsd, row.marketCount, row.credible, row.excludeReason];
}

function hlBook() {
  return [
    {
      universe: [
        { name: "xyz:NVDA" },
        { name: "xyz:XAU" },
        { name: "xyz:TQQQ" },
        { name: "xyz:XYZ100" },
      ],
    },
    [
      { markPx: "100", openInterest: "2", dayNtlVlm: "1000", dayBaseVlm: "10" },
      { markPx: "2400", openInterest: "1", dayNtlVlm: "9000", dayBaseVlm: "4" },
      { markPx: "50", openInterest: "3", dayNtlVlm: "250", dayBaseVlm: "5" },
      { markPx: "20000", openInterest: "1", dayNtlVlm: "400", dayBaseVlm: "0.02" },
    ],
  ];
}

describe("equity perp classification", () => {
  it("normalizes venue symbols and splits leveraged ETFs from single stocks", () => {
    expect(normPerpSymbol("xyz:NVDA")).toBe("NVDA");
    expect(normPerpSymbol("NVIDIA-USDT-SWAP")).toBe("NVDA");
    expect(normPerpSymbol("PF_TSLAUSD")).toBe("TSLA");
    expect(classifyPerpUnderlying("NVDA")).toBe("stock");
    expect(classifyPerpUnderlying("SPY")).toBe("etf");
    expect(classifyPerpUnderlying("TQQQ")).toBe("leveraged-etf");
    expect(classifyPerpUnderlying("CSOPSKHYNIX2L")).toBe("leveraged-etf");
    expect(classifyPerpUnderlying("US500")).toBe("index");
    expect(classifyPerpUnderlying("XAU")).toBe("nonequity");
    expect(classifyPerpUnderlying("XTI")).toBe("nonequity");
    expect(classifyPerpUnderlying("GLD")).toBe("etf-nonequity");
    expect(classifyPerpUnderlying("OPENAI")).toBe("preipo");
    expect(classifyPerpUnderlying("SPCX")).toBe("preipo");
    expect(normPerpSymbol("SPCXUSD1")).toBe("SPCX");
    expect(normPerpSymbol("POLYMARKETUSD1")).toBe("POLYMARKET");
    expect(normPerpSymbol("AAPL-SWAP-USDT")).toBe("AAPL");
    expect(normPerpSymbol("NVDA-USD-PERP")).toBe("NVDA");
  });

  it("keeps a ticker only when the mark agrees with the tagged-venue median", () => {
    const reference = {
      prices: new Map([["NVDA", 100]]),
      set: new Set(["NVDA", "US500"]),
    };
    expect(matchUntaggedPerp("NVDAUSDT", 110, reference)?.underlying).toBe("NVDA");
    expect(matchUntaggedPerp("NVDAUSDT", 20, reference)).toBeNull();
    expect(matchUntaggedPerp("US500", null, reference)?.category).toBe("index");
    expect(matchUntaggedPerp("DOGEUSDT", 0.1, reference)).toBeNull();
  });

  it("does not turn Hyperliquid base-size candles into a USD ET-day total", () => {
    expect(
      hyperliquidEtDayNotional([
        { t: 1, v: "46.4", c: "30759.0", o: "30700", h: "30800", l: "30600" },
      ]),
    ).toBeNull();
  });
});

describe("equity perp snapshot", () => {
  it("drops non-equity names and price mismatches, and keeps long-tail CoinGecko out of the headline", () => {
    const day = parseEquityPerpsFeeds(
      emptyFeeds({
        hyperliquid: { dexs: [{ dex: "xyz", book: hlBook(), error: null }], error: null },
        lighter: {
          error: null,
          data: {
            order_book_details: [
              { symbol: "NVDA", status: "active", mark_price: "102", open_interest: "1", daily_quote_token_volume: "30" },
              { symbol: "NVDA", status: "active", mark_price: "10", open_interest: "1", daily_quote_token_volume: "999" },
              { symbol: "DOGE", status: "active", mark_price: "0.2", open_interest: "1", daily_quote_token_volume: "50" },
            ],
          },
        },
        coingecko: {
          error: null,
          data: [
            { market: "Tapbit (Futures)", contract_type: "perpetual", symbol: "NVDA", price: "100", volume_24h: "999999", open_interest: "400000" },
            { market: "Deepcoin (Derivatives)", contract_type: "perpetual", symbol: "NVDA", price: "100", volume_24h: "200000000", open_interest: "1000000" },
            { market: "Hyperliquid (Futures)", contract_type: "perpetual", symbol: "NVDA", price: "100", volume_24h: "5000000000", open_interest: "1000000000" },
            { market: "Binance (Futures)", contract_type: "perpetual", index_id: "NVDAUSDT", price: "101", volume_24h: "40", open_interest: "5" },
            { market: "Bybit (Futures)", contract_type: "perpetual", symbol: "GOLDUSDT", price: "2400", volume_24h: "80", open_interest: "1" },
            { market: "OKX (Futures)", contract_type: "perpetual", symbol: "NVDAUSDT", price: "100", volume_24h: "70", open_interest: "1" },
          ],
        },
        ostium: {
          error: null,
          data: {
            pairs: [
              {
                symbol: "NVDA/USD",
                from: "NVDA",
                group: { name: "stocks" },
                lastTradePrice: 100,
                longOIInUnits: 1,
                shortOIInUnits: 1,
                volumeInUsd: 5000,
              },
            ],
          },
        },
      }),
    );

    expect(day.date).toBe("2026-10-08");
    const hl = day.venues.find((venue) => venue.venue === "Hyperliquid HIP-3 (xyz)");
    expect(hl?.markets.map((market) => market.underlying).sort()).toEqual(["NVDA", "TQQQ", "XYZ100"]);
    expect(hl?.markets.find((market) => market.underlying === "NVDA")?.volume24hUsd).toBe(1000);
    expect(hl?.markets.find((market) => market.underlying === "XAU")).toBeUndefined();

    const lighter = day.venues.find((venue) => venue.venue === "Lighter");
    expect(lighter?.markets).toHaveLength(1);
    expect(lighter?.markets[0]?.volume24hUsd).toBe(30);

    const binance = day.venues.find((venue) => venue.venue === "Binance");
    expect(binance?.tier).toBe("cex-coingecko");
    expect(binance?.markets.map((market) => market.underlying)).toEqual(["NVDA"]);
    const tapbit = day.venues.find((venue) => venue.venue === "Tapbit");
    expect(tapbit?.tier).toBe("long-tail");
    expect(tapbit?.credible).toBe(true);
    expect(tapbit?.markets[0]?.volume24hUsd).toBe(999999);
    const deepcoin = day.venues.find((venue) => venue.venue === "Deepcoin");
    expect(deepcoin?.credible).toBe(false);
    expect(day.venues.some((venue) => venue.venue.includes("Hyperliquid") && venue.venue !== "Hyperliquid HIP-3 (xyz)")).toBe(false);
    expect(binance?.markets.some((market) => market.volume24hUsd === 70)).toBe(false);

    const ostium = day.venues.find((venue) => venue.venue === "Ostium");
    expect(ostium?.markets[0]?.volume24hUsd).toBeNull();
    expect(ostium?.markets[0]?.lifetimeVolumeUsd).toBe(5000);

    const model = buildPerpsDeskModel({ schema: "equity-perps-v1", records: [day] }, Date.parse("2026-10-09T16:00:00.000Z") / 1000);
    const view = selectPerpsRange(model.days, "24h", false);
    expect(view.openDay).toBe(false);
    expect(view.headlineUsd).toBe(1000 + 250 + 400 + 30 + 40);
    expect(view.onchainUsd).toBe(1000 + 250 + 400 + 30);
    expect(view.cexCoingeckoUsd).toBe(40);
    expect(view.longTailUsd).toBe(999999);
    expect(view.includeLongTail).toBe(false);
    const withTail = selectPerpsRange(model.days, "24h", false, true);
    expect(withTail.headlineUsd).toBe(1000 + 250 + 400 + 30 + 40 + 999999);
    const hidden = selectPerpsRange(model.days, "24h", true);
    expect(hidden.headlineUsd).toBe(1000 + 400 + 30 + 40);
    expect(hidden.leveragedUsd).toBe(250);
    expectCompactMatches(day, Date.parse("2026-10-09T16:00:00.000Z") / 1000);
  });

  it("shows an Ostium daily diff only across consecutive Eastern snapshots", () => {
    const day = (date: string, lifetime: number): PerpsDaySnapshot => ({
      date,
      capturedAt: `${date}T04:00:00.000Z`,
      venues: [
        {
          venue: "Ostium",
          tier: "onchain",
          source: "https://builder.prod.bedrock.ostium.io/v1/pairs",
          volumeWindow: "lifetime",
          windowNote: "lifetime",
          capturedAt: `${date}T04:00:00.000Z`,
          error: null,
          markets: [
            {
              symbol: "NVDA/USD",
              underlying: "NVDA",
              category: "stock",
              volume24hUsd: null,
              openInterestUsd: 10,
              lifetimeVolumeUsd: lifetime,
              priceUsd: 100,
            },
          ],
        },
      ],
    });
    const file: PerpsSnapshotFile = {
      schema: "equity-perps-v1",
      records: [day("2026-10-06", 1000), day("2026-10-08", 1800)],
    };
    const gapped = buildPerpsDeskModel(file, Date.parse("2026-10-09T16:00:00.000Z") / 1000);
    const gapView = selectPerpsRange(gapped.days, "24h", false);
    expect(gapView.headlineUsd).toBeNull();

    const consecutive = buildPerpsDeskModel(
      mergePerpsDay(file, day("2026-10-07", 1400)),
      Date.parse("2026-10-09T16:00:00.000Z") / 1000,
    );
    const latest = selectPerpsRange(consecutive.days, "24h", false);
    expect(latest.headlineUsd).toBe(400);
    const week = selectPerpsRange(consecutive.days, "7d", false);
    expect(week.headlineUsd).toBe(400 + 400);
    expect(volumeSnapshotChain("perps")?.label).toBe("Perps");
  });

  it("shows an in-progress Eastern capture on 24H and leaves 7D empty", () => {
    const day: PerpsDaySnapshot = {
      date: "2026-10-08",
      capturedAt: "2026-10-08T21:49:00.000Z",
      venues: [
        {
          venue: "OKX",
          tier: "cex-direct",
          source: "https://www.okx.com",
          volumeWindow: "rolling-24h",
          windowNote: "rolling",
          capturedAt: "2026-10-08T21:49:00.000Z",
          error: null,
          markets: [
            {
              symbol: "NVDA-USDT-SWAP",
              underlying: "NVDA",
              category: "stock",
              volume24hUsd: 10,
              openInterestUsd: null,
              priceUsd: 100,
            },
          ],
        },
      ],
    };
    const model = buildPerpsDeskModel(
      { schema: "equity-perps-v1", records: [day] },
      Date.parse("2026-10-08T21:49:00.000Z") / 1000,
    );
    expect(model.days[0]?.closed).toBe(false);
    const live = selectPerpsRange(model.days, "24h", false);
    expect(live.openDay).toBe(true);
    expect(live.headlineUsd).toBe(10);
    const week = selectPerpsRange(model.days, "7d", false);
    expect(week.headlineUsd).toBeNull();
    expect(week.caption).toMatch(/no closed Eastern day/);
    expect(week.caption).not.toMatch(/No equity-perp snapshot yet/);
  });

  it("migrates equity-perps-v1 into compact v2 and leaves a failed volume/OI screen out of the headline", () => {
    expect(perpsExcludeReason(26, 1)).toMatch(/×/);
    expect(perpsExcludeReason(25, 1)).toBeNull();
    expect(perpsExcludeReason(100_000_001, 4_999_999)).toMatch(/\$5M/);
    expect(perpsExcludeReason(50_000_000, null)).toBeNull();
    const v1 = {
      schema: "equity-perps-v1",
      records: [
        {
          date: "2026-10-07",
          capturedAt: "2026-10-08T03:59:00.000Z",
          venues: [
            {
              venue: "OKX",
              tier: "cex-direct",
              source: "https://www.okx.com",
              volumeWindow: "rolling-24h",
              windowNote: "",
              capturedAt: "2026-10-08T03:59:00.000Z",
              error: null,
              markets: [
                { symbol: "NVDA", underlying: "NVDA", category: "stock", volume24hUsd: 10, openInterestUsd: 5, priceUsd: 100 },
              ],
            },
          ],
        },
      ],
    };
    const legacy = parsePerpsSnapshotFile(v1);
    expect(legacy.schema).toBe(PERPS_SNAPSHOT_SCHEMA);
    expect(legacy.schema).toBe("equity-perps-v2");
    expect(legacy.records[0]?.venues[0]?.credible).toBe(true);
    expect(legacy.records[0] && "tickers" in legacy.records[0]).toBe(true);
    const next = parsePerpsSnapshotFile(JSON.parse(serializePerpsSnapshot(legacy)));
    expect(next.schema).toBe("equity-perps-v2");
    expect(JSON.parse(serializePerpsSnapshot(next))).toEqual(JSON.parse(serializePerpsSnapshot(legacy)));
    const stored = JSON.parse(serializePerpsSnapshot(legacy)) as { schema: string; records: unknown[] };
    const landed = assertAppendOnlySnapshot(stored, {
      schema: "equity-perps-v2",
      records: [
        ...stored.records,
        {
          date: "2026-10-08",
          capturedAt: "2026-10-09T03:59:00.000Z",
          venues: [],
          tickers: [],
        },
      ],
    });
    expect(landed.ok).toBe(true);

    const migrated = assertPerpsLandSnapshot(v1, {
      ...JSON.parse(serializePerpsSnapshot(legacy)),
      records: [
        ...JSON.parse(serializePerpsSnapshot(legacy)).records,
        {
          date: "2026-10-08",
          capturedAt: "2026-10-09T03:59:00.000Z",
          venues: [
            {
              venue: "Tapbit",
              tier: "long-tail",
              source: "https://api.coingecko.com",
              volumeWindow: "rolling-24h",
              windowNote: "",
              capturedAt: "2026-10-09T03:59:00.000Z",
              error: null,
              credible: true,
              excludeReason: null,
              parts: { stock: { volumeUsd: 12, openInterestUsd: 4, markets: 1, fundingVolumeUsd: 12 } },
            },
          ],
          tickers: [
            {
              group: "NVDA",
              category: "stock",
              tiers: { "long-tail": { volumeUsd: 12, openInterestUsd: 4, venues: ["Tapbit"] } },
              funding: { Tapbit: 0.0001 },
            },
          ],
        },
      ],
    });
    expect(migrated.ok).toBe(true);
    if (migrated.ok) expect(migrated.added).toEqual(["2026-10-08"]);

    const rewritten = assertPerpsLandSnapshot(legacy, {
      schema: "equity-perps-v2",
      records: [
        {
          date: "2026-10-07",
          capturedAt: "2026-10-08T03:59:00.000Z",
          venues: [],
          tickers: [],
        },
        {
          date: "2026-10-08",
          capturedAt: "2026-10-09T03:59:00.000Z",
          venues: [],
          tickers: [],
        },
      ],
    });
    expect(rewritten.ok).toBe(false);
  });

  it("renders the migrated 2026-10-08 row from the compact file", () => {
    const text = readFileSync(join(process.cwd(), "data", "perps-snapshots", "perps.json"), "utf8");
    const parsed = parsePerpsSnapshotFile(JSON.parse(text));
    expect(parsed.schema).toBe("equity-perps-v2");
    expect(parsed.readError).toBeUndefined();
    expect(Buffer.byteLength(text)).toBeLessThan(80_000 * parsed.records.length);
    const dates = parsed.records.map((row) => row.date);
    expect(dates[0]).toBe("2026-10-08");
    expect(dates.at(-1)! >= "2026-10-10").toBe(true);
    expect(new Set(dates).size).toBe(dates.length);
    for (let index = 1; index < dates.length; index += 1) {
      expect(dates[index]! > dates[index - 1]!).toBe(true);
      expect(easternDayKey(utcInstantForDayKey(dates[index - 1]!) + 26 * 3600)).toBe(dates[index]);
    }
    expect(parsed.records[0]?.venues).toHaveLength(60);
    expect(serializePerpsSnapshot(parsed)).toBe(text);
    const model = buildPerpsDeskModel(parsed, Date.parse("2026-10-09T16:00:00.000Z") / 1000);
    const view = selectPerpsRange(model.days, "24h", false, false);
    expect(formatUsdCompact(view.headlineUsd)).toBe("$26.1B");
    expect(formatUsdCompact(view.onchainUsd)).toBe("$5.4B");
    expect(formatUsdCompact(view.cexDirectUsd)).toBe("$9.4B");
    expect(formatUsdCompact(view.cexCoingeckoUsd)).toBe("$11.3B");
    expect(formatUsdCompact(view.longTailUsd)).toBe("$11.6B");
    expect(formatUsdCompact(view.excludedUsd)).toBe("$14.5B");
    expect(formatUsdCompact(view.preipoUsd)).toBe("$3.0B");
    expect(view.venueCount).toBe(42);
    expect(view.marketCount).toBe(4866);
    expect(view.underlyings[0]).toMatchObject({ group: "SOXL", venueCount: 30 });
    expect(view.onchainUnderlyings[0]?.group).toBe("Nasdaq-100 index");
    expect(view.builders[0]).toMatchObject({ dex: "xyz", marketCount: 98 });
    expect(view.chains[0]?.chain).toBe("Hyperliquid L1");
    expect(view.funding[0]?.group).toBe("SOXL");
    expect(view.fundingVenues[0]).toBe("Binance");
    expect(formatUsdCompact(selectPerpsRange(model.days, "24h", true, false).headlineUsd)).toBe("$20.4B");
    expect(formatUsdCompact(selectPerpsRange(model.days, "24h", false, true).headlineUsd)).toBe("$37.7B");
    const home = perpsHomeSummary(model);
    expect(home.hasSnapshot).toBe(true);
    expect(formatUsdCompact(home.totalUsd)).toBe("$26.1B");
    expect(home.venueCount).toBe(42);
    expect(home.marketCount).toBe(4866);
  });
});
