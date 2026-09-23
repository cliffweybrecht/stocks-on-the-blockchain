import { createRequestGate, mapWithConcurrency } from "./async-pool";
import { findAssetByKey } from "./identity";
import { buildSolanaSnapshot, unwrapDexScreenerPairs, unwrapDexScreenerSearch, type DexScreenerPair } from "./map-solana";
import {
  chunkValues,
  collectSolanaCandidateTokens,
  DEFAULT_SOLANA_DISCOVERY_QUERIES,
  DEXSCREENER_TOKEN_BATCH_SIZE,
  mergeTokenIdentities,
  mintsInPairs,
  pairsTouchingMints,
  prioritizeMintsForHydrate,
  selectInstrumentMints,
  solanaSearchPath,
  solanaTokenPairsPath,
  solanaTokensBatchPath,
  type DiscoveredEquityMint,
} from "./solana-discover";
import {
  DEFAULT_GECKOTERMINAL_BASE_URL,
  DEFAULT_GECKOTERMINAL_QUERIES,
  geckoTerminalOhlcvPath,
  geckoTerminalSearchPath,
  parseGeckoTerminalSearch,
} from "./solana-geckoterminal";
import { SolanaHydrateMemory } from "./solana-hydrate-memory";
import { fetchJsonOrText, type FetchLike } from "./solana-http";
import { DEFAULT_ONDO_REGISTRY_URL, parseOndoGmConstants } from "./solana-ondo";
import {
  DEFAULT_SUNRISE_REGISTRY_BASE_URL,
  parseSunriseTokensPage,
  SUNRISE_REGISTRY_MAX_PAGES,
  sunriseTokensPath,
} from "./solana-sunrise";
import { DEFAULT_TESSERA_REGISTRY_URL, parseTesseraTokenMints } from "./solana-tessera";
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
  type AssetPriceHistoryResult,
  type ChainDetailResult,
  type ChainListResult,
  type EquityVolumeHistoryResult,
  type MarketDataSource,
  type VolumeAggregation,
} from "./types";
import {
  buildAssetPriceHistory,
  emptyAssetPriceHistory,
  parseGeckoTerminalOhlcvSeries,
  selectPrimaryPricePool,
} from "./asset-price-history";
import { chainCombinedVolume24h } from "./aggregate";
import { emptyEquityVolumeHistory } from "./volume-history";
import { FileDeskVolumeSnapshotStore } from "./volume-snapshot-store";
import {
  buildSnapshotEquityVolumeHistory,
  recordDeskVolumeFromChain,
  type DeskVolumeSnapshotStore,
} from "./volume-snapshots";
import type { TokenIdentity } from "./solana-classifier";

export const SOLANA_DEFAULTS = {
  timeoutMs: 12_000,
  cacheMs: 5 * 60_000,
  staleMs: 15 * 60_000,
  requestGapMs: 50,
  maxConcurrent: 6,
  /** DexScreener hydrate budget after discovery. Search pairs are seeded even if this is 0. */
  homeBudgetMs: 25_000,
  fullBudgetMs: 60_000,
  /** Background DexScreener hydrate after the first snapshot is returned. */
  enrichBudgetMs: 180_000,
  /** Skip re-previewing mints confirmed to have zero DexScreener pools. */
  emptyCacheMs: 30 * 60_000,
  /** Cache TTL for Daily Volume snapshot history and per-mint GeckoTerminal price candles. */
  volumeHistoryCacheMs: 30 * 60_000,
} as const;

const DEFAULT_BASE_URL = "https://api.dexscreener.com";

type SnapshotMode = "light" | "full";

interface CachedSnapshot {
  mapped: ReturnType<typeof buildSolanaSnapshot>;
  aggregation: VolumeAggregation;
  discovered: DiscoveredEquityMint[];
  discoveredEtfs: DiscoveredEquityMint[];
  discoveredPrivates: DiscoveredEquityMint[];
  extraNotes: string[];
  pairRows: DexScreenerPair[];
  pendingPreviewMints: string[];
  pendingFullMints: string[];
  failedMints: string[];
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
  enableTesseraRegistry?: boolean;
  tesseraRegistryUrl?: string;
  enableSunriseRegistry?: boolean;
  sunriseRegistryUrl?: string;
  enableGeckoTerminal?: boolean;
  geckoTerminalBaseUrl?: string;
  enrichBudgetMs?: number;
  emptyCacheMs?: number;
  retries?: number;
  backgroundEnrichment?: boolean;
  fetchImpl?: FetchLike;
  volumeHistoryCacheMs?: number;
  volumeSnapshotStore?: DeskVolumeSnapshotStore;
  volumeSnapshotDir?: string;
}

export class SolanaMarketDataSource implements MarketDataSource {
  readonly id = "solana" as const;
  readonly label = SOLANA_SOURCE_LABEL;
  private cache: CachedSnapshot | null = null;
  private inflight: Promise<CachedSnapshot> | null = null;
  private inflightMode: SnapshotMode | null = null;
  private backgroundWork: Promise<void> | null = null;
  private readonly memory: SolanaHydrateMemory;
  private readonly deskSnapshots: DeskVolumeSnapshotStore;
  private volumeHistoryCache: { result: EquityVolumeHistoryResult; expiresAt: number } | null = null;
  private volumeHistoryInflight: Promise<EquityVolumeHistoryResult> | null = null;
  private priceHistoryCache = new Map<string, { result: AssetPriceHistoryResult; expiresAt: number }>();
  private priceHistoryInflight = new Map<string, Promise<AssetPriceHistoryResult>>();

  constructor(private readonly options: SolanaMarketDataSourceOptions = {}) {
    this.memory = new SolanaHydrateMemory(options.emptyCacheMs ?? SOLANA_DEFAULTS.emptyCacheMs);
    this.deskSnapshots = options.volumeSnapshotStore ?? new FileDeskVolumeSnapshotStore(options.volumeSnapshotDir);
  }

  private get baseUrl() {
    return (this.options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  }

  private get timeoutMs() {
    return this.options.timeoutMs ?? SOLANA_DEFAULTS.timeoutMs;
  }

  private get requestGapMs() {
    return this.options.requestGapMs ?? SOLANA_DEFAULTS.requestGapMs;
  }

  private get maxConcurrent() {
    return this.options.maxConcurrent ?? SOLANA_DEFAULTS.maxConcurrent;
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

  private get tesseraEnabled() {
    return this.options.enableTesseraRegistry !== false;
  }

  private get tesseraRegistryUrl() {
    return this.options.tesseraRegistryUrl ?? DEFAULT_TESSERA_REGISTRY_URL;
  }

  private get sunriseEnabled() {
    return this.options.enableSunriseRegistry !== false;
  }

  private get sunriseRegistryUrl() {
    return (this.options.sunriseRegistryUrl ?? DEFAULT_SUNRISE_REGISTRY_BASE_URL).replace(/\/+$/, "");
  }

  private get geckoEnabled() {
    return this.options.enableGeckoTerminal !== false;
  }

  private get geckoTerminalBaseUrl() {
    return (this.options.geckoTerminalBaseUrl ?? DEFAULT_GECKOTERMINAL_BASE_URL).replace(/\/+$/, "");
  }

  private get fetchImpl() {
    return this.options.fetchImpl ?? fetch;
  }

  private get cacheMs() {
    return this.options.cacheMs ?? SOLANA_DEFAULTS.cacheMs;
  }

  private get staleMs() {
    return this.options.staleMs ?? SOLANA_DEFAULTS.staleMs;
  }

  private get homeBudgetMs() {
    return this.options.homeBudgetMs ?? SOLANA_DEFAULTS.homeBudgetMs;
  }

  private get fullBudgetMs() {
    return this.options.fullBudgetMs ?? SOLANA_DEFAULTS.fullBudgetMs;
  }

  private get enrichBudgetMs() {
    return this.options.enrichBudgetMs ?? SOLANA_DEFAULTS.enrichBudgetMs;
  }

  private get backgroundEnrichment() {
    return this.options.backgroundEnrichment !== false;
  }

  private get volumeHistoryCacheMs() {
    return this.options.volumeHistoryCacheMs ?? SOLANA_DEFAULTS.volumeHistoryCacheMs;
  }

  private gate() {
    return createRequestGate({ maxConcurrent: this.maxConcurrent, minGapMs: this.requestGapMs });
  }

  private async fetchSource(url: string, label: string): Promise<unknown> {
    return fetchJsonOrText(url, this.timeoutMs, this.fetchImpl, label, this.options.retries ?? 2);
  }

  private async loadSearchIdentities(): Promise<{
    identities: TokenIdentity[];
    pairs: DexScreenerPair[];
    error: Error | null;
    failedQueries: number;
  }> {
    const gate = this.gate();
    const results = await mapWithConcurrency(this.discoveryQueries, this.maxConcurrent, async (query) => {
      try {
        const payload = await gate.run(() => this.fetchSource(`${this.baseUrl}${solanaSearchPath(query)}`, "DexScreener"));
        return { pairs: unwrapDexScreenerSearch(payload), error: null as Error | null };
      } catch (error) {
        return {
          pairs: [] as DexScreenerPair[],
          error: error instanceof Error ? error : new Error("DexScreener search failed."),
        };
      }
    });
    const pairs = results.flatMap((row) => row.pairs);
    const identities = collectSolanaCandidateTokens(pairs);
    const errors = results.map((row) => row.error).filter((error): error is Error => error !== null);
    return {
      identities,
      pairs,
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

  private async loadTesseraIdentities(): Promise<TokenIdentity[]> {
    const payload = await this.fetchSource(this.tesseraRegistryUrl, "Tessera T-Token list");
    return parseTesseraTokenMints(payload);
  }

  private async loadSunriseIdentities(): Promise<TokenIdentity[]> {
    const identities: TokenIdentity[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < SUNRISE_REGISTRY_MAX_PAGES; page += 1) {
      const payload = await this.fetchSource(
        `${this.sunriseRegistryUrl}${sunriseTokensPath(cursor)}`,
        "Sunrise token list",
      );
      const parsed = parseSunriseTokensPage(payload);
      for (const identity of parsed.identities) {
        if (seen.has(identity.address)) continue;
        seen.add(identity.address);
        identities.push(identity);
      }
      if (!parsed.nextCursor) break;
      cursor = parsed.nextCursor;
    }
    return identities;
  }

  private async loadGeckoTerminalIdentities(): Promise<TokenIdentity[]> {
    const identities: TokenIdentity[] = [];
    const gate = this.gate();
    for (const query of DEFAULT_GECKOTERMINAL_QUERIES) {
      const payload = await gate.run(() =>
        this.fetchSource(`${this.geckoTerminalBaseUrl}${geckoTerminalSearchPath(query)}`, "GeckoTerminal"),
      );
      identities.push(...parseGeckoTerminalSearch(payload));
    }
    return identities;
  }

  private rememberHydrateOutcome(
    requested: readonly string[],
    pairRows: readonly DexScreenerPair[],
    failed: ReadonlySet<string>,
    incomplete: ReadonlySet<string>,
  ): void {
    const found = mintsInPairs(pairRows, new Set(requested));
    this.memory.rememberOutcome(requested, found, failed, incomplete);
  }

  private hydrateSkipSet(mints: readonly string[], now = Date.now()): Set<string> {
    const skip = new Set<string>();
    for (const mint of mints) {
      if (this.memory.isConfirmedEmpty(mint, now)) skip.add(mint);
    }
    return skip;
  }

  private async hydratePreviewPairs(mints: readonly string[], deadline: number) {
    const gate = this.gate();
    const chunks = chunkValues(mints, DEXSCREENER_TOKEN_BATCH_SIZE);
    const failedMints = new Set<string>();
    const incompleteMints = new Set<string>();
    const pairRows: ReturnType<typeof unwrapDexScreenerPairs> = [];

    const results = await mapWithConcurrency(chunks, this.maxConcurrent, async (chunk) => {
      if (Date.now() >= deadline) {
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
      if (Date.now() >= deadline) {
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

  private coverageScore(snapshot: CachedSnapshot): number {
    const full = snapshot.aggregation === "all-pools" ? 1_000_000 : 0;
    return (
      full +
      snapshot.mapped.chain.assetsWithVolume * 1_000 +
      snapshot.mapped.chain.assetsWithPools * 10 +
      snapshot.pairRows.length
    );
  }

  private cacheSatisfies(mode: SnapshotMode, now: number): CachedSnapshot | null {
    if (!this.cache) return null;
    if (this.cache.staleUntil <= now) return null;
    if (mode === "full" && this.cache.aggregation !== "all-pools") return null;
    return this.cache;
  }

  private commitCache(next: CachedSnapshot): CachedSnapshot {
    const merged = this.preferRicherCache(next);
    this.cache = merged;
    this.scheduleEnrichment();
    void this.persistDeskVolume(merged);
    return merged;
  }

  private rebuildSnapshot(
    snapshot: Omit<CachedSnapshot, "mapped" | "createdAt" | "expiresAt" | "staleUntil"> & {
      createdAt?: number;
      refreshDurationMs: number;
    },
  ): CachedSnapshot {
    const incompleteMints = new Set([...snapshot.pendingPreviewMints, ...snapshot.pendingFullMints]);
    const extraNotes = [...snapshot.extraNotes];
    const hydrating = incompleteMints.size;
    if (hydrating > 0) {
      extraNotes.push(
        `${hydrating} mint(s) still hydrating DexScreener volume in the background. Counts are so-far, not final.`,
      );
    }
    const now = Date.now();
    const mapped = buildSolanaSnapshot({
      pairs: snapshot.pairRows,
      fetchedAt: new Date().toISOString(),
      discovered: snapshot.discovered,
      discoveredEtfs: snapshot.discoveredEtfs,
      discoveredPrivates: snapshot.discoveredPrivates,
      extraNotes,
      failedMints: new Set(snapshot.failedMints),
      incompleteMints,
      aggregation: snapshot.aggregation,
      refreshDurationMs: snapshot.refreshDurationMs,
      cacheStatus: hydrating > 0 ? "partial" : "fresh",
      cacheAgeMs: 0,
    });
    if (mapped.assets.length === 0 && mapped.etfAssets.length === 0 && mapped.privateAssets.length === 0) {
      throw new Error(
        "Discovery returned candidates but none classified as verifiable tokenized equities. Nothing was invented.",
      );
    }
    return {
      mapped,
      aggregation: snapshot.aggregation,
      discovered: snapshot.discovered,
      discoveredEtfs: snapshot.discoveredEtfs,
      discoveredPrivates: snapshot.discoveredPrivates,
      extraNotes,
      pairRows: snapshot.pairRows,
      pendingPreviewMints: snapshot.pendingPreviewMints,
      pendingFullMints: snapshot.pendingFullMints,
      failedMints: snapshot.failedMints,
      createdAt: snapshot.createdAt ?? now,
      expiresAt: now + this.cacheMs,
      staleUntil: now + this.staleMs,
    };
  }

  private async refresh(mode: SnapshotMode): Promise<CachedSnapshot> {
    const started = Date.now();
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

    const tesseraTask = this.tesseraEnabled
      ? this.loadTesseraIdentities().then(
          (identities) => ({ identities, error: null as Error | null }),
          (error: unknown) => ({
            identities: [] as TokenIdentity[],
            error: error instanceof Error ? error : new Error("Tessera T-Token list failed."),
          }),
        )
      : Promise.resolve({ identities: [] as TokenIdentity[], error: null as Error | null });

    const sunriseTask = this.sunriseEnabled
      ? this.loadSunriseIdentities().then(
          (identities) => ({ identities, error: null as Error | null }),
          (error: unknown) => ({
            identities: [] as TokenIdentity[],
            error: error instanceof Error ? error : new Error("Sunrise token list failed."),
          }),
        )
      : Promise.resolve({ identities: [] as TokenIdentity[], error: null as Error | null });

    const geckoTask = this.geckoEnabled
      ? this.loadGeckoTerminalIdentities().then(
          (identities) => ({ identities, error: null as Error | null }),
          (error: unknown) => ({
            identities: [] as TokenIdentity[],
            error: error instanceof Error ? error : new Error("GeckoTerminal search failed."),
          }),
        )
      : Promise.resolve({ identities: [] as TokenIdentity[], error: null as Error | null });

    const [searchResult, registryResult, ondoResult, tesseraResult, sunriseResult, geckoResult] = await Promise.all([
      searchTask,
      registryTask,
      ondoTask,
      tesseraTask,
      sunriseTask,
      geckoTask,
    ]);
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
    if (tesseraResult.error) {
      extraNotes.push(
        `Tessera public T-Token mint list unavailable: ${tesseraResult.error.message}. Discovery continued from other live sources.`,
      );
    }
    if (sunriseResult.error) {
      extraNotes.push(
        `Sunrise public token list unavailable: ${sunriseResult.error.message}. Discovery continued from other live sources.`,
      );
    }
    if (geckoResult.error) {
      extraNotes.push(
        `GeckoTerminal public search unavailable: ${geckoResult.error.message}. DexScreener remains the volume source. Discovery continued from other live sources.`,
      );
    }
    if (searchResult.failedQueries > 0 && searchResult.failedQueries < this.discoveryQueries.length) {
      extraNotes.push(
        `${searchResult.failedQueries} DexScreener search probe(s) failed; remaining probes and registries were still used.`,
      );
    }

    const selected = selectInstrumentMints(
      mergeTokenIdentities([
        searchResult.identities,
        registryResult.identities,
        ondoResult.identities,
        tesseraResult.identities,
        sunriseResult.identities,
        geckoResult.identities,
      ]),
    );
    const discovered = selected.equities;
    const discoveredEtfs = selected.etfs;
    const discoveredPrivates = selected.privates;
    if (discovered.length === 0 && discoveredEtfs.length === 0 && discoveredPrivates.length === 0) {
      if (
        searchResult.error &&
        (!this.registryEnabled || registryResult.error) &&
        (!this.ondoEnabled || ondoResult.error) &&
        (!this.tesseraEnabled || tesseraResult.error) &&
        (!this.sunriseEnabled || sunriseResult.error) &&
        (!this.geckoEnabled || geckoResult.error)
      ) {
        throw new Error(
          [
            searchResult.error.message,
            registryResult.error?.message,
            ondoResult.error?.message,
            tesseraResult.error?.message,
            sunriseResult.error?.message,
            geckoResult.error?.message,
          ]
            .filter(Boolean)
            .join(" · "),
        );
      }
      throw new Error(
        "No verifiable Solana tokenized stocks from live discovery + classifier. Coverage is as discoverable from DexScreener search, the xStocks public registry, the public Ondo GM mint list, the public Tessera T-Token mint list, the public Sunrise token list, public GeckoTerminal search, and the classifier — not a full chain index. Keyed issuer APIs are not used.",
      );
    }

    const allDiscovered = [...discovered, ...discoveredEtfs, ...discoveredPrivates];
    const classifiedMints = new Set(allDiscovered.map((row) => row.mint));
    const searchMints = new Set(
      searchResult.identities.map((token) => token.address).filter((mint) => classifiedMints.has(mint)),
    );
    const geckoMints = new Set(
      geckoResult.identities.map((token) => token.address).filter((mint) => classifiedMints.has(mint)),
    );
    const tesseraMints = new Set(
      tesseraResult.identities.map((token) => token.address).filter((mint) => classifiedMints.has(mint)),
    );
    const sunriseMints = new Set(
      sunriseResult.identities.map((token) => token.address).filter((mint) => classifiedMints.has(mint)),
    );
    const priorityMints = new Set([
      ...searchMints,
      ...geckoMints,
      ...tesseraMints,
      ...sunriseMints,
      ...this.memory.pooledMints(),
    ]);
    const seedPairs = pairsTouchingMints(searchResult.pairs, classifiedMints);
    const seededMints = mintsInPairs(seedPairs, classifiedMints);
    this.memory.markPooled(seededMints);

    const unclassifiedRemaining = allDiscovered.map((row) => row.mint).filter((mint) => !seededMints.has(mint));
    const skipEmpty = this.hydrateSkipSet(unclassifiedRemaining);
    const remainingPreview = prioritizeMintsForHydrate(unclassifiedRemaining, priorityMints, skipEmpty);

    const hydrateDeadline = Date.now() + (mode === "light" ? this.homeBudgetMs : this.fullBudgetMs);
    const preview = await this.hydratePreviewPairs(remainingPreview, hydrateDeadline);
    this.rememberHydrateOutcome(remainingPreview, preview.pairRows, preview.failedMints, preview.incompleteMints);
    const pairRows = [...seedPairs, ...preview.pairRows];
    const failedMints = new Set(preview.failedMints);
    const pendingPreview = [...preview.incompleteMints];

    extraNotes.push(
      `Classified ${discovered.length} public equities, ${discoveredEtfs.length} ETF/index products, and ${discoveredPrivates.length} private-market names. ${seededMints.size} mint(s) seeded from DexScreener search. ${skipEmpty.size} mint(s) skipped as recently confirmed empty on DexScreener. ${preview.failedMints.size} mint batch(es) failed DexScreener preview; ${pendingPreview.length} did not finish before the snapshot budget.`,
    );

    const aggregation: VolumeAggregation = mode === "light" ? "primary-pair" : "all-pools";
    let finalPairs = pairRows;
    const pendingFull: string[] = [];

    if (mode === "full") {
      const knownPairMints = mintsInPairs(pairRows, classifiedMints);
      this.memory.markPooled(knownPairMints);
      const activeMints = prioritizeMintsForHydrate(
        [...knownPairMints].filter((mint) => !failedMints.has(mint) && !preview.incompleteMints.has(mint)),
        priorityMints,
      );
      if (activeMints.length > 0) {
        const full = await this.hydrateFullPools(activeMints, hydrateDeadline);
        finalPairs = full.pairRows.length > 0 ? full.pairRows : pairRows;
        if (full.pairRows.length > 0) {
          const fullMints = mintsInPairs(full.pairRows, classifiedMints);
          finalPairs = [
            ...pairRows.filter((pair) => {
              const touched = mintsInPairs([pair], classifiedMints);
              return [...touched].every((mint) => !fullMints.has(mint));
            }),
            ...full.pairRows,
          ];
        }
        full.failedMints.forEach((mint) => failedMints.add(mint));
        pendingFull.push(...full.incompleteMints);
      }
      if (pendingPreview.length > 0 || pendingFull.length > 0) {
        extraNotes.push(
          "DexScreener every-pool hydrate hit the snapshot budget. Unfinished mints keep unknown volume, not zero, and continue in the background.",
        );
      }
    } else {
      extraNotes.push(
        "Home snapshot uses DexScreener search pairs plus a time-boxed primary-pair hydrate. Open Solana for every-pool aggregation. Remaining mints keep hydrating in the background. Confirmed-empty mints are not re-fetched until the empty-cache TTL.",
      );
    }

    return this.rebuildSnapshot({
      aggregation,
      discovered,
      discoveredEtfs,
      discoveredPrivates,
      extraNotes,
      pairRows: finalPairs,
      pendingPreviewMints: pendingPreview,
      pendingFullMints: pendingFull,
      failedMints: [...failedMints],
      refreshDurationMs: Date.now() - started,
    });
  }

  private scheduleEnrichment(): void {
    if (!this.backgroundEnrichment) return;
    const snapshot = this.cache;
    if (!snapshot) return;
    if (snapshot.pendingPreviewMints.length === 0 && snapshot.pendingFullMints.length === 0) return;
    if (this.backgroundWork) return;
    this.backgroundWork = this.enrichInBackground(snapshot.aggregation)
      .catch(() => undefined)
      .finally(() => {
        this.backgroundWork = null;
      });
  }

  private async enrichInBackground(mode: VolumeAggregation): Promise<void> {
    const deadline = Date.now() + this.enrichBudgetMs;
    let passes = 0;

    while (passes < 12 && Date.now() < deadline) {
      const snapshot = this.cache;
      if (!snapshot) return;
      const classifiedMints = new Set(
        [...snapshot.discovered, ...snapshot.discoveredEtfs, ...snapshot.discoveredPrivates].map((row) => row.mint),
      );
      const knownMints = new Set([
        ...mintsInPairs(snapshot.pairRows, classifiedMints),
        ...this.memory.pooledMints(),
      ]);

      let pairRows = snapshot.pairRows;
      const failedMints = new Set(snapshot.failedMints);
      const skipEmpty = this.hydrateSkipSet(snapshot.pendingPreviewMints);
      let pendingPreview = prioritizeMintsForHydrate(snapshot.pendingPreviewMints, knownMints, skipEmpty);
      let pendingFull = snapshot.pendingFullMints.filter((mint) => !this.memory.isConfirmedEmpty(mint));
      const startedPending = pendingPreview.length + pendingFull.length;
      if (startedPending === 0) {
        if (snapshot.pendingPreviewMints.length > 0 || snapshot.pendingFullMints.length > 0) {
          const next = this.rebuildSnapshot({
            aggregation: snapshot.aggregation,
            discovered: snapshot.discovered,
            discoveredEtfs: snapshot.discoveredEtfs,
            discoveredPrivates: snapshot.discoveredPrivates,
            extraNotes: snapshot.extraNotes.filter((note) => !/still hydrating DexScreener volume/.test(note)),
            pairRows: snapshot.pairRows,
            pendingPreviewMints: [],
            pendingFullMints: [],
            failedMints: snapshot.failedMints,
            createdAt: snapshot.createdAt,
            refreshDurationMs: snapshot.mapped.provenance.refreshDurationMs ?? 0,
          });
          this.cache = this.preferRicherCache(next);
          void this.persistDeskVolume(this.cache);
        }
        return;
      }

      if (pendingPreview.length > 0) {
        const preview = await this.hydratePreviewPairs(pendingPreview, deadline);
        this.rememberHydrateOutcome(pendingPreview, preview.pairRows, preview.failedMints, preview.incompleteMints);
        pairRows = [...pairRows, ...preview.pairRows];
        preview.failedMints.forEach((mint) => failedMints.add(mint));
        pendingPreview = [...preview.incompleteMints];
        const newlyKnown = mintsInPairs(preview.pairRows, classifiedMints);
        this.memory.markPooled(newlyKnown);
        if (mode === "all-pools") {
          pendingFull = prioritizeMintsForHydrate([...new Set([...pendingFull, ...newlyKnown])], newlyKnown);
        }
      }

      if (mode === "all-pools" && pendingFull.length > 0 && Date.now() < deadline) {
        const full = await this.hydrateFullPools(pendingFull, deadline);
        if (full.pairRows.length > 0) {
          const fullMints = mintsInPairs(full.pairRows, classifiedMints);
          pairRows = [
            ...pairRows.filter((pair) => {
              const touched = mintsInPairs([pair], classifiedMints);
              return [...touched].every((mint) => !fullMints.has(mint));
            }),
            ...full.pairRows,
          ];
        }
        full.failedMints.forEach((mint) => failedMints.add(mint));
        pendingFull = [...full.incompleteMints];
      }

      const next = this.rebuildSnapshot({
        aggregation: snapshot.aggregation,
        discovered: snapshot.discovered,
        discoveredEtfs: snapshot.discoveredEtfs,
        discoveredPrivates: snapshot.discoveredPrivates,
        extraNotes: snapshot.extraNotes.filter((note) => !/still hydrating DexScreener volume/.test(note)),
        pairRows,
        pendingPreviewMints: pendingPreview,
        pendingFullMints: pendingFull,
        failedMints: [...failedMints],
        createdAt: snapshot.createdAt,
        refreshDurationMs: snapshot.mapped.provenance.refreshDurationMs ?? 0,
      });
      this.cache = this.preferRicherCache(next);
      void this.persistDeskVolume(this.cache);
      const remaining = this.cache.pendingPreviewMints.length + this.cache.pendingFullMints.length;
      if (remaining === 0 || remaining >= startedPending) break;
      passes += 1;
    }
  }

  /** Test hook: wait for in-flight background volume enrichment. */
  async flushBackgroundWork(): Promise<void> {
    if (this.backgroundWork) await this.backgroundWork;
  }

  private async loadCached(mode: SnapshotMode): Promise<CachedSnapshot> {
    const now = Date.now();
    const hit = this.cacheSatisfies(mode, now);
    if (hit) {
      this.scheduleEnrichment();
      if (hit.expiresAt <= now && !this.inflight) {
        this.inflightMode = mode;
        this.inflight = this.refresh(mode)
          .then((next) => this.commitCache(next))
          .finally(() => {
            this.inflight = null;
            this.inflightMode = null;
          });
      }
      const age = now - hit.createdAt;
      hit.mapped.provenance.cacheStatus = hit.pendingPreviewMints.length + hit.pendingFullMints.length > 0
        ? "partial"
        : hit.expiresAt > now
          ? "fresh"
          : "stale";
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
      .then((next) => this.commitCache(next))
      .finally(() => {
        this.inflight = null;
        this.inflightMode = null;
      });
    return this.inflight;
  }

  private preferRicherCache(next: CachedSnapshot): CachedSnapshot {
    if (!this.cache) return next;
    if (this.cache.staleUntil <= Date.now()) return next;
    if (this.coverageScore(next) >= this.coverageScore(this.cache)) return next;
    return this.cache;
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
      privateAssets: cached.mapped.privateAssets,
      provenance: cached.mapped.provenance,
    };
  }

  async getAsset(chainId: string, symbol: string): Promise<AssetDetailResult | null> {
    if (chainId !== SOLANA_CHAIN_ID) return null;
    const cached = await this.loadCached("full");
    const asset = findAssetByKey(
      [...cached.mapped.details, ...cached.mapped.etfDetails, ...cached.mapped.privateDetails],
      symbol,
    );
    if (!asset) return null;
    return { chain: cached.mapped.chain, asset, provenance: cached.mapped.provenance };
  }

  async getEquityVolumeHistory(): Promise<EquityVolumeHistoryResult> {
    const now = Date.now();
    if (this.volumeHistoryCache && this.volumeHistoryCache.expiresAt > now) {
      return this.volumeHistoryCache.result;
    }
    if (this.volumeHistoryInflight) return this.volumeHistoryInflight;

    this.volumeHistoryInflight = this.buildEquityVolumeHistory()
      .then((result) => {
        if (result.available) {
          this.volumeHistoryCache = {
            result,
            expiresAt: Date.now() + this.volumeHistoryCacheMs,
          };
        }
        return result;
      })
      .finally(() => {
        this.volumeHistoryInflight = null;
      });
    return this.volumeHistoryInflight;
  }

  private async persistDeskVolume(snapshot: CachedSnapshot): Promise<void> {
    try {
      const generatedAt = snapshot.mapped.provenance.generatedAt ?? snapshot.mapped.provenance.fetchedAt;
      const result = await recordDeskVolumeFromChain(this.deskSnapshots, snapshot.mapped.chain, generatedAt);
      if (result.ok && result.written) {
        this.volumeHistoryCache = null;
      }
    } catch {
      // Disk failures must not take down the live desk.
    }
  }

  private async buildEquityVolumeHistory(): Promise<EquityVolumeHistoryResult> {
    let chain;
    let generatedAt: string;
    try {
      const mode = this.cache?.aggregation === "all-pools" ? "full" : "light";
      const snapshot = await this.loadCached(mode);
      chain = snapshot.mapped.chain;
      generatedAt = snapshot.mapped.provenance.generatedAt ?? snapshot.mapped.provenance.fetchedAt;
      await this.persistDeskVolume(snapshot);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Solana snapshot failed.";
      return emptyEquityVolumeHistory(message);
    }

    const records = await this.deskSnapshots.load();
    const parsed = Date.parse(generatedAt);
    const nowT = Number.isFinite(parsed) && parsed > 0 ? parsed / 1000 : Date.now() / 1000;
    return buildSnapshotEquityVolumeHistory({
      snapshots: records,
      liveCombined24hUsd: chainCombinedVolume24h(chain),
      livePublic24hUsd: chain.volume24hUsd,
      nowT,
      generatedAt,
      mintCount: chain.assetCount,
      poolCount: chain.reportedPoolCount,
    });
  }

  async getAssetPriceHistory(chainId: string, symbol: string): Promise<AssetPriceHistoryResult> {
    if (chainId !== SOLANA_CHAIN_ID) {
      return emptyAssetPriceHistory("Price candles are GeckoTerminal Solana pool closes only.");
    }
    if (!this.geckoEnabled) {
      return emptyAssetPriceHistory(
        "GeckoTerminal is disabled, so there is no historical close series to load.",
      );
    }

    const cacheKey = `${chainId}:${symbol.toLowerCase()}`;
    const now = Date.now();
    const cached = this.priceHistoryCache.get(cacheKey);
    if (cached && cached.expiresAt > now) return cached.result;
    const inflight = this.priceHistoryInflight.get(cacheKey);
    if (inflight) return inflight;

    const pending = this.buildAssetPriceHistory(symbol)
      .then((result) => {
        if (result.available) {
          this.priceHistoryCache.set(cacheKey, {
            result,
            expiresAt: Date.now() + this.volumeHistoryCacheMs,
          });
        }
        return result;
      })
      .finally(() => {
        this.priceHistoryInflight.delete(cacheKey);
      });
    this.priceHistoryInflight.set(cacheKey, pending);
    return pending;
  }

  private async buildAssetPriceHistory(symbol: string): Promise<AssetPriceHistoryResult> {
    let pairAddress: string | null = null;
    let mint: string | null = null;
    try {
      const snapshot = await this.loadCached("full");
      const asset = findAssetByKey(
        [...snapshot.mapped.details, ...snapshot.mapped.etfDetails, ...snapshot.mapped.privateDetails],
        symbol,
      );
      if (!asset) {
        return emptyAssetPriceHistory("That mint is not in this Solana snapshot.");
      }
      mint = asset.contractAddress;
      pairAddress = selectPrimaryPricePool(asset.pools);
      if (!pairAddress) {
        return emptyAssetPriceHistory(
          "This mint has no DexScreener pair address, so there is no GeckoTerminal close series to load.",
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Solana snapshot failed.";
      return emptyAssetPriceHistory(message);
    }

    const gate = createRequestGate({
      maxConcurrent: Math.min(2, this.maxConcurrent),
      minGapMs: Math.max(this.requestGapMs, 400),
    });

    const [dailySettled, hourlySettled] = await Promise.allSettled([
      gate.run(() =>
        this.fetchSource(
          `${this.geckoTerminalBaseUrl}${geckoTerminalOhlcvPath(pairAddress, { timeframe: "day", limit: 90 })}`,
          "GeckoTerminal",
        ),
      ),
      gate.run(() =>
        this.fetchSource(
          `${this.geckoTerminalBaseUrl}${geckoTerminalOhlcvPath(pairAddress, { timeframe: "hour", limit: 24 })}`,
          "GeckoTerminal",
        ),
      ),
    ]);

    const dailySeries =
      dailySettled.status === "fulfilled" ? parseGeckoTerminalOhlcvSeries(dailySettled.value) : { prices: [], volumes: [] };
    const hourlySeries =
      hourlySettled.status === "fulfilled"
        ? parseGeckoTerminalOhlcvSeries(hourlySettled.value)
        : { prices: [], volumes: [] };

    return buildAssetPriceHistory({
      pairAddress,
      daily: dailySeries.prices,
      hourly: hourlySeries.prices,
      dailyVolume: dailySeries.volumes,
      hourlyVolume: hourlySeries.volumes,
      fallbackDailyVolume: mint ? this.volumeHistoryCache?.result.seriesByMint[mint] : undefined,
      emptyReason:
        dailySeries.prices.length === 0 && hourlySeries.prices.length === 0
          ? "GeckoTerminal did not return usable USD closes for this mint’s primary pool."
          : undefined,
    });
  }
}
