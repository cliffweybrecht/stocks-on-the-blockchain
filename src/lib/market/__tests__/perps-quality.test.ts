import { describe, expect, it } from "vitest";
import { PERPS_CHANGELOG } from "../perps-changelog";
import { classifyPerpUnderlying, normPerpSymbol, perpGroupLabel } from "../perps-classify";
import { fundingSpreads, normalizeFunding, perpsFundingIntervalHours } from "../perps-funding";
import {
  compactPerpsDay,
  encodeCompactDay,
  isCompactDay,
  parseCompactDay,
  PERPS_ROW_BYTE_BUDGET,
  type PerpsCompactDay,
  type PerpsCompactVenue,
} from "../perps-compact";
import { buildPerpsVenueCsv } from "../perps-csv";
import { perpsListingChanges, perpsOiSeries, perpsVenueShareSeries } from "../perps-history";
import { buildPerpsJson, PERPS_JSON_ATTRIBUTION, PERPS_JSON_SCHEMA } from "../perps-json";
import { parseEquityPerpsFeeds, type PerpsFeeds } from "../perps-parse";
import { CG_SPECS } from "../perps-sources";
import {
  buildPerpsDeskModel,
  emptyPerpsSnapshotFile,
  mergePerpsDay,
  parsePerpsSnapshotFile,
  perpsExcludeReason,
  perpsScreenInputs,
  perpsVenueQuality,
  serializePerpsSnapshot,
  stampPerpsQuality,
  PERPS_SNAPSHOT_SCHEMA,
  type PerpsDaySnapshot,
  type PerpsVenueSnapshot,
  type PerpsViewDay,
  type PerpsViewVenue,
} from "../perps-snapshot";

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

function venue(partial: Partial<PerpsVenueSnapshot> & Pick<PerpsVenueSnapshot, "venue" | "error">): PerpsVenueSnapshot {
  return {
    tier: "cex-direct",
    source: "test",
    volumeWindow: "rolling-24h",
    windowNote: "",
    capturedAt: "2026-10-09T03:59:00.000Z",
    markets: [],
    ...partial,
  };
}

function viewVenue(name: string, volume: number | null, tier: PerpsViewVenue["tier"] = "cex-direct", chain: string | null = null): PerpsViewVenue {
  return {
    venue: name,
    tier,
    source: "test",
    volumeWindow: "rolling-24h",
    windowNote: "",
    capturedAt: "2026-10-09T03:59:00.000Z",
    error: null,
    zeroFee: false,
    credible: true,
    excludeReason: null,
    chain: chain ?? "",
    operator: "",
    onchainChain: chain,
    markets: [],
    ...(volume === null ? {} : { parts: { stock: { markets: 1, volumeUsd: volume, openInterestUsd: 10 } } }),
  };
}

function viewDay(date: string, venues: PerpsViewVenue[], extra: Partial<PerpsViewDay> = {}): PerpsViewDay {
  return {
    date,
    t: 0,
    capturedAt: `${date}T04:00:00.000Z`,
    closed: true,
    venues,
    ...extra,
  };
}

describe("equity perp aliases and credibility", () => {
  it("collapses exchange suffixes and index labels without merging Dow Inc into the Dow index", () => {
    expect(normPerpSymbol("GOOGLXUSDT")).toBe("GOOGL");
    expect(normPerpSymbol("xyz:TSLA")).toBe("TSLA");
    expect(perpGroupLabel("DAX")).toBe("DAX index");
    expect(perpGroupLabel("GDAXI")).toBe("DAX index");
    expect(perpGroupLabel("FTSE")).toBe("FTSE 100 index");
    expect(perpGroupLabel("UKX")).toBe("FTSE 100 index");
    expect(perpGroupLabel("DJI")).toBe("Dow 30 index");
    expect(perpGroupLabel("DJIA")).toBe("Dow 30 index");
    expect(perpGroupLabel("NIK")).toBe("Nikkei/Japan 225 index");
    expect(perpGroupLabel("NKY")).toBe("Nikkei/Japan 225 index");
    expect(classifyPerpUnderlying("DAX")).toBe("index");
    expect(classifyPerpUnderlying("DOW")).toBe("stock");
    expect(classifyPerpUnderlying("SKHY")).toBe("stock");
    expect(classifyPerpUnderlying("SKHYNIX")).toBe("stock");
    expect(normPerpSymbol("SKHX")).toBe("SKHYNIX");
    expect(normPerpSymbol("SKHY")).toBe("SKHY");
    expect(classifyPerpUnderlying("ZHIPU")).toBe("stock");
    expect(classifyPerpUnderlying("MUU")).toBe("leveraged-etf");
    expect(classifyPerpUnderlying("MVLL")).toBe("leveraged-etf");
    expect(classifyPerpUnderlying("INTW")).toBe("leveraged-etf");
    expect(classifyPerpUnderlying("SKDD")).toBe("leveraged-etf");
  });

  it("screens a covered majority and ignores a thin open-interest fill", () => {
    const thin = perpsScreenInputs([
      { category: "stock", volume24hUsd: 200_000_000, openInterestUsd: null },
      { category: "stock", volume24hUsd: 1_000_000, openInterestUsd: 1_000 },
      { category: "preipo", volume24hUsd: 9_000_000_000, openInterestUsd: null },
    ]);
    expect(thin).toEqual({ volumeUsd: 201_000_000, openInterestUsd: null });
    expect(perpsExcludeReason(thin.volumeUsd, thin.openInterestUsd)).toBeNull();

    const majority = perpsScreenInputs([
      { category: "stock", volume24hUsd: 200_000_000, openInterestUsd: 1_000_000 },
      { category: "stock", volume24hUsd: 50, openInterestUsd: null },
    ]);
    expect(majority).toEqual({ volumeUsd: 200_000_000, openInterestUsd: 1_000_000 });
    expect(perpsExcludeReason(majority.volumeUsd, majority.openInterestUsd)).toMatch(/Volume is/);

    const full = perpsScreenInputs([
      { category: "stock", volume24hUsd: 200_000_000, openInterestUsd: 1_000_000 },
      { category: "stock", volume24hUsd: 0, openInterestUsd: null },
    ]);
    expect(full.openInterestUsd).toBe(1_000_000);
    expect(perpsExcludeReason(full.volumeUsd, full.openInterestUsd)).toMatch(/Volume is/);
  });

  it("keeps a CoinGecko venue that matched no equity markets", () => {
    const day = parseEquityPerpsFeeds(emptyFeeds({ coingecko: { error: null, data: [] } }));
    for (const spec of CG_SPECS) {
      const row = day.venues.find((item) => item.venue === spec.venue);
      expect(row, spec.venue).toBeDefined();
      expect(row?.markets).toEqual([]);
      expect(row?.error).toBeNull();
      expect(row?.quality).toBe("fresh");
    }
  });
});

describe("equity perp quality, books, and downloads", () => {
  it("marks a failed venue stale from the last good capture and does not copy that volume", () => {
    const good: PerpsDaySnapshot = {
      date: "2026-10-08",
      capturedAt: "2026-10-09T03:59:00.000Z",
      venues: [
        venue({
          venue: "OKX",
          error: null,
          capturedAt: "2026-10-09T03:59:00.000Z",
          markets: [
            {
              symbol: "NVDA",
              underlying: "NVDA",
              category: "stock",
              volume24hUsd: 1_234_567,
              openInterestUsd: 50,
              priceUsd: 100,
            },
          ],
        }),
        venue({ venue: "Gate", error: "down", capturedAt: "2026-10-09T03:59:00.000Z" }),
      ],
    };
    const failed: PerpsDaySnapshot = {
      date: "2026-10-09",
      capturedAt: "2026-10-10T03:59:00.000Z",
      venues: [
        venue({ venue: "OKX", error: "timeout", capturedAt: "2026-10-10T03:59:00.000Z" }),
        venue({ venue: "Gate", error: "down", capturedAt: "2026-10-10T03:59:00.000Z" }),
        venue({ venue: "Bitget", error: null, capturedAt: "2026-10-10T03:59:00.000Z" }),
      ],
    };
    const stamped = stampPerpsQuality(failed, compactPerpsDay(good));
    const okx = stamped.venues.find((row) => row.venue === "OKX");
    const gate = stamped.venues.find((row) => row.venue === "Gate");
    const bitget = stamped.venues.find((row) => row.venue === "Bitget");
    expect(okx?.quality).toBe("stale");
    expect(okx?.lastGoodAt).toBe("2026-10-09T03:59:00.000Z");
    expect(okx?.markets).toEqual([]);
    expect(gate?.quality).toBe("failed");
    expect(gate?.lastGoodAt).toBeNull();
    expect(bitget?.quality).toBe("fresh");

    const again = stampPerpsQuality(
      {
        ...failed,
        date: "2026-10-10",
        capturedAt: "2026-10-11T03:59:00.000Z",
        venues: [venue({ venue: "OKX", error: "timeout", capturedAt: "2026-10-11T03:59:00.000Z" })],
      },
      compactPerpsDay(stamped),
    );
    expect(again.venues[0]?.quality).toBe("stale");
    expect(again.venues[0]?.lastGoodAt).toBe("2026-10-09T03:59:00.000Z");

    const text = serializePerpsSnapshot(mergePerpsDay(emptyPerpsSnapshotFile(), stamped));
    expect(text).not.toContain("1234567");
    const parsed = parsePerpsSnapshotFile(JSON.parse(text));
    const record = parsed.records[0];
    expect(record && isCompactDay(record)).toBe(true);
    if (!record || !isCompactDay(record)) throw new Error("expected a compact day");
    const stored = record.venues.find((row) => row.venue === "OKX");
    expect(stored?.quality).toBe("stale");
    expect(stored?.lastGoodAt).toBe("2026-10-09T03:59:00.000Z");
    expect(stored?.parts.stock?.volumeUsd).toBeUndefined();
    expect(perpsVenueQuality({ error: "down" })).toBe("failed");
    expect(perpsVenueQuality({ error: null })).toBe("fresh");
    expect(serializePerpsSnapshot(parsed)).toBe(text);
  });

  it("round-trips the name set and per-venue books, including an Ostium daily diff on the book", () => {
    const capture = (date: string, lifetime: number): PerpsDaySnapshot => ({
      date,
      capturedAt: `${date}T04:00:00.000Z`,
      venues: [
        venue({
          venue: "Ostium",
          tier: "onchain",
          error: null,
          capturedAt: `${date}T04:00:00.000Z`,
          volumeWindow: "lifetime",
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
        }),
      ],
    });
    const first = capture("2026-10-08", 1000);
    const second = capture("2026-10-09", 1400);
    const file = mergePerpsDay(mergePerpsDay(emptyPerpsSnapshotFile(), first), second);
    const text = serializePerpsSnapshot(file);
    const parsed = parsePerpsSnapshotFile(JSON.parse(text));
    expect(serializePerpsSnapshot(parsed)).toBe(text);
    const stored = parsed.records[1];
    expect(stored && isCompactDay(stored)).toBe(true);
    if (!stored || !isCompactDay(stored)) throw new Error("expected a compact day");
    expect(stored.names).toEqual(["NVDA"]);
    expect(stored.tickers.find((ticker) => ticker.group === "NVDA")?.books?.[0]?.venue).toBe("Ostium");

    const model = buildPerpsDeskModel(parsed, Date.parse("2026-10-10T16:00:00.000Z") / 1000);
    const latest = model.days.find((day) => day.date === "2026-10-09");
    const book = latest?.tickers?.find((ticker) => ticker.group === "NVDA")?.books?.find((row) => row.venue === "Ostium");
    expect(book?.volumeUsd).toBe(400);
    expect(latest?.names).toEqual(["NVDA"]);

    const json = JSON.parse(buildPerpsJson("venues", model, "2026-10-15T00:00:00.000Z")) as {
      schema: string;
      attribution: string;
      columns: string[];
      rows: { quality: string; volumeUsd: number | null }[];
    };
    expect(json.schema).toBe(PERPS_JSON_SCHEMA);
    expect(json.attribution).toBe(PERPS_JSON_ATTRIBUTION);
    expect(json.attribution).toContain("CoinGecko");
    expect(json.columns.join(",")).toBe(buildPerpsVenueCsv(model).trim().split("\n")[0]);
    expect(json.columns).toEqual(expect.arrayContaining(["quality", "lastGoodAt"]));
    const tickerJson = JSON.parse(buildPerpsJson("tickers", model, "2026-10-15T00:00:00.000Z")) as { columns: string[] };
    expect(tickerJson.columns).toContain("books");
  });

  it("drops per-venue books before the name set when a row would pass the byte budget", () => {
    const base: PerpsCompactVenue = {
      venue: "V",
      tier: "cex-direct",
      source: "test",
      volumeWindow: "rolling-24h",
      windowNote: "",
      capturedAt: "2026-10-09T03:59:00.000Z",
      error: null,
      credible: true,
      excludeReason: null,
      parts: { stock: { markets: 1, volumeUsd: 1 } },
    };
    const books = Array.from({ length: 12_000 }, () => ({ venue: "V", volumeUsd: 123456789.12, openInterestUsd: 123456789.12 }));
    const bulky: PerpsCompactDay = {
      date: "2026-10-09",
      capturedAt: "2026-10-10T03:59:00.000Z",
      venues: [base],
      tickers: [{ group: "NVDA", category: "stock", tiers: { "cex-direct": { volumeUsd: 1, venues: ["V"] } }, books }],
      names: ["NVDA", "TSLA"],
    };
    const encoded = encodeCompactDay(bulky);
    expect(Buffer.byteLength(JSON.stringify(encoded))).toBeLessThanOrEqual(PERPS_ROW_BYTE_BUDGET);
    expect(encoded.names).toEqual(["NVDA", "TSLA"]);
    expect((encoded.tickers[0] as unknown[]).length).toBe(3);

    const namesOnly: PerpsCompactDay = {
      ...bulky,
      tickers: [{ group: "NVDA", category: "stock", tiers: {} }],
      names: Array.from({ length: 8_000 }, (_, index) => `N${index}${"X".repeat(40)}`),
    };
    const stripped = encodeCompactDay(namesOnly);
    expect(stripped.names).toBeUndefined();
    expect(Buffer.byteLength(JSON.stringify(stripped))).toBeLessThanOrEqual(PERPS_ROW_BYTE_BUDGET);
  });

  it("leaves an absent venue's share blank and labels a capped ticker diff", () => {
    const earlier = viewDay("2026-10-08", [viewVenue("OKX", 100)]);
    const later = viewDay("2026-10-09", [
      viewVenue("OKX", 50),
      viewVenue("Binance", 50, "cex-coingecko"),
      viewVenue("HIP-3 xyz", 40, "onchain", "Hyperliquid L1"),
    ]);
    const shares = perpsVenueShareSeries([earlier, later], false, false);
    const firstBinance = shares[0]?.rows.find((row) => row.name === "Binance");
    expect(firstBinance?.share).toBeNull();
    expect(firstBinance?.volumeUsd).toBeNull();
    expect(shares[0]?.rows.find((row) => row.name === "OKX")?.share).toBe(1);
    expect(shares[1]?.rows.find((row) => row.name === "OKX")?.share).toBeCloseTo(50 / 140);

    const oi = perpsOiSeries([earlier, later], false, false);
    expect(oi[1]?.openInterestUsd).toBe(30);
    expect(oi[1]?.volOi).toBeCloseTo(140 / 30);

    const book = perpsListingChanges([
      viewDay("2026-10-08", [], { names: ["NVDA", "TSLA"] }),
      viewDay("2026-10-09", [], { names: ["NVDA", "AAPL"] }),
    ]);
    expect(book?.scope).toBe("book");
    expect(book?.listed).toEqual(["AAPL"]);
    expect(book?.delisted).toEqual(["TSLA"]);

    const capped = perpsListingChanges([
      viewDay("2026-10-08", [], { tickers: [{ group: "NVDA", category: "stock", tiers: {} }] }),
      viewDay("2026-10-09", [], { tickers: [{ group: "AAPL", category: "stock", tiers: {} }] }),
    ]);
    expect(capped?.scope).toBe("stored-tickers");
    expect(capped?.listed).toEqual([]);
    expect(capped?.delisted).toEqual([]);
    expect(capped?.enteredCap).toEqual(["AAPL"]);
    expect(capped?.leftCap).toEqual(["NVDA"]);
    expect(capped?.note).toMatch(/not delisted/);

    const stayed = perpsListingChanges([
      viewDay("2026-10-08", [], {
        names: ["NVDA", "TSLA"],
        tickers: [{ group: "NVDA", category: "stock", tiers: {} }],
      }),
      viewDay("2026-10-09", [], {
        names: ["NVDA", "TSLA"],
        tickers: [{ group: "TSLA", category: "stock", tiers: {} }],
      }),
    ]);
    expect(stayed?.listed).toEqual([]);
    expect(stayed?.delisted).toEqual([]);
    expect(stayed?.leftCap).toEqual(["NVDA"]);
    expect(stayed?.enteredCap).toEqual(["TSLA"]);

    const partial = perpsListingChanges([
      viewDay("2026-10-08", [], { tickers: [{ group: "NVDA", category: "stock", tiers: {} }] }),
      viewDay("2026-10-09", [], {
        names: ["NVDA", "AAPL"],
        tickers: [{ group: "AAPL", category: "stock", tiers: {} }],
      }),
    ]);
    expect(partial?.scope).toBe("partial");
    expect(partial?.listed).toEqual([]);
    expect(partial?.delisted).toEqual([]);
    expect(partial?.leftCap).toEqual(["NVDA"]);
    expect(perpsListingChanges([viewDay("2026-10-09", [])])?.scope).toBe("unavailable");
  });

  it("normalizes funding only when the interval is known and records an empty onchain book", () => {
    expect(perpsFundingIntervalHours(28800, "seconds")).toBe(8);
    expect(perpsFundingIntervalHours(14400, "seconds")).toBe(4);
    expect(perpsFundingIntervalHours("8", "hours")).toBe(8);
    expect(perpsFundingIntervalHours(7.2, "hours")).toBeNull();
    const hyperliquid = normalizeFunding("Hyperliquid HIP-3 (xyz)", 0.00000625, null);
    expect(hyperliquid.hoursSource).toBe("documented");
    expect(hyperliquid.hours).toBe(1);
    expect(hyperliquid.eightHour).toBeCloseTo(0.00005);
    expect(hyperliquid.annualizedPct).toBeCloseTo(5.475);
    const gate = normalizeFunding("Gate", 0.0008, 4);
    expect(gate.hoursSource).toBe("stored");
    expect(gate.eightHour).toBeCloseTo(0.0016);
    expect(normalizeFunding("Binance", 0.0001, null).eightHour).toBeNull();
    expect(
      fundingSpreads(
        [
          {
            group: "NVDA",
            category: "stock",
            funding: { "Hyperliquid HIP-3 (xyz)": 0.00000625, Binance: 0.0001 },
          },
        ],
        false,
      ),
    ).toEqual([]);
    expect(
      fundingSpreads(
        [
          {
            group: "NVDA",
            category: "stock",
            funding: { "Hyperliquid HIP-3 (xyz)": 0.00000625, Gate: 0.0008 },
            fundingHours: { Gate: 8 },
          },
        ],
        false,
      )[0]?.group,
    ).toBe("NVDA");

    const day = parseEquityPerpsFeeds(
      emptyFeeds({
        hyperliquid: {
          error: null,
          dexs: [
            { dex: "quiet", book: [{ universe: [] }, []], error: null },
            { dex: "down", book: null, error: "timeout" },
            {
              dex: "xyz",
              book: [
                { universe: [{ name: "xyz:NVDA" }] },
                [{ markPx: "200", openInterest: "2", dayNtlVlm: "1000", funding: "0.00000625" }],
              ],
              error: null,
            },
          ],
        },
        bitget: { tickers: [], contracts: [], error: null },
        lighter: { data: { order_book_details: [] }, error: null },
        gate: {
          error: null,
          tickers: [{ contract: "NVDA_USDT", mark_price: "200", volume_24h_quote: "500", funding_rate: "0.0008", total_size: "1" }],
          contracts: [{ name: "NVDA_USDT", contract_type: "stocks", quanto_multiplier: "1", funding_interval: 14400 }],
        },
      }),
    );
    const quiet = day.venues.find((venue) => venue.venue === "Hyperliquid HIP-3 (quiet)");
    expect(quiet?.noEquity).toBe(true);
    expect(quiet?.error).toBeNull();
    expect(quiet?.markets).toEqual([]);
    const down = day.venues.find((venue) => venue.venue === "Hyperliquid HIP-3 (down)");
    expect(down?.error).toBe("timeout");
    expect(down?.noEquity).toBeUndefined();
    const nvda = day.venues.find((venue) => venue.venue === "Hyperliquid HIP-3 (xyz)")?.markets.find((market) => market.underlying === "NVDA");
    expect(nvda?.fundingIntervalHours).toBe(1);
    const gateMarket = day.venues.find((venue) => venue.venue === "Gate")?.markets[0];
    expect(gateMarket?.fundingIntervalHours).toBe(4);
    expect(day.venues.find((venue) => venue.venue === "Bitget")?.noEquity).toBeUndefined();
    expect(day.venues.find((venue) => venue.venue === "Lighter")?.noEquity).toBe(true);

    const compact = compactPerpsDay(day);
    const encoded = encodeCompactDay(compact);
    const quietWire = (encoded.venues as { venue?: string; ne?: number }[]).find((venue) => venue.venue?.includes("quiet"));
    expect(quietWire?.ne).toBe(1);
    const xyzWire = (encoded.venues as { venue?: string; ne?: number }[]).find((venue) => venue.venue?.includes("xyz"));
    expect(xyzWire?.ne).toBeUndefined();
    const parsed = parseCompactDay(encoded);
    expect(parsed?.venues.find((venue) => venue.venue.includes("quiet"))?.noEquity).toBe(true);
    const nvdaTicker = parsed?.tickers.find((ticker) => ticker.group === "NVDA");
    expect(nvdaTicker?.funding?.["Hyperliquid HIP-3 (xyz)"]).toBeCloseTo(0.00000625);
    expect(nvdaTicker?.fundingHours?.["Hyperliquid HIP-3 (xyz)"]).toBe(1);
    expect(nvdaTicker?.fundingHours?.Gate).toBe(4);
    const again = encodeCompactDay(parsed!);
    expect(JSON.stringify(again)).toBe(JSON.stringify(encoded));
    expect(PERPS_CHANGELOG.map((entry) => entry.id)).toContain("funding");
    expect(PERPS_CHANGELOG.map((entry) => entry.id)).toContain("listings");
  });
});
