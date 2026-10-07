import { chunkValues, DEXSCREENER_TOKEN_BATCH_SIZE } from "./solana-discover";
import { unwrapDexScreenerPairs, type DexScreenerPair } from "./map-solana";
import type { FetchLike } from "./solana-http";
import { fetchJsonOrText } from "./solana-http";
import { mapWithConcurrency } from "./async-pool";
import { BASE_DESK } from "./base-desk-volume";
import { snapshotDeskChainShell } from "./snapshot-desk-volume";
import {
  BASE_DEX_CHAIN_SLUG,
  BASE_MARKETS_NOTE,
  BASE_MARKETS_SOURCE_LABEL,
  buildBaseMarketLanes,
  centrifugeBaseShareTokens,
  findBaseDetail,
  mergeBaseTokens,
  parseAnchoredTokenDocs,
  parseBackedAssets,
  parseCoinbaseTokenizedStocks,
  parseDinariStocksonchain,
  parseOndoBaseAssets,
  parseSt0xTokenList,
  type BaseMarketLanes,
} from "./base-markets";
import { type AssetDetailResult, type DataProvenance, type SourceFailure } from "./types";

export const DEFAULT_COINBASE_TOKENIZED_STOCKS_URL = "https://api.coinbase.com/v1/tokenized-stocks";
export const DEFAULT_ST0X_BASE_LIST_URL =
  "https://raw.githubusercontent.com/ST0x-Technology/st0x.registry/main/token-lists/base.json";
export const DEFAULT_DINARI_STOCKSONCHAIN_URL = "https://stocksonchain.io/api/tokens.json";
export const DEFAULT_BACKED_ASSETS_URL = "https://api.backed.fi/api/v1/token";
export const DEFAULT_ANCHORED_DOCS_URL = "https://docs.anchored.finance/getting-started/anchored-tokens.md";
/** Often unresolved or 403. A failure is recorded and no Base address is invented. */
export const DEFAULT_ONDO_ASSETS_URL = "https://api.ondo.finance/v1/assets";
export const DEFAULT_BASE_DEX_BASE_URL = "https://api.dexscreener.com";

const CACHE_MS = 60_000;
const NAME_TIMEOUT_MS = 20_000;
const DEX_TIMEOUT_MS = 12_000;
const DEX_CONCURRENCY = 4;

export interface BaseChainCatalog extends BaseMarketLanes {
  volumeHydrated: boolean;
  sourceFailures: SourceFailure[];
  fetchedAt: string;
  provenance: DataProvenance;
}

export interface LoadBaseChainMarketsOptions {
  fetchImpl?: FetchLike;
  coinbaseUrl?: string;
  st0xUrl?: string;
  dinariUrl?: string;
  backedUrl?: string;
  anchoredUrl?: string;
  ondoUrl?: string;
  dexBaseUrl?: string;
  timeoutMs?: number;
  /** Tests skip the process cache. */
  cache?: boolean;
  /** Published SPXA / deSPXA share tokens. Tests can omit them to assert a fully empty registry. */
  includeCentrifuge?: boolean;
}

interface CacheEntry {
  key: string;
  expiresAt: number;
  catalog: BaseChainCatalog;
}

function cacheStore(): { entry: CacheEntry | null } {
  const globalForCache = globalThis as typeof globalThis & {
    __sotbBaseMarkets?: { entry: CacheEntry | null };
  };
  if (!globalForCache.__sotbBaseMarkets) {
    globalForCache.__sotbBaseMarkets = { entry: null };
  }
  return globalForCache.__sotbBaseMarkets;
}

function cacheKey(options: LoadBaseChainMarketsOptions): string {
  return [
    options.coinbaseUrl ?? DEFAULT_COINBASE_TOKENIZED_STOCKS_URL,
    options.st0xUrl ?? DEFAULT_ST0X_BASE_LIST_URL,
    options.dinariUrl ?? DEFAULT_DINARI_STOCKSONCHAIN_URL,
    options.backedUrl ?? DEFAULT_BACKED_ASSETS_URL,
    options.anchoredUrl ?? DEFAULT_ANCHORED_DOCS_URL,
    options.ondoUrl ?? DEFAULT_ONDO_ASSETS_URL,
    options.dexBaseUrl ?? DEFAULT_BASE_DEX_BASE_URL,
  ].join("::");
}

/**
 * Live Base issuer registries plus DexScreener chain-8453 markets.
 * One registry failing does not blank the others.
 * Throws only when every name source produced no tokens.
 * `base.json` is not a name source.
 */
export async function loadBaseChainMarkets(
  options: LoadBaseChainMarketsOptions = {},
): Promise<BaseChainCatalog> {
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
  const dexBase = (options.dexBaseUrl ?? DEFAULT_BASE_DEX_BASE_URL).replace(/\/+$/, "");

  const [coinbase, st0x, dinari, backed, anchored, ondo] = await Promise.all([
    readNameSource(
      options.coinbaseUrl ?? DEFAULT_COINBASE_TOKENIZED_STOCKS_URL,
      "Coinbase tokenized stocks",
      nameTimeout,
      fetchImpl,
      (payload) => parseCoinbaseTokenizedStocks(payload),
    ),
    readNameSource(
      options.st0xUrl ?? DEFAULT_ST0X_BASE_LIST_URL,
      "ST0x Base list",
      nameTimeout,
      fetchImpl,
      (payload) => parseSt0xTokenList(payload),
    ),
    readNameSource(
      options.dinariUrl ?? DEFAULT_DINARI_STOCKSONCHAIN_URL,
      "Dinari via Stocks On Chain",
      nameTimeout,
      fetchImpl,
      (payload) => parseDinariStocksonchain(payload),
    ),
    readNameSource(
      options.backedUrl ?? DEFAULT_BACKED_ASSETS_URL,
      "Backed assets",
      nameTimeout,
      fetchImpl,
      (payload) => parseBackedAssets(payload),
    ),
    readNameSource(
      options.anchoredUrl ?? DEFAULT_ANCHORED_DOCS_URL,
      "Anchored token docs",
      nameTimeout,
      fetchImpl,
      (payload) => (typeof payload === "string" ? parseAnchoredTokenDocs(payload) : []),
    ),
    readNameSource(
      options.ondoUrl ?? DEFAULT_ONDO_ASSETS_URL,
      "Ondo address API",
      nameTimeout,
      fetchImpl,
      (payload) => parseOndoBaseAssets(payload),
    ),
  ]);

  const centrifuge = options.includeCentrifuge === false ? [] : centrifugeBaseShareTokens();
  const sourceFailures = [coinbase, st0x, dinari, backed, anchored, ondo].flatMap((source) =>
    source.error ? [{ sourceId: "base" as const, sourceLabel: source.label, message: source.error }] : [],
  );
  if (ondo.tokens.length === 0 && !ondo.error) {
    sourceFailures.push({
      sourceId: "base",
      sourceLabel: "Ondo address API",
      message: "Ondo did not confirm a Base contract. No Ondo row was added.",
    });
  }

  const tokens = mergeBaseTokens([
    coinbase.tokens,
    st0x.tokens,
    centrifuge,
    dinari.tokens,
    backed.tokens,
    anchored.tokens,
    ondo.tokens,
  ]);
  if (tokens.length === 0) {
    const detail = sourceFailures.map((row) => row.message).filter(Boolean).join(" ");
    throw new Error(
      `Base discovery returned no issuer tokens. That is a missing list, not zero volume.${detail ? ` ${detail}` : ""}`,
    );
  }

  const chunks = chunkValues(
    tokens.map((token) => token.address),
    DEXSCREENER_TOKEN_BATCH_SIZE,
  );
  const batchResults = await mapWithConcurrency(chunks, DEX_CONCURRENCY, async (addresses) => {
    try {
      const payload = await fetchJsonOrText(
        `${dexBase}/tokens/v1/${BASE_DEX_CHAIN_SLUG}/${addresses.join(",")}`,
        timeoutMs,
        fetchImpl,
        "DexScreener tokens",
        1,
      );
      return { ok: true as const, pairs: unwrapDexScreenerPairs(payload) };
    } catch {
      return { ok: false as const, pairs: [] as DexScreenerPair[] };
    }
  });

  const volumeHydrated = batchResults.some((batch) => batch.ok);
  const pairs = batchResults.flatMap((batch) => batch.pairs);
  const lanes = buildBaseMarketLanes(tokens, pairs, { volumeHydrated });
  const fetchedAt = new Date().toISOString();
  const catalog: BaseChainCatalog = {
    ...lanes,
    volumeHydrated,
    sourceFailures,
    fetchedAt,
    provenance: {
      sourceId: "base",
      sourceLabel: BASE_MARKETS_SOURCE_LABEL,
      fetchedAt,
      generatedAt: fetchedAt,
      refreshStartedAt: fetchedAt,
      refreshDurationMs: null,
      cacheStatus: volumeHydrated ? "fresh" : "partial",
      cacheAgeMs: 0,
      notes: [BASE_MARKETS_NOTE],
      sourceFailures,
    },
  };

  if (useCache) {
    store.entry = { key, expiresAt: now + CACHE_MS, catalog };
  }
  return catalog;
}

export async function lookupBaseChainAsset(
  key: string,
  options?: LoadBaseChainMarketsOptions,
): Promise<AssetDetailResult | null> {
  const catalog = await loadBaseChainMarkets(options);
  const asset = findBaseDetail(catalog.details, key);
  if (!asset) return null;
  const chain = {
    ...snapshotDeskChainShell(BASE_DESK),
    sourceId: "base" as const,
    sourceLabel: BASE_MARKETS_SOURCE_LABEL,
    coverageNote: BASE_MARKETS_NOTE,
  };
  return { chain, asset, provenance: catalog.provenance };
}

export function baseCatalogCount(
  catalog: Pick<BaseChainCatalog, "assets" | "etfAssets" | "privateAssets">,
): number {
  return catalog.assets.length + catalog.etfAssets.length + catalog.privateAssets.length;
}

interface NameSourceResult {
  label: string;
  tokens: ReturnType<typeof parseCoinbaseTokenizedStocks>;
  error: string | null;
}

async function readNameSource(
  url: string,
  label: string,
  timeoutMs: number,
  fetchImpl: FetchLike,
  parse: (payload: unknown) => NameSourceResult["tokens"],
): Promise<NameSourceResult> {
  try {
    const payload = await fetchJsonOrText(url, timeoutMs, fetchImpl, label, 1);
    return { label, tokens: parse(payload), error: null };
  } catch (error) {
    return { label, tokens: [], error: error instanceof Error ? error.message : `${label} failed.` };
  }
}
