import { findAssetByKey } from "./identity";
import { buildSolanaSnapshot, unwrapDexScreenerPairs, unwrapDexScreenerSearch } from "./map-solana";
import {
  chunkValues,
  collectSolanaCandidateTokens,
  DEFAULT_SOLANA_DISCOVERY_QUERIES,
  DEXSCREENER_TOKEN_BATCH_SIZE,
  mergeTokenIdentities,
  selectEquityMints,
  solanaSearchPath,
  solanaTokenPairsPath,
  solanaTokensBatchPath,
  type DiscoveredEquityMint,
} from "./solana-discover";
import {
  DEFAULT_XSTOCKS_REGISTRY_BASE_URL,
  parseXStocksAssetsPage,
  XSTOCKS_REGISTRY_MAX_PAGES,
  xStocksAssetsPath,
} from "./solana-registry";
import { SOLANA_SOURCE_LABEL } from "./trust";
import { SOLANA_CHAIN_ID, type AssetDetailResult, type ChainDetailResult, type ChainListResult, type MarketDataSource } from "./types";
import type { TokenIdentity } from "./solana-classifier";

const DEFAULT_BASE_URL = "https://api.dexscreener.com";
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_CACHE_MS = 60_000;
const DEFAULT_REQUEST_GAP_MS = 200;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

interface CachedSnapshot {
  mapped: ReturnType<typeof buildSolanaSnapshot>;
  expiresAt: number;
}

export interface SolanaMarketDataSourceOptions {
  baseUrl?: string;
  timeoutMs?: number;
  cacheMs?: number;
  requestGapMs?: number;
  discoveryQueries?: readonly string[];
  enableRegistry?: boolean;
  registryBaseUrl?: string;
  fetchImpl?: FetchLike;
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(
  url: string,
  timeoutMs: number,
  fetchImpl: FetchLike,
  sourceLabel: string,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "user-agent": "stocks-on-the-blockchain/0.1",
      },
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`${sourceLabel} ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`${sourceLabel} timed out after ${Math.round(timeoutMs / 1000)}s.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export class SolanaMarketDataSource implements MarketDataSource {
  readonly id = "solana" as const;
  readonly label = SOLANA_SOURCE_LABEL;
  private cache: CachedSnapshot | null = null;

  constructor(private readonly options: SolanaMarketDataSourceOptions = {}) {}

  private get baseUrl() {
    return (this.options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  }

  private get timeoutMs() {
    return this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private get requestGapMs() {
    return this.options.requestGapMs ?? DEFAULT_REQUEST_GAP_MS;
  }

  private get discoveryQueries() {
    return this.options.discoveryQueries ?? DEFAULT_SOLANA_DISCOVERY_QUERIES;
  }

  private get registryEnabled() {
    return this.options.enableRegistry !== false;
  }

  private get registryBaseUrl() {
    return (this.options.registryBaseUrl ?? DEFAULT_XSTOCKS_REGISTRY_BASE_URL).replace(/\/+$/, "");
  }

  private get fetchImpl() {
    return this.options.fetchImpl ?? fetch;
  }

  private async loadSearchIdentities(): Promise<TokenIdentity[]> {
    const searchPairs = [];
    for (const [index, query] of this.discoveryQueries.entries()) {
      if (index > 0) await sleep(this.requestGapMs);
      const payload = await fetchJson(
        `${this.baseUrl}${solanaSearchPath(query)}`,
        this.timeoutMs,
        this.fetchImpl,
        "DexScreener",
      );
      searchPairs.push(...unwrapDexScreenerSearch(payload));
    }
    return collectSolanaCandidateTokens(searchPairs);
  }

  private async loadRegistryIdentities(): Promise<TokenIdentity[]> {
    const identities: TokenIdentity[] = [];
    for (let page = 0; page < XSTOCKS_REGISTRY_MAX_PAGES; page += 1) {
      if (page > 0) await sleep(this.requestGapMs);
      const payload = await fetchJson(
        `${this.registryBaseUrl}${xStocksAssetsPath(page)}`,
        this.timeoutMs,
        this.fetchImpl,
        "xStocks registry",
      );
      const parsed = parseXStocksAssetsPage(payload);
      identities.push(...parsed.identities);
      if (!parsed.hasNextPage) break;
    }
    return identities;
  }

  private async hydratePreviewPairs(mints: readonly string[]) {
    const pairRows = [];
    const chunks = chunkValues(mints, DEXSCREENER_TOKEN_BATCH_SIZE);
    for (const [index, chunk] of chunks.entries()) {
      if (index > 0) await sleep(this.requestGapMs);
      const payload = await fetchJson(
        `${this.baseUrl}${solanaTokensBatchPath(chunk)}`,
        this.timeoutMs,
        this.fetchImpl,
        "DexScreener",
      );
      pairRows.push(...unwrapDexScreenerPairs(payload));
    }
    return pairRows;
  }

  private async hydrateFullPools(mints: readonly string[]) {
    const pairRows = [];
    for (const [index, mint] of mints.entries()) {
      if (index > 0) await sleep(this.requestGapMs);
      const payload = await fetchJson(
        `${this.baseUrl}${solanaTokenPairsPath(mint)}`,
        this.timeoutMs,
        this.fetchImpl,
        "DexScreener",
      );
      pairRows.push(...unwrapDexScreenerPairs(payload));
    }
    return pairRows;
  }

  private mintsWithPairs(pairs: readonly { baseToken?: { address?: unknown }; quoteToken?: { address?: unknown } }[], discovered: readonly DiscoveredEquityMint[]) {
    const wanted = new Set(discovered.map((row) => row.mint));
    const found = new Set<string>();
    for (const pair of pairs) {
      for (const side of [pair.baseToken, pair.quoteToken]) {
        const address = typeof side?.address === "string" ? side.address : null;
        if (address && wanted.has(address)) found.add(address);
      }
    }
    return discovered.map((row) => row.mint).filter((mint) => found.has(mint));
  }

  private async loadMapped() {
    const now = Date.now();
    const ttl = this.options.cacheMs ?? DEFAULT_CACHE_MS;
    if (this.cache && this.cache.expiresAt > now) {
      return this.cache.mapped;
    }

    const extraNotes: string[] = [];
    const searchTask = this.loadSearchIdentities().then(
      (identities) => ({ identities, error: null as Error | null }),
      (error: unknown) => ({
        identities: [] as TokenIdentity[],
        error: error instanceof Error ? error : new Error("DexScreener search failed."),
      }),
    );
    const registryTask = this.registryEnabled
      ? this.loadRegistryIdentities().then(
          (identities) => ({ identities, error: null as Error | null }),
          (error: unknown) => ({
            identities: [] as TokenIdentity[],
            error: error instanceof Error ? error : new Error("xStocks registry failed."),
          }),
        )
      : Promise.resolve({ identities: [] as TokenIdentity[], error: null as Error | null });

    const [searchResult, registryResult] = await Promise.all([searchTask, registryTask]);
    const searchIdentities = searchResult.identities;
    const searchError = searchResult.error;
    const registryIdentities = registryResult.identities;
    const registryError = registryResult.error;
    if (registryError) {
      extraNotes.push(
        `xStocks public registry unavailable: ${registryError.message}. Discovery continued from DexScreener search.`,
      );
    }

    const discovered: DiscoveredEquityMint[] = selectEquityMints(
      mergeTokenIdentities([searchIdentities, registryIdentities]),
    );
    if (discovered.length === 0) {
      if (searchError && (!this.registryEnabled || registryError)) {
        throw new Error(
          [searchError.message, registryError?.message].filter(Boolean).join(" · "),
        );
      }
      throw new Error(
        "No verifiable Solana tokenized stocks from live discovery + classifier. Coverage is as discoverable from DexScreener search, the xStocks public registry, and the classifier — not a full chain index.",
      );
    }

    const previewPairs = await this.hydratePreviewPairs(discovered.map((row) => row.mint));
    const activeMints = this.mintsWithPairs(previewPairs, discovered);
    const pairRows = activeMints.length > 0 ? await this.hydrateFullPools(activeMints) : [];
    const mapped = buildSolanaSnapshot({
      pairs: pairRows,
      fetchedAt: new Date().toISOString(),
      discovered,
      extraNotes,
    });
    if (mapped.assets.length === 0) {
      throw new Error(
        "Discovery returned candidates but none classified as verifiable tokenized equities. Nothing was invented.",
      );
    }
    this.cache = { mapped, expiresAt: now + ttl };
    return mapped;
  }

  async listChains(): Promise<ChainListResult> {
    const mapped = await this.loadMapped();
    return { chains: [mapped.chain], provenance: mapped.provenance };
  }

  async getChain(chainId: string): Promise<ChainDetailResult | null> {
    if (chainId !== SOLANA_CHAIN_ID) return null;
    const mapped = await this.loadMapped();
    return { chain: mapped.chain, assets: mapped.assets, provenance: mapped.provenance };
  }

  async getAsset(chainId: string, symbol: string): Promise<AssetDetailResult | null> {
    if (chainId !== SOLANA_CHAIN_ID) return null;
    const mapped = await this.loadMapped();
    const asset = findAssetByKey(mapped.details, symbol);
    if (!asset) return null;
    return { chain: mapped.chain, asset, provenance: mapped.provenance };
  }
}
