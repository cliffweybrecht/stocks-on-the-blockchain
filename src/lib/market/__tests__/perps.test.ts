import { describe, expect, it } from "vitest";
import { classifyPerpUnderlying, normPerpSymbol } from "../perps-classify";
import { hyperliquidEtDayNotional, matchUntaggedPerp, parseEquityPerpsFeeds, type PerpsFeeds } from "../perps-parse";
import {
  buildPerpsDeskModel,
  mergePerpsDay,
  parsePerpsSnapshotFile,
  perpsExcludeReason,
  selectPerpsRange,
  serializePerpsSnapshot,
  PERPS_SNAPSHOT_SCHEMA,
  type PerpsDaySnapshot,
  type PerpsSnapshotFile,
} from "../perps-snapshot";
import { assertAppendOnlySnapshot } from "../snapshot-land";
import { volumeSnapshotChain } from "../snapshot-land";

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

  it("keeps equity-perps-v1 and leaves a failed volume/OI screen out of the headline", () => {
    expect(perpsExcludeReason(26, 1)).toMatch(/×/);
    expect(perpsExcludeReason(25, 1)).toBeNull();
    expect(perpsExcludeReason(100_000_001, 4_999_999)).toMatch(/\$5M/);
    expect(perpsExcludeReason(50_000_000, null)).toBeNull();
    const legacy = parsePerpsSnapshotFile({
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
    });
    expect(legacy.schema).toBe(PERPS_SNAPSHOT_SCHEMA);
    expect(legacy.records[0]?.venues[0]?.credible).toBe(true);
    const next = parsePerpsSnapshotFile(JSON.parse(serializePerpsSnapshot(legacy)));
    expect(next.schema).toBe("equity-perps-v1");
    const landed = assertAppendOnlySnapshot(legacy, {
      schema: "equity-perps-v1",
      records: [
        ...legacy.records,
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
              markets: [
                {
                  symbol: "NVDA",
                  underlying: "NVDA",
                  category: "stock",
                  volume24hUsd: 12,
                  openInterestUsd: 4,
                  fundingRate: 0.0001,
                  priceUsd: 100,
                },
              ],
            },
          ],
        },
      ],
    });
    expect(landed.ok).toBe(true);
  });
});
