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
    gate,
    mexc,
    aster,
    kucoin,
    extended,
    lighter,
    lighterRobinhood,
    ondo,
    variational,
    kraken,
    bingx,
    coingecko,
    ostium,
    avantis,
  ] = await Promise.all([
    settle(() => postInfo({ type: "perpDexs" })),
    pair(
      () => getJson("https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES"),
      () => getJson("https://api.bitget.com/api/v2/mix/market/contracts?productType=USDT-FUTURES"),
    ),
    settle(() => getJson("https://www.okx.com/api/v5/public/instruments?instType=SWAP")),
    settle(() => getJson("https://www.okx.com/api/v5/market/tickers?instType=SWAP")),
    settle(() => getJson("https://www.okx.com/api/v5/public/open-interest?instType=SWAP")),
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
    settle(() => getJson("https://api.rh.lighter.xyz/api/v1/orderBookDetails")),
    settle(() => getJson("https://api.ondoperps.xyz/v1/perps/contracts")),
    settle(() => getJson("https://omni-client-api.prod.ap-northeast-1.variational.io/metadata/stats")),
    settle(() => getJson("https://futures.kraken.com/derivatives/api/v3/tickers")),
    settle(() => getJson("https://open-api.bingx.com/openApi/swap/v2/quote/ticker")),
    settle(() => getJsonRetry("https://api.coingecko.com/api/v3/derivatives?include_tickers=unexpired")),
    settle(() => getJson("https://builder.prod.bedrock.ostium.io/v1/pairs?chainId=42161&first=1000")),
    settle(() => getJson("https://socket-api-pub.avantisfi.com/socket-api/v1/data")),
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
    },
    gate: { tickers: gate.left, contracts: gate.right, error: gate.error },
    mexc: { ticker: mexc.left, detail: mexc.right, error: mexc.error },
    aster: { ticker: aster.left, exchangeInfo: aster.right, error: aster.error },
    kucoin,
    extended,
    lighter,
    lighterRobinhood,
    ondo,
    variational,
    kraken,
    bingx,
    coingecko,
    ostium,
    avantis,
  };
}

export async function captureEquityPerpsSnapshot(now = new Date()): Promise<PerpsDaySnapshot> {
  const capturedAt = now.toISOString();
  const feeds = await fetchEquityPerpsFeeds(capturedAt);
  return parseEquityPerpsFeeds(feeds);
}
