import { createRequestGate, mapWithConcurrency } from "./async-pool";
import { findAssetByKey } from "./identity";
import { buildSolanaSnapshot, unwrapDexScreenerPairs, unwrapDexScreenerSearch } from "./map-solana";
import {
  chunkValues,
  collectSolanaCandidateTokens,
  DEFAULT_SOLANA_DISCOVERY_QUERIES,
  DEXSCREENER_TOKEN_BATCH_SIZE,
  mergeTokenIdentities,
  selectInstrumentMints,
  solanaSearchPath,
  solanaTokenPairsPath,
  solanaTokensBatchPath,
  type DiscoveredEquityMint,
} from "./solana-discover";
import { fetchJsonOrText, type FetchLike } from "./solana-http";
import { DEFAULT_ONDO_REGISTRY_URL, parseOndoGmConstants } from "./solana-ondo";
import {
  DEFAULT_XSTOCKS_REGISTRY_BASE_URL,
  parseXStocksAssetsPage,
  XSTOCKS_REGISTRY_MAX_PAGES,
  xStocksAssetsPath,
} from "./solana-registry";
import { SOLANA_SOURCE_LABEL } from "./trust";
import {
  SOLANA_CHAIN_ID,
  type AssetDetailResult,
  type ChainDetailResult,
  type ChainListResult,
  type MarketDataSource,
  type VolumeAggregation,
} from "./types";
import type { TokenIdentity } from "./solana-classifier";

const DEFAULT_BASE_URL = "https://api.dexscreener.com";
const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_CACHE_MS = 5 * 60_000;
const DEFAULT_STALE_MS = 15 * 60_000;
const DEFAULT_REQUEST_GAP_MS = 80;
const DEFAULT_MAX_CONCURRENT = 4;
const DEFAULT_HOME_BUDGET_MS = 12_000;
const DEFAULT_FULL_BUDGET_MS = 25_000;

type SnapshotMode = "light" | "full";

interface CachedSnapshot {
  mapped: ReturnType<typeof buildSolanaSnapshot>;
  aggregation: VolumeAggregation;
  discovered: DiscoveredEquityMint[];
  discoveredEtfs: DiscoveredEquityMint[];
  extraNotes: string[];
  createdAt: number;
  expiresAt: number;
  staleUntil: number;
}

export interface SolanaMarketDataSourceOptions {
  baseUrl?: string;
  timeoutMs?: number;
  cacheMs?: number;
  staleMs?: number;
  requestGapMs?: number;
  maxConcurrent?: number;
  homeBudgetMs?: number;
  fullBudgetMs?: number;
  discoveryQueries?: readonly string[];
  enableRegistry?: boolean;
  registryBaseUrl?: string;
  enableOndoRegistry?: boolean;
  ondoRegistryUrl?: string;
  retries?: number;
  fetchImpl?: FetchLike;
}

export class SolanaMarketDataSource implements MarketDataSource {
  readonly id = "solana" as const;
  readonly label = SOLANA_SOURCE_LABEL;
  private cache: CachedSnapshot | null = null;
  private inflight: Promise<CachedSnapshot> | null = null;
  private inflightMode: SnapshotMode | null = null;

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

  private get maxConcurrent() {
    return this.options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
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

  private get ondoEnabled() {
    return this.options.enableOndoRegistry !== false;
  }

  private get ondoRegistryUrl() {
    return this.options.ondoRegistryUrl ?? DEFAULT_ONDO_REGISTRY_URL;
  }

  private get fetchImpl() {
    return this.options.fetchImpl ?? fetch;
  }

  private get cacheMs() {
    return this.options.cacheMs ?? DEFAULT_CACHE_MS;
  }

  private get staleMs() {
    return this.options.staleMs ?? DEFAULT_STALE_MS;
  }

  private gate() {
    return createRequestGate({ maxConcurrent: this.maxConcurrent, minGapMs: this.requestGapMs });
  }

  private async fetchSource(url: string, label: string): Promise<unknown> {
    return fetchJsonOrText(url, this.timeoutMs, this.fetchImpl, label, this.options.retries ?? 2);
  }

  private async loadSearchIdentities(): Promise<{ identities: TokenIdentity[]; error: Error | null; failedQueries: number }> {
    const gate = this.gate();
    const results = await mapWithConcurrency(this.discoveryQueries, this.maxConcurrent, async (query) => {
      try {
        const payload = await gate.run(() => this.fetchSource(`${this.baseUrl}${solanaSearchPath(query)}`, "DexScreener"));
        return { pairs: unwrapDexScreenerSearch(payload), error: null as Error | null };
      } catch (error) {
        return {
          pairs: [],
          error: error instanceof Error ? error : new Error("DexScreener search failed."),
        };
      }
    });
    const identities = collectSolanaCandidateTokens(results.flatMap((row) => row.pairs));
    const errors = results.map((row) => row.error).filter((error): error is Error => error !== null);
    return {
      identities,
      error: errors.length === results.length && results.length > 0 ? errors[0]! : null,
      failedQueries: errors.length,
    };
  }

  private async loadRegistryIdentities(): Promise<TokenIdentity[]> {
    const identities: TokenIdentity[] = [];
    const gate = this.gate();
    const first = await gate.run(() =>
      this.fetchSource(`${this.registryBaseUrl}${xStocksAssetsPath(0)}`, "xStocks registry"),
    );
    const parsed = parseXStocksAssetsPage(first);
    identities.push(...parsed.identities);
    let hasNextPage = parsed.hasNextPage;
    let page = 1;
    while (hasNextPage && page < XSTOCKS_REGISTRY_MAX_PAGES) {
      const batch: number[] = [];
      for (let offset = 0; offset < 3 && page + offset < XSTOCKS_REGISTRY_MAX_PAGES; offset += 1) {
        batch.push(page + offset);
      }
      const pages = await mapWithConcurrency(batch, Math.min(3, this.maxConcurrent), async (pageNumber) => {
        const payload = await gate.run(() =>
          this.fetchSource(`${this.registryBaseUrl}${xStocksAssetsPath(pageNumber)}`, "xStocks registry"),
        );
        const next = parseXStocksAssetsPage(payload);
        return { identities: next.identities, hasNextPage: next.hasNextPage, page: pageNumber };
      });
      for (const row of [...pages].sort((a, b) => a.page - b.page)) {
        identities.push(...row.identities);
        if (!row.hasNextPage) {
          hasNextPage = false;
          break;
        }
      }
      page += batch.length;
    }
    return identities;
  }

  private async loadOndoIdentities(): Promise<TokenIdentity[]> {
    const payload = await this.fetchSource(this.ondoRegistryUrl, "Ondo GM list");
    return parseOndoGmConstants(payload);
  }

  private async hydratePreviewPairs(mints: readonly string[], deadline: number) {
    const gate = this.gate();
    const chunks = chunkValues(mints, DEXSCREENER_TOKEN_BATCH_SIZE);
    const failedMints = new Set<string>();
    const incompleteMints = new Set<string>();
    const pairRows: ReturnType<typeof unwrapDexScreenerPairs> = [];

    const results = await mapWithConcurrency(chunks, this.maxConcurrent, async (chunk) => {
      if (Date.now() > deadline) {
        return { ok: false as const, incomplete: true, chunk, pairs: [] };
      }
      try {
        const payload = await gate.run(() =>
          this.fetchSource(`${this.baseUrl}${solanaTokensBatchPath(chunk)}`, "DexScreener"),
        );
        return { ok: true as const, incomplete: false, chunk, pairs: unwrapDexScreenerPairs(payload) };
      } catch {
        return { ok: false as const, incomplete: false, chunk, pairs: [] };
      }
    });

    for (const result of results) {
      if (result.ok) {
        pairRows.push(...result.pairs);
      } else if (result.incomplete) {
        result.chunk.forEach((mint) => incompleteMints.add(mint));
      } else {
        result.chunk.forEach((mint) => failedMints.add(mint));
      }
    }
    return { pairRows, failedMints, incompleteMints };
  }

  private async hydrateFullPools(mints: readonly string[], deadline: number) {
    const gate = this.gate();
    const failedMints = new Set<string>();
    const incompleteMints = new Set<string>();
    const pairRows: ReturnType<typeof unwrapDexScreenerPairs> = [];

    const results = await mapWithConcurrency(mints, this.maxConcurrent, async (mint) => {
      if (Date.now() > deadline) {
        return { ok: false as const, incomplete: true, mint, pairs: [] };
      }
      try {
        const payload = await gate.run(() =>
          this.fetchSource(`${this.baseUrl}${solanaTokenPairsPath(mint)}`, "DexScreener"),
        );
        return { ok: true as const, incomplete: false, mint, pairs: unwrapDexScreenerPairs(payload) };
      } catch {
        return { ok: false as const, incomplete: false, mint, pairs: [] };
      }
    });

    for (const result of results) {
      if (result.ok) {
        pairRows.push(...result.pairs);
      } else if (result.incomplete) {
        incompleteMints.add(result.mint);
      } else {
        failedMints.add(result.mint);
      }
    }
    return { pairRows, failedMints, incompleteMints };
  }

  private mintsWithPairs(
    pairs: readonly { baseToken?: { address?: unknown }; quoteToken?: { address?: unknown } }[],
    discovered: readonly DiscoveredEquityMint[],
  ) {
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

  private cacheSatisfies(mode: SnapshotMode, now: number): CachedSnapshot | null {
    if (!this.cache) return null;
    if (this.cache.staleUntil <= now) return null;
    if (mode === "full" && this.cache.aggregation !== "all-pools") return null;
    return this.cache;
  }

  private async refresh(mode: SnapshotMode): Promise<CachedSnapshot> {
    const started = Date.now();
    const budgetMs = mode === "light" ? (this.options.homeBudgetMs ?? DEFAULT_HOME_BUDGET_MS) : (this.options.fullBudgetMs ?? DEFAULT_FULL_BUDGET_MS);
    const deadline = started + budgetMs;
    const extraNotes: string[] = [];

    const searchTask = this.loadSearchIdentities();
    const registryTask = this.registryEnabled
      ? this.loadRegistryIdentities().then(
          (identities) => ({ identities, error: null as Error | null }),
          (error: unknown) => ({
            identities: [] as TokenIdentity[],
            error: error instanceof Error ? error : new Error("xStocks registry failed."),
          }),
        )
      : Promise.resolve({ identities: [] as TokenIdentity[], error: null as Error | null });
    const ondoTask = this.ondoEnabled
      ? this.loadOndoIdentities().then(
          (identities) => ({ identities, error: null as Error | null }),
          (error: unknown) => ({
            identities: [] as TokenIdentity[],
            error: error instanceof Error ? error : new Error("Ondo GM list failed."),
          }),
        )
      : Promise.resolve({ identities: [] as TokenIdentity[], error: null as Error | null });

    const [searchResult, registryResult, ondoResult] = await Promise.all([searchTask, registryTask, ondoTask]);
    if (registryResult.error) {
      extraNotes.push(
        `xStocks public registry unavailable: ${registryResult.error.message}. Discovery continued from DexScreener search${this.ondoEnabled ? " and the public Ondo mint list" : ""}.`,
      );
    }
    if (ondoResult.error) {
      extraNotes.push(
        `Ondo public GM mint list unavailable: ${ondoResult.error.message}. Official Ondo Stocks API was not used (requires a key). Discovery continued from other live sources.`,
      );
    }
    if (searchResult.failedQueries > 0 && searchResult.failedQueries < this.discoveryQueries.length) {
      extraNotes.push(
        `${searchResult.failedQueries} DexScreener search probe(s) failed; remaining probes and registries were still used.`,
      );
    }

    const selected = selectInstrumentMints(
      mergeTokenIdentities([searchResult.identities, registryResult.identities, ondoResult.identities]),
    );
    const discovered = selected.equities;
    const discoveredEtfs = selected.etfs;
    if (discovered.length === 0 && discoveredEtfs.length === 0) {
      if (searchResult.error && (!this.registryEnabled || registryResult.error) && (!this.ondoEnabled || ondoResult.error)) {
        throw new Error(
          [searchResult.error.message, registryResult.error?.message, ondoResult.error?.message].filter(Boolean).join(" · "),
        );
      }
      throw new Error(
        "No verifiable Solana tokenized stocks from live discovery + classifier. Coverage is as discoverable from DexScreener search, the xStocks public registry, the public Ondo GM mint list, and the classifier — not a full chain index. Ondo's keyed API is not used.",
      );
    }

    const allDiscovered = [...discovered, ...discoveredEtfs];
    const preview = await this.hydratePreviewPairs(
      allDiscovered.map((row) => row.mint),
      deadline,
    );
    extraNotes.push(
      `Classified ${discovered.length} public equities and ${discoveredEtfs.length} ETF/index products. ${preview.failedMints.size} mint batch(es) failed DexScreener preview; ${preview.incompleteMints.size} did not finish before the snapshot budget.`,
    );

    const aggregation: VolumeAggregation = mode === "light" ? "primary-pair" : "all-pools";
    let pairRows = preview.pairRows;
    const failedMints = new Set(preview.failedMints);
    const incompleteMints = new Set(preview.incompleteMints);

    if (mode === "full") {
      const activeMints = this.mintsWithPairs(preview.pairRows, allDiscovered).filter(
        (mint) => !failedMints.has(mint) && !incompleteMints.has(mint),
      );
      if (activeMints.length > 0) {
        const full = await this.hydrateFullPools(activeMints, deadline);
        pairRows = full.pairRows;
        full.failedMints.forEach((mint) => failedMints.add(mint));
        full.incompleteMints.forEach((mint) => incompleteMints.add(mint));
      }
      if (incompleteMints.size > 0) {
        extraNotes.push(
          "DexScreener every-pool hydrate hit the snapshot budget. Volume for unfinished mints is unknown, not zero.",
        );
      }
    } else {
      extraNotes.push(
        "Home snapshot uses DexScreener primary-pair volume per mint so the chain list is not blocked on every-pool hydrate. Open Solana for full pool aggregation.",
      );
    }

    const now = Date.now();
    const mapped = buildSolanaSnapshot({
      pairs: pairRows,
      fetchedAt: new Date().toISOString(),
      discovered,
      discoveredEtfs,
      extraNotes,
      failedMints,
      incompleteMints,
      aggregation,
      refreshDurationMs: now - started,
      cacheStatus: "fresh",
      cacheAgeMs: 0,
    });
    if (mapped.assets.length === 0 && mapped.etfAssets.length === 0) {
      throw new Error(
        "Discovery returned candidates but none classified as verifiable tokenized equities. Nothing was invented.",
      );
    }

    return {
      mapped,
      aggregation,
      discovered,
      discoveredEtfs,
      extraNotes,
      createdAt: now,
      expiresAt: now + this.cacheMs,
      staleUntil: now + this.staleMs,
    };
  }

  private async loadCached(mode: SnapshotMode): Promise<CachedSnapshot> {
    const now = Date.now();
    const hit = this.cacheSatisfies(mode, now);
    if (hit) {
      if (hit.expiresAt <= now && !this.inflight) {
        this.inflightMode = mode;
        this.inflight = this.refresh(mode)
          .then((next) => {
            this.cache = this.preferRicherCache(next);
            return this.cache;
          })
          .finally(() => {
            this.inflight = null;
            this.inflightMode = null;
          });
      }
      const age = now - hit.createdAt;
      hit.mapped.provenance.cacheStatus = hit.expiresAt > now ? "fresh" : "stale";
      hit.mapped.provenance.cacheAgeMs = age;
      return hit;
    }

    if (this.inflight && (this.inflightMode === mode || this.inflightMode === "full" || mode === "light")) {
      const pending = await this.inflight;
      if (mode === "full" && pending.aggregation !== "all-pools") {
        // fall through to a full refresh
      } else {
        return pending;
      }
    }

    this.inflightMode = mode;
    this.inflight = this.refresh(mode)
      .then((next) => {
        this.cache = this.preferRicherCache(next);
        return this.cache;
      })
      .finally(() => {
        this.inflight = null;
        this.inflightMode = null;
      });
    return this.inflight;
  }

  private preferRicherCache(next: CachedSnapshot): CachedSnapshot {
    if (
      this.cache &&
      this.cache.aggregation === "all-pools" &&
      next.aggregation === "primary-pair" &&
      this.cache.expiresAt > Date.now()
    ) {
      return this.cache;
    }
    return next;
  }

  async listChains(): Promise<ChainListResult> {
    const cached = await this.loadCached("light");
    return { chains: [cached.mapped.chain], provenance: cached.mapped.provenance };
  }

  async getChain(chainId: string): Promise<ChainDetailResult | null> {
    if (chainId !== SOLANA_CHAIN_ID) return null;
    const cached = await this.loadCached("full");
    return {
      chain: cached.mapped.chain,
      assets: cached.mapped.assets,
      etfAssets: cached.mapped.etfAssets,
      provenance: cached.mapped.provenance,
    };
  }

  async getAsset(chainId: string, symbol: string): Promise<AssetDetailResult | null> {
    if (chainId !== SOLANA_CHAIN_ID) return null;
    const cached = await this.loadCached("full");
    const asset = findAssetByKey([...cached.mapped.details, ...cached.mapped.etfDetails], symbol);
    if (!asset) return null;
    return { chain: cached.mapped.chain, asset, provenance: cached.mapped.provenance };
  }
}
