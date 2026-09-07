import { findAssetByKey } from "./identity";
import { buildSolanaSnapshot, unwrapDexScreenerPairs, unwrapDexScreenerSearch } from "./map-solana";
import {
  DEFAULT_SOLANA_DISCOVERY_QUERIES,
  selectEquityMints,
  collectSolanaCandidateTokens,
  solanaSearchPath,
  solanaTokenPairsPath,
} from "./solana-discover";
import { SOLANA_SOURCE_LABEL } from "./trust";
import { SOLANA_CHAIN_ID, type AssetDetailResult, type ChainDetailResult, type ChainListResult, type MarketDataSource } from "./types";

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
  fetchImpl?: FetchLike;
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url: string, timeoutMs: number, fetchImpl: FetchLike): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`Solana market source ${response.status} from DexScreener`);
    }
    return await response.json();
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Solana market source timed out after ${Math.round(timeoutMs / 1000)}s.`);
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

  private get fetchImpl() {
    return this.options.fetchImpl ?? fetch;
  }

  private async loadMapped() {
    const now = Date.now();
    const ttl = this.options.cacheMs ?? DEFAULT_CACHE_MS;
    if (this.cache && this.cache.expiresAt > now) {
      return this.cache.mapped;
    }

    const searchPairs = [];
    for (const [index, query] of this.discoveryQueries.entries()) {
      if (index > 0) await sleep(this.requestGapMs);
      const payload = await fetchJson(`${this.baseUrl}${solanaSearchPath(query)}`, this.timeoutMs, this.fetchImpl);
      searchPairs.push(...unwrapDexScreenerSearch(payload));
    }

    const discovered = selectEquityMints(collectSolanaCandidateTokens(searchPairs));
    if (discovered.length === 0) {
      throw new Error(
        "No verifiable Solana tokenized stocks from DexScreener discovery + classifier. Coverage is search-capped, not a full chain index.",
      );
    }

    const pairRows = [];
    for (const [index, row] of discovered.entries()) {
      if (index > 0) await sleep(this.requestGapMs);
      const payload = await fetchJson(
        `${this.baseUrl}${solanaTokenPairsPath(row.mint)}`,
        this.timeoutMs,
        this.fetchImpl,
      );
      pairRows.push(...unwrapDexScreenerPairs(payload));
    }

    const mapped = buildSolanaSnapshot({
      pairs: pairRows,
      fetchedAt: new Date().toISOString(),
    });
    if (mapped.assets.length === 0) {
      throw new Error(
        "DexScreener returned pairs but none classified as verifiable tokenized equities. Nothing was invented.",
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
