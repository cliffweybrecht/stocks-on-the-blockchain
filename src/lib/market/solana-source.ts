import { buildSolanaSnapshot, unwrapDexScreenerPairs } from "./map-solana";
import { SOLANA_XSTOCK_MINTS, solanaTokensPath, type SolanaAllowlistedMint } from "./solana-allowlist";
import { SOLANA_CHAIN_ID, type AssetDetailResult, type ChainDetailResult, type ChainListResult, type MarketDataSource } from "./types";

const DEFAULT_BASE_URL = "https://api.dexscreener.com";
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_CACHE_MS = 60_000;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

interface CachedSnapshot {
  mapped: ReturnType<typeof buildSolanaSnapshot>;
  expiresAt: number;
}

export interface SolanaMarketDataSourceOptions {
  baseUrl?: string;
  timeoutMs?: number;
  cacheMs?: number;
  mints?: readonly SolanaAllowlistedMint[];
  fetchImpl?: FetchLike;
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
  readonly label = "DexScreener (xStocks allowlist)";
  private cache: CachedSnapshot | null = null;

  constructor(private readonly options: SolanaMarketDataSourceOptions = {}) {}

  private get baseUrl() {
    return (this.options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  }

  private get timeoutMs() {
    return this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private get mints() {
    return this.options.mints ?? SOLANA_XSTOCK_MINTS;
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

    const payload = await fetchJson(`${this.baseUrl}${solanaTokensPath(this.mints)}`, this.timeoutMs, this.fetchImpl);
    const pairs = unwrapDexScreenerPairs(payload);
    const mapped = buildSolanaSnapshot({
      pairs,
      mints: this.mints,
      fetchedAt: new Date().toISOString(),
    });
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
    const asset = mapped.details.find((row) => row.symbol.toLowerCase() === symbol.toLowerCase());
    if (!asset) return null;
    return { chain: mapped.chain, asset, provenance: mapped.provenance };
  }
}
