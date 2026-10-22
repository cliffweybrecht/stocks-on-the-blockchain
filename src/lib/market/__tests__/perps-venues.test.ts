import { describe, expect, it } from "vitest";
import { parseEquityPerpsFeeds, type PerpsFeeds } from "../perps-parse";
import { buildPerpsDeskModel, PERPS_SNAPSHOT_SCHEMA, selectPerpsRange } from "../perps-snapshot";
import { PERPS_NAMED_OUTLIERS } from "../perps-sources";

function emptyFeeds(overrides: Partial<PerpsFeeds> = {}): PerpsFeeds {
  const skipped = { data: null, error: "skipped" };
  return {
    capturedAt: "2026-10-20T16:00:00.000Z",
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

function hlNvda(price = "100") {
  return {
    dexs: [
      {
        dex: "xyz",
        book: [{ universe: [{ name: "xyz:NVDA" }] }, [{ markPx: price, openInterest: "1", dayNtlVlm: "10" }]],
        error: null,
      },
    ],
    error: null,
  };
}

function headline(feeds: PerpsFeeds, includeUnverified = false) {
  const day = parseEquityPerpsFeeds(feeds);
  const model = buildPerpsDeskModel({ schema: PERPS_SNAPSHOT_SCHEMA, records: [day] }, Date.parse(feeds.capturedAt) / 1000);
  return { day, view: selectPerpsRange(model.days, "24h", false, false, includeUnverified) };
}

describe("added equity perp adapters", () => {
  it("keeps Zoomex turnover as quote USD and reads fundingInterval as minutes", () => {
    const { day, view } = headline(
      emptyFeeds({
        zoomex: {
          error: null,
          tickers: {
            result: {
              list: [
                {
                  symbol: "NVDAUSDT",
                  markPrice: "100",
                  turnover24h: "1000",
                  openInterestValue: "400",
                  fundingRate: "0.0001",
                  fundingIntervalHour: "8",
                },
                { symbol: "BTCUSDT", markPrice: "80000", turnover24h: "9000000", openInterestValue: "100" },
              ],
            },
          },
          instruments: {
            result: {
              list: [
                { symbol: "NVDAUSDT", status: "Trading", baseCoin: "NVDA", tags: ["Stock"], fundingInterval: 480 },
                { symbol: "BTCUSDT", status: "Trading", baseCoin: "BTC", tags: ["Crypto"], fundingInterval: 480 },
              ],
            },
          },
        },
        coingecko: {
          error: null,
          data: [
            {
              market: "Zoomex (Futures)",
              contract_type: "perpetual",
              symbol: "NVDAUSDT",
              price: "100",
              volume_24h: "300",
              open_interest: "120",
            },
          ],
        },
      }),
    );
    const zoomex = day.venues.filter((venue) => venue.venue === "Zoomex");
    expect(zoomex).toHaveLength(1);
    expect(zoomex[0]?.markets.map((market) => market.underlying)).toEqual(["NVDA"]);
    expect(zoomex[0]?.markets[0]?.volume24hUsd).toBe(1000);
    expect(zoomex[0]?.markets[0]?.fundingIntervalHours).toBe(8);
    expect(zoomex[0]?.tier).toBe("cex-direct");
    expect(view.headlineUsd).toBe(1000);
  });

  it("keeps Vest NDX and SPX as indices", () => {
    const { day, view } = headline(
      emptyFeeds({
        vest: {
          error: null,
          info: {
            symbols: [
              { symbol: "NDX-USD-PERP", base: "NDX-USD", asset: "stock", tradingStatus: "TRADING" },
              { symbol: "SPX-USD-PERP", base: "SPX-USD", asset: "stock", tradingStatus: "TRADING" },
              { symbol: "NVDA-USD-PERP", base: "NVDA-USD", asset: "stock", tradingStatus: "TRADING" },
              { symbol: "DDOG-USD-PERP", base: "DDOG-USD", asset: "stock", tradingStatus: "HALT" },
            ],
          },
          tickers: {
            tickers: [
              { symbol: "NDX-USD-PERP", closePrice: "0", openPrice: "0", highPrice: "20010", lowPrice: "19990", quoteVolume: "37900000" },
              { symbol: "SPX-USD-PERP", closePrice: "0", openPrice: "6700", highPrice: "6710", lowPrice: "6690", quoteVolume: "8600000" },
              { symbol: "NVDA-USD-PERP", closePrice: "0", openPrice: "0", highPrice: "102", lowPrice: "98", quoteVolume: "5000000" },
              { symbol: "DDOG-USD-PERP", closePrice: "0", openPrice: "0", highPrice: "0", lowPrice: "0", quoteVolume: "0" },
            ],
          },
        },
      }),
    );
    const vest = day.venues.find((venue) => venue.venue === "Vest");
    expect(vest?.markets.map((market) => [market.underlying, market.category, market.volume24hUsd])).toEqual([
      ["NDX", "index", 37900000],
      ["NVDA", "stock", 5000000],
      ["SPX", "index", 8600000],
    ]);
    expect(vest?.markets.find((market) => market.underlying === "NVDA")?.priceUsd).toBe(100);
    expect(view.headlineUsd).toBe(37900000 + 8600000 + 5000000);
  });

  it("counts Veranta once on the last complete UTC day", () => {
    const { day, view } = headline(
      emptyFeeds({
        avantis: {
          error: null,
          data: {
            data: {
              pairInfos: {
                "4": {
                  from: "NVDA",
                  to: "USD",
                  groupIndex: 6,
                  isPairListed: true,
                  openInterest: { long: 2000000, short: 2000000 },
                },
                "7": {
                  from: "US500",
                  to: "USD",
                  groupIndex: 6,
                  isPairListed: true,
                  openInterest: { long: 5000000, short: 5000000 },
                },
                "9": {
                  from: "SPCX",
                  to: "USD",
                  groupIndex: 6,
                  isPairListed: true,
                  openInterest: { long: 4, short: 0 },
                },
                "2": { from: "BTC", to: "USD", groupIndex: 0, isPairListed: true, openInterest: { long: 9, short: 9 } },
              },
            },
          },
        },
        veranta: {
          error: null,
          data: {
            history: [
              { date: "2026-10-19", pairVolumes: [0, 0, 99, 0, 3500000, 0, 0, 800000, 0, 454] },
              { date: "2026-10-20", pairVolumes: [0, 0, 1, 0, 960000, 0, 0, 1, 0, 1] },
            ],
          },
        },
      }),
    );
    expect(day.venues.some((venue) => venue.venue === "Avantis")).toBe(false);
    const veranta = day.venues.find((venue) => venue.venue === "Veranta");
    expect(veranta?.volumeWindow).toBe("utc-day");
    expect(veranta?.windowNote).toContain("2026-10-19");
    expect(veranta?.markets.map((market) => [market.underlying, market.category, market.volume24hUsd, market.openInterestUsd])).toEqual([
      ["NVDA", "stock", 3500000, 4000000],
      ["SPCX", "preipo", 454, 4],
      ["US500", "index", 800000, 10000000],
    ]);
    expect(view.headlineUsd).toBe(3500000 + 800000);
    expect(view.preipoUsd).toBe(454);
  });

  it("marks Drift as no equity perps without a fetch", () => {
    const day = parseEquityPerpsFeeds(emptyFeeds());
    const drift = day.venues.find((venue) => venue.venue === "Drift");
    expect(drift?.noEquity).toBe(true);
    expect(drift?.error).toBeNull();
    expect(drift?.quality).toBe("fresh");
    expect(drift?.markets).toEqual([]);
    expect(drift?.windowNote).toContain("2026-04-01");
  });

  it("excludes LBank and Ourbit with the volume/OI screen", () => {
    const { day } = headline(
      emptyFeeds({
        hyperliquid: hlNvda(),
        lbank: {
          error: null,
          data: [{ symbol: "NVDAUSDT", instrumentStatus: "2", markedPrice: "100", turnover: "4200000000", fundingRate: "0.0001" }],
        },
        ourbit: {
          error: null,
          ticker: {
            data: [{ symbol: "NVDA_USDT", amount24: 903000000, holdVol: 280000, fairPrice: 100, lastPrice: 100, fundingRate: 0.0001 }],
          },
          detail: {
            data: [{ symbol: "NVDA_USDT", baseCoin: "NVDA", state: 0, contractSize: 1, conceptPlate: ["ob_trade_zone_stock"] }],
          },
        },
        coingecko: {
          error: null,
          data: [
            {
              market: "LBank (Futures)",
              contract_type: "perpetual",
              symbol: "NVDAUSDT",
              price: "100",
              open_interest: "23800000",
              volume_24h: "1",
            },
          ],
        },
      }),
    );
    const lbank = day.venues.find((venue) => venue.venue === "LBank");
    const ourbit = day.venues.find((venue) => venue.venue === "Ourbit");
    expect(lbank?.credible).toBe(false);
    expect(lbank?.excludeReason).toMatch(/Volume is \d+(\.\d+)?× open interest/);
    expect(lbank?.markets[0]?.openInterestUsd).toBe(23800000);
    expect(ourbit?.credible).toBe(false);
    expect(ourbit?.markets[0]?.openInterestUsd).toBe(28000000);
    expect(ourbit?.excludeReason).toBe("Volume is 32.3× open interest.");
    expect(PERPS_NAMED_OUTLIERS.LBank).toBeUndefined();
    expect(PERPS_NAMED_OUTLIERS.Ourbit).toBeUndefined();
  });

  it("uses edgeX quote value and drops pre-IPO from the headline", () => {
    const { day, view } = headline(
      emptyFeeds({
        edgex: {
          error: null,
          meta: { data: { contractList: [{ contractId: "1", isStock: true }, { contractId: "2", isStock: true }] } },
          tickers: [
            {
              data: [
                {
                  contractName: "NVDAUSDC",
                  value: "25200000",
                  openInterest: "20000",
                  markPrice: "100",
                  fundingRate: "0.0001",
                  fundingTime: "1000000000000",
                  nextFundingTime: "1000014400000",
                },
              ],
            },
            { data: [{ contractName: "SPCXUSDC", value: "500", openInterest: "1", markPrice: "20", fundingRate: "0" }] },
          ],
        },
      }),
    );
    const edgex = day.venues.find((venue) => venue.venue === "edgeX");
    const nvda = edgex?.markets.find((market) => market.underlying === "NVDA");
    const spcx = edgex?.markets.find((market) => market.underlying === "SPCX");
    expect(nvda?.volume24hUsd).toBe(25200000);
    expect(nvda?.openInterestUsd).toBe(2000000);
    expect(nvda?.fundingIntervalHours).toBe(4);
    expect(spcx?.category).toBe("preipo");
    expect(view.headlineUsd).toBe(25200000);
    expect(view.preipoUsd).toBe(500);
  });

  it("parses the other direct books from recorded rows", () => {
    const { day, view } = headline(
      emptyFeeds({
        hyperliquid: hlNvda(),
        arcus: {
          error: null,
          data: {
            markets: [
              {
                marketDisplayName: "NVDA-USD",
                status: "ONLINE",
                baseAsset: "NVDA",
                category: "EQUITIES",
                markPrice: "100",
                volume24hNotional: "187",
                openInterest: "2",
                fundingRate: "0.0001",
              },
              {
                marketDisplayName: "SPX-USD",
                status: "ONLINE",
                baseAsset: "SPX",
                category: "INDICES",
                markPrice: "6700",
                volume24hNotional: "11",
                openInterest: "1",
              },
            ],
          },
        },
        polymarket: {
          error: null,
          instruments: [
            { instrument_id: 1, instrument_type: "perpetual", category: "index", symbol: "SP500-USD", base_asset: "SP500", funding_interval: "1h" },
          ],
          statistics: [{ instrument_id: 1, symbol: "SP500-USD", volume: "32100000" }],
        },
        blofin: {
          error: null,
          instruments: { data: [{ instId: "NVDA-USDT", baseCurrency: "NVDA", assetClass: "Stocks", state: "live", contractValue: "0.01" }] },
          tickers: { data: [{ instId: "NVDA-USDT", last: "100", volCurrency24h: "3", vol24h: "300" }] },
        },
        risex: {
          error: null,
          data: {
            data: {
              markets: [
                {
                  active: true,
                  category: "stocks",
                  base_asset_symbol: "NVDA/USDC",
                  display_name: "NVDA/USDC",
                  quote_volume_24h: "40",
                  open_interest: "0.5",
                  mark_price: "100",
                  current_funding_rate: "0.0001",
                  funding_interval: "3600000000000",
                },
              ],
            },
          },
        },
        gmxSolana: { error: null, data: [{ base_currency: "NVDA", product_type: "Perpetual", target_volume: 70, open_interest: 20, last_price: 100, funding_rate: 0.0001, funding_interval_minutes: 60 }] },
        gmxArbitrum: { error: null, data: [{ base_currency: "NVDA", product_type: "Perpetual", target_volume: 8, open_interest: 3, last_price: 101 }] },
        helix: {
          error: null,
          markets: { markets: [{ market: { ticker: "NVDA/USDC PERP", market_id: "nvda", status: "Active" }, mark_price: "100" }] },
          summary: [{ marketId: "nvda", volume: 15, price: 100 }],
        },
        bitstamp: {
          error: null,
          data: [{ market_type: "PERPETUAL", pair: "NVDA/USD-PERP", volume: "2", vwap: "100", mark_price: "100", open_interest_value: "50" }],
        },
        standx: {
          error: null,
          symbols: [{ symbol: "NVDA-USD" }],
          markets: [{ symbol: "NVDA-USD", volume_quote_24h: "9", open_interest_notional: "4", mark_price: "100" }],
        },
        bitfinex: { error: null, data: [["tGERMANY40IXF0:USTF0", 0, 0, 0, 0, 0, 0, 25000, 0.04]] },
        crypto: {
          error: null,
          tickers: { result: { data: [{ i: "NVDAUSD-PERP", k: "100", vv: "12", oi: "0.2" }, { i: "BTCUSD-PERP", k: "80000", vv: "999", oi: "1" }] } },
          instruments: {
            result: {
              data: [
                { symbol: "NVDAUSD-PERP", product_type: "EQUITY", base_ccy: "NVDA", tradable: true },
                { symbol: "BTCUSD-PERP", product_type: "DIGITAL_CURRENCIES", base_ccy: "BTC", tradable: true },
                { symbol: "OPENAIIPOUSD-PERP", product_type: "PRE_IPO", base_ccy: "OPENAIIPO", tradable: true },
              ],
            },
          },
        },
      }),
    );
    const volume = (name: string) => day.venues.find((venue) => venue.venue === name)?.markets.find((market) => market.underlying === "NVDA")?.volume24hUsd;
    expect(volume("Arcus")).toBe(187);
    expect(day.venues.find((venue) => venue.venue === "Arcus")?.markets.find((market) => market.category === "index")?.underlying).toBe("SPX");
    expect(day.venues.find((venue) => venue.venue === "Polymarket Perps")?.markets[0]?.volume24hUsd).toBe(32100000);
    expect(day.venues.find((venue) => venue.venue === "Polymarket Perps")?.markets[0]?.category).toBe("index");
    expect(volume("BloFin")).toBe(300);
    expect(volume("RISEx")).toBe(40);
    expect(day.venues.find((venue) => venue.venue === "RISEx")?.markets[0]?.openInterestUsd).toBe(50);
    expect(day.venues.find((venue) => venue.venue === "RISEx")?.markets[0]?.fundingIntervalHours).toBe(1);
    expect(volume("GMX V2 (Solana)")).toBe(70);
    expect(day.venues.find((venue) => venue.venue === "GMX V2 (Solana)")?.markets[0]?.openInterestUsd).toBe(20);
    expect(volume("GMX V2 (Arbitrum)")).toBe(8);
    expect(volume("Helix")).toBe(15);
    expect(volume("Bitstamp")).toBe(200);
    expect(volume("StandX")).toBe(9);
    expect(day.venues.find((venue) => venue.venue === "Bitfinex")?.markets[0]?.underlying).toBe("GERMANY40");
    expect(day.venues.find((venue) => venue.venue === "Bitfinex")?.markets[0]?.category).toBe("index");
    expect(day.venues.find((venue) => venue.venue === "Bitfinex")?.markets[0]?.volume24hUsd).toBe(1000);
    expect(volume("Crypto.com")).toBe(12);
    expect(day.venues.find((venue) => venue.venue === "Crypto.com")?.markets.some((market) => market.underlying === "BTC")).toBe(false);
    expect(view.cexDirectUsd).toBe(300 + 200 + 1000 + 12);
  });

  it("excludes a named CoinGecko outlier when the screen does not fire", () => {
    const { day, view } = headline(
      emptyFeeds({
        hyperliquid: hlNvda(),
        coingecko: {
          error: null,
          data: [
            {
              market: "Bitrue (Futures)",
              contract_type: "perpetual",
              symbol: "NVDA",
              price: "100",
              volume_24h: "1000",
              open_interest: "4000",
            },
          ],
        },
      }),
      true,
    );
    const bitrue = day.venues.find((venue) => venue.venue === "Bitrue");
    expect(bitrue?.tier).toBe("unverified");
    expect(bitrue?.credible).toBe(false);
    expect(bitrue?.excludeReason).toBe(PERPS_NAMED_OUTLIERS.Bitrue);
    expect(view.headlineUsd).toBe(10);
  });

  it("errors edgeX when stock contracts produce no ticker", () => {
    const day = parseEquityPerpsFeeds(
      emptyFeeds({
        edgex: { error: null, meta: { data: { contractList: [{ contractId: "1", isStock: true }] } }, tickers: [null] },
      }),
    );
    const edgex = day.venues.find((venue) => venue.venue === "edgeX");
    expect(edgex?.error).toContain("no ticker");
    expect(edgex?.noEquity).toBeUndefined();
    expect(edgex?.markets).toEqual([]);
  });
});
