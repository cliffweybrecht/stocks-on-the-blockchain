import {
  assembleArchiveVenue,
  binanceKlineUrl,
  binanceMetricsUrl,
  bybitTradeUrl,
  dedupeArchiveSymbols,
  lastBinanceMetricsOpenInterestUsd,
  previousUtcDay,
  priorUtcDay,
  readGzipText,
  readZipText,
  sumBinanceDailyQuoteVolume,
  sumBybitTradeNotional,
  type PerpsArchiveCheck,
  type PerpsArchiveSymbolResult,
} from "./perps-archive";
import { parseEquityPerpsFeeds, type PerpsFeedResult, type PerpsFeeds } from "./perps-parse";
import type { PerpsDaySnapshot } from "./perps-snapshot";

const UA = "Mozilla/5.0 (compatible; StocksOnTheBlockchain/1.0)";

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.replace(/\s+/g, " ").trim();
    return message.slice(0, 180) || "request failed";
  }
  return "request failed";
}

async function getJson(url: string, init?: RequestInit, timeoutMs = 45_000): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      accept: "application/json",
      "user-agent": UA,
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.json();
}

async function getJsonRetry(url: string, init?: RequestInit): Promise<unknown> {
  try {
    return await getJson(url, init);
  } catch (error) {
    const message = errorMessage(error);
    if (!/\b(429|502|503)\b/.test(message)) throw error;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    return getJson(url, init);
  }
}

async function postInfo(body: unknown): Promise<unknown> {
  return getJson("https://api.hyperliquid.xyz/info", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function settle<T>(run: () => Promise<T>): Promise<PerpsFeedResult<T>> {
  try {
    return { data: await run(), error: null };
  } catch (error) {
    return { data: null, error: errorMessage(error) };
  }
}

async function pair(
  left: () => Promise<unknown>,
  right: () => Promise<unknown>,
): Promise<{ left: unknown; right: unknown; error: string | null }> {
  const [a, b] = await Promise.all([settle(left), settle(right)]);
  if (a.error || b.error || a.data === null || b.data === null) {
    return { left: a.data, right: b.data, error: a.error ?? b.error ?? "empty response" };
  }
  return { left: a.data, right: b.data, error: null };
}

async function mapPool<T, R>(items: readonly T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      const item = items[index];
      if (item === undefined) return;
      out[index] = await run(item);
    }
  }
  const workers = Math.max(1, Math.min(limit, items.length));
  if (items.length === 0) return out;
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return out;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

async function fetchGrvt(): Promise<PerpsFeedResult<unknown>> {
  try {
    const payload = await getJson("https://market-data.grvt.io/full/v1/all_instruments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ is_active: true }),
    });
    const result = asRecord(payload)?.result;
    const instruments = (Array.isArray(result) ? result : []).filter((row) => {
      const inst = asRecord(row);
      return inst?.asset_class === "EQUITY" && inst.status === "ACTIVE";
    });
    const tickers = await mapPool(instruments, 8, async (row) => {
      const instrument = asRecord(row)?.instrument;
      if (typeof instrument !== "string") return null;
      try {
        return await getJson(
          "https://market-data.grvt.io/full/v1/ticker",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ instrument }),
          },
          15_000,
        );
      } catch {
        return null;
      }
    });
    return { data: { instruments, tickers }, error: null };
  } catch (error) {
    return { data: null, error: errorMessage(error) };
  }
}

async function fetchApex(): Promise<PerpsFeedResult<unknown>> {
  try {
    const payload = await getJson("https://omni.apex.exchange/api/v3/symbols");
    const config = asRecord(asRecord(payload)?.data)?.contractConfig;
    const stock = asRecord(config)?.stockContract;
    const contracts = (Array.isArray(stock) ? stock : []).filter((row) => asRecord(row)?.enableTrade !== false);
    const tickers = await mapPool(contracts, 8, async (row) => {
      const symbol = asRecord(row)?.crossSymbolName;
      if (typeof symbol !== "string" || !symbol) return null;
      try {
        return await getJson(`https://omni.apex.exchange/api/v3/ticker?symbol=${encodeURIComponent(symbol)}`, undefined, 15_000);
      } catch {
        return null;
      }
    });
    return { data: { contracts, tickers }, error: null };
  } catch (error) {
    return { data: null, error: errorMessage(error) };
  }
}

async function fetchHtx(): Promise<NonNullable<PerpsFeeds["htx"]>> {
  const [info, ticker, openInterest] = await Promise.all([
    settle(() => getJson("https://api.hbdm.com/linear-swap-api/v1/swap_contract_info?business_type=swap")),
    settle(() => getJson("https://api.hbdm.com/linear-swap-ex/market/detail/batch_merged?business_type=swap")),
    settle(() => getJson("https://api.hbdm.com/linear-swap-api/v1/swap_open_interest?business_type=swap")),
  ]);
  return {
    info: info.data,
    ticker: ticker.data,
    openInterest: openInterest.data,
    error: info.error ?? ticker.error,
    oiError: openInterest.error,
  };
}

async function getBytes(url: string, timeoutMs = 30_000): Promise<Uint8Array | null> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { accept: "*/*", "user-agent": UA },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function fetchWeex(): Promise<NonNullable<PerpsFeeds["weex"]>> {
  const tickers = await settle(() => getJson("https://api-contract.weex.com/capi/v3/market/ticker/24hr"));
  const info = await settle(() => getJson("https://api-contract.weex.com/capi/v3/market/exchangeInfo"));
  if (tickers.error || info.error || tickers.data === null || info.data === null) {
    return {
      tickers: tickers.data,
      exchangeInfo: info.data,
      openInterest: [],
      error: tickers.error ?? info.error ?? "empty response",
    };
  }
  const symbols: string[] = [];
  const rows = asRecord(info.data);
  const listed = Array.isArray(rows?.symbols) ? rows.symbols : [];
  for (const row of listed) {
    const contract = asRecord(row);
    if (!contract || contract.contractType !== "TRADIFI_PERPETUAL") continue;
    const kind = contract.underlyingType;
    if (kind !== "Stocks" && kind !== "Indices" && kind !== "Pre-IPO") continue;
    if (typeof contract.symbol === "string" && contract.symbol) symbols.push(contract.symbol);
  }
  const openInterest = await mapPool(symbols, 8, async (symbol) => {
    try {
      return await getJson(
        `https://api-contract.weex.com/capi/v3/market/openInterest?symbol=${encodeURIComponent(symbol)}`,
        undefined,
        15_000,
      );
    } catch {
      return null;
    }
  });
  return { tickers: tickers.data, exchangeInfo: info.data, openInterest, error: null };
}

async function archiveText(url: string, gzip: boolean): Promise<string | null> {
  try {
    const bytes = await getBytes(url);
    if (!bytes) return null;
    return gzip ? readGzipText(bytes) : readZipText(bytes);
  } catch {
    return null;
  }
}

async function loadArchiveDay(
  day: string,
  binance: readonly { symbol: string; volumeUsd: number | null }[],
  bybit: readonly { symbol: string; volumeUsd: number | null }[],
): Promise<{ binance: PerpsArchiveSymbolResult[]; bybit: PerpsArchiveSymbolResult[] }> {
  const [binanceRows, bybitRows] = await Promise.all([
    mapPool(binance, 6, async (row) => {
      const [kline, metrics] = await Promise.all([
        archiveText(binanceKlineUrl(row.symbol, day), false),
        archiveText(binanceMetricsUrl(row.symbol, day), false),
      ]);
      return {
        symbol: row.symbol,
        coingeckoVolumeUsd: row.volumeUsd,
        volumeUsd: kline === null ? null : sumBinanceDailyQuoteVolume(kline),
        openInterestUsd: metrics === null ? null : lastBinanceMetricsOpenInterestUsd(metrics),
      } satisfies PerpsArchiveSymbolResult;
    }),
    mapPool(bybit, 4, async (row) => {
      const csv = await archiveText(bybitTradeUrl(row.symbol, day), true);
      return {
        symbol: row.symbol,
        coingeckoVolumeUsd: row.volumeUsd,
        volumeUsd: csv === null ? null : sumBybitTradeNotional(csv),
        openInterestUsd: null,
      } satisfies PerpsArchiveSymbolResult;
    }),
  ]);
  return { binance: binanceRows, bybit: bybitRows };
}

function archiveCheck(
  utcDate: string,
  rows: { binance: PerpsArchiveSymbolResult[]; bybit: PerpsArchiveSymbolResult[] },
  note: string | null,
): PerpsArchiveCheck {
  return {
    utcDate,
    binance: assembleArchiveVenue(rows.binance, true),
    bybit: assembleArchiveVenue(rows.bybit, false),
    note,
  };
}

async function fetchArchiveCheck(day: PerpsDaySnapshot): Promise<PerpsArchiveCheck | undefined> {
  const symbols = day.archiveSymbols;
  if (!symbols) return undefined;
  const binance = dedupeArchiveSymbols(symbols.binance);
  const bybit = dedupeArchiveSymbols(symbols.bybit);
  const utcDate = priorUtcDay(day.capturedAt);
  if (!utcDate) return undefined;
  if (binance.length === 0 && bybit.length === 0) {
    return archiveCheck(utcDate, { binance: [], bybit: [] }, "No CoinGecko equity symbols, so the archive cross-check was not downloaded.");
  }
  const first = await loadArchiveDay(utcDate, binance, bybit);
  const firstCheck = archiveCheck(utcDate, first, null);
  const binanceMissing = binance.length > 0 && firstCheck.binance.covered === 0;
  const bybitMissing = bybit.length > 0 && firstCheck.bybit.covered === 0;
  const oneMissing =
    (binanceMissing && bybit.length > 0 && !bybitMissing) || (bybitMissing && binance.length > 0 && !binanceMissing);
  if (!binanceMissing && !bybitMissing) return firstCheck;
  if (oneMissing) {
    const waiting = binanceMissing ? "Binance" : "Bybit";
    return archiveCheck(utcDate, first, `${waiting} archive for this UTC day was not published. The other venue stays on this day.`);
  }
  const earlier = previousUtcDay(utcDate);
  if (!earlier) return firstCheck;
  const second = await loadArchiveDay(earlier, binance, bybit);
  const secondCheck = archiveCheck(
    earlier,
    second,
    "The prior UTC day was not published yet. This cross-check uses the previous UTC day.",
  );
  if (secondCheck.binance.covered > 0 || secondCheck.bybit.covered > 0) return secondCheck;
  return archiveCheck(utcDate, first, "The official archive for the prior UTC day was not published.");
}

async function fetchZoomex(): Promise<NonNullable<PerpsFeeds["zoomex"]>> {
  const tickers = await settle(() =>
    getJson("https://openapi.zoomex.com/cloud/trade/v3/market/tickers?category=linear"),
  );
  const pages: unknown[] = [];
  let cursor = "";
  let error: string | null = null;
  for (let page = 0; page < 8; page += 1) {
    const url = `https://openapi.zoomex.com/cloud/trade/v3/market/instruments-info?category=linear&limit=1000${
      cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""
    }`;
    const body = await settle(() => getJson(url));
    if (body.error || body.data === null) {
      error = body.error ?? "empty response";
      break;
    }
    pages.push(body.data);
    const next = asRecord(asRecord(body.data)?.result)?.nextPageCursor;
    if (typeof next !== "string" || next.length === 0 || next === cursor) break;
    cursor = next;
  }
  const list: unknown[] = [];
  for (const page of pages) {
    const rows = asRecord(asRecord(page)?.result)?.list;
    if (Array.isArray(rows)) list.push(...rows);
  }
  const failed = tickers.error ?? error;
  return {
    tickers: tickers.data,
    instruments: list.length > 0 ? { result: { list } } : null,
    error: failed ?? (list.length === 0 || tickers.data === null ? "empty response" : null),
  };
}

async function fetchEdgex(): Promise<NonNullable<PerpsFeeds["edgex"]>> {
  const meta = await settle(() => getJson("https://edgex-prod-v2.edgex.exchange/api/v2/public/meta/getMetaData"));
  if (meta.error || meta.data === null) return { meta: meta.data, tickers: [], error: meta.error ?? "empty response" };
  const contracts = asRecord(asRecord(meta.data)?.data)?.contractList;
  const ids: string[] = [];
  if (Array.isArray(contracts)) {
    for (const row of contracts) {
      const contract = asRecord(row);
      if (!contract || contract.isStock !== true) continue;
      const id = contract.contractId;
      if (typeof id === "string" && id) ids.push(id);
      else if (typeof id === "number") ids.push(String(id));
    }
  }
  const tickers = await mapPool(ids, 8, async (contractId) => {
    try {
      return await getJson(
        `https://edgex-prod-v2.edgex.exchange/api/v2/public/quote/getTicker?contractId=${encodeURIComponent(contractId)}`,
        undefined,
        20_000,
      );
    } catch {
      return null;
    }
  });
  return { meta: meta.data, tickers, error: null };
}

async function fetchStandx(): Promise<NonNullable<PerpsFeeds["standx"]>> {
  const info = await settle(() => getJson("https://perps.standx.com/api/query_symbol_info"));
  if (info.error || info.data === null) return { symbols: info.data, markets: [], error: info.error ?? "empty response" };
  const symbols: string[] = [];
  if (Array.isArray(info.data)) {
    for (const row of info.data) {
      const symbol = asRecord(row)?.symbol;
      if (typeof symbol === "string" && symbol) symbols.push(symbol);
    }
  }
  const markets = await mapPool(symbols, 4, async (symbol) => {
    try {
      return await getJson(
        `https://perps.standx.com/api/query_symbol_market?symbol=${encodeURIComponent(symbol)}`,
        undefined,
        20_000,
      );
    } catch {
      return null;
    }
  });
  return { symbols: info.data, markets, error: null };
}

function trimVerantaVolumes(payload: unknown): unknown {
  const root = asRecord(payload);
  if (!root || !Array.isArray(root.history)) return payload;
  const history = root.history.slice(-8).map((row) => {
    const item = asRecord(row);
    if (!item) return row;
    return { date: item.date, pairVolumes: item.pairVolumes };
  });
  return { history };
}

async function fetchVerantaVolumes(): Promise<PerpsFeedResult<unknown>> {
  const body = await settle(() =>
    getJson("https://api.veranta.xyz/v1/cached/history/analytics/daily-volumes-by-pair/1", undefined, 60_000),
  );
  if (body.error || body.data === null) return body;
  return { data: trimVerantaVolumes(body.data), error: null };
}

const VEST_HEADERS = { "xrestservermm": "restserver0" };

function dexNames(payload: unknown): string[] {
  if (!Array.isArray(payload)) return [];
  const names: string[] = [];
  for (const row of payload) {
    if (!row || typeof row !== "object") continue;
    const name = (row as { name?: unknown }).name;
    if (typeof name === "string" && name) names.push(name);
  }
  return names;
}

export async function fetchEquityPerpsFeeds(capturedAt: string): Promise<PerpsFeeds> {
  const [
    hyperliquidDexs,
    bitget,
    okxInstruments,
    okxTickers,
    okxOi,
    okxFunding,
    gate,
    mexc,
    aster,
    kucoin,
    extended,
    lighter,
    lighterFunding,
    lighterRobinhood,
    ondo,
    variational,
    kraken,
    bingx,
    coingecko,
    ostium,
    avantis,
    toobit,
    xt,
    bitunix,
    whitebit,
    phemex,
    btse,
    deribit,
    htx,
    crypto,
    lbank,
    grvt,
    apex,
    nado,
    pacifica,
    orderly,
    paradex,
    weex,
    coinbase,
    zoomex,
    ourbit,
    arcus,
    vestInfo,
    vestTickers,
    polymarket,
    blofin,
    risex,
    edgex,
    gmxSolana,
    gmxArbitrum,
    helix,
    bitstamp,
    standx,
    bitfinex,
    veranta,
    cryptoInstruments,
  ] = await Promise.all([
    settle(() => postInfo({ type: "perpDexs" })),
    pair(
      () => getJson("https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES"),
      () => getJson("https://api.bitget.com/api/v2/mix/market/contracts?productType=USDT-FUTURES"),
    ),
    settle(() => getJson("https://www.okx.com/api/v5/public/instruments?instType=SWAP")),
    settle(() => getJson("https://www.okx.com/api/v5/market/tickers?instType=SWAP")),
    settle(() => getJson("https://www.okx.com/api/v5/public/open-interest?instType=SWAP")),
    settle(() => getJson("https://www.okx.com/api/v5/public/funding-rate?instId=ANY", undefined, 20_000)),
    pair(
      () => getJson("https://api.gateio.ws/api/v4/futures/usdt/tickers"),
      () => getJson("https://api.gateio.ws/api/v4/futures/usdt/contracts"),
    ),
    pair(
      () => getJson("https://contract.mexc.com/api/v1/contract/ticker"),
      () => getJson("https://contract.mexc.com/api/v1/contract/detail"),
    ),
    pair(
      () => getJson("https://fapi.asterdex.com/fapi/v1/ticker/24hr"),
      () => getJson("https://fapi.asterdex.com/fapi/v1/exchangeInfo"),
    ),
    settle(() => getJson("https://api-futures.kucoin.com/api/v1/contracts/active")),
    settle(() =>
      getJson("https://api.starknet.extended.exchange/api/v1/info/markets", {
        headers: { "user-agent": "Mozilla/5.0" },
      }),
    ),
    settle(() => getJson("https://mainnet.zklighter.elliot.ai/api/v1/orderBookDetails")),
    settle(() => getJson("https://mainnet.zklighter.elliot.ai/api/v1/funding-rates", undefined, 20_000)),
    settle(() => getJson("https://api.rh.lighter.xyz/api/v1/orderBookDetails")),
    settle(() => getJson("https://api.ondoperps.xyz/v1/perps/contracts")),
    settle(() => getJson("https://omni-client-api.prod.ap-northeast-1.variational.io/metadata/stats")),
    settle(() => getJson("https://futures.kraken.com/derivatives/api/v3/tickers")),
    settle(() => getJson("https://open-api.bingx.com/openApi/swap/v2/quote/ticker")),
    settle(() => getJsonRetry("https://api.coingecko.com/api/v3/derivatives?include_tickers=unexpired")),
    settle(() => getJson("https://builder.prod.bedrock.ostium.io/v1/pairs?chainId=42161&first=1000")),
    settle(() => getJson("https://socket-api-pub.avantisfi.com/socket-api/v1/data")),
    settle(() => getJson("https://api.toobit.com/quote/v1/contract/ticker/24hr")),
    pair(
      () => getJson("https://fapi.xt.com/future/market/v1/public/q/tickers"),
      () => getJson("https://fapi.xt.com/future/market/v3/public/symbol/list"),
    ),
    settle(() => getJson("https://fapi.bitunix.com/api/v1/futures/market/tickers")),
    settle(() => getJson("https://whitebit.com/api/v4/public/futures")),
    pair(
      () => getJson("https://api.phemex.com/md/v3/ticker/24hr/all"),
      () => getJson("https://api.phemex.com/public/products-plus"),
    ),
    settle(() => getJson("https://api.btse.com/futures/api/v2.1/market_summary")),
    settle(() => getJson("https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=USDC&kind=future")),
    fetchHtx(),
    settle(() => getJson("https://api.crypto.com/exchange/v1/public/get-tickers")),
    settle(() => getJson("https://lbkperp.lbank.com/cfd/openApi/v1/pub/marketData?productGroup=SwapU")),
    fetchGrvt(),
    fetchApex(),
    settle(() =>
      getJson("https://archive.prod.nado.xyz/v2/contracts", { headers: { "accept-encoding": "gzip" } }),
    ),
    settle(() => getJson("https://api.pacifica.fi/api/v1/info/prices")),
    settle(() => getJson("https://api.orderly.org/v1/public/futures")),
    settle(() => getJson("https://api.prod.paradex.trade/v1/markets/summary?market=ALL")),
    fetchWeex(),
    settle(() => getJson("https://api.international.coinbase.com/api/v1/instruments")),
    fetchZoomex(),
    pair(
      () => getJson("https://futures.ourbit.com/api/v1/contract/ticker"),
      () => getJson("https://futures.ourbit.com/api/v1/contract/detail"),
    ),
    settle(() => getJson("https://api.arcus.xyz/v1/markets")),
    settle(() =>
      getJson("https://server-prod.hz.vestmarkets.com/v2/exchangeInfo", { headers: VEST_HEADERS }),
    ),
    settle(() => getJson("https://server-prod.hz.vestmarkets.com/v2/ticker/24hr", { headers: VEST_HEADERS })),
    pair(
      () => getJson("https://api.perpetuals.polymarket.com/v1/info/instruments"),
      () => getJson("https://api.perpetuals.polymarket.com/v1/info/statistics"),
    ),
    pair(
      () => getJson("https://openapi.blofin.com/api/v1/market/instruments"),
      () => getJson("https://openapi.blofin.com/api/v1/market/tickers"),
    ),
    settle(() => getJson("https://api.rise.trade/v1/markets")),
    fetchEdgex(),
    settle(() => getJson("https://solana.gmxapi.io/v1/pairs")),
    settle(() => getJson("https://arbitrum.gmxapi.io/v1/pairs")),
    pair(
      () =>
        getJson(
          "https://sentry.lcd.injective.network/injective/exchange/v1beta1/derivative/markets?status=Active",
        ),
      () =>
        getJson(
          "https://sentry.exchange.grpc-web.injective.network/api/chronos/v1/derivative/market_summary_all?resolution=24h",
        ),
    ),
    settle(() => getJson("https://www.bitstamp.net/api/v2/ticker/")),
    fetchStandx(),
    settle(() => getJson("https://api-pub.bitfinex.com/v2/tickers?symbols=ALL")),
    fetchVerantaVolumes(),
    settle(() => getJson("https://api.crypto.com/exchange/v1/public/get-instruments")),
  ]);

  let hyperliquid: PerpsFeeds["hyperliquid"] = { dexs: [], error: hyperliquidDexs.error };
  if (hyperliquidDexs.data && !hyperliquidDexs.error) {
    const names = dexNames(hyperliquidDexs.data);
    const books = await Promise.all(
      names.map(async (dex) => {
        const book = await settle(() => postInfo({ type: "metaAndAssetCtxs", dex }));
        return { dex, book: book.data, error: book.error };
      }),
    );
    hyperliquid = { dexs: books, error: null };
  }

  const okxError = okxInstruments.error ?? okxTickers.error;
  return {
    capturedAt,
    hyperliquid,
    bitget: { tickers: bitget.left, contracts: bitget.right, error: bitget.error },
    okx: {
      instruments: okxInstruments.data,
      tickers: okxTickers.data,
      openInterest: okxOi.data,
      oiError: okxOi.error,
      error: okxError,
      funding: okxFunding.data,
      fundingError: okxFunding.error,
    },
    gate: { tickers: gate.left, contracts: gate.right, error: gate.error },
    mexc: { ticker: mexc.left, detail: mexc.right, error: mexc.error },
    aster: { ticker: aster.left, exchangeInfo: aster.right, error: aster.error },
    kucoin,
    extended,
    lighter,
    lighterFunding,
    lighterRobinhood,
    ondo,
    variational,
    kraken,
    bingx,
    coingecko,
    ostium,
    avantis,
    toobit,
    xt: { tickers: xt.left, symbols: xt.right, error: xt.error },
    bitunix,
    whitebit,
    phemex: { tickers: phemex.left, products: phemex.right, error: phemex.error },
    btse,
    deribit,
    htx,
    crypto: {
      tickers: crypto.data,
      instruments: cryptoInstruments.data,
      error: crypto.error ?? cryptoInstruments.error,
    },
    lbank,
    grvt,
    apex,
    nado,
    pacifica,
    orderly,
    paradex,
    weex,
    coinbase,
    zoomex,
    ourbit: { ticker: ourbit.left, detail: ourbit.right, error: ourbit.error },
    arcus,
    vest: { info: vestInfo.data, tickers: vestTickers.data, error: vestInfo.error ?? vestTickers.error },
    polymarket: { instruments: polymarket.left, statistics: polymarket.right, error: polymarket.error },
    blofin: { instruments: blofin.left, tickers: blofin.right, error: blofin.error },
    risex,
    edgex,
    gmxSolana,
    gmxArbitrum,
    helix: { markets: helix.left, summary: helix.right, error: helix.error },
    bitstamp,
    standx,
    bitfinex,
    veranta,
  };
}

export async function captureEquityPerpsSnapshot(now = new Date()): Promise<PerpsDaySnapshot> {
  const capturedAt = now.toISOString();
  const feeds = await fetchEquityPerpsFeeds(capturedAt);
  const day = parseEquityPerpsFeeds(feeds);
  let archive: PerpsArchiveCheck | undefined;
  try {
    archive = await fetchArchiveCheck(day);
  } catch (error) {
    const utcDate = priorUtcDay(day.capturedAt);
    if (utcDate) {
      archive = archiveCheck(
        utcDate,
        { binance: [], bybit: [] },
        error instanceof Error ? error.message.slice(0, 180) : "Archive cross-check failed.",
      );
    }
  }
  const { archiveSymbols: _symbols, ...stored } = day;
  return archive ? { ...stored, archive } : stored;
}
