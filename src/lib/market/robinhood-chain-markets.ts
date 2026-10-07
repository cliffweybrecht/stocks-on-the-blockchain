import { chunkValues, DEXSCREENER_TOKEN_BATCH_SIZE } from "./solana-discover";
import { unwrapDexScreenerPairs, type DexScreenerPair } from "./map-solana";
import type { FetchLike } from "./solana-http";
import { fetchJsonOrText } from "./solana-http";
import { mapWithConcurrency } from "./async-pool";
import { robinhoodSnapshotChainShell } from "./robinhood-desk-volume";
import {
  ROBINHOOD_DEX_CHAIN_SLUG,
  ROBINHOOD_MARKETS_NOTE,
  ROBINHOOD_MARKETS_SOURCE_LABEL,
  ROBINHOOD_ONDO_SEARCH_QUERIES,
  buildRobinhoodMarketLanes,
  findRobinhoodDetail,
  mergeRobinhoodTokens,
  ondoTokensFromPairs,
  parseRhjRegistry,
  type RobinhoodMarketLanes,
} from "./robinhood-markets";
import { type AssetDetailResult, type DataProvenance } from "./types";

export const DEFAULT_RHJ_ASSETS_URL = "https://api.robinhood.com/rhj/assets";
export const DEFAULT_ROBINHOOD_DEX_BASE_URL = "https://api.dexscreener.com";

const CACHE_MS = 60_000;
const RHJ_TIMEOUT_MS = 15_000;
const DEX_TIMEOUT_MS = 12_000;
const DEX_CONCURRENCY = 4;

export interface RobinhoodChainCatalog extends RobinhoodMarketLanes {
  volumeHydrated: boolean;
  registryError: string | null;
  fetchedAt: string;
  provenance: DataProvenance;
}

export interface LoadRobinhoodChainMarketsOptions {
  fetchImpl?: FetchLike;
  rhjUrl?: string;
  dexBaseUrl?: string;
  timeoutMs?: number;
  searchQueries?: readonly string[];
  /** Tests skip the process cache. */
  cache?: boolean;
}

interface CacheEntry {
  key: string;
  expiresAt: number;
  catalog: RobinhoodChainCatalog;
}

function cacheStore(): { entry: CacheEntry | null } {
  const globalForCache = globalThis as typeof globalThis & {
    __sotbRobinhoodMarkets?: { entry: CacheEntry | null };
  };
  if (!globalForCache.__sotbRobinhoodMarkets) {
    globalForCache.__sotbRobinhoodMarkets = { entry: null };
  }
  return globalForCache.__sotbRobinhoodMarkets;
}

function cacheKey(options: LoadRobinhoodChainMarketsOptions): string {
  return [
    options.rhjUrl ?? DEFAULT_RHJ_ASSETS_URL,
    options.dexBaseUrl ?? DEFAULT_ROBINHOOD_DEX_BASE_URL,
    (options.searchQueries ?? ROBINHOOD_ONDO_SEARCH_QUERIES).join("|"),
  ].join("::");
}

/**
 * RHJ registry plus DexScreener chain-4663 markets.
 * A down registry or a failed search does not blank the other source.
 * Throws only when both name sources fail.
 */
export async function loadRobinhoodChainMarkets(
  options: LoadRobinhoodChainMarketsOptions = {},
): Promise<RobinhoodChainCatalog> {
  const useCache = options.cache !== false && options.fetchImpl == null;
  const key = cacheKey(options);
  const store = cacheStore();
  const now = Date.now();
  if (useCache && store.entry && store.entry.key === key && store.entry.expiresAt > now) {
    return store.entry.catalog;
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const rhjUrl = options.rhjUrl ?? DEFAULT_RHJ_ASSETS_URL;
  const dexBase = (options.dexBaseUrl ?? DEFAULT_ROBINHOOD_DEX_BASE_URL).replace(/\/+$/, "");
  const timeoutMs = options.timeoutMs ?? DEX_TIMEOUT_MS;
  const queries = options.searchQueries ?? ROBINHOOD_ONDO_SEARCH_QUERIES;

  const [registrySettled, searchSettled] = await Promise.all([
    fetchJsonOrText(rhjUrl, options.timeoutMs ?? RHJ_TIMEOUT_MS, fetchImpl, "RHJ registry", 1).then(
      (payload) => ({ ok: true as const, payload }),
      (error: unknown) => ({ ok: false as const, error }),
    ),
    mapWithConcurrency(queries, DEX_CONCURRENCY, async (query) => {
      try {
        const payload = await fetchJsonOrText(
          `${dexBase}/latest/dex/search?q=${encodeURIComponent(query)}`,
          timeoutMs,
          fetchImpl,
          "DexScreener search",
          1,
        );
        return unwrapDexScreenerPairs(payload);
      } catch {
        return [] as DexScreenerPair[];
      }
    }),
  ]);

  const registryError = registrySettled.ok ? null : errorMessage(registrySettled.error);
  const rhjTokens = registrySettled.ok ? parseRhjRegistry(registrySettled.payload) : [];
  const searchPairs = searchSettled.flat();
  const tokens = mergeRobinhoodTokens(rhjTokens, ondoTokensFromPairs(searchPairs));
  if (tokens.length === 0) {
    throw new Error(
      registryError ??
        "Robinhood Chain discovery returned no RHJ or Ondo-named tokens. That is a missing list, not zero volume.",
    );
  }

  const chunks = chunkValues(
    tokens.map((token) => token.address),
    DEXSCREENER_TOKEN_BATCH_SIZE,
  );
  const batchResults = await mapWithConcurrency(chunks, DEX_CONCURRENCY, async (addresses) => {
    try {
      const payload = await fetchJsonOrText(
        `${dexBase}/tokens/v1/${ROBINHOOD_DEX_CHAIN_SLUG}/${addresses.join(",")}`,
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
  const lanes = buildRobinhoodMarketLanes(tokens, pairs, { volumeHydrated });
  const fetchedAt = new Date().toISOString();
  const catalog: RobinhoodChainCatalog = {
    ...lanes,
    volumeHydrated,
    registryError,
    fetchedAt,
    provenance: {
      sourceId: "robinhood",
      sourceLabel: ROBINHOOD_MARKETS_SOURCE_LABEL,
      fetchedAt,
      generatedAt: fetchedAt,
      refreshStartedAt: fetchedAt,
      refreshDurationMs: null,
      cacheStatus: volumeHydrated ? "fresh" : "partial",
      cacheAgeMs: 0,
      notes: [ROBINHOOD_MARKETS_NOTE],
      sourceFailures: registryError
        ? [{ sourceId: "robinhood", sourceLabel: "RHJ registry", message: registryError }]
        : [],
    },
  };

  if (useCache) {
    store.entry = { key, expiresAt: now + CACHE_MS, catalog };
  }
  return catalog;
}

export async function lookupRobinhoodChainAsset(
  key: string,
  options?: LoadRobinhoodChainMarketsOptions,
): Promise<AssetDetailResult | null> {
  const catalog = await loadRobinhoodChainMarkets(options);
  const asset = findRobinhoodDetail(catalog.details, key);
  if (!asset) return null;
  const chain = {
    ...robinhoodSnapshotChainShell(),
    sourceId: "robinhood" as const,
    sourceLabel: ROBINHOOD_MARKETS_SOURCE_LABEL,
    coverageNote: ROBINHOOD_MARKETS_NOTE,
  };
  return { chain, asset, provenance: catalog.provenance };
}

export function robinhoodCatalogCount(
  catalog: Pick<RobinhoodChainCatalog, "assets" | "etfAssets" | "privateAssets">,
): number {
  return catalog.assets.length + catalog.etfAssets.length + catalog.privateAssets.length;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Robinhood Chain name source failed.";
}
