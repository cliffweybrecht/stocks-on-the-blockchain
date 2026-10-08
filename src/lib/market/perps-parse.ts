import {
  classifyPerpUnderlying,
  isStoredEquityCategory,
  normPerpSymbol,
  type PerpsCategory,
  type PerpsClass,
} from "./perps-classify";
import { asNonNegativeNumber } from "./numbers";
import type { PerpsDaySnapshot, PerpsMarketSnapshot, PerpsTier, PerpsVenueSnapshot, PerpsVolumeWindow } from "./perps-snapshot";
import { easternDayKey } from "./volume-snapshots";

/**
 * Pure builder for one equity-perp snapshot. Network I/O lives in perps-fetch.
 * Tagged venues (exchange asset-class flags) seed the reference price.
 * Untagged venues match a normalized ticker only when the mark is within
 * 0.8–1.25 of that median. Long-tail CoinGecko venues are dropped.
 * Hyperliquid hourly candles report base size, not USD notional, so they
 * are not turned into an ET-day figure.
 */

const PRICE_BAND_MIN = 0.8;
const PRICE_BAND_MAX = 1.25;

const HL_NONEQ = new Set(["ANSEM", "TREAD", "BTCD", "TOTAL2", "OTHERS", "BVIV", "10Y", "2Y", "30Y", "USBOND"]);

const DIRECT_CG_MARKETS = new Set([
  "Hyperliquid (Futures)",
  "Bitget Futures",
  "OKX (Futures)",
  "Gate (Futures)",
  "MEXC (Futures)",
  "Aster (Futures)",
  "Lighter",
  "Robinhood Chain Lighter (Futures)",
  "Ondo Perps",
  "Extended",
  "Variational Omni",
  "KuCoin Futures",
  "Kraken (Futures)",
  "BingX (Futures)",
  "dYdX Chain",
  "Gate DEX",
]);

/** Headline CoinGecko venues. Everything else on that feed is not credible. */
const CREDIBLE_CG_MARKETS = new Set(["Binance (Futures)", "Bybit (Futures)"]);

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
  okx: { instruments: unknown; tickers: unknown; openInterest: unknown; oiError: string | null; error: string | null };
  gate: { tickers: unknown; contracts: unknown; error: string | null };
  mexc: { ticker: unknown; detail: unknown; error: string | null };
  aster: { ticker: unknown; exchangeInfo: unknown; error: string | null };
  kucoin: PerpsFeedResult<unknown>;
  extended: PerpsFeedResult<unknown>;
  lighter: PerpsFeedResult<unknown>;
  lighterRobinhood: PerpsFeedResult<unknown>;
  ondo: PerpsFeedResult<unknown>;
  variational: PerpsFeedResult<unknown>;
  kraken: PerpsFeedResult<unknown>;
  bingx: PerpsFeedResult<unknown>;
  coingecko: PerpsFeedResult<unknown>;
  ostium: PerpsFeedResult<unknown>;
  avantis: PerpsFeedResult<unknown>;
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
  category: PerpsCategory,
  volume24hUsd: number | null,
  openInterestUsd: number | null,
  priceUsd: number | null,
  lifetimeVolumeUsd?: number | null,
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
  return row;
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
  lifetimeVolumeUsd?: number | null,
): void {
  observations.push({ underlying, category, price: priceUsd });
  if (!isStoredEquityCategory(category)) return;
  markets.push(market(symbol, underlying, category, volume24hUsd, openInterestUsd, priceUsd, lifetimeVolumeUsd));
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
): { underlying: string; category: PerpsCategory } | null {
  let underlying = normPerpSymbol(symbol);
  if (!reference.set.has(underlying) && underlying.endsWith("X") && reference.set.has(underlying.slice(0, -1))) {
    underlying = underlying.slice(0, -1);
  }
  const category = classifyPerpUnderlying(underlying);
  if (category === "nonequity" || category === "etf-nonequity" || category === "preipo") return null;
  if (category === "index") return { underlying, category };
  const ref = reference.prices.get(underlying);
  if (ref === undefined || price === null || ref <= 0) return null;
  const ratio = price / ref;
  if (ratio < PRICE_BAND_MIN || ratio > PRICE_BAND_MAX) return null;
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

function pushUntagged(
  markets: PerpsMarketSnapshot[],
  reference: ReferenceBook,
  symbol: string,
  price: number | null,
  volume24hUsd: number | null,
  openInterestUsd: number | null,
): void {
  const matched = matchUntaggedPerp(symbol, price, reference);
  if (!matched) return;
  markets.push(
    market(symbol, matched.underlying, matched.category, volume24hUsd, openInterestUsd, price),
  );
}

function hyperliquidVenues(feeds: PerpsFeeds, observations: Observation[]): PerpsVenueSnapshot[] {
  const sourceFor = (dex: string) =>
    `POST https://api.hyperliquid.xyz/info {"type":"metaAndAssetCtxs","dex":"${dex}"}`;
  const note =
    "Rolling 24h notional (dayNtlVlm). Hourly candles are base size, not USD, so this is not an ET-day sum.";
  if (feeds.hyperliquid.error && feeds.hyperliquid.dexs.length === 0) {
    return [
      emptyVenue(
        "Hyperliquid HIP-3",
        "onchain",
        "POST https://api.hyperliquid.xyz/info {\"type\":\"perpDexs\"}",
        "rolling-24h",
        note,
        feeds.capturedAt,
        feeds.hyperliquid.error,
      ),
    ];
  }
  const venues: PerpsVenueSnapshot[] = [];
  for (const dexFeed of feeds.hyperliquid.dexs) {
    const name = `Hyperliquid HIP-3 (${dexFeed.dex})`;
    if (dexFeed.error || dexFeed.book === null) {
      venues.push(
        emptyVenue(name, "onchain", sourceFor(dexFeed.dex), "rolling-24h", note, feeds.capturedAt, dexFeed.error),
      );
      continue;
    }
    const pair = asList(dexFeed.book);
    const meta = rec(pair[0]);
    const ctxs = asList(pair[1]);
    const universe = asList(meta?.universe);
    if (!meta || universe.length === 0 || ctxs.length === 0) {
      venues.push(
        emptyVenue(name, "onchain", sourceFor(dexFeed.dex), "rolling-24h", note, feeds.capturedAt, "Empty HIP-3 book."),
      );
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
      observe(
        observations,
        markets,
        rawName,
        classifiedName.underlying,
        classifiedName.category,
        vol(ctx.dayNtlVlm),
        oi,
        price,
      );
    }
    if (markets.length === 0) continue;
    venues.push(venueShell(name, "onchain", sourceFor(dexFeed.dex), "rolling-24h", note, feeds.capturedAt, null, markets));
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
  const source =
    "GET https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES (+ /contracts isRwa=YES)";
  const shell = (error: string | null, markets: PerpsMarketSnapshot[] = []) =>
    venueShell(
      "Bitget",
      "cex-direct",
      source,
      "rolling-24h",
      "Rolling 24h USDT volume. Equity flag is Bitget isRwa=YES.",
      feeds.capturedAt,
      error,
      markets,
    );
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
    );
  }
  return shell(null, markets);
}

function okxVenue(feeds: PerpsFeeds, observations: Observation[]): PerpsVenueSnapshot {
  const source =
    "GET https://www.okx.com/api/v5/market/tickers?instType=SWAP (volCcy24h × last) + /public/instruments instCategory=3 + /public/open-interest";
  const note = feeds.okx.oiError
    ? `Rolling 24h. Open interest left blank (${feeds.okx.oiError}). Equity flag is instCategory=3.`
    : "Rolling 24h (volCcy24h × last). Equity flag is instCategory=3.";
  const shell = (error: string | null, markets: PerpsMarketSnapshot[] = []) =>
    venueShell("OKX", "cex-direct", source, "rolling-24h", note, feeds.capturedAt, error, markets);
  if (feeds.okx.error) return shell(feeds.okx.error);
  const instruments = indexBy(listFrom(feeds.okx.instruments), "instId");
  const oi = new Map<string, number | null>();
  for (const row of listFrom(feeds.okx.openInterest)) {
    const record = rec(row);
    if (!record) continue;
    oi.set(text(record.instId), vol(record.oiUsd));
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
    observe(
      observations,
      markets,
      symbol,
      classifiedName.underlying,
      classifiedName.category,
      mul(vol(ticker.volCcy24h), price),
      oi.get(symbol) ?? null,
      price,
    );
  }
  return shell(null, markets);
}

function gateVenue(feeds: PerpsFeeds, observations: Observation[]): PerpsVenueSnapshot {
  const source = "GET https://api.gateio.ws/api/v4/futures/usdt/tickers (+ /contracts contract_type)";
  const shell = (error: string | null, markets: PerpsMarketSnapshot[] = []) =>
    venueShell(
      "Gate",
      "cex-direct",
      source,
      "rolling-24h",
      "Rolling 24h quote volume. Equity flag is contract_type stocks or indices.",
      feeds.capturedAt,
      error,
      markets,
    );
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
    );
  }
  return shell(null, markets);
}

function plates(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function mexcVenue(feeds: PerpsFeeds, observations: Observation[]): PerpsVenueSnapshot {
  const source =
    "GET https://contract.mexc.com/api/v1/contract/ticker (+ /contract/detail conceptPlate Stock)";
  const shell = (error: string | null, markets: PerpsMarketSnapshot[] = []) =>
    venueShell(
      "MEXC",
      "cex-direct",
      source,
      "rolling-24h",
      "Rolling 24h. Equity flag is conceptPlate Stock. Zero-fee / points venue.",
      feeds.capturedAt,
      error,
      markets,
    );
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
    );
  }
  return shell(null, markets);
}

function asterVenue(feeds: PerpsFeeds, observations: Observation[]): PerpsVenueSnapshot {
  const source =
    "GET https://fapi.asterdex.com/fapi/v1/ticker/24hr (+ exchangeInfo underlyingSubType STOCK)";
  const shell = (error: string | null, markets: PerpsMarketSnapshot[] = []) =>
    venueShell(
      "Aster",
      "onchain",
      source,
      "rolling-24h",
      "Rolling 24h quote volume. Equity flag is underlyingSubType STOCK. Open interest is not on this endpoint.",
      feeds.capturedAt,
      error,
      markets,
    );
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
  const source = "GET https://api-futures.kucoin.com/api/v1/contracts/active (assetClass=STOCK)";
  const shell = (error: string | null, markets: PerpsMarketSnapshot[] = []) =>
    venueShell(
      "KuCoin",
      "cex-direct",
      source,
      "rolling-24h",
      "Rolling 24h turnover. Equity flag is assetClass=STOCK.",
      feeds.capturedAt,
      error,
      markets,
    );
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
    );
  }
  return shell(null, markets);
}

function extendedVenue(feeds: PerpsFeeds, observations: Observation[]): PerpsVenueSnapshot {
  const source =
    "GET https://api.starknet.extended.exchange/api/v1/info/markets (category RWA, subCategory Equity|ETF/Index)";
  const shell = (error: string | null, markets: PerpsMarketSnapshot[] = []) =>
    venueShell(
      "Extended",
      "onchain",
      source,
      "rolling-24h",
      "Rolling 24h (dailyVolume). Equity flag is RWA Equity or ETF/Index. Pre-IPO is excluded.",
      feeds.capturedAt,
      error,
      markets,
    );
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
    );
  }
  return shell(null, markets);
}

function bookVenue(
  feeds: PerpsFeeds,
  reference: ReferenceBook,
  which: "lighter" | "lighterRobinhood",
): PerpsVenueSnapshot {
  const robinhood = which === "lighterRobinhood";
  const venueName = robinhood ? "Lighter on Robinhood Chain" : "Lighter";
  const host = robinhood ? "api.rh.lighter.xyz" : "mainnet.zklighter.elliot.ai";
  const source = `GET https://${host}/api/v1/orderBookDetails`;
  const feed = robinhood ? feeds.lighterRobinhood : feeds.lighter;
  const shell = (error: string | null, markets: PerpsMarketSnapshot[] = []) =>
    venueShell(
      venueName,
      "onchain",
      source,
      "rolling-24h",
      "Rolling 24h (daily_quote_token_volume). No asset-class flag; ticker plus price band. Zero-fee / points venue.",
      feeds.capturedAt,
      error,
      markets,
    );
  if (feed.error) return shell(feed.error);
  const markets: PerpsMarketSnapshot[] = [];
  const root = rec(feed.data);
  for (const row of asList(root?.order_book_details)) {
    const book = rec(row);
    if (!book || text(book.status) !== "active") continue;
    const price = px(book.mark_price);
    pushUntagged(
      markets,
      reference,
      text(book.symbol),
      price,
      vol(book.daily_quote_token_volume),
      mul(vol(book.open_interest), price),
    );
  }
  return shell(null, markets);
}

function ondoVenue(feeds: PerpsFeeds, reference: ReferenceBook): PerpsVenueSnapshot {
  const source = "GET https://api.ondoperps.xyz/v1/perps/contracts";
  const shell = (error: string | null, markets: PerpsMarketSnapshot[] = []) =>
    venueShell(
      "Ondo Perps",
      "onchain",
      source,
      "rolling-24h",
      "Rolling 24h usdVolume. No asset-class flag; ticker plus price band.",
      feeds.capturedAt,
      error,
      markets,
    );
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
    );
  }
  return shell(null, markets);
}

function variationalVenue(feeds: PerpsFeeds, reference: ReferenceBook): PerpsVenueSnapshot {
  const source = "GET https://omni-client-api.prod.ap-northeast-1.variational.io/metadata/stats";
  const shell = (error: string | null, markets: PerpsMarketSnapshot[] = []) =>
    venueShell(
      "Variational Omni",
      "onchain",
      source,
      "rolling-24h",
      "Rolling 24h. No asset-class flag; ticker plus price band. US500 is the SPY product. Zero-fee / points venue.",
      feeds.capturedAt,
      error,
      markets,
    );
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
    pushUntagged(markets, reference, symbol, px(listing.mark_price), vol(listing.volume_24h), openInterest);
  }
  return shell(null, markets);
}

function krakenVenue(feeds: PerpsFeeds, reference: ReferenceBook): PerpsVenueSnapshot {
  const source = "GET https://futures.kraken.com/derivatives/api/v3/tickers";
  const shell = (error: string | null, markets: PerpsMarketSnapshot[] = []) =>
    venueShell(
      "Kraken Futures",
      "cex-direct",
      source,
      "rolling-24h",
      "Rolling 24h (volumeQuote). No equity flag; ticker plus price band.",
      feeds.capturedAt,
      error,
      markets,
    );
  if (feeds.kraken.error) return shell(feeds.kraken.error);
  const markets: PerpsMarketSnapshot[] = [];
  const root = rec(feeds.kraken.data);
  for (const row of asList(root?.tickers)) {
    const ticker = rec(row);
    if (!ticker || text(ticker.tag) !== "perpetual" || ticker.suspended === true) continue;
    const price = px(ticker.markPrice);
    const oi =
      ticker.openInterest === undefined || ticker.openInterest === null ? null : mul(vol(ticker.openInterest), price);
    pushUntagged(markets, reference, text(ticker.symbol), price, vol(ticker.volumeQuote), oi);
  }
  return shell(null, markets);
}

function bingxVenue(feeds: PerpsFeeds): PerpsVenueSnapshot {
  const source = "GET https://open-api.bingx.com/openApi/swap/v2/quote/ticker (NCSK*/NCSI* symbols)";
  const shell = (error: string | null, markets: PerpsMarketSnapshot[] = []) =>
    venueShell(
      "BingX",
      "cex-direct",
      source,
      "rolling-24h",
      "Rolling 24h. Equity symbols use the NCSK (stock) or NCSI (index) prefix. Open interest is not on this endpoint.",
      feeds.capturedAt,
      error,
      markets,
    );
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
      ),
    );
  }
  return shell(null, markets);
}

function coingeckoVenues(feeds: PerpsFeeds, reference: ReferenceBook): PerpsVenueSnapshot[] {
  const source = "GET https://api.coingecko.com/api/v3/derivatives?include_tickers=unexpired";
  const note =
    "Rolling 24h via CoinGecko. Binance and Bybit block this host. Long-tail CoinGecko venues are excluded. Ticker plus price band.";
  const names: { market: string; venue: string }[] = [
    { market: "Binance (Futures)", venue: "Binance" },
    { market: "Bybit (Futures)", venue: "Bybit" },
  ];
  if (feeds.coingecko.error) {
    return names.map((item) =>
      emptyVenue(item.venue, "cex-coingecko", source, "rolling-24h", note, feeds.capturedAt, feeds.coingecko.error),
    );
  }
  const buckets = new Map<string, PerpsMarketSnapshot[]>(names.map((item) => [item.market, []]));
  for (const row of asList(feeds.coingecko.data)) {
    const ticker = rec(row);
    if (!ticker || text(ticker.contract_type) !== "perpetual") continue;
    const marketName = text(ticker.market);
    if (DIRECT_CG_MARKETS.has(marketName) || !CREDIBLE_CG_MARKETS.has(marketName)) continue;
    const bucket = buckets.get(marketName);
    if (!bucket) continue;
    const symbol = text(ticker.index_id) || text(ticker.symbol);
    const matched = matchUntaggedPerp(symbol, px(ticker.price), reference);
    if (!matched) continue;
    bucket.push(
      market(symbol, matched.underlying, matched.category, vol(ticker.volume_24h), vol(ticker.open_interest), px(ticker.price)),
    );
  }
  return names.map((item) =>
    venueShell(
      item.venue,
      "cex-coingecko",
      `${source} (market=${item.market})`,
      "rolling-24h",
      note,
      feeds.capturedAt,
      null,
      buckets.get(item.market) ?? [],
    ),
  );
}

function ostiumVenue(feeds: PerpsFeeds): PerpsVenueSnapshot {
  const source =
    "GET https://builder.prod.bedrock.ostium.io/v1/pairs?chainId=42161&first=1000 (volumeInUsd is cumulative)";
  const shell = (error: string | null, markets: PerpsMarketSnapshot[] = []) =>
    venueShell(
      "Ostium",
      "onchain",
      source,
      "lifetime",
      "No 24h field. lifetimeVolumeUsd is cumulative volumeInUsd. Daily volume is the difference between consecutive Eastern snapshots.",
      feeds.capturedAt,
      error,
      markets,
    );
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

function avantisVenue(feeds: PerpsFeeds): PerpsVenueSnapshot {
  const source = "GET https://socket-api-pub.avantisfi.com/socket-api/v1/data";
  const shell = (error: string | null, markets: PerpsMarketSnapshot[] = []) =>
    venueShell(
      "Avantis",
      "onchain",
      source,
      "unavailable",
      "No public 24h volume. Open interest is the equities group (groupIndex 6). Volume stays blank.",
      feeds.capturedAt,
      error,
      markets,
    );
  if (feeds.avantis.error) return shell(feeds.avantis.error);
  const markets: PerpsMarketSnapshot[] = [];
  const root = rec(feeds.avantis.data);
  const data = rec(root?.data);
  const infos = rec(data?.pairInfos);
  if (!infos) return shell(null, markets);
  for (const value of Object.values(infos)) {
    const pair = rec(value);
    if (!pair || pair.isPairListed !== true || String(pair.groupIndex) !== "6") continue;
    const from = text(pair.from);
    const underlying = normPerpSymbol(from);
    const classifiedName = classified(underlying, { forceIndex: from === "US500" || from === "US100" });
    if (!isStoredEquityCategory(classifiedName.category)) continue;
    const oi = rec(pair.openInterest);
    const longOi = vol(oi?.long);
    const shortOi = vol(oi?.short);
    const openInterest = longOi === null && shortOi === null ? null : (longOi ?? 0) + (shortOi ?? 0);
    const to = text(pair.to);
    markets.push(
      market(to ? `${from}/${to}` : from, classifiedName.underlying, classifiedName.category, null, openInterest, null),
    );
  }
  return shell(null, markets);
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
  const reference = buildReference(referenceObservations);
  const venues = [
    ...tagged,
    bookVenue(feeds, reference, "lighter"),
    bookVenue(feeds, reference, "lighterRobinhood"),
    ondoVenue(feeds, reference),
    variationalVenue(feeds, reference),
    krakenVenue(feeds, reference),
    bingxVenue(feeds),
    ...coingeckoVenues(feeds, reference),
    ostiumVenue(feeds),
    avantisVenue(feeds),
  ].sort((a, b) => a.venue.localeCompare(b.venue));

  return { date, capturedAt: feeds.capturedAt, venues };
}
