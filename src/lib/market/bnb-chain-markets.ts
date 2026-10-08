import { chunkValues, DEXSCREENER_TOKEN_BATCH_SIZE } from "./solana-discover";
import { unwrapDexScreenerPairs, type DexScreenerPair } from "./map-solana";
import type { FetchLike } from "./solana-http";
import { fetchJsonOrText } from "./solana-http";
import { mapWithConcurrency } from "./async-pool";
import { BNB_DESK } from "./bnb-desk-volume";
import { snapshotDeskChainShell } from "./snapshot-desk-volume";
import {
  BNB_DEX_CHAIN_SLUG,
  BNB_MARKETS_NOTE,
  BNB_MARKETS_SOURCE_LABEL,
  DINARI_ISSUER_LABEL,
  ONDO_ISSUER_LABEL,
  buildBnbMarketLanes,
  findBnbDetail,
  mergeBnbTokens,
  parseColbContracts,
  parseJumperBstocks,
  parseOndoBnbAssets,
  parsePaimonDocs,
  parsePaimonTradePage,
  parseStocksonchainBnb,
  parseXStocksAssets,
  parseXStocksProductCatalog,
  parseXStocksTokenList,
  retainVerifiedXStocks,
  xStocksAssetsHasNextPage,
  type BnbListedToken,
  type BnbMarketLanes,
} from "./bnb-markets";
import { type AssetDetailResult, type DataProvenance, type SourceFailure } from "./types";

export const DEFAULT_STOCKSONCHAIN_URL = "https://stocksonchain.io/api/tokens.json";
export const DEFAULT_XSTOCKS_TOKENLIST_URL =
  "https://raw.githubusercontent.com/backed-fi/cowswap-xstocks-tokenlist/main/tokenlist.json";
export const DEFAULT_XSTOCKS_ASSETS_URL = "https://api.xstocks.fi/api/v2/public/assets";
/** Official lineup. Each product publishes `addresses.bsc` or leaves it null. */
export const DEFAULT_XSTOCKS_PRODUCTS_URL = "https://xstocks.fi/us/products";
export const DEFAULT_JUMPER_BSTOCKS_URL = "https://rwa.jumper.xyz/providers/bstocks";
export const DEFAULT_COLB_DOCS_URL = "https://docs.colb.finance/getting-started/smart-contracts.md";
export const DEFAULT_PAIMON_TRADE_URL = "https://app.paimon.finance/trade";
export const DEFAULT_PAIMON_DOCS_URL = "https://paimon-finance.gitbook.io/paimon.finance";
/** Often 403. A failure is recorded and no BNB address is invented from this API. */
export const DEFAULT_ONDO_GM_URL = "https://api.gm.ondo.finance/v1/assets/all/metadata";
export const DEFAULT_BNB_DEX_BASE_URL = "https://api.dexscreener.com";

const CACHE_MS = 60_000;
const NAME_TIMEOUT_MS = 20_000;
const DEX_TIMEOUT_MS = 12_000;
const DEX_CONCURRENCY = 12;
const XSTOCKS_PAGE_CONCURRENCY = 16;
const XSTOCKS_MAX_PAGES = 16;

export interface BnbChainCatalog extends BnbMarketLanes {
  volumeHydrated: boolean;
  sourceFailures: SourceFailure[];
  fetchedAt: string;
  provenance: DataProvenance;
}

export interface LoadBnbChainMarketsOptions {
  fetchImpl?: FetchLike;
  stocksonchainUrl?: string;
  xstocksTokenlistUrl?: string;
  xstocksAssetsUrl?: string;
  xstocksProductsUrl?: string;
  jumperUrl?: string;
  colbUrl?: string;
  paimonTradeUrl?: string;
  paimonDocsUrl?: string;
  ondoUrl?: string;
  dexBaseUrl?: string;
  timeoutMs?: number;
  /** Tests skip the process cache. */
  cache?: boolean;
}

interface CacheEntry {
  key: string;
  expiresAt: number;
  catalog: BnbChainCatalog;
}

function cacheStore(): { entry: CacheEntry | null } {
  const globalForCache = globalThis as typeof globalThis & {
    __sotbBnbMarkets?: { entry: CacheEntry | null };
  };
  if (!globalForCache.__sotbBnbMarkets) {
    globalForCache.__sotbBnbMarkets = { entry: null };
  }
  return globalForCache.__sotbBnbMarkets;
}

function cacheKey(options: LoadBnbChainMarketsOptions): string {
  return [
    options.stocksonchainUrl ?? DEFAULT_STOCKSONCHAIN_URL,
    options.xstocksTokenlistUrl ?? DEFAULT_XSTOCKS_TOKENLIST_URL,
    options.xstocksAssetsUrl ?? DEFAULT_XSTOCKS_ASSETS_URL,
    options.xstocksProductsUrl ?? DEFAULT_XSTOCKS_PRODUCTS_URL,
    options.jumperUrl ?? DEFAULT_JUMPER_BSTOCKS_URL,
    options.colbUrl ?? DEFAULT_COLB_DOCS_URL,
    options.paimonTradeUrl ?? DEFAULT_PAIMON_TRADE_URL,
    options.paimonDocsUrl ?? DEFAULT_PAIMON_DOCS_URL,
    options.ondoUrl ?? DEFAULT_ONDO_GM_URL,
    options.dexBaseUrl ?? DEFAULT_BNB_DEX_BASE_URL,
  ].join("::");
}

/**
 * Live BNB Chain issuer registries plus DexScreener chain-56 markets.
 * One registry failing does not blank the others.
 * Throws only when every name source produced no tokens.
 * `bnb.json` is not a name source.
 */
export async function loadBnbChainMarkets(
  options: LoadBnbChainMarketsOptions = {},
): Promise<BnbChainCatalog> {
  const useCache = options.cache !== false && options.fetchImpl == null;
  const key = cacheKey(options);
  const store = cacheStore();
  const now = Date.now();
  if (useCache && store.entry && store.entry.key === key && store.entry.expiresAt > now) {
    return store.entry.catalog;
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEX_TIMEOUT_MS;
  const nameTimeout = options.timeoutMs ?? NAME_TIMEOUT_MS;
  const dexBase = (options.dexBaseUrl ?? DEFAULT_BNB_DEX_BASE_URL).replace(/\/+$/, "");

  const [stocksonchain, tokenlist, xstocksApi, xstocksProducts, jumper, colb, paimon, ondo] = await Promise.all([
    readNameSource(
      options.stocksonchainUrl ?? DEFAULT_STOCKSONCHAIN_URL,
      "Stocks On Chain",
      nameTimeout,
      fetchImpl,
      (payload) => parseStocksonchainBnb(payload),
    ),
    readNameSource(
      options.xstocksTokenlistUrl ?? DEFAULT_XSTOCKS_TOKENLIST_URL,
      "xStocks token list",
      nameTimeout,
      fetchImpl,
      (payload) => parseXStocksTokenList(payload),
    ),
    readXStocksAssets(options.xstocksAssetsUrl ?? DEFAULT_XSTOCKS_ASSETS_URL, nameTimeout, fetchImpl),
    readNameSource(
      options.xstocksProductsUrl ?? DEFAULT_XSTOCKS_PRODUCTS_URL,
      "xStocks product catalogue",
      nameTimeout,
      fetchImpl,
      (payload) => parseXStocksProductCatalog(payload),
    ),
    readNameSource(
      options.jumperUrl ?? DEFAULT_JUMPER_BSTOCKS_URL,
      "Jumper bStocks",
      nameTimeout,
      fetchImpl,
      (payload) => (typeof payload === "string" || (payload && typeof payload === "object") ? parseJumperBstocks(payload) : []),
    ),
    readNameSource(
      options.colbUrl ?? DEFAULT_COLB_DOCS_URL,
      "Colb contracts",
      nameTimeout,
      fetchImpl,
      (payload) => (typeof payload === "string" ? parseColbContracts(payload) : []),
    ),
    readPaimon(
      options.paimonTradeUrl ?? DEFAULT_PAIMON_TRADE_URL,
      options.paimonDocsUrl ?? DEFAULT_PAIMON_DOCS_URL,
      nameTimeout,
      fetchImpl,
    ),
    readNameSource(
      options.ondoUrl ?? DEFAULT_ONDO_GM_URL,
      "Ondo metadata API",
      nameTimeout,
      fetchImpl,
      (payload) => parseOndoBnbAssets(payload),
    ),
  ]);

  const sourceFailures = [stocksonchain, tokenlist, xstocksApi, xstocksProducts, jumper, colb, paimon, ondo].flatMap(
    (source) => (source.error ? [{ sourceId: "bnb" as const, sourceLabel: source.label, message: source.error }] : []),
  );
  const dinariCount = stocksonchain.tokens.filter((token) => token.issuer === DINARI_ISSUER_LABEL).length;
  if (dinariCount === 0) {
    sourceFailures.push({
      sourceId: "bnb",
      sourceLabel: "Dinari",
      message: stocksonchain.error
        ? "Dinari BNB Chain contracts were not verified because Stocks On Chain did not load. No Dinari row was added."
        : "Stocks On Chain did not name a Dinari contract on BNB Chain. No Dinari row was added.",
    });
  }
  const ondoFromRegistries = [stocksonchain, jumper, ondo].some((source) =>
    source.tokens.some((token) => token.issuer === ONDO_ISSUER_LABEL),
  );
  if (!ondoFromRegistries) {
    sourceFailures.push({
      sourceId: "bnb",
      sourceLabel: "Ondo",
      message: "No registry confirmed an Ondo contract on BNB Chain. No Ondo row was added.",
    });
  } else if (ondo.tokens.length === 0 && !ondo.error) {
    sourceFailures.push({
      sourceId: "bnb",
      sourceLabel: "Ondo metadata API",
      message: "Ondo metadata API did not name a BNB Chain contract. Ondo rows come from the other registries that did.",
    });
  }

  const catalogueAddresses =
    xstocksProducts.tokens.length > 0
      ? new Set(xstocksProducts.tokens.map((token) => token.address.toLowerCase()))
      : null;
  if (!catalogueAddresses && !xstocksProducts.error) {
    sourceFailures.push({
      sourceId: "bnb",
      sourceLabel: "xStocks product catalogue",
      message: "xStocks product catalogue did not name a BNB Chain contract. Chain-56 rows from the other xStocks registries were kept.",
    });
  }
  const tokens = mergeBnbTokens([
    retainVerifiedXStocks(xstocksProducts.tokens, catalogueAddresses),
    retainVerifiedXStocks(stocksonchain.tokens, catalogueAddresses),
    retainVerifiedXStocks(xstocksApi.tokens, catalogueAddresses),
    retainVerifiedXStocks(tokenlist.tokens, catalogueAddresses),
    retainVerifiedXStocks(jumper.tokens, catalogueAddresses),
    colb.tokens,
    paimon.tokens,
    ondo.tokens,
  ]);
  if (tokens.length === 0) {
    const detail = sourceFailures.map((row) => row.message).filter(Boolean).join(" ");
    throw new Error(
      `BNB Chain discovery returned no issuer tokens. That is a missing list, not zero volume.${detail ? ` ${detail}` : ""}`,
    );
  }

  const chunks = chunkValues(
    tokens.map((token) => token.address),
    DEXSCREENER_TOKEN_BATCH_SIZE,
  );
  const batchResults = await mapWithConcurrency(chunks, DEX_CONCURRENCY, async (addresses) => {
    try {
      const payload = await fetchJsonOrText(
        `${dexBase}/tokens/v1/${BNB_DEX_CHAIN_SLUG}/${addresses.join(",")}`,
        timeoutMs,
        fetchImpl,
        "DexScreener tokens",
        0,
      );
      return { ok: true as const, pairs: unwrapDexScreenerPairs(payload) };
    } catch {
      return { ok: false as const, pairs: [] as DexScreenerPair[] };
    }
  });

  const volumeHydrated = batchResults.some((batch) => batch.ok);
  const pairs = batchResults.flatMap((batch) => batch.pairs);
  const lanes = buildBnbMarketLanes(tokens, pairs, { volumeHydrated });
  const fetchedAt = new Date().toISOString();
  const catalog: BnbChainCatalog = {
    ...lanes,
    volumeHydrated,
    sourceFailures,
    fetchedAt,
    provenance: {
      sourceId: "bnb",
      sourceLabel: BNB_MARKETS_SOURCE_LABEL,
      fetchedAt,
      generatedAt: fetchedAt,
      refreshStartedAt: fetchedAt,
      refreshDurationMs: null,
      cacheStatus: volumeHydrated ? "fresh" : "partial",
      cacheAgeMs: 0,
      notes: [BNB_MARKETS_NOTE],
      sourceFailures,
    },
  };

  if (useCache) {
    store.entry = { key, expiresAt: now + CACHE_MS, catalog };
  }
  return catalog;
}

export async function lookupBnbChainAsset(
  key: string,
  options?: LoadBnbChainMarketsOptions,
): Promise<AssetDetailResult | null> {
  const catalog = await loadBnbChainMarkets(options);
  const asset = findBnbDetail(catalog.details, key);
  if (!asset) return null;
  const chain = {
    ...snapshotDeskChainShell(BNB_DESK),
    sourceId: "bnb" as const,
    sourceLabel: BNB_MARKETS_SOURCE_LABEL,
    coverageNote: BNB_MARKETS_NOTE,
  };
  return { chain, asset, provenance: catalog.provenance };
}

export function bnbCatalogCount(
  catalog: Pick<BnbChainCatalog, "assets" | "etfAssets" | "privateAssets">,
): number {
  return catalog.assets.length + catalog.etfAssets.length + catalog.privateAssets.length;
}

interface NameSourceResult {
  label: string;
  tokens: BnbListedToken[];
  error: string | null;
}

async function readNameSource(
  url: string,
  label: string,
  timeoutMs: number,
  fetchImpl: FetchLike,
  parse: (payload: unknown) => BnbListedToken[],
): Promise<NameSourceResult> {
  try {
    const payload = await fetchJsonOrText(url, timeoutMs, fetchImpl, label, 0);
    return { label, tokens: parse(payload), error: null };
  } catch (error) {
    return { label, tokens: [], error: error instanceof Error ? error.message : `${label} failed.` };
  }
}

async function readXStocksAssets(url: string, timeoutMs: number, fetchImpl: FetchLike): Promise<NameSourceResult> {
  const label = "xStocks assets API";
  const pages = Array.from({ length: XSTOCKS_MAX_PAGES }, (_, index) => index);
  const results = await mapWithConcurrency(pages, XSTOCKS_PAGE_CONCURRENCY, async (index) => {
    try {
      const payload = await fetchJsonOrText(withPage(url, index), timeoutMs, fetchImpl, label, 0);
      return {
        ok: true as const,
        index,
        tokens: parseXStocksAssets(payload),
        hasNext: xStocksAssetsHasNextPage(payload),
      };
    } catch (error) {
      return {
        ok: false as const,
        index,
        tokens: [] as BnbListedToken[],
        hasNext: false,
        error: error instanceof Error ? error.message : `${label} failed.`,
      };
    }
  });
  const first = results.find((result) => result.index === 0);
  if (!first?.ok) {
    return { label, tokens: [], error: first && "error" in first ? first.error : `${label} failed.` };
  }
  const tokens: BnbListedToken[] = [];
  for (const result of results.sort((a, b) => a.index - b.index)) {
    if (!result.ok) break;
    tokens.push(...result.tokens);
    if (!result.hasNext) break;
  }
  return { label, tokens: mergeBnbTokens([tokens]), error: null };
}

async function readPaimon(
  tradeUrl: string,
  docsUrl: string,
  timeoutMs: number,
  fetchImpl: FetchLike,
): Promise<NameSourceResult> {
  const [trade, docs] = await Promise.all([
    readNameSource(tradeUrl, "Paimon trade page", timeoutMs, fetchImpl, (payload) =>
      typeof payload === "string" ? parsePaimonTradePage(payload) : [],
    ),
    readNameSource(docsUrl, "Paimon docs", timeoutMs, fetchImpl, (payload) =>
      typeof payload === "string" ? parsePaimonDocs(payload) : [],
    ),
  ]);
  const tokens = mergeBnbTokens([trade.tokens, docs.tokens]);
  if (tokens.length > 0) return { label: "Paimon", tokens, error: null };
  const error = [trade.error, docs.error].filter(Boolean).join(" ");
  return {
    label: "Paimon",
    tokens: [],
    error: error || "Paimon did not publish a BNB Chain stock contract. No Paimon row was added.",
  };
}

function withPage(url: string, page: number): string {
  const next = new URL(url);
  next.searchParams.set("page", String(page));
  return next.toString();
}
