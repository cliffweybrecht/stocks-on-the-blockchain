import type { PerpsArchiveSymbol } from "./perps-archive";
import {
  classifyPerpUnderlying,
  isStoredEquityCategory,
  normPerpSymbol,
  type PerpsCategory,
  type PerpsClass,
} from "./perps-classify";
import { perpsFundingIntervalHours } from "./perps-funding";
import { asNonNegativeNumber, asReportedNumber } from "./numbers";
import { perpsExcludeReason, perpsScreenInputs, type PerpsDaySnapshot, type PerpsMarketSnapshot, type PerpsTier, type PerpsVenueSnapshot, type PerpsVolumeWindow } from "./perps-snapshot";
import {
  CG_OI_MARKETS,
  CG_SPECS,
  DIRECT_CG_MARKETS,
  HIP3_DEX_LIST_SOURCE,
  PERPS_COINGECKO_NAMED_SKIP,
  PERPS_NAMED_OUTLIERS,
  PERPS_PRICE_BAND_MAX,
  PERPS_PRICE_BAND_MIN,
  coingeckoVenueSource,
  hip3DexSource,
  perpsDirectSpec,
  type PerpsDirectSpec,
} from "./perps-sources";
import { easternDayKey } from "./volume-snapshots";

/**
 * Pure builder for one equity-perp snapshot. Network I/O lives in perps-fetch.
 * Tagged venues (exchange asset-class flags) seed the reference price.
 * Untagged venues match a normalized ticker only when the mark is within
 * 0.8–1.25 of that median. Long-tail CoinGecko venues are stored and left
 * out of the default headline. A volume/OI screen records outliers with
 * credible=false so they stay out of the headline too.
 * Hyperliquid hourly candles report base size, not USD notional, so they
 * are not turned into an ET-day figure.
 */

const HL_NONEQ = new Set(["ANSEM", "TREAD", "BTCD", "TOTAL2", "OTHERS", "BVIV", "10Y", "2Y", "30Y", "USBOND"]);

const BINGX_INDEX_ALIAS: Record<string, string> = {
  NASDAQ100: "US100",
  DOWJONES: "US30",
  NIKKEI225: "JP225",
  RUSSELL2000: "US2000",
  KOSPI1: "KOSPI",
};

export interface PerpsFeedResult<T> {
  data: T | null;
  error: string | null;
}

export interface HyperliquidDexFeed {
  dex: string;
  book: unknown;
  error: string | null;
}

export interface PerpsFeeds {
  capturedAt: string;
  hyperliquid: { dexs: HyperliquidDexFeed[]; error: string | null };
  bitget: { tickers: unknown; contracts: unknown; error: string | null };
  okx: {
    instruments: unknown;
    tickers: unknown;
    openInterest: unknown;
    oiError: string | null;
    error: string | null;
    /**
     * One bulk funding-rate response (`instId=ANY`). Absent in fixtures.
     * A funding error does not fail the OKX book; rates stay unannualized.
     */
    funding?: unknown;
    fundingError?: string | null;
  };
  gate: { tickers: unknown; contracts: unknown; error: string | null };
  mexc: { ticker: unknown; detail: unknown; error: string | null };
  aster: { ticker: unknown; exchangeInfo: unknown; error: string | null };
  kucoin: PerpsFeedResult<unknown>;
  extended: PerpsFeedResult<unknown>;
  lighter: PerpsFeedResult<unknown>;
  lighterRobinhood: PerpsFeedResult<unknown>;
  /**
   * Public Lighter funding-rates list. Absent in fixtures and on the Robinhood host.
   * Only rows with exchange "lighter" are used, and they carry no interval.
   */
  lighterFunding?: PerpsFeedResult<unknown>;
  ondo: PerpsFeedResult<unknown>;
  variational: PerpsFeedResult<unknown>;
  kraken: PerpsFeedResult<unknown>;
  bingx: PerpsFeedResult<unknown>;
  coingecko: PerpsFeedResult<unknown>;
  ostium: PerpsFeedResult<unknown>;
  avantis: PerpsFeedResult<unknown>;
  /** Absent in unit fixtures. The live fetcher always sets these. */
  toobit?: PerpsFeedResult<unknown>;
  xt?: { tickers: unknown; symbols: unknown; error: string | null };
  bitunix?: PerpsFeedResult<unknown>;
  whitebit?: PerpsFeedResult<unknown>;
  phemex?: { tickers: unknown; products: unknown; error: string | null };
  btse?: PerpsFeedResult<unknown>;
  deribit?: PerpsFeedResult<unknown>;
  htx?: { ticker: unknown; info: unknown; openInterest: unknown; error: string | null; oiError: string | null };
  /** Tickers plus get-instruments. Absent in unit fixtures. */
  crypto?: { tickers: unknown; instruments: unknown; error: string | null };
  lbank?: PerpsFeedResult<unknown>;
  grvt?: PerpsFeedResult<unknown>;
  apex?: PerpsFeedResult<unknown>;
  nado?: PerpsFeedResult<unknown>;
  pacifica?: PerpsFeedResult<unknown>;
  orderly?: PerpsFeedResult<unknown>;
  paradex?: PerpsFeedResult<unknown>;
  /** Absent in unit fixtures. The live fetcher always sets these. */
  weex?: { tickers: unknown; exchangeInfo: unknown; openInterest: unknown; error: string | null };
  coinbase?: PerpsFeedResult<unknown>;
  zoomex?: { tickers: unknown; instruments: unknown; error: string | null };
  ourbit?: { ticker: unknown; detail: unknown; error: string | null };
  arcus?: PerpsFeedResult<unknown>;
  vest?: { info: unknown; tickers: unknown; error: string | null };
  polymarket?: { instruments: unknown; statistics: unknown; error: string | null };
  blofin?: { instruments: unknown; tickers: unknown; error: string | null };
  risex?: PerpsFeedResult<unknown>;
  edgex?: { meta: unknown; tickers: unknown; error: string | null };
  gmxSolana?: PerpsFeedResult<unknown>;
  gmxArbitrum?: PerpsFeedResult<unknown>;
  helix?: { markets: unknown; summary: unknown; error: string | null };
  bitstamp?: PerpsFeedResult<unknown>;
  standx?: { symbols: unknown; markets: unknown; error: string | null };
  bitfinex?: PerpsFeedResult<unknown>;
  /** Veranta daily pair volumes. Absent when a fixture only has the socket book. */
  veranta?: PerpsFeedResult<unknown>;
}

interface Observation {
  underlying: string;
  category: PerpsClass;
  price: number | null;
}

interface ReferenceBook {
  prices: Map<string, number>;
  set: Set<string>;
}

function rec(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function listFrom(payload: unknown, key?: string): unknown[] {
  if (Array.isArray(payload)) return payload;
  const row = rec(payload);
  if (!row) return [];
  if (key && Array.isArray(row[key])) return row[key] as unknown[];
  if (Array.isArray(row.data)) return row.data;
  return [];
}

function px(value: unknown): number | null {
  const n = asNonNegativeNumber(value);
  if (n === null || n <= 0) return null;
  return n;
}

function vol(value: unknown): number | null {
  return asNonNegativeNumber(value);
}

function mul(a: number | null, b: number | null, c: number | null = 1): number | null {
  if (a === null || b === null || c === null) return null;
  return a * b * c;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function market(
  symbol: string,
  underlying: string,
  category: PerpsCategory | "preipo",
  volume24hUsd: number | null,
  openInterestUsd: number | null,
  priceUsd: number | null,
  lifetimeVolumeUsd?: number | null,
  fundingRate?: number | null,
  fundingIntervalHours?: number | null,
): PerpsMarketSnapshot {
  const row: PerpsMarketSnapshot = {
    symbol,
    underlying,
    category,
    volume24hUsd,
    openInterestUsd,
    priceUsd,
  };
  if (typeof lifetimeVolumeUsd === "number") row.lifetimeVolumeUsd = lifetimeVolumeUsd;
  if (typeof fundingRate === "number") row.fundingRate = fundingRate;
  if (typeof fundingRate === "number" && typeof fundingIntervalHours === "number" && fundingIntervalHours > 0) {
    row.fundingIntervalHours = fundingIntervalHours;
  }
  return row;
}

function rate(value: unknown): number | null {
  return asReportedNumber(value);
}

function venueShell(
  venueName: string,
  tier: PerpsTier,
  source: string,
  volumeWindow: PerpsVolumeWindow,
  windowNote: string,
  capturedAt: string,
  error: string | null,
  markets: PerpsMarketSnapshot[],
): PerpsVenueSnapshot {
  const sorted = [...markets].sort((a, b) => a.symbol.localeCompare(b.symbol));
  return {
    venue: venueName,
    tier,
    source,
    volumeWindow,
    windowNote,
    capturedAt,
    error,
    quality: error ? "failed" : "fresh",
    lastGoodAt: error ? null : capturedAt,
    markets: sorted,
  };
}

function emptyVenue(
  venueName: string,
  tier: PerpsTier,
  source: string,
  volumeWindow: PerpsVolumeWindow,
  windowNote: string,
  capturedAt: string,
  error: string | null,
): PerpsVenueSnapshot {
  return venueShell(venueName, tier, source, volumeWindow, windowNote, capturedAt, error, []);
}

function shellFromSpec(
  spec: PerpsDirectSpec,
  capturedAt: string,
  error: string | null,
  markets: PerpsMarketSnapshot[] = [],
  note = spec.note,
  source = spec.source,
): PerpsVenueSnapshot {
  return venueShell(spec.venue, spec.tier, source, spec.volumeWindow, note, capturedAt, error, markets);
}

function classified(
  underlying: string,
  options?: { forceIndex?: boolean; forceGroupIndex?: boolean; forcePreipo?: boolean; forceNonequity?: boolean },
): { underlying: string; category: PerpsClass } {
  let category = classifyPerpUnderlying(underlying);
  if (options?.forceNonequity) category = "nonequity";
  if (options?.forcePreipo && category === "stock") category = "preipo";
  if (options?.forceIndex && category === "stock") category = "index";
  if (options?.forceGroupIndex) category = "index";
  return { underlying, category };
}

function observe(
  observations: Observation[],
  markets: PerpsMarketSnapshot[],
  symbol: string,
  underlying: string,
  category: PerpsClass,
  volume24hUsd: number | null,
  openInterestUsd: number | null,
  priceUsd: number | null,
  fundingRate?: number | null,
  lifetimeVolumeUsd?: number | null,
  fundingIntervalHours?: number | null,
): void {
  observations.push({ underlying, category, price: priceUsd });
  if (!isStoredEquityCategory(category) && category !== "preipo") return;
  markets.push(
    market(symbol, underlying, category, volume24hUsd, openInterestUsd, priceUsd, lifetimeVolumeUsd, fundingRate, fundingIntervalHours),
  );
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? null;
  const left = sorted[mid - 1];
  const right = sorted[mid];
  if (left === undefined || right === undefined) return null;
  return (left + right) / 2;
}

function buildReference(observations: readonly Observation[]): ReferenceBook {
  const buckets = new Map<string, number[]>();
  const set = new Set<string>();
  for (const row of observations) {
    if (row.category === "index") set.add(row.underlying);
    if (
      (row.category === "stock" || row.category === "etf" || row.category === "leveraged-etf" || row.category === "preipo") &&
      row.price !== null
    ) {
      const list = buckets.get(row.underlying) ?? [];
      list.push(row.price);
      buckets.set(row.underlying, list);
    }
  }
  const prices = new Map<string, number>();
  for (const [underlying, list] of buckets) {
    const mid = median(list);
    if (mid !== null && mid > 0) {
      prices.set(underlying, mid);
      set.add(underlying);
    }
  }
  return { prices, set };
}

/**
 * Match an unlabeled perp to the tagged-venue universe.
 * Index aliases match on ticker (index levels are not comparable across
 * contract multipliers). Everything else needs a price inside the band.
 * Returns null for non-equity, unknown tickers, and price mismatches.
 */
export function matchUntaggedPerp(
  symbol: string,
  price: number | null,
  reference: ReferenceBook,
): { underlying: string; category: PerpsCategory | "preipo" } | null {
  let underlying = normPerpSymbol(symbol);
  if (!reference.set.has(underlying) && underlying.endsWith("X") && reference.set.has(underlying.slice(0, -1))) {
    underlying = underlying.slice(0, -1);
  }
  const category = classifyPerpUnderlying(underlying);
  if (category === "nonequity" || category === "etf-nonequity") return null;
  if (category === "index") return { underlying, category };
  const ref = reference.prices.get(underlying);
  if (ref === undefined || price === null || ref <= 0) return null;
  const ratio = price / ref;
  if (ratio < PERPS_PRICE_BAND_MIN || ratio > PERPS_PRICE_BAND_MAX) return null;
  return { underlying, category };
}

/**
 * Hyperliquid `candleSnapshot` rows are base size (`v`), same unit as
 * `dayBaseVlm`. There is no quote notional. Multiplying by a mark would be
 * an estimate, so this returns null unless a notional field is actually present.
 */
export function hyperliquidEtDayNotional(candles: unknown): number | null {
  if (!Array.isArray(candles) || candles.length === 0) return null;
  const sample = rec(candles[0]);
  if (!sample) return null;
  const notionalKey = Object.keys(sample).find((key) => /notional|quotevolume|ntlvlm|quote_volume/i.test(key));
  if (!notionalKey) return null;
  let sum = 0;
  let any = false;
  for (const row of candles) {
    const value = vol(rec(row)?.[notionalKey]);
    if (value === null) continue;
    sum += value;
    any = true;
  }
  return any ? sum : null;
}

/**
 * WEEX quoteVolume is USD when quoteVolume / volume lands inside the bar.
 * A quote that does not match volume × a price in that range is discarded,
 * and volume × mark is used instead. CoinGecko's WEEX quote is not used.
 */
export function weexQuoteVolumeUsd(ticker: {
  volume?: unknown;
  quoteVolume?: unknown;
  markPrice?: unknown;
  lastPrice?: unknown;
  highPrice?: unknown;
  lowPrice?: unknown;
}): number | null {
  const base = vol(ticker.volume);
  const quote = vol(ticker.quoteVolume);
  const mark = px(ticker.markPrice) ?? px(ticker.lastPrice);
  const low = px(ticker.lowPrice);
  const high = px(ticker.highPrice);
  if (quote !== null && base !== null && base > 0) {
    const implied = quote / base;
    const floor = low ?? mark;
    const cap = high ?? mark;
    if (floor !== null && cap !== null && implied >= floor * 0.98 && implied <= cap * 1.02) return quote;
  }
  if (base !== null && mark !== null) return base * mark;
  return null;
}

const WEEX_EQUITY_TYPES = new Set(["Stocks", "Indices", "Pre-IPO"]);

function pushUntagged(
  markets: PerpsMarketSnapshot[],
  reference: ReferenceBook,
  symbol: string,
  price: number | null,
  volume24hUsd: number | null,
  openInterestUsd: number | null,
  fundingRate?: number | null,
  fundingIntervalHours?: number | null,
): void {
  const matched = matchUntaggedPerp(symbol, price, reference);
  if (!matched) return;
  markets.push(
    market(
      symbol,
      matched.underlying,
      matched.category,
      volume24hUsd,
      openInterestUsd,
      price,
      null,
      fundingRate,
      fundingIntervalHours,
    ),
  );
}

function hyperliquidVenues(feeds: PerpsFeeds, observations: Observation[]): PerpsVenueSnapshot[] {
  const spec = perpsDirectSpec("Hyperliquid HIP-3");
  if (feeds.hyperliquid.error && feeds.hyperliquid.dexs.length === 0) {
    return [shellFromSpec(spec, feeds.capturedAt, feeds.hyperliquid.error, [], spec.note, HIP3_DEX_LIST_SOURCE)];
  }
  const venues: PerpsVenueSnapshot[] = [];
  for (const dexFeed of feeds.hyperliquid.dexs) {
    const name = `Hyperliquid HIP-3 (${dexFeed.dex})`;
    const source = hip3DexSource(dexFeed.dex);
    if (dexFeed.error || dexFeed.book === null) {
      venues.push(emptyVenue(name, spec.tier, source, spec.volumeWindow, spec.note, feeds.capturedAt, dexFeed.error));
      continue;
    }
    const pair = asList(dexFeed.book);
    const meta = rec(pair[0]);
    const ctxs = asList(pair[1]);
    const universe = asList(meta?.universe);
    if (!meta || !Array.isArray(meta.universe) || !Array.isArray(pair[1]) || (universe.length > 0 && ctxs.length === 0)) {
      venues.push(emptyVenue(name, spec.tier, source, spec.volumeWindow, spec.note, feeds.capturedAt, "Empty HIP-3 book."));
      continue;
    }
    const markets: PerpsMarketSnapshot[] = [];
    const count = Math.min(universe.length, ctxs.length);
    for (let i = 0; i < count; i += 1) {
      const asset = rec(universe[i]);
      const ctx = rec(ctxs[i]);
      if (!asset || !ctx || asset.isDelisted === true) continue;
      const rawName = text(asset.name);
      if (!rawName) continue;
      const underlying = normPerpSymbol(rawName);
      const forceNonequity = HL_NONEQ.has(underlying);
      const forcePreipo = dexFeed.dex === "io" && (underlying === "ANTH" || underlying === "OAI");
      const classifiedName = classified(underlying, { forceNonequity, forcePreipo });
      const price = px(ctx.markPx);
      const oi = mul(vol(ctx.openInterest), price);
      const funding = rate(ctx.funding);
      observe(
        observations,
        markets,
        rawName,
        classifiedName.underlying,
        classifiedName.category,
        vol(ctx.dayNtlVlm),
        oi,
        price,
        funding,
        null,
        funding === null ? null : 1,
      );
    }
    if (markets.length === 0) {
      const quiet = venueShell(name, spec.tier, source, spec.volumeWindow, spec.note, feeds.capturedAt, null, markets);
      quiet.noEquity = true;
      quiet.windowNote = `${spec.note} Book returned and contained no equity markets.`;
      venues.push(quiet);
      continue;
    }
    venues.push(venueShell(name, spec.tier, source, spec.volumeWindow, spec.note, feeds.capturedAt, null, markets));
  }
  return venues;
}

function indexBy(rows: unknown[], key: string): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const record = rec(row);
    const id = record ? text(record[key]) : "";
    if (record && id) map.set(id, record);
  }
  return map;
}

function bitgetVenue(feeds: PerpsFeeds, observations: Observation[]): PerpsVenueSnapshot {
  const spec = perpsDirectSpec("Bitget");
  const shell = (error: string | null, markets: PerpsMarketSnapshot[] = []) =>
    shellFromSpec(spec, feeds.capturedAt, error, markets);
  if (feeds.bitget.error) return shell(feeds.bitget.error);
  const contracts = indexBy(listFrom(feeds.bitget.contracts), "symbol");
  const markets: PerpsMarketSnapshot[] = [];
  for (const row of listFrom(feeds.bitget.tickers)) {
    const ticker = rec(row);
    if (!ticker) continue;
    const symbol = text(ticker.symbol);
    const meta = contracts.get(symbol);
    if (!meta || String(meta.isRwa).toUpperCase() !== "YES") continue;
    const underlying = normPerpSymbol(symbol);
    const classifiedName = classified(underlying);
    const price = px(ticker.markPrice);
    observe(
      observations,
      markets,
      symbol,
      classifiedName.underlying,
      classifiedName.category,
      vol(ticker.usdtVolume),
      mul(vol(ticker.holdingAmount), price),
      price,
      rate(ticker.fundingRate),
      null,
      perpsFundingIntervalHours(meta.fundInterval, "hours"),
    );
  }
  return shell(null, markets);
}

function okxVenue(feeds: PerpsFeeds, observations: Observation[]): PerpsVenueSnapshot {
  const spec = perpsDirectSpec("OKX");
  const note = feeds.okx.oiError
    ? `Rolling 24h. Open interest left blank (${feeds.okx.oiError}). Equity flag is instCategory=3.`
    : spec.note;
  const shell = (error: string | null, markets: PerpsMarketSnapshot[] = []) =>
    shellFromSpec(spec, feeds.capturedAt, error, markets, note);
  if (feeds.okx.error) return shell(feeds.okx.error);
  const instruments = indexBy(listFrom(feeds.okx.instruments), "instId");
  const oi = new Map<string, number | null>();
  for (const row of listFrom(feeds.okx.openInterest)) {
    const record = rec(row);
    if (!record) continue;
    oi.set(text(record.instId), vol(record.oiUsd));
  }
  const funding = new Map<string, { rate: number; hours: number | null }>();
  if (!feeds.okx.fundingError && feeds.okx.funding != null) {
    for (const row of listFrom(feeds.okx.funding)) {
      const item = rec(row);
      if (!item) continue;
      const instId = text(item.instId);
      const fundingRate = rate(item.fundingRate);
      if (!instId || fundingRate === null) continue;
      const start = asReportedNumber(item.fundingTime);
      const next = asReportedNumber(item.nextFundingTime);
      const hours =
        start !== null && next !== null && next > start
          ? perpsFundingIntervalHours((next - start) / 1000, "seconds")
          : null;
      funding.set(instId, { rate: fundingRate, hours });
    }
  }
  const markets: PerpsMarketSnapshot[] = [];
  for (const row of listFrom(feeds.okx.tickers)) {
    const ticker = rec(row);
    if (!ticker) continue;
    const symbol = text(ticker.instId);
    const inst = instruments.get(symbol);
    if (!inst || String(inst.instCategory) !== "3") continue;
    const underlying = normPerpSymbol(symbol);
    const classifiedName = classified(underlying);
    const price = px(ticker.last);
    const fund = funding.get(symbol);
    observe(
      observations,
      markets,
      symbol,
      classifiedName.underlying,
      classifiedName.category,
      mul(vol(ticker.volCcy24h), price),
      oi.get(symbol) ?? null,
      price,
      fund?.rate ?? null,
      null,
      fund?.hours ?? null,
    );
  }
  return shell(null, markets);
}

function gateVenue(feeds: PerpsFeeds, observations: Observation[]): PerpsVenueSnapshot {
  const spec = perpsDirectSpec("Gate");
  const shell = (error: string | null, markets: PerpsMarketSnapshot[] = []) =>
    shellFromSpec(spec, feeds.capturedAt, error, markets);
  if (feeds.gate.error) return shell(feeds.gate.error);
  const contracts = indexBy(listFrom(feeds.gate.contracts), "name");
  const markets: PerpsMarketSnapshot[] = [];
  for (const row of listFrom(feeds.gate.tickers)) {
    const ticker = rec(row);
    if (!ticker) continue;
    const symbol = text(ticker.contract);
    const meta = contracts.get(symbol);
    const contractType = meta ? text(meta.contract_type) : "";
    if (!meta || (contractType !== "stocks" && contractType !== "indices")) continue;
    const underlying = normPerpSymbol(symbol);
    const classifiedName = classified(underlying, { forceIndex: contractType === "indices" });
    const price = px(ticker.mark_price);
    const oi =
      ticker.total_size === undefined || ticker.total_size === null
        ? null
        : mul(vol(ticker.total_size), vol(meta.quanto_multiplier), price);
    observe(
      observations,
      markets,
      symbol,
      classifiedName.underlying,
      classifiedName.category,
      vol(ticker.volume_24h_quote),
      oi,
      price,
      rate(ticker.funding_rate),
      null,
      perpsFundingIntervalHours(meta.funding_interval, "seconds"),
    );
  }
  return shell(null, markets);
}

function plates(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function mexcVenue(feeds: PerpsFeeds, observations: Observation[]): PerpsVenueSnapshot {
  const spec = perpsDirectSpec("MEXC");
  const shell = (error: string | null, markets: PerpsMarketSnapshot[] = []) =>
    shellFromSpec(spec, feeds.capturedAt, error, markets);
  if (feeds.mexc.error) return shell(feeds.mexc.error);
  const detail = indexBy(listFrom(feeds.mexc.detail), "symbol");
  const markets: PerpsMarketSnapshot[] = [];
  for (const row of listFrom(feeds.mexc.ticker)) {
    const ticker = rec(row);
    if (!ticker) continue;
    const symbol = text(ticker.symbol);
    const meta = detail.get(symbol);
    const concepts = plates(meta?.conceptPlate);
    if (!meta || !concepts.some((item) => item.includes("Stock"))) continue;
    const underlying = normPerpSymbol(symbol);
    const classifiedName = classified(underlying, {
      forceIndex: concepts.some((item) => item.includes("stockindex")),
    });
    const price = px(ticker.fairPrice);
    observe(
      observations,
      markets,
      symbol,
      classifiedName.underlying,
      classifiedName.category,
      vol(ticker.amount24),
      mul(vol(ticker.holdVol), vol(meta.contractSize), price),
      price,
      rate(ticker.fundingRate),
    );
  }
  return shell(null, markets);
}

function asterVenue(feeds: PerpsFeeds, observations: Observation[]): PerpsVenueSnapshot {
  const spec = perpsDirectSpec("Aster");
  const shell = (error: string | null, markets: PerpsMarketSnapshot[] = []) =>
    shellFromSpec(spec, feeds.capturedAt, error, markets);
  if (feeds.aster.error) return shell(feeds.aster.error);
  const info = indexBy(listFrom(feeds.aster.exchangeInfo, "symbols"), "symbol");
  const markets: PerpsMarketSnapshot[] = [];
  for (const row of listFrom(feeds.aster.ticker)) {
    const ticker = rec(row);
    if (!ticker) continue;
    const symbol = text(ticker.symbol);
    const meta = info.get(symbol);
    const subtypes = asList(meta?.underlyingSubType).map((item) => String(item));
    if (!meta || !subtypes.includes("STOCK") || text(meta.status) !== "TRADING") continue;
    const underlying = normPerpSymbol(symbol);
    const classifiedName = classified(underlying);
    observe(
      observations,
      markets,
      symbol,
      classifiedName.underlying,
      classifiedName.category,
      vol(ticker.quoteVolume),
      null,
      px(ticker.lastPrice),
    );
  }
  return shell(null, markets);
}

function kucoinVenue(feeds: PerpsFeeds, observations: Observation[]): PerpsVenueSnapshot {
  const spec = perpsDirectSpec("KuCoin");
  const shell = (error: string | null, markets: PerpsMarketSnapshot[] = []) =>
    shellFromSpec(spec, feeds.capturedAt, error, markets);
  if (feeds.kucoin.error) return shell(feeds.kucoin.error);
  const markets: PerpsMarketSnapshot[] = [];
  for (const row of listFrom(feeds.kucoin.data)) {
    const contract = rec(row);
    if (!contract || text(contract.assetClass) !== "STOCK" || text(contract.status) !== "Open") continue;
    const symbol = text(contract.symbol);
    const underlying = normPerpSymbol(symbol);
    const classifiedName = classified(underlying);
    const price = px(contract.markPrice);
    const oi =
      contract.openInterest === undefined || contract.openInterest === null
        ? null
        : mul(vol(contract.openInterest), vol(contract.multiplier), price);
    observe(
      observations,
      markets,
      symbol,
      classifiedName.underlying,
      classifiedName.category,
      vol(contract.turnoverOf24h),
      oi,
      price,
      rate(contract.fundingFeeRate),
    );
  }
  return shell(null, markets);
}

function extendedVenue(feeds: PerpsFeeds, observations: Observation[]): PerpsVenueSnapshot {
  const spec = perpsDirectSpec("Extended");
  const shell = (error: string | null, markets: PerpsMarketSnapshot[] = []) =>
    shellFromSpec(spec, feeds.capturedAt, error, markets);
  if (feeds.extended.error) return shell(feeds.extended.error);
  const allowed = new Set(["Equity", "ETF/Index", "Pre-market"]);
  const markets: PerpsMarketSnapshot[] = [];
  for (const row of listFrom(feeds.extended.data)) {
    const item = rec(row);
    if (!item || text(item.category) !== "RWA" || !allowed.has(text(item.subCategory)) || item.active !== true) {
      continue;
    }
    const symbol = text(item.name);
    const underlying = normPerpSymbol(symbol);
    const classifiedName = classified(underlying, { forcePreipo: text(item.subCategory) === "Pre-market" });
    const stats = rec(item.marketStats);
    observe(
      observations,
      markets,
      symbol,
      classifiedName.underlying,
      classifiedName.category,
      vol(stats?.dailyVolume),
      vol(stats?.openInterest),
      px(stats?.markPrice),
      rate(stats?.fundingRate),
    );
  }
  return shell(null, markets);
}

function lighterFundingRates(feeds: PerpsFeeds): Map<string, number> {
  const map = new Map<string, number>();
  const feed = feeds.lighterFunding;
  if (!feed || feed.error || feed.data == null) return map;
  for (const row of listFrom(feed.data, "funding_rates")) {
    const item = rec(row);
    if (!item || text(item.exchange) !== "lighter") continue;
    const symbol = text(item.symbol);
    const fundingRate = rate(item.rate);
    if (!symbol || fundingRate === null) continue;
    map.set(symbol, fundingRate);
  }
  return map;
}

function bookVenue(
  feeds: PerpsFeeds,
  reference: ReferenceBook,
  which: "lighter" | "lighterRobinhood",
): PerpsVenueSnapshot {
  const robinhood = which === "lighterRobinhood";
  const spec = perpsDirectSpec(robinhood ? "Lighter on Robinhood Chain" : "Lighter");
  const feed = robinhood ? feeds.lighterRobinhood : feeds.lighter;
  const shell = (error: string | null, markets: PerpsMarketSnapshot[] = []) =>
    shellFromSpec(spec, feeds.capturedAt, error, markets);
  if (feed.error) return shell(feed.error);
  const lighterRates = robinhood ? new Map<string, number>() : lighterFundingRates(feeds);
  const markets: PerpsMarketSnapshot[] = [];
  const root = rec(feed.data);
  for (const row of asList(root?.order_book_details)) {
    const book = rec(row);
    if (!book || text(book.status) !== "active") continue;
    const symbol = text(book.symbol);
    const bookRate = rate(book.funding_rate) ?? rate(book.last_funding_rate);
    const price = px(book.mark_price);
    pushUntagged(
      markets,
      reference,
      symbol,
      price,
      vol(book.daily_quote_token_volume),
      mul(vol(book.open_interest), price),
      bookRate ?? lighterRates.get(symbol) ?? null,
    );
  }
  return shell(null, markets);
}

function ondoVenue(feeds: PerpsFeeds, reference: ReferenceBook): PerpsVenueSnapshot {
  const spec = perpsDirectSpec("Ondo Perps");
  const shell = (error: string | null, markets: PerpsMarketSnapshot[] = []) =>
    shellFromSpec(spec, feeds.capturedAt, error, markets);
  if (feeds.ondo.error) return shell(feeds.ondo.error);
  const markets: PerpsMarketSnapshot[] = [];
  const root = rec(feeds.ondo.data);
  for (const row of asList(root?.result)) {
    const contract = rec(row);
    if (!contract || contract.disabled === true) continue;
    pushUntagged(
      markets,
      reference,
      text(contract.market),
      px(contract.lastPrice),
      vol(contract.usdVolume),
      vol(contract.openInterestUsd),
      rate(contract.fundingRate) ?? rate(contract.funding),
    );
  }
  return shell(null, markets);
}

function variationalVenue(feeds: PerpsFeeds, reference: ReferenceBook): PerpsVenueSnapshot {
  const spec = perpsDirectSpec("Variational Omni");
  const shell = (error: string | null, markets: PerpsMarketSnapshot[] = []) =>
    shellFromSpec(spec, feeds.capturedAt, error, markets);
  if (feeds.variational.error) return shell(feeds.variational.error);
  const markets: PerpsMarketSnapshot[] = [];
  const root = rec(feeds.variational.data);
  for (const row of asList(root?.listings)) {
    const listing = rec(row);
    if (!listing) continue;
    let symbol = text(listing.ticker);
    if (symbol === "US500") symbol = "SPY";
    const oi = rec(listing.open_interest);
    const longOi = vol(oi?.long_open_interest);
    const shortOi = vol(oi?.short_open_interest);
    const openInterest = longOi === null && shortOi === null ? null : (longOi ?? 0) + (shortOi ?? 0);
    pushUntagged(
      markets,
      reference,
      symbol,
      px(listing.mark_price),
      vol(listing.volume_24h),
      openInterest,
      rate(listing.funding_rate),
    );
  }
  return shell(null, markets);
}

function krakenVenue(feeds: PerpsFeeds, reference: ReferenceBook): PerpsVenueSnapshot {
  const spec = perpsDirectSpec("Kraken Futures");
  const shell = (error: string | null, markets: PerpsMarketSnapshot[] = []) =>
    shellFromSpec(spec, feeds.capturedAt, error, markets);
  if (feeds.kraken.error) return shell(feeds.kraken.error);
  const markets: PerpsMarketSnapshot[] = [];
  const root = rec(feeds.kraken.data);
  for (const row of asList(root?.tickers)) {
    const ticker = rec(row);
    if (!ticker || text(ticker.tag) !== "perpetual" || ticker.suspended === true) continue;
    const price = px(ticker.markPrice);
    const oi =
      ticker.openInterest === undefined || ticker.openInterest === null ? null : mul(vol(ticker.openInterest), price);
    pushUntagged(
      markets,
      reference,
      text(ticker.symbol),
      price,
      vol(ticker.volumeQuote),
      oi,
      rate(ticker.fundingRate),
    );
  }
  return shell(null, markets);
}

function bingxVenue(feeds: PerpsFeeds): PerpsVenueSnapshot {
  const spec = perpsDirectSpec("BingX");
  const shell = (error: string | null, markets: PerpsMarketSnapshot[] = []) =>
    shellFromSpec(spec, feeds.capturedAt, error, markets);
  if (feeds.bingx.error) return shell(feeds.bingx.error);
  const markets: PerpsMarketSnapshot[] = [];
  for (const row of listFrom(feeds.bingx.data)) {
    const ticker = rec(row);
    if (!ticker) continue;
    const symbol = text(ticker.symbol).toUpperCase();
    const matched = /^NC(SK|SI)(.+?)2USD-USDT$/.exec(symbol);
    if (!matched) continue;
    const kind = matched[1];
    const raw = matched[2] ?? "";
    const aliased = BINGX_INDEX_ALIAS[raw] ?? raw;
    const underlying = normPerpSymbol(aliased);
    if (underlying === "H100" || underlying === "B200") continue;
    const classifiedName = classified(underlying, { forceIndex: kind === "SI" });
    if (!isStoredEquityCategory(classifiedName.category)) continue;
    markets.push(
      market(
        symbol,
        classifiedName.underlying,
        classifiedName.category,
        vol(ticker.quoteVolume),
        null,
        px(ticker.lastPrice),
        null,
        rate(ticker.fundingRate),
      ),
    );
  }
  return shell(null, markets);
}

function optionalShell(
  feed: { error: string | null } | undefined,
): { skip: true } | { skip: false; error: string | null } {
  if (!feed) return { skip: true };
  return { skip: false, error: feed.error };
}

function toobitVenue(feeds: PerpsFeeds, reference: ReferenceBook): PerpsVenueSnapshot | null {
  const spec = perpsDirectSpec("Toobit");
  const gate = optionalShell(feeds.toobit);
  if (gate.skip) return null;
  const shell = (error: string | null, markets: PerpsMarketSnapshot[] = []) =>
    shellFromSpec(spec, feeds.capturedAt, error, markets);
  if (gate.error) return shell(gate.error);
  const markets: PerpsMarketSnapshot[] = [];
  for (const row of asList(feeds.toobit?.data)) {
    const ticker = rec(row);
    if (!ticker) continue;
    const symbol = text(ticker.s);
    if (!symbol.endsWith("-SWAP-USDT")) continue;
    const price = px(ticker.c);
    pushUntagged(markets, reference, symbol, price, vol(ticker.qv), null);
  }
  return shell(null, markets);
}

function xtVenue(feeds: PerpsFeeds, observations: Observation[]): PerpsVenueSnapshot | null {
  const feed = feeds.xt;
  if (!feed) return null;
  const spec = perpsDirectSpec("XT.COM");
  const shell = (error: string | null, markets: PerpsMarketSnapshot[] = []) =>
    shellFromSpec(spec, feeds.capturedAt, error, markets);
  if (feed.error) return shell(feed.error);
  const symbolRoot = rec(rec(feed.symbols)?.result);
  const meta = indexBy(asList(symbolRoot?.symbols), "symbol");
  const markets: PerpsMarketSnapshot[] = [];
  for (const row of listFrom(feed.tickers, "result")) {
    const ticker = rec(row);
    if (!ticker) continue;
    const symbol = text(ticker.s).toLowerCase();
    const info = meta.get(symbol);
    if (!info || text(info.contractType) !== "PERPETUAL" || info.tradeSwitch === false) continue;
    const labels = asList(info.labels).map((item) => String(item));
    const stock = labels.includes("STOCK");
    const index = labels.includes("INDEX");
    if (!stock && !index) continue;
    const underlying = normPerpSymbol(symbol);
    const classifiedName = classified(underlying, { forceIndex: index });
    observe(observations, markets, symbol, classifiedName.underlying, classifiedName.category, vol(ticker.v), null, px(ticker.c));
  }
  return shell(null, markets);
}

function bitunixVenue(feeds: PerpsFeeds, reference: ReferenceBook): PerpsVenueSnapshot | null {
  const feed = feeds.bitunix;
  if (!feed) return null;
  const spec = perpsDirectSpec("Bitunix");
  const shell = (error: string | null, markets: PerpsMarketSnapshot[] = []) =>
    shellFromSpec(spec, feeds.capturedAt, error, markets);
  if (feed.error) return shell(feed.error);
  const markets: PerpsMarketSnapshot[] = [];
  for (const row of listFrom(feed.data)) {
    const ticker = rec(row);
    if (!ticker) continue;
    const price = px(ticker.markPrice) ?? px(ticker.lastPrice);
    pushUntagged(markets, reference, text(ticker.symbol), price, vol(ticker.quoteVol), null);
  }
  return shell(null, markets);
}

function whitebitVenue(feeds: PerpsFeeds, reference: ReferenceBook): PerpsVenueSnapshot | null {
  const feed = feeds.whitebit;
  if (!feed) return null;
  const spec = perpsDirectSpec("WhiteBIT");
  const shell = (error: string | null, markets: PerpsMarketSnapshot[] = []) =>
    shellFromSpec(spec, feeds.capturedAt, error, markets);
  if (feed.error) return shell(feed.error);
  const markets: PerpsMarketSnapshot[] = [];
  for (const row of listFrom(feed.data, "result")) {
    const ticker = rec(row);
    if (!ticker) continue;
    const price = px(ticker.index_price) ?? px(ticker.last_price);
    pushUntagged(
      markets,
      reference,
      text(ticker.ticker_id),
      price,
      vol(ticker.money_volume),
      mul(vol(ticker.open_interest), price),
      rate(ticker.funding_rate),
    );
  }
  return shell(null, markets);
}

function phemexVenue(feeds: PerpsFeeds, observations: Observation[]): PerpsVenueSnapshot | null {
  const feed = feeds.phemex;
  if (!feed) return null;
  const spec = perpsDirectSpec("Phemex");
  const shell = (error: string | null, markets: PerpsMarketSnapshot[] = []) =>
    shellFromSpec(spec, feeds.capturedAt, error, markets);
  if (feed.error) return shell(feed.error);
  const products = asList(rec(rec(feed.products)?.data)?.perpProductsV2);
  const tickers = indexBy(listFrom(feed.tickers, "result"), "symbol");
  const markets: PerpsMarketSnapshot[] = [];
  for (const row of products) {
    const product = rec(row);
    if (!product) continue;
    const sub = text(product.perpProductSubType);
    if ((sub !== "TradFi" && sub !== "PreMarket") || text(product.status) !== "Listed") continue;
    const symbol = text(product.symbol);
    const ticker = tickers.get(symbol);
    if (!ticker) continue;
    const underlying = normPerpSymbol(text(product.contractUnderlyingAssets) || symbol);
    const classifiedName = classified(underlying, { forcePreipo: sub === "PreMarket" });
    const price = px(ticker.markRp) ?? px(ticker.lastRp);
    observe(
      observations,
      markets,
      symbol,
      classifiedName.underlying,
      classifiedName.category,
      vol(ticker.turnoverRv),
      mul(vol(ticker.openInterestRv), price),
      price,
      rate(ticker.fundingRateRr),
    );
  }
  return shell(null, markets);
}

function btseVenue(feeds: PerpsFeeds, reference: ReferenceBook): PerpsVenueSnapshot | null {
  const feed = feeds.btse;
  if (!feed) return null;
  const spec = perpsDirectSpec("BTSE");
  const shell = (error: string | null, markets: PerpsMarketSnapshot[] = []) =>
    shellFromSpec(spec, feeds.capturedAt, error, markets);
  if (feed.error) return shell(feed.error);
  const markets: PerpsMarketSnapshot[] = [];
  for (const row of asList(feed.data)) {
    const ticker = rec(row);
    if (!ticker || ticker.active === false) continue;
    const symbol = text(ticker.symbol);
    if (!symbol.endsWith("PFC")) continue;
    pushUntagged(
      markets,
      reference,
      symbol.slice(0, -3),
      px(ticker.last),
      vol(ticker.volume),
      vol(ticker.openInterestUSD),
    );
  }
  return shell(null, markets);
}

function deribitVenue(feeds: PerpsFeeds, reference: ReferenceBook): PerpsVenueSnapshot | null {
  const feed = feeds.deribit;
  if (!feed) return null;
  const spec = perpsDirectSpec("Deribit");
  const shell = (error: string | null, markets: PerpsMarketSnapshot[] = []) =>
    shellFromSpec(spec, feeds.capturedAt, error, markets);
  if (feed.error) return shell(feed.error);
  const markets: PerpsMarketSnapshot[] = [];
  for (const row of listFrom(feed.data, "result")) {
    const ticker = rec(row);
    if (!ticker) continue;
    const instrument = text(ticker.instrument_name);
    if (!instrument.endsWith("-PERPETUAL")) continue;
    const price = px(ticker.mark_price);
    pushUntagged(
      markets,
      reference,
      text(ticker.base_currency) || instrument,
      price,
      vol(ticker.volume_usd),
      mul(vol(ticker.open_interest), price),
      rate(ticker.funding_8h) ?? rate(ticker.current_funding),
    );
  }
  return shell(null, markets);
}

function htxVenue(feeds: PerpsFeeds, observations: Observation[]): PerpsVenueSnapshot | null {
  const feed = feeds.htx;
  if (!feed) return null;
  const spec = perpsDirectSpec("HTX");
  const note = feed.oiError
    ? `Rolling 24h trade_turnover. Equity flag is tradfi_labels Stocks or Indices. Open interest left blank (${feed.oiError}).`
    : spec.note;
  const shell = (error: string | null, markets: PerpsMarketSnapshot[] = []) =>
    shellFromSpec(spec, feeds.capturedAt, error, markets, note);
  if (feed.error) return shell(feed.error);
  const info = indexBy(listFrom(feed.info), "contract_code");
  const oi = indexBy(listFrom(feed.openInterest), "contract_code");
  const markets: PerpsMarketSnapshot[] = [];
  for (const row of listFrom(feed.ticker, "ticks")) {
    const ticker = rec(row);
    if (!ticker) continue;
    const code = text(ticker.contract_code);
    const meta = info.get(code);
    const labels = asList(meta?.tradfi_labels).map((item) => String(item));
    if (!meta || meta.contract_status !== 1) continue;
    if (!labels.includes("Stocks") && !labels.includes("Indices")) continue;
    const underlying = normPerpSymbol(text(meta.symbol) || code);
    const classifiedName = classified(underlying, { forceIndex: labels.includes("Indices") });
    const price = px(ticker.close);
    observe(
      observations,
      markets,
      code,
      classifiedName.underlying,
      classifiedName.category,
      vol(ticker.trade_turnover),
      vol(oi.get(code)?.value),
      price,
    );
  }
  return shell(null, markets);
}

function cryptoVenue(feeds: PerpsFeeds, observations: Observation[]): PerpsVenueSnapshot | null {
  const feed = feeds.crypto;
  if (!feed) return null;
  const spec = perpsDirectSpec("Crypto.com");
  const shell = (error: string | null, markets: PerpsMarketSnapshot[] = []) =>
    shellFromSpec(spec, feeds.capturedAt, error, markets);
  if (feed.error) return shell(feed.error);
  const instruments = indexBy(asList(rec(rec(feed.instruments)?.result)?.data), "symbol");
  const markets: PerpsMarketSnapshot[] = [];
  for (const row of asList(rec(rec(feed.tickers)?.result)?.data)) {
    const ticker = rec(row);
    if (!ticker) continue;
    const symbol = text(ticker.i);
    const inst = instruments.get(symbol);
    if (!inst || inst.tradable === false) continue;
    const kind = text(inst.product_type);
    if (kind !== "EQUITY" && kind !== "EQUITY_IND" && kind !== "PRE_IPO") continue;
    const underlying = normPerpSymbol(text(inst.base_ccy) || symbol);
    const classifiedName = classified(underlying, { forcePreipo: kind === "PRE_IPO" });
    const price = px(ticker.k) ?? px(ticker.a);
    observe(
      observations,
      markets,
      symbol,
      classifiedName.underlying,
      classifiedName.category,
      vol(ticker.vv),
      mul(vol(ticker.oi), price),
      price,
    );
  }
  return shell(null, markets);
}

function lbankVenue(feeds: PerpsFeeds, reference: ReferenceBook): PerpsVenueSnapshot | null {
  const feed = feeds.lbank;
  if (!feed) return null;
  const spec = perpsDirectSpec("LBank");
  const shell = (error: string | null, markets: PerpsMarketSnapshot[] = []) =>
    shellFromSpec(spec, feeds.capturedAt, error, markets);
  if (feed.error) return shell(feed.error);
  const markets: PerpsMarketSnapshot[] = [];
  for (const row of listFrom(feed.data)) {
    const ticker = rec(row);
    if (!ticker || String(ticker.instrumentStatus) !== "2") continue;
    const price = px(ticker.markedPrice) ?? px(ticker.lastPrice);
    pushUntagged(markets, reference, text(ticker.symbol), price, vol(ticker.turnover), null, rate(ticker.fundingRate));
  }
  return shell(null, markets);
}

function grvtVenue(feeds: PerpsFeeds, observations: Observation[]): PerpsVenueSnapshot | null {
  const feed = feeds.grvt;
  if (!feed) return null;
  const spec = perpsDirectSpec("GRVT");
  const shell = (error: string | null, markets: PerpsMarketSnapshot[] = []) =>
    shellFromSpec(spec, feeds.capturedAt, error, markets);
  if (feed.error) return shell(feed.error);
  const root = rec(feed.data);
  const tickers = new Map<string, Record<string, unknown>>();
  for (const row of asList(root?.tickers)) {
    const body = rec(row);
    const result = rec(body?.result) ?? body;
    const instrument = result ? text(result.instrument) : "";
    if (result && instrument) tickers.set(instrument, result);
  }
  const markets: PerpsMarketSnapshot[] = [];
  for (const row of asList(root?.instruments)) {
    const inst = rec(row);
    if (!inst || text(inst.asset_class) !== "EQUITY" || text(inst.status) !== "ACTIVE") continue;
    const instrument = text(inst.instrument);
    const ticker = tickers.get(instrument);
    if (!ticker) continue;
    const underlying = normPerpSymbol(text(inst.base) || instrument);
    const classifiedName = classified(underlying);
    const price = px(ticker.mark_price);
    const buy = vol(ticker.buy_volume_24h_q);
    const sell = vol(ticker.sell_volume_24h_q);
    const volume = buy === null && sell === null ? null : (buy ?? 0) + (sell ?? 0);
    observe(
      observations,
      markets,
      instrument,
      classifiedName.underlying,
      classifiedName.category,
      volume,
      mul(vol(ticker.open_interest), price),
      price,
      rate(ticker.funding_rate),
    );
  }
  return shell(null, markets);
}

function apexVenue(feeds: PerpsFeeds, observations: Observation[]): PerpsVenueSnapshot | null {
  const feed = feeds.apex;
  if (!feed) return null;
  const spec = perpsDirectSpec("ApeX Omni");
  const shell = (error: string | null, markets: PerpsMarketSnapshot[] = []) =>
    shellFromSpec(spec, feeds.capturedAt, error, markets);
  if (feed.error) return shell(feed.error);
  const root = rec(feed.data);
  const bySymbol = new Map<string, Record<string, unknown>>();
  for (const row of asList(root?.tickers)) {
    const body = rec(row);
    const ticker = rec(asList(body?.data)[0]);
    const symbol = ticker ? text(ticker.symbol) : "";
    if (ticker && symbol) bySymbol.set(symbol, ticker);
  }
  const markets: PerpsMarketSnapshot[] = [];
  for (const row of asList(root?.contracts)) {
    const contract = rec(row);
    if (!contract || contract.enableTrade === false) continue;
    const query = text(contract.crossSymbolName);
    const ticker = bySymbol.get(query);
    if (!ticker) continue;
    const underlying = normPerpSymbol(text(contract.symbol) || query);
    const classifiedName = classified(underlying, { forcePreipo: contract.isPrelaunch === true });
    const price = px(ticker.markPrice) ?? px(ticker.lastPrice);
    observe(
      observations,
      markets,
      query || text(contract.symbol),
      classifiedName.underlying,
      classifiedName.category,
      vol(ticker.turnover24h),
      mul(vol(ticker.openInterest), price),
      price,
      rate(ticker.fundingRate),
    );
  }
  return shell(null, markets);
}

function nadoVenue(feeds: PerpsFeeds, reference: ReferenceBook): PerpsVenueSnapshot | null {
  const feed = feeds.nado;
  if (!feed) return null;
  const spec = perpsDirectSpec("Nado");
  const shell = (error: string | null, markets: PerpsMarketSnapshot[] = []) =>
    shellFromSpec(spec, feeds.capturedAt, error, markets);
  if (feed.error) return shell(feed.error);
  const root = rec(feed.data);
  if (!root) return shell("Empty Nado book.");
  const markets: PerpsMarketSnapshot[] = [];
  for (const value of Object.values(root)) {
    const contract = rec(value);
    if (!contract || text(contract.product_type) !== "perpetual") continue;
    const base = text(contract.base_currency).replace(/-PERP$/, "");
    pushUntagged(
      markets,
      reference,
      base,
      px(contract.mark_price) ?? px(contract.last_price),
      vol(contract.quote_volume),
      vol(contract.open_interest_usd),
      rate(contract.funding_rate),
    );
  }
  return shell(null, markets);
}

function pacificaVenue(feeds: PerpsFeeds, reference: ReferenceBook): PerpsVenueSnapshot | null {
  const feed = feeds.pacifica;
  if (!feed) return null;
  const spec = perpsDirectSpec("Pacifica");
  const shell = (error: string | null, markets: PerpsMarketSnapshot[] = []) =>
    shellFromSpec(spec, feeds.capturedAt, error, markets);
  if (feed.error) return shell(feed.error);
  const markets: PerpsMarketSnapshot[] = [];
  for (const row of listFrom(feed.data)) {
    const ticker = rec(row);
    if (!ticker) continue;
    const price = px(ticker.mark);
    pushUntagged(
      markets,
      reference,
      text(ticker.symbol),
      price,
      vol(ticker.volume_24h),
      mul(vol(ticker.open_interest), price),
      rate(ticker.funding),
    );
  }
  return shell(null, markets);
}

function orderlyVenue(feeds: PerpsFeeds, reference: ReferenceBook): PerpsVenueSnapshot | null {
  const feed = feeds.orderly;
  if (!feed) return null;
  const spec = perpsDirectSpec("Orderly");
  const shell = (error: string | null, markets: PerpsMarketSnapshot[] = []) =>
    shellFromSpec(spec, feeds.capturedAt, error, markets);
  if (feed.error) return shell(feed.error);
  const markets: PerpsMarketSnapshot[] = [];
  for (const row of asList(rec(rec(feed.data)?.data)?.rows)) {
    const ticker = rec(row);
    if (!ticker || text(ticker.status) !== "ACTIVE" || text(ticker.broker_id)) continue;
    const price = px(ticker.mark_price);
    pushUntagged(
      markets,
      reference,
      text(ticker.display_symbol_name) || text(ticker.symbol),
      price,
      vol(ticker["24h_amount"]),
      mul(vol(ticker.open_interest), price),
      rate(ticker.last_funding_rate),
    );
  }
  return shell(null, markets);
}

function paradexVenue(feeds: PerpsFeeds, reference: ReferenceBook): PerpsVenueSnapshot | null {
  const feed = feeds.paradex;
  if (!feed) return null;
  const spec = perpsDirectSpec("Paradex");
  const shell = (error: string | null, markets: PerpsMarketSnapshot[] = []) =>
    shellFromSpec(spec, feeds.capturedAt, error, markets);
  if (feed.error) return shell(feed.error);
  const markets: PerpsMarketSnapshot[] = [];
  for (const row of listFrom(feed.data, "results")) {
    const ticker = rec(row);
    if (!ticker) continue;
    const symbol = text(ticker.symbol);
    if (!symbol.endsWith("-USD-PERP")) continue;
    const price = px(ticker.mark_price);
    pushUntagged(
      markets,
      reference,
      symbol,
      price,
      vol(ticker.volume_24h),
      mul(vol(ticker.open_interest), price),
      rate(ticker.funding_rate),
    );
  }
  return shell(null, markets);
}

interface CgPoint {
  underlying: string;
  price: number | null;
  openInterestUsd: number | null;
  fundingRate: number | null;
}

function coingeckoVenues(
  feeds: PerpsFeeds,
  reference: ReferenceBook,
  archiveSymbols: { binance: PerpsArchiveSymbol[]; bybit: PerpsArchiveSymbol[] },
): { venues: PerpsVenueSnapshot[]; points: Map<string, CgPoint[]> } {
  const points = new Map<string, CgPoint[]>();
  const specs = CG_SPECS;
  if (feeds.coingecko.error) {
    return {
      venues: specs.map((item) =>
        emptyVenue(item.venue, item.tier, coingeckoVenueSource(item.market), "rolling-24h", item.note, feeds.capturedAt, feeds.coingecko.error),
      ),
      points,
    };
  }
  const buckets = new Map<string, PerpsMarketSnapshot[]>(specs.map((item) => [item.market, []]));
  const specByMarket = new Map(specs.map((item) => [item.market, item]));
  for (const row of asList(feeds.coingecko.data)) {
    const ticker = rec(row);
    if (!ticker || text(ticker.contract_type) !== "perpetual") continue;
    const marketName = text(ticker.market);
    if (PERPS_COINGECKO_NAMED_SKIP.has(marketName)) continue;
    const symbol = text(ticker.index_id) || text(ticker.symbol);
    const price = px(ticker.price);
    const matched = matchUntaggedPerp(symbol, price, reference);
    const point: CgPoint = {
      underlying: matched?.underlying ?? normPerpSymbol(symbol),
      price,
      openInterestUsd: vol(ticker.open_interest),
      fundingRate: rate(ticker.funding_rate),
    };
    const list = points.get(marketName) ?? [];
    list.push(point);
    points.set(marketName, list);
    if (DIRECT_CG_MARKETS.has(marketName) || !specByMarket.has(marketName) || !matched) continue;
    const quote = vol(ticker.volume_24h);
    buckets.get(marketName)?.push(
      market(symbol, matched.underlying, matched.category, quote, vol(ticker.open_interest), price, null, rate(ticker.funding_rate)),
    );
    const exchangeSymbol = text(ticker.symbol).toUpperCase();
    if (!/^[A-Z0-9]{2,30}USDT$/.test(exchangeSymbol)) continue;
    if (marketName === "Binance (Futures)") archiveSymbols.binance.push({ symbol: exchangeSymbol, volumeUsd: quote });
    if (marketName === "Bybit (Futures)") archiveSymbols.bybit.push({ symbol: exchangeSymbol, volumeUsd: quote });
  }
  return {
    venues: specs.map((item) =>
      venueShell(
        item.venue,
        item.tier,
        coingeckoVenueSource(item.market),
        "rolling-24h",
        item.note,
        feeds.capturedAt,
        null,
        buckets.get(item.market) ?? [],
      ),
    ),
    points,
  };
}

function fillMissingOpenInterest(venues: PerpsVenueSnapshot[], points: Map<string, CgPoint[]>): void {
  for (const venue of venues) {
    const marketName = CG_OI_MARKETS[venue.venue];
    const rows = marketName ? points.get(marketName) : undefined;
    if (!rows || rows.length === 0) continue;
    let filled = 0;
    for (const market of venue.markets) {
      const needsOi = market.openInterestUsd === null;
      const needsFunding = market.fundingRate === undefined || market.fundingRate === null;
      if (!needsOi && !needsFunding) continue;
      const hit = rows.find((row) => {
        if (row.underlying !== market.underlying) return false;
        if (market.category === "index") return true;
        if (market.priceUsd === null || row.price === null || row.price <= 0 || market.priceUsd <= 0) return false;
        const ratio = market.priceUsd / row.price;
        return ratio >= PERPS_PRICE_BAND_MIN && ratio <= PERPS_PRICE_BAND_MAX;
      });
      if (!hit) continue;
      if (needsOi && hit.openInterestUsd !== null) {
        market.openInterestUsd = hit.openInterestUsd;
        filled += 1;
      }
      if (needsFunding && hit.fundingRate !== null) market.fundingRate = hit.fundingRate;
    }
    if (filled > 0 && !venue.windowNote.includes("CoinGecko")) {
      venue.windowNote = `${venue.windowNote} Open interest filled from CoinGecko where the venue feed left it blank.`;
    }
  }
}

function annotateCredibility(venue: PerpsVenueSnapshot): PerpsVenueSnapshot {
  const screen = perpsScreenInputs(venue.markets);
  const screenReason = perpsExcludeReason(screen.volumeUsd, screen.openInterestUsd);
  const named = screenReason === null ? PERPS_NAMED_OUTLIERS[venue.venue] : undefined;
  const excludeReason = screenReason ?? named ?? null;
  return { ...venue, credible: excludeReason === null, excludeReason };
}

/** A successful onchain book with no equity markets stays in the file under the same venue name. */
function markQuietOnchainBook(venue: PerpsVenueSnapshot): PerpsVenueSnapshot {
  if (venue.noEquity) return venue;
  if (venue.tier !== "onchain" || venue.error || venue.markets.length > 0) return venue;
  const sentence = "Book returned and contained no equity markets.";
  const windowNote = venue.windowNote.includes(sentence) ? venue.windowNote : `${venue.windowNote} ${sentence}`.trim();
  return { ...venue, noEquity: true, windowNote };
}

function ostiumVenue(feeds: PerpsFeeds): PerpsVenueSnapshot {
  const spec = perpsDirectSpec("Ostium");
  const shell = (error: string | null, markets: PerpsMarketSnapshot[] = []) =>
    shellFromSpec(spec, feeds.capturedAt, error, markets);
  if (feeds.ostium.error) return shell(feeds.ostium.error);
  const markets: PerpsMarketSnapshot[] = [];
  const root = rec(feeds.ostium.data);
  for (const row of asList(root?.pairs)) {
    const pair = rec(row);
    const group = rec(pair?.group);
    const groupName = text(group?.name);
    if (!pair || (groupName !== "stocks" && groupName !== "etf" && groupName !== "indices")) continue;
    let underlying = normPerpSymbol(text(pair.from));
    if (underlying === "SPX") underlying = "US500";
    const base = classifyPerpUnderlying(underlying);
    if (base === "nonequity" || base === "etf-nonequity" || base === "preipo") continue;
    const classifiedName = classified(underlying, { forceGroupIndex: groupName === "indices" });
    if (!isStoredEquityCategory(classifiedName.category)) continue;
    const price = px(pair.lastTradePrice);
    const longUnits = vol(pair.longOIInUnits);
    const shortUnits = vol(pair.shortOIInUnits);
    const oi =
      price === null || (longUnits === null && shortUnits === null)
        ? null
        : mul((longUnits ?? 0) + (shortUnits ?? 0), price);
    markets.push(
      market(
        text(pair.symbol) || underlying,
        classifiedName.underlying,
        classifiedName.category,
        null,
        oi,
        price,
        vol(pair.volumeInUsd),
      ),
    );
  }
  return shell(null, markets);
}

function utcCaptureDate(capturedAt: string): string {
  const ms = Date.parse(capturedAt);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toISOString().slice(0, 10);
}

function verantaHistory(payload: unknown): { date: string; pairVolumes: unknown[] }[] {
  const root = rec(payload);
  const rows = root ? asList(root.history) : asList(payload);
  const out: { date: string; pairVolumes: unknown[] }[] = [];
  for (const row of rows) {
    const item = rec(row);
    const date = item ? text(item.date) : "";
    if (!item || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Array.isArray(item.pairVolumes)) continue;
    out.push({ date, pairVolumes: item.pairVolumes });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** Avantis was renamed Veranta. One venue. Volume is the last complete UTC day. */
function verantaVenue(feeds: PerpsFeeds): PerpsVenueSnapshot {
  const spec = perpsDirectSpec("Veranta");
  const shell = (error: string | null, markets: PerpsMarketSnapshot[] = [], note = spec.note) =>
    shellFromSpec(spec, feeds.capturedAt, error, markets, note);
  if (feeds.avantis.error) return shell(feeds.avantis.error);
  const infos = rec(rec(rec(feeds.avantis.data)?.data)?.pairInfos);
  if (!infos) return shell(null, []);
  const captureDate = utcCaptureDate(feeds.capturedAt);
  const volumes = feeds.veranta;
  let day: { date: string; pairVolumes: unknown[] } | null = null;
  let volumeNote = "";
  if (!volumes) {
    volumeNote = " Daily volume was not on this capture, so volume stays blank.";
  } else if (volumes.error) {
    volumeNote = ` Daily volume left blank (${volumes.error}).`;
  } else {
    const complete = verantaHistory(volumes.data).filter((row) => row.date < captureDate);
    day = complete[complete.length - 1] ?? null;
    volumeNote = day
      ? ` Daily volume is the last complete UTC day ${day.date}. The ${captureDate || "capture"} row is partial and is not blended in.`
      : " Daily history has no complete UTC day before this capture, so volume stays blank rather than using the partial day.";
  }
  const markets: PerpsMarketSnapshot[] = [];
  for (const [key, value] of Object.entries(infos)) {
    const pair = rec(value);
    if (!pair || pair.isPairListed !== true || String(pair.groupIndex) !== "6") continue;
    const index = Number(key);
    const from = text(pair.from);
    const underlying = normPerpSymbol(from);
    const classifiedName = classified(underlying);
    if (!isStoredEquityCategory(classifiedName.category) && classifiedName.category !== "preipo") continue;
    const oi = rec(pair.openInterest);
    const longOi = vol(oi?.long);
    const shortOi = vol(oi?.short);
    const openInterest = longOi === null && shortOi === null ? null : (longOi ?? 0) + (shortOi ?? 0);
    const printed = day && Number.isInteger(index) && index >= 0 && index < day.pairVolumes.length ? vol(day.pairVolumes[index]) : null;
    const to = text(pair.to);
    markets.push(
      market(to ? `${from}/${to}` : from, classifiedName.underlying, classifiedName.category, day ? printed : null, openInterest, null),
    );
  }
  return shell(null, markets, `${spec.note}${volumeNote}`);
}

function driftVenue(feeds: PerpsFeeds): PerpsVenueSnapshot {
  const spec = perpsDirectSpec("Drift");
  const venue = shellFromSpec(spec, feeds.capturedAt, null, []);
  venue.noEquity = true;
  return venue;
}

function resultList(payload: unknown): unknown[] {
  const result = rec(payload)?.result;
  const listed = asList(rec(result)?.list);
  if (listed.length > 0) return listed;
  return listFrom(payload, "list");
}

function zoomexVenue(feeds: PerpsFeeds, observations: Observation[]): PerpsVenueSnapshot | null {
  const feed = feeds.zoomex;
  if (!feed) return null;
  const spec = perpsDirectSpec("Zoomex");
  const shell = (error: string | null, markets: PerpsMarketSnapshot[] = []) =>
    shellFromSpec(spec, feeds.capturedAt, error, markets);
  if (feed.error) return shell(feed.error);
  const meta = indexBy(resultList(feed.instruments), "symbol");
  const markets: PerpsMarketSnapshot[] = [];
  for (const row of resultList(feed.tickers)) {
    const ticker = rec(row);
    if (!ticker) continue;
    const symbol = text(ticker.symbol);
    const inst = meta.get(symbol);
    const tags = asList(inst?.tags).map((item) => String(item));
    if (!inst || text(inst.status) !== "Trading" || !tags.includes("Stock")) continue;
    const underlying = normPerpSymbol(text(inst.baseCoin) || symbol);
    const classifiedName = classified(underlying);
    const price = px(ticker.markPrice) ?? px(ticker.lastPrice);
    // instruments-info fundingInterval is minutes (480 = 8h). turnover24h is already
    // quote USD (volume × price ≈ 1). CoinGecko prints about 0.30× this figure and
    // is not applied. Contract size is not a multiplier.
    const intervalMinutes = asReportedNumber(inst.fundingInterval);
    const hours =
      perpsFundingIntervalHours(intervalMinutes === null ? null : intervalMinutes / 60, "hours") ??
      perpsFundingIntervalHours(ticker.fundingIntervalHour, "hours");
    observe(
      observations,
      markets,
      symbol,
      classifiedName.underlying,
      classifiedName.category,
      vol(ticker.turnover24h),
      vol(ticker.openInterestValue),
      price,
      rate(ticker.fundingRate),
      null,
      hours,
    );
  }
  return shell(null, markets);
}

function plateNames(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item));
  if (typeof value === "string" && value) return [value];
  return [];
}

function ourbitVenue(feeds: PerpsFeeds, observations: Observation[]): PerpsVenueSnapshot | null {
  const feed = feeds.ourbit;
  if (!feed) return null;
  const spec = perpsDirectSpec("Ourbit");
  const shell = (error: string | null, markets: PerpsMarketSnapshot[] = []) =>
    shellFromSpec(spec, feeds.capturedAt, error, markets);
  if (feed.error) return shell(feed.error);
  const detail = indexBy(listFrom(feed.detail), "symbol");
  const markets: PerpsMarketSnapshot[] = [];
  for (const row of listFrom(feed.ticker)) {
    const ticker = rec(row);
    if (!ticker) continue;
    const symbol = text(ticker.symbol);
    const meta = detail.get(symbol);
    if (!meta || String(meta.state) !== "0") continue;
    const plates = plateNames(meta.conceptPlate);
    if (!plates.includes("ob_trade_zone_stock") && !plates.includes("ob_trade_zone_etf")) continue;
    const underlying = normPerpSymbol(text(meta.baseCoin) || symbol);
    const classifiedName = classified(underlying);
    const price = px(ticker.fairPrice) ?? px(ticker.lastPrice);
    // holdVol is contracts. Quote open interest is holdVol × contractSize × fairPrice.
    // amount24 is already quote notional.
    const oi = mul(vol(ticker.holdVol), vol(meta.contractSize), price);
    observe(
      observations,
      markets,
      symbol,
      classifiedName.underlying,
      classifiedName.category,
      vol(ticker.amount24),
      oi,
      price,
      rate(ticker.fundingRate),
    );
  }
  return shell(null, markets);
}

function arcusVenue(feeds: PerpsFeeds, observations: Observation[]): PerpsVenueSnapshot | null {
  const feed = feeds.arcus;
  if (!feed) return null;
  const spec = perpsDirectSpec("Arcus");
  const shell = (error: string | null, markets: PerpsMarketSnapshot[] = []) =>
    shellFromSpec(spec, feeds.capturedAt, error, markets);
  if (feed.error) return shell(feed.error);
  const markets: PerpsMarketSnapshot[] = [];
  for (const row of listFrom(feed.data, "markets")) {
    const ticker = rec(row);
    if (!ticker || text(ticker.status) !== "ONLINE") continue;
    const category = text(ticker.category);
    if (category !== "EQUITIES" && category !== "INDICES") continue;
    const underlying = normPerpSymbol(text(ticker.baseAsset));
    const classifiedName = classified(underlying, { forceIndex: category === "INDICES" });
    const price = px(ticker.markPrice) ?? px(ticker.lastTradePrice);
    observe(
      observations,
      markets,
      text(ticker.marketDisplayName) || underlying,
      classifiedName.underlying,
      classifiedName.category,
      vol(ticker.volume24hNotional),
      mul(vol(ticker.openInterest), price),
      price,
      rate(ticker.fundingRate),
    );
  }
  return shell(null, markets);
}

function vestPrice(ticker: Record<string, unknown>): number | null {
  const close = px(ticker.closePrice);
  if (close !== null) return close;
  const open = px(ticker.openPrice);
  if (open !== null) return open;
  const high = px(ticker.highPrice);
  const low = px(ticker.lowPrice);
  if (high !== null && low !== null) return (high + low) / 2;
  return high ?? low;
}

function vestVenue(feeds: PerpsFeeds, observations: Observation[]): PerpsVenueSnapshot | null {
  const feed = feeds.vest;
  if (!feed) return null;
  const spec = perpsDirectSpec("Vest");
  const shell = (error: string | null, markets: PerpsMarketSnapshot[] = []) =>
    shellFromSpec(spec, feeds.capturedAt, error, markets);
  if (feed.error) return shell(feed.error);
  const tickers = indexBy(listFrom(feed.tickers, "tickers"), "symbol");
  const markets: PerpsMarketSnapshot[] = [];
  let stocks = 0;
  for (const row of listFrom(feed.info, "symbols")) {
    const info = rec(row);
    if (!info || text(info.asset) !== "stock") continue;
    stocks += 1;
    const symbol = text(info.symbol);
    const ticker = tickers.get(symbol);
    const quote = ticker ? vol(ticker.quoteVolume) : null;
    const trading = text(info.tradingStatus) === "TRADING";
    if (!trading && !(quote !== null && quote > 0)) continue;
    const underlying = normPerpSymbol(text(info.base) || symbol);
    const classifiedName = classified(underlying);
    observe(
      observations,
      markets,
      symbol,
      classifiedName.underlying,
      classifiedName.category,
      quote,
      null,
      ticker ? vestPrice(ticker) : null,
    );
  }
  if (stocks > 0 && markets.length === 0) return shell("Vest listed stock markets but no ticker parsed.");
  return shell(null, markets);
}

function polymarketHours(value: unknown): number | null {
  const raw = text(value).trim().toLowerCase();
  const match = /^(\d+(?:\.\d+)?)(h|hr|hrs|hour|hours|m|min|mins)?$/.exec(raw);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2] ?? "h";
  return perpsFundingIntervalHours(unit.startsWith("m") ? amount / 60 : amount, "hours");
}

function polymarketVenue(feeds: PerpsFeeds, observations: Observation[]): PerpsVenueSnapshot | null {
  const feed = feeds.polymarket;
  if (!feed) return null;
  const spec = perpsDirectSpec("Polymarket Perps");
  const shell = (error: string | null, markets: PerpsMarketSnapshot[] = []) =>
    shellFromSpec(spec, feeds.capturedAt, error, markets);
  if (feed.error) return shell(feed.error);
  const stats = new Map<string, Record<string, unknown>>();
  for (const row of asList(feed.statistics)) {
    const item = rec(row);
    if (!item) continue;
    const id = text(item.instrument_id) || String(item.instrument_id ?? "");
    if (id) stats.set(id, item);
    const symbol = text(item.symbol);
    if (symbol) stats.set(symbol, item);
  }
  const markets: PerpsMarketSnapshot[] = [];
  for (const row of asList(feed.instruments)) {
    const inst = rec(row);
    if (!inst || text(inst.instrument_type) !== "perpetual") continue;
    const category = text(inst.category);
    if (category !== "equity" && category !== "index") continue;
    const id = text(inst.instrument_id) || String(inst.instrument_id ?? "");
    const stat = stats.get(id) ?? stats.get(text(inst.symbol));
    if (!stat) continue;
    const underlying = normPerpSymbol(text(inst.base_asset) || text(inst.symbol));
    const classifiedName = classified(underlying, { forceIndex: category === "index" });
    // statistics.volume is the rolling 24h quote notional. The 2026-10-20 sample
    // matched CoinGecko. This payload has no open interest.
    observe(
      observations,
      markets,
      text(inst.symbol) || underlying,
      classifiedName.underlying,
      classifiedName.category,
      vol(stat.volume),
      null,
      null,
      null,
      null,
      polymarketHours(inst.funding_interval),
    );
  }
  return shell(null, markets);
}

function blofinVenue(feeds: PerpsFeeds, observations: Observation[]): PerpsVenueSnapshot | null {
  const feed = feeds.blofin;
  if (!feed) return null;
  const spec = perpsDirectSpec("BloFin");
  const shell = (error: string | null, markets: PerpsMarketSnapshot[] = []) =>
    shellFromSpec(spec, feeds.capturedAt, error, markets);
  if (feed.error) return shell(feed.error);
  const meta = indexBy(listFrom(feed.instruments), "instId");
  const markets: PerpsMarketSnapshot[] = [];
  for (const row of listFrom(feed.tickers)) {
    const ticker = rec(row);
    if (!ticker) continue;
    const symbol = text(ticker.instId);
    const inst = meta.get(symbol);
    if (!inst || text(inst.state) !== "live") continue;
    const assetClass = text(inst.assetClass);
    if (assetClass !== "Stocks" && assetClass !== "Indices") continue;
    const underlying = normPerpSymbol(text(inst.baseCurrency) || symbol);
    const classifiedName = classified(underlying, { forceIndex: assetClass === "Indices" });
    const price = px(ticker.last);
    // volCurrency24h is base size (vol24h × contractValue). Notional is that size × last.
    observe(
      observations,
      markets,
      symbol,
      classifiedName.underlying,
      classifiedName.category,
      mul(vol(ticker.volCurrency24h), price),
      null,
      price,
    );
  }
  return shell(null, markets);
}

function risexVenue(feeds: PerpsFeeds, observations: Observation[]): PerpsVenueSnapshot | null {
  const feed = feeds.risex;
  if (!feed) return null;
  const spec = perpsDirectSpec("RISEx");
  const shell = (error: string | null, markets: PerpsMarketSnapshot[] = []) =>
    shellFromSpec(spec, feeds.capturedAt, error, markets);
  if (feed.error) return shell(feed.error);
  const markets: PerpsMarketSnapshot[] = [];
  const rows = asList(rec(rec(feed.data)?.data)?.markets);
  for (const row of rows) {
    const ticker = rec(row);
    if (!ticker || ticker.active === false) continue;
    const category = text(ticker.category);
    if (category !== "stocks" && category !== "index_etf") continue;
    const base = text(ticker.display_base_asset_symbol) || text(ticker.base_asset_symbol);
    const underlying = normPerpSymbol(base.split("/")[0] || base);
    const classifiedName = classified(underlying);
    const price = px(ticker.mark_price) ?? px(ticker.last_price);
    const interval = asReportedNumber(ticker.funding_interval);
    const hours =
      interval === null
        ? null
        : perpsFundingIntervalHours(interval >= 1_000_000_000 ? interval / 1_000_000_000 : interval, "seconds");
    observe(
      observations,
      markets,
      text(ticker.display_name) || base,
      classifiedName.underlying,
      classifiedName.category,
      vol(ticker.quote_volume_24h),
      mul(vol(ticker.open_interest), price),
      price,
      rate(ticker.current_funding_rate),
      null,
      hours,
    );
  }
  return shell(null, markets);
}

function edgexTickerRow(payload: unknown): Record<string, unknown> | null {
  const data = rec(payload)?.data;
  return rec(asList(data)[0]) ?? rec(data);
}

function edgexVenue(feeds: PerpsFeeds, observations: Observation[]): PerpsVenueSnapshot | null {
  const feed = feeds.edgex;
  if (!feed) return null;
  const spec = perpsDirectSpec("edgeX");
  const shell = (error: string | null, markets: PerpsMarketSnapshot[] = []) =>
    shellFromSpec(spec, feeds.capturedAt, error, markets);
  if (feed.error) return shell(feed.error);
  const contracts = asList(rec(rec(feed.meta)?.data)?.contractList);
  const stocks = contracts.filter((row) => rec(row)?.isStock === true);
  const markets: PerpsMarketSnapshot[] = [];
  for (const row of asList(feed.tickers)) {
    const ticker = edgexTickerRow(row) ?? rec(row);
    if (!ticker || ticker.isStock === true) continue;
    const name = text(ticker.contractName);
    if (!name) continue;
    const underlying = normPerpSymbol(name);
    const classifiedName = classified(underlying);
    const price = px(ticker.markPrice) ?? px(ticker.lastPrice);
    const start = asReportedNumber(ticker.fundingTime);
    const next = asReportedNumber(ticker.nextFundingTime);
    const hours =
      start !== null && next !== null && next > start ? perpsFundingIntervalHours((next - start) / 3_600_000, "hours") : null;
    // value is quote 24h notional. openInterest is base size.
    observe(
      observations,
      markets,
      name,
      classifiedName.underlying,
      classifiedName.category,
      vol(ticker.value),
      mul(vol(ticker.openInterest), price),
      price,
      rate(ticker.fundingRate),
      null,
      hours,
    );
  }
  if (stocks.length > 0 && markets.length === 0) return shell("edgeX listed stock contracts but no ticker parsed.");
  return shell(null, markets);
}

function gmxVenue(
  feeds: PerpsFeeds,
  reference: ReferenceBook,
  key: "gmxSolana" | "gmxArbitrum",
  venueName: "GMX V2 (Solana)" | "GMX V2 (Arbitrum)",
): PerpsVenueSnapshot | null {
  const feed = feeds[key];
  if (!feed) return null;
  const spec = perpsDirectSpec(venueName);
  const shell = (error: string | null, markets: PerpsMarketSnapshot[] = []) =>
    shellFromSpec(spec, feeds.capturedAt, error, markets);
  if (feed.error) return shell(feed.error);
  const markets: PerpsMarketSnapshot[] = [];
  for (const row of asList(feed.data)) {
    const pair = rec(row);
    if (!pair || text(pair.product_type) !== "Perpetual") continue;
    const price = px(pair.last_price);
    const minutes = asReportedNumber(pair.funding_interval_minutes);
    pushUntagged(
      markets,
      reference,
      text(pair.base_currency) || text(pair.ticker_id),
      price,
      vol(pair.target_volume),
      vol(pair.open_interest),
      rate(pair.funding_rate),
      minutes === null ? null : perpsFundingIntervalHours(minutes / 60, "hours"),
    );
  }
  return shell(null, markets);
}

function helixVenue(feeds: PerpsFeeds, reference: ReferenceBook): PerpsVenueSnapshot | null {
  const feed = feeds.helix;
  if (!feed) return null;
  const spec = perpsDirectSpec("Helix");
  const shell = (error: string | null, markets: PerpsMarketSnapshot[] = []) =>
    shellFromSpec(spec, feeds.capturedAt, error, markets);
  if (feed.error) return shell(feed.error);
  const summary = new Map<string, Record<string, unknown>>();
  for (const row of asList(feed.summary)) {
    const item = rec(row);
    const id = item ? text(item.marketId) : "";
    if (item && id) summary.set(id, item);
  }
  const markets: PerpsMarketSnapshot[] = [];
  for (const row of listFrom(feed.markets, "markets")) {
    const item = rec(row);
    const marketRow = rec(item?.market);
    if (!item || !marketRow || text(marketRow.status) !== "Active") continue;
    const id = text(marketRow.market_id);
    const ticker = text(marketRow.ticker);
    const base = ticker.split("/")[0] ?? "";
    const stats = summary.get(id);
    if (!stats || !base) continue;
    pushUntagged(markets, reference, base, px(stats.price) ?? px(item.mark_price), vol(stats.volume), null);
  }
  return shell(null, markets);
}

function bitstampVenue(feeds: PerpsFeeds, reference: ReferenceBook): PerpsVenueSnapshot | null {
  const feed = feeds.bitstamp;
  if (!feed) return null;
  const spec = perpsDirectSpec("Bitstamp");
  const shell = (error: string | null, markets: PerpsMarketSnapshot[] = []) =>
    shellFromSpec(spec, feeds.capturedAt, error, markets);
  if (feed.error) return shell(feed.error);
  const markets: PerpsMarketSnapshot[] = [];
  for (const row of asList(feed.data)) {
    const ticker = rec(row);
    if (!ticker || text(ticker.market_type) !== "PERPETUAL") continue;
    const pair = text(ticker.pair) || text(ticker.market);
    const base = pair.split("/")[0] ?? "";
    const price = px(ticker.mark_price) ?? px(ticker.last);
    const vwap = px(ticker.vwap) ?? price;
    pushUntagged(markets, reference, base, price, mul(vol(ticker.volume), vwap), vol(ticker.open_interest_value));
  }
  return shell(null, markets);
}

function standxVenue(feeds: PerpsFeeds, reference: ReferenceBook): PerpsVenueSnapshot | null {
  const feed = feeds.standx;
  if (!feed) return null;
  const spec = perpsDirectSpec("StandX");
  const shell = (error: string | null, markets: PerpsMarketSnapshot[] = []) =>
    shellFromSpec(spec, feeds.capturedAt, error, markets);
  if (feed.error) return shell(feed.error);
  const markets: PerpsMarketSnapshot[] = [];
  for (const row of asList(feed.markets)) {
    const ticker = rec(row);
    if (!ticker) continue;
    const price = px(ticker.mark_price) ?? px(ticker.last_price);
    pushUntagged(
      markets,
      reference,
      text(ticker.symbol) || text(ticker.base),
      price,
      vol(ticker.volume_quote_24h),
      vol(ticker.open_interest_notional),
      rate(ticker.funding_rate),
    );
  }
  return shell(null, markets);
}

function bitfinexVenue(feeds: PerpsFeeds, observations: Observation[]): PerpsVenueSnapshot | null {
  const feed = feeds.bitfinex;
  if (!feed) return null;
  const spec = perpsDirectSpec("Bitfinex");
  const shell = (error: string | null, markets: PerpsMarketSnapshot[] = []) =>
    shellFromSpec(spec, feeds.capturedAt, error, markets);
  if (feed.error) return shell(feed.error);
  const markets: PerpsMarketSnapshot[] = [];
  for (const row of asList(feed.data)) {
    if (!Array.isArray(row)) continue;
    const symbol = text(row[0]);
    const match = /^t([A-Z0-9]+)IXF0:USTF0$/.exec(symbol);
    if (!match?.[1]) continue;
    const classifiedName = classified(match[1], { forceIndex: true });
    const last = px(row[7]);
    observe(
      observations,
      markets,
      symbol,
      classifiedName.underlying,
      classifiedName.category,
      mul(vol(row[8]), last),
      null,
      last,
    );
  }
  return shell(null, markets);
}

function weexVenue(feeds: PerpsFeeds, observations: Observation[]): PerpsVenueSnapshot | null {
  const feed = feeds.weex;
  if (!feed) return null;
  const spec = perpsDirectSpec("WEEX");
  const shell = (error: string | null, markets: PerpsMarketSnapshot[] = []) =>
    shellFromSpec(spec, feeds.capturedAt, error, markets);
  if (feed.error) return shell(feed.error);
  const meta = indexBy(asList(rec(feed.exchangeInfo)?.symbols), "symbol");
  const oiBySymbol = new Map<string, number>();
  for (const row of asList(feed.openInterest)) {
    const item = rec(row);
    if (!item) continue;
    const symbol = text(item.symbol);
    const base = vol(item.openInterest);
    if (symbol && base !== null) oiBySymbol.set(symbol, base);
  }
  const markets: PerpsMarketSnapshot[] = [];
  for (const row of asList(feed.tickers)) {
    const ticker = rec(row);
    if (!ticker) continue;
    const symbol = text(ticker.symbol);
    const info = meta.get(symbol);
    if (!info || text(info.contractType) !== "TRADIFI_PERPETUAL") continue;
    const kind = text(info.underlyingType);
    if (!WEEX_EQUITY_TYPES.has(kind)) continue;
    const underlying = normPerpSymbol(text(info.baseAsset) || symbol);
    const classifiedName = classified(underlying, { forcePreipo: kind === "Pre-IPO" });
    const price = px(ticker.markPrice) ?? px(ticker.lastPrice);
    const oiBase = oiBySymbol.get(symbol);
    observe(
      observations,
      markets,
      symbol,
      classifiedName.underlying,
      classifiedName.category,
      weexQuoteVolumeUsd(ticker),
      oiBase === undefined ? null : mul(oiBase, price),
      price,
    );
  }
  return shell(null, markets);
}

function coinbaseVenue(feeds: PerpsFeeds, observations: Observation[]): PerpsVenueSnapshot | null {
  const feed = feeds.coinbase;
  if (!feed) return null;
  const spec = perpsDirectSpec("Coinbase International");
  const shell = (error: string | null, markets: PerpsMarketSnapshot[] = [], note = spec.note) =>
    shellFromSpec(spec, feeds.capturedAt, error, markets, note);
  if (feed.error) return shell(feed.error);
  const markets: PerpsMarketSnapshot[] = [];
  let listed = 0;
  let paused = 0;
  for (const row of asList(feed.data)) {
    const instrument = rec(row);
    if (!instrument || text(instrument.type) !== "PERP") continue;
    const kind = text(instrument.underlying_type);
    if (kind !== "EQUITY" && kind !== "EQUITY_ETF" && kind !== "PREIPO") continue;
    const state = text(instrument.trading_state);
    if (state === "DELISTED") continue;
    const underlying = normPerpSymbol(text(instrument.base_asset_name) || text(instrument.symbol));
    const classifiedName = classified(underlying, { forcePreipo: kind === "PREIPO" });
    if (!isStoredEquityCategory(classifiedName.category) && classifiedName.category !== "preipo") continue;
    listed += 1;
    const notional = vol(instrument.notional_24hr);
    const volume = state === "PAUSED" ? 0 : notional;
    if (state === "PAUSED") paused += 1;
    observe(
      observations,
      markets,
      text(instrument.symbol) || underlying,
      classifiedName.underlying,
      classifiedName.category,
      volume,
      null,
      null,
    );
  }
  const note =
    listed > 0 && paused === listed
      ? `${spec.note} All ${listed} equity instruments on this feed are paused, so 24h notional is $0.`
      : spec.note;
  return shell(null, markets, note);
}

export function parseEquityPerpsFeeds(feeds: PerpsFeeds): PerpsDaySnapshot {
  const capturedMs = Date.parse(feeds.capturedAt);
  const date = easternDayKey((Number.isFinite(capturedMs) ? capturedMs : Date.now()) / 1000);
  if (!date) throw new Error("Equity-perp capture has no America/New_York day.");

  const referenceObservations: Observation[] = [];
  const tagged: PerpsVenueSnapshot[] = [
    ...hyperliquidVenues(feeds, referenceObservations),
    bitgetVenue(feeds, referenceObservations),
    okxVenue(feeds, referenceObservations),
    gateVenue(feeds, referenceObservations),
    mexcVenue(feeds, referenceObservations),
    asterVenue(feeds, referenceObservations),
    kucoinVenue(feeds, referenceObservations),
    extendedVenue(feeds, referenceObservations),
  ];
  for (const venue of [
    xtVenue(feeds, referenceObservations),
    phemexVenue(feeds, referenceObservations),
    htxVenue(feeds, referenceObservations),
    grvtVenue(feeds, referenceObservations),
    apexVenue(feeds, referenceObservations),
    weexVenue(feeds, referenceObservations),
    coinbaseVenue(feeds, referenceObservations),
    cryptoVenue(feeds, referenceObservations),
    zoomexVenue(feeds, referenceObservations),
    ourbitVenue(feeds, referenceObservations),
    arcusVenue(feeds, referenceObservations),
    vestVenue(feeds, referenceObservations),
    polymarketVenue(feeds, referenceObservations),
    blofinVenue(feeds, referenceObservations),
    risexVenue(feeds, referenceObservations),
    edgexVenue(feeds, referenceObservations),
  ]) {
    if (venue) tagged.push(venue);
  }
  const reference = buildReference(referenceObservations);
  const archiveSymbols = { binance: [] as PerpsArchiveSymbol[], bybit: [] as PerpsArchiveSymbol[] };
  const coingecko = coingeckoVenues(feeds, reference, archiveSymbols);
  const venues = [
    ...tagged,
    bookVenue(feeds, reference, "lighter"),
    bookVenue(feeds, reference, "lighterRobinhood"),
    ondoVenue(feeds, reference),
    variationalVenue(feeds, reference),
    krakenVenue(feeds, reference),
    bingxVenue(feeds),
    ...coingecko.venues,
    ostiumVenue(feeds),
    verantaVenue(feeds),
    driftVenue(feeds),
  ];
  for (const venue of [
    toobitVenue(feeds, reference),
    bitunixVenue(feeds, reference),
    whitebitVenue(feeds, reference),
    btseVenue(feeds, reference),
    deribitVenue(feeds, reference),
    lbankVenue(feeds, reference),
    nadoVenue(feeds, reference),
    pacificaVenue(feeds, reference),
    orderlyVenue(feeds, reference),
    paradexVenue(feeds, reference),
    gmxVenue(feeds, reference, "gmxSolana", "GMX V2 (Solana)"),
    gmxVenue(feeds, reference, "gmxArbitrum", "GMX V2 (Arbitrum)"),
    helixVenue(feeds, reference),
    bitstampVenue(feeds, reference),
    standxVenue(feeds, reference),
    bitfinexVenue(feeds, referenceObservations),
  ]) {
    if (venue) venues.push(venue);
  }
  fillMissingOpenInterest(venues, coingecko.points);
  const annotated = venues.map(annotateCredibility).map(markQuietOnchainBook).sort((a, b) => a.venue.localeCompare(b.venue));

  return {
    date,
    capturedAt: feeds.capturedAt,
    venues: annotated,
    archiveSymbols,
  };
}
