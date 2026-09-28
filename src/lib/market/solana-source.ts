import { createRequestGate, mapWithConcurrency, sleep } from "./async-pool";
import { findAssetByKey } from "./identity";
import { buildSolanaSnapshot, unwrapDexScreenerPairs, unwrapDexScreenerSearch, type DexScreenerPair } from "./map-solana";
import {
  applyPairHolderCounts,
  DEFAULT_DEXSCREENER_IO_BASE_URL,
  dexScreenerPairDetailsPath,
  HOLDER_FETCH_TIMEOUT_MS,
  MINT_HOLDER_CACHE_MS,
  MINT_HOLDER_MISS_CACHE_MS,
  parseDexScreenerPairHolderCount,
  parseJupiterHolderCounts,
} from "./solana-holders";
import {
  applyMintLogoFallbacks,
  DEFAULT_JUPITER_TOKEN_BASE_URL,
  JUPITER_TOKEN_SEARCH_BATCH,
  jupiterTokenSearchPath,
  MINT_LOGO_CACHE_MS,
  parseJupiterTokenIcons,
  rememberMintLogo,
  type MintLogoCatalog,
} from "./solana-token-logos";
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
import {
  fetchJsonOrText,
  isDefinitiveFetchMiss,
  responseStatusFromError,
  SourceRequestError,
  type FetchLike,
} from "./solana-http";
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
import { applyOutstandingMintSupply, DEFAULT_SOLANA_RPC_URL, fetchMintUiSupply } from "./solana-supply";
import { SOLANA_SOURCE_LABEL } from "./trust";
import {
  SOLANA_CHAIN_ID,
  emptyAllMarketsVolumeSnapshot,
  type AssetAllMarketsVolumeSnapshot,
  type AssetDetailResult,
  type AssetPriceHistoryResult,
  type ChainDetailResult,
  type ChainListResult,
  type EquityCardDayVolumeSeriesSnapshot,
  type EquityVolumeHistoryResult,
  type MarketDataSource,
  type VolumeAggregation,
  type VolumeHistoryPoint,
} from "./types";
import {
  EQUITY_CARD_DAY_VOLUME_SERIES_MAX,
  EQUITY_CARD_VOLUME_SERIES_MIN_GAP_MS,
  EQUITY_CARD_VOLUME_SERIES_RATE_LIMIT_COOLDOWN_MS,
  EQUITY_CARD_VOLUME_SERIES_RETRIES,
  EQUITY_CARD_VOLUME_SERIES_SLOW_GAP_MS,
  EQUITY_CARD_VOLUME_SERIES_SPARSE_CACHE_MS,
  equityCardVolumeRateLimitDelayMs,
  equityCardVolumeSeriesCacheTtlMs,
  selectEquityCardVolumeTargets,
  sliceEquityCardDayVolumeSeries,
  type EquityCardVolumeTarget,
} from "./equity-card-volume";
import {
  allMarketsPairKey,
  deleteAllMarketsProgress,
  readAllMarketsProgress,
  readStoredAllMarketsVolume,
  writeAllMarketsProgress,
  writeCompleteAllMarketsDaily,
  writeCompleteAllMarketsHourly,
  ALL_MARKETS_HOURLY_PROGRESS_SUFFIX,
  DEFAULT_ALL_MARKETS_VOLUME_DIR,
  type AllMarketsProgressPool,
  type AllMarketsStoredPool,
} from "./all-markets-volume-cache";
import {
  allMarketsLiveSetIsPartial,
  allMarketsPoolSetCompatible,
  assembleAllMarketsDaily,
  mergeVolumeSeries,
  uniqueAllMarketsPools,
  type AllMarketsPoolResult,
} from "./asset-volume-headline";
import {
  ASSET_PRICE_POOL_ATTEMPTS,
  buildAssetPriceHistory,
  emptyAssetPriceHistory,
  parseGeckoTerminalOhlcvSeries,
  rankPoolsForMintPrice,
  readGeckoOhlcvBaseAddress,
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
  cardVolumeSeriesMax?: number;
  /** Steady gap between card OHLCV calls. Tests pass 0. */
  cardVolumeSeriesGapMs?: number;
  /** Gap used after GeckoTerminal returns 429. */
  cardVolumeSeriesSlowGapMs?: number;
  /** Wait when Retry-After is missing or 0. */
  cardVolumeSeriesCooldownMs?: number;
  /** Extra attempts per pool inside one build. */
  cardVolumeSeriesRetries?: number;
  /** How long a build with failed fetches stays warm before another pass. */
  cardVolumeSeriesSparseCacheMs?: number;
  /** Short pause between non-429 retries (timeouts, 5xx). */
  cardVolumeSeriesTransientRetryMs?: number;
  volumeSnapshotStore?: DeskVolumeSnapshotStore;
  volumeSnapshotDir?: string;
  /** `null` keeps all-markets volume in memory. Omitted uses the desk cache directory. */
  allMarketsVolumeCacheDir?: string | null;
  enableJupiterTokenLogos?: boolean;
  jupiterTokenBaseUrl?: string;
  mintLogoCacheMs?: number;
  /** Jupiter Tokens V2 holderCount for the asset statistics card. Default on. */
  enableJupiterHolders?: boolean;
  /** DexScreener pair-details `holders.count` for the Markets Holders column. Default on. */
  enablePairHolders?: boolean;
  /** io.dexscreener.com host. The public pair API does not return holder counts. */
  dexScreenerIoBaseUrl?: string;
  /** Cache TTL after a holder payload, including a real null. */
  holderCacheMs?: number;
  /** Solana JSON-RPC for `getTokenSupply`. Default: public mainnet-beta. */
  rpcUrl?: string;
  /** When false, asset stats leave supply, market cap, and FDV blank. */
  enableMintSupply?: boolean;
}

type AllMarketsSlotStatus = "open" | "points" | "definitive_miss";

interface AllMarketsSlot {
  pairAddress: string;
  volume24hUsd: number | null;
  status: AllMarketsSlotStatus;
  points: VolumeHistoryPoint[] | null;
  /**
   * Volume is already inside the published series and the candles were not stored.
   * A later reassemble must merge new pools into that series instead of summing empty candles.
   */
  folded?: boolean;
}

interface AllMarketsJob {
  mint: string;
  pairKey: string;
  pairAddresses: string[];
  slots: AllMarketsSlot[];
  /** Daily candles feed 7D/30D. Hourly candles feed the 24H line. `daily` holds that series. */
  series: "daily" | "hourly";
  timer: ReturnType<typeof setTimeout> | null;
  running: boolean;
  hydrated: boolean;
  hydratePromise: Promise<void> | null;
  finished: boolean;
  complete: boolean;
  daily: VolumeHistoryPoint[];
  expiresAt: number;
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
  private cardVolumeResolved = new Map<string, { points: VolumeHistoryPoint[] | null; expiresAt: number }>();
  private cardVolumeSeriesInflight: Promise<Record<string, VolumeHistoryPoint[]>> | null = null;
  private cardVolumeTargetMints: string[] = [];
  private cardVolumeTargetsLoadedAt = 0;
  private cardVolumeTargetsKnown = false;
  private cardVolumeRetryNotBefore = 0;
  private cardVolumeAutoRetries = 0;
  private cardVolumeTimer: ReturnType<typeof setTimeout> | null = null;
  private priceHistoryCache = new Map<string, { result: AssetPriceHistoryResult; expiresAt: number }>();
  private priceHistoryInflight = new Map<string, Promise<AssetPriceHistoryResult>>();
  private allMarketsJobs = new Map<string, AllMarketsJob>();
  /** Hourly series fill. Starts only after the daily series for the same pools is complete. */
  private hourlyMarketsJobs = new Map<string, AllMarketsJob>();
  /** Serializes GeckoTerminal calls. A 429 sets `geckoCooldownUntil` for every caller. */
  private geckoTail: Promise<unknown> = Promise.resolve();
  private geckoCooldownUntil = 0;
  private readonly mintLogoCatalog: MintLogoCatalog = new Map();
  private jupiterLogoCache = new Map<string, { url: string | null; expiresAt: number }>();
  private mintSupplyCache = new Map<string, { uiSupply: number; expiresAt: number }>();
  private holderCache = new Map<string, { count: number | null; expiresAt: number }>();
  private holderInflight = new Map<string, Promise<number | null>>();
  private pairHolderCache = new Map<string, { count: number | null; expiresAt: number }>();
  private pairHolderInflight = new Map<string, Promise<number | null>>();

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

  private get jupiterTokenLogosEnabled() {
    return this.options.enableJupiterTokenLogos !== false;
  }

  private get jupiterHoldersEnabled() {
    return this.options.enableJupiterHolders !== false;
  }

  private get pairHoldersEnabled() {
    return this.options.enablePairHolders !== false;
  }

  private get dexScreenerIoBaseUrl() {
    return (this.options.dexScreenerIoBaseUrl ?? DEFAULT_DEXSCREENER_IO_BASE_URL).replace(/\/+$/, "");
  }

  private get holderCacheMs() {
    return this.nonNegativeOption(this.options.holderCacheMs, MINT_HOLDER_CACHE_MS);
  }

  private get jupiterTokenBaseUrl() {
    return (this.options.jupiterTokenBaseUrl ?? DEFAULT_JUPITER_TOKEN_BASE_URL).replace(/\/+$/, "");
  }

  private get mintLogoCacheMs() {
    return this.options.mintLogoCacheMs ?? MINT_LOGO_CACHE_MS;
  }

  private get rpcUrl() {
    return (this.options.rpcUrl ?? DEFAULT_SOLANA_RPC_URL).replace(/\/+$/, "");
  }

  private get mintSupplyEnabled() {
    return this.options.enableMintSupply !== false;
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

  private get allMarketsVolumeCacheDir(): string | null {
    if (this.options.allMarketsVolumeCacheDir === null) return null;
    return this.options.allMarketsVolumeCacheDir ?? DEFAULT_ALL_MARKETS_VOLUME_DIR;
  }

  private get cardVolumeSeriesMax() {
    const value = this.options.cardVolumeSeriesMax ?? EQUITY_CARD_DAY_VOLUME_SERIES_MAX;
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  }

  private nonNegativeOption(value: number | undefined, fallback: number): number {
    return Number.isFinite(value) && value !== undefined && value >= 0 ? value : fallback;
  }

  private get cardVolumeSeriesGapMs() {
    return this.nonNegativeOption(this.options.cardVolumeSeriesGapMs, EQUITY_CARD_VOLUME_SERIES_MIN_GAP_MS);
  }

  private get cardVolumeSeriesSlowGapMs() {
    return Math.max(
      this.cardVolumeSeriesGapMs,
      this.nonNegativeOption(this.options.cardVolumeSeriesSlowGapMs, EQUITY_CARD_VOLUME_SERIES_SLOW_GAP_MS),
    );
  }

  private get cardVolumeSeriesCooldownMs() {
    return this.nonNegativeOption(
      this.options.cardVolumeSeriesCooldownMs,
      EQUITY_CARD_VOLUME_SERIES_RATE_LIMIT_COOLDOWN_MS,
    );
  }

  private get cardVolumeSeriesRetries() {
    return Math.floor(
      this.nonNegativeOption(this.options.cardVolumeSeriesRetries, EQUITY_CARD_VOLUME_SERIES_RETRIES),
    );
  }

  private get cardVolumeSeriesSparseCacheMs() {
    return this.nonNegativeOption(
      this.options.cardVolumeSeriesSparseCacheMs,
      EQUITY_CARD_VOLUME_SERIES_SPARSE_CACHE_MS,
    );
  }

  private get cardVolumeSeriesTransientRetryMs() {
    return this.nonNegativeOption(this.options.cardVolumeSeriesTransientRetryMs, 1_500);
  }

  private gate() {
    return createRequestGate({ maxConcurrent: this.maxConcurrent, minGapMs: this.requestGapMs });
  }

  private async fetchSource(url: string, label: string, retry?: { retries?: number }): Promise<unknown> {
    return fetchJsonOrText(
      url,
      this.timeoutMs,
      this.fetchImpl,
      label,
      retry?.retries ?? this.options.retries ?? 2,
    );
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
    this.rememberCatalogLogos(parsed.logos);
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
        return { identities: next.identities, logos: next.logos, hasNextPage: next.hasNextPage, page: pageNumber };
      });
      for (const row of [...pages].sort((a, b) => a.page - b.page)) {
        identities.push(...row.identities);
        this.rememberCatalogLogos(row.logos);
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
      this.rememberCatalogLogos(parsed.logos);
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
    for (const query of DEFAULT_GECKOTERMINAL_QUERIES) {
      let stop = false;
      try {
        const payload = await this.enqueueGecko(async () => {
          try {
            return await this.fetchSource(
              `${this.geckoTerminalBaseUrl}${geckoTerminalSearchPath(query)}`,
              "GeckoTerminal",
              { retries: 0 },
            );
          } catch (error) {
            if (responseStatusFromError(error) === 429) {
              this.armGeckoCooldown(error instanceof SourceRequestError ? error.retryAfterHeader : null);
              stop = true;
            }
            throw error;
          }
        });
        identities.push(...parseGeckoTerminalSearch(payload));
      } catch (error) {
        if (stop || responseStatusFromError(error) === 429) break;
        throw error;
      }
    }
    return identities;
  }

  /**
   * One Gecko lane for search, card sparklines, and the detail chart.
   * Callers that 429 arm a shared cooldown; the next caller waits it out.
   * `Retry-After: 0` is not a reason to retry in a few hundred milliseconds.
   */
  private enqueueGecko<T>(task: () => Promise<T>): Promise<T> {
    const run = this.geckoTail.then(async () => {
      const wait = this.geckoCooldownUntil - Date.now();
      if (wait > 0) await sleep(wait);
      return task();
    });
    this.geckoTail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private armGeckoCooldown(retryAfterHeader: string | null): void {
    const wait = equityCardVolumeRateLimitDelayMs(retryAfterHeader, this.cardVolumeSeriesCooldownMs);
    if (wait <= 0) return;
    this.geckoCooldownUntil = Math.max(this.geckoCooldownUntil, Date.now() + wait);
  }

  /**
   * One OHLCV GET. 429s wait on the shared cooldown and retry.
   * A missing pool or other error is null — the caller does not invent candles.
   */
  private async fetchGeckoOhlcvPayload(url: string): Promise<unknown | null> {
    const maxAttempts = 1 + this.cardVolumeSeriesRetries;
    let cooled = false;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const result = await this.enqueueGecko(async () => {
        try {
          const payload = await this.fetchSource(url, "GeckoTerminal", { retries: 0 });
          return { payload, rateLimited: false, retryAfter: null as string | null, done: false };
        } catch (error) {
          if (responseStatusFromError(error) !== 429) {
            return { payload: null, rateLimited: false, retryAfter: null, done: true };
          }
          const retryAfter = error instanceof SourceRequestError ? error.retryAfterHeader : null;
          if (!cooled) {
            cooled = true;
            this.armGeckoCooldown(retryAfter);
          } else if (this.cardVolumeSeriesSlowGapMs > 0) {
            this.geckoCooldownUntil = Math.max(this.geckoCooldownUntil, Date.now() + this.cardVolumeSeriesSlowGapMs);
          }
          return { payload: null, rateLimited: true, retryAfter, done: attempt >= maxAttempts - 1 };
        }
      });
      if (result.payload) return result.payload;
      if (result.done || !result.rateLimited) return null;
    }
    return null;
  }

  private rememberCatalogLogos(logos: Record<string, string>): void {
    for (const [mint, url] of Object.entries(logos)) {
      rememberMintLogo(this.mintLogoCatalog, mint, url);
    }
  }

  private mappedLogoRows(mapped: ReturnType<typeof buildSolanaSnapshot>) {
    return [
      ...mapped.assets,
      ...mapped.details,
      ...mapped.etfAssets,
      ...mapped.etfDetails,
      ...mapped.privateAssets,
      ...mapped.privateDetails,
    ];
  }

  private applyCatalogLogos(mapped: ReturnType<typeof buildSolanaSnapshot>): void {
    applyMintLogoFallbacks(this.mappedLogoRows(mapped), this.mintLogoCatalog);
  }

  private async hydrateMintLogos(mapped: ReturnType<typeof buildSolanaSnapshot>): Promise<void> {
    this.applyCatalogLogos(mapped);
    if (!this.jupiterTokenLogosEnabled) return;
    try {
      await this.fillJupiterMintLogos(mapped);
    } catch {
      // Catalog miss stays monogram. DexScreener snapshot must not fail.
    }
    this.applyCatalogLogos(mapped);
  }

  private async fillJupiterMintLogos(mapped: ReturnType<typeof buildSolanaSnapshot>): Promise<void> {
    const now = Date.now();
    const missing = [
      ...new Set(
        this.mappedLogoRows(mapped)
          .filter((row) => !row.logoUrl)
          .map((row) => row.contractAddress)
          .filter((mint) => mint && !this.mintLogoCatalog.has(mint)),
      ),
    ];
    const toFetch: string[] = [];
    for (const mint of missing) {
      const cached = this.jupiterLogoCache.get(mint);
      if (cached && cached.expiresAt > now) {
        if (cached.url) rememberMintLogo(this.mintLogoCatalog, mint, cached.url);
        continue;
      }
      toFetch.push(mint);
    }
    if (toFetch.length === 0) return;

    const expiresAt = now + this.mintLogoCacheMs;
    const gate = this.gate();
    const batches = chunkValues(toFetch, JUPITER_TOKEN_SEARCH_BATCH);
    await mapWithConcurrency(batches, Math.min(2, this.maxConcurrent), async (batch) => {
      const requested = new Set(batch);
      try {
        const payload = await gate.run(() =>
          this.fetchSource(`${this.jupiterTokenBaseUrl}${jupiterTokenSearchPath(batch)}`, "Jupiter token logos"),
        );
        const found = parseJupiterTokenIcons(payload, requested);
        for (const mint of batch) {
          const url = found[mint] ?? null;
          this.jupiterLogoCache.set(mint, { url, expiresAt });
          if (url) rememberMintLogo(this.mintLogoCatalog, mint, url);
        }
      } catch {
        for (const mint of batch) {
          if (!this.jupiterLogoCache.has(mint)) {
            this.jupiterLogoCache.set(mint, { url: null, expiresAt });
          }
        }
      }
    });
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
    this.applyCatalogLogos(mapped);
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

    const snapshot = this.rebuildSnapshot({
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
    await this.hydrateMintLogos(snapshot.mapped);
    return snapshot;
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
    await this.stampHolderCounts(asset);
    const uiSupply = await this.readMintUiSupply(asset.contractAddress);
    return {
      chain: cached.mapped.chain,
      asset: applyOutstandingMintSupply(asset, uiSupply),
      provenance: cached.mapped.provenance,
    };
  }

  /**
   * Outstanding UI supply for one mint. Failures stay null so a down RPC cannot
   * blank the rest of the asset page or resurrect a DexScreener cap.
   * Successful reads are cached with the snapshot TTL. The chain list does not call this.
   */
  private async readMintUiSupply(mint: string): Promise<number | null> {
    if (!this.mintSupplyEnabled) return null;
    const now = Date.now();
    const cached = this.mintSupplyCache.get(mint);
    if (cached && cached.expiresAt > now) return cached.uiSupply;
    const uiSupply = await fetchMintUiSupply(mint, {
      rpcUrl: this.rpcUrl,
      timeoutMs: this.timeoutMs,
      fetchImpl: this.fetchImpl,
    });
    if (uiSupply !== null) {
      this.mintSupplyCache.set(mint, { uiSupply, expiresAt: now + this.cacheMs });
    }
    return uiSupply;
  }

  /**
   * Statistics use the page mint's Jupiter holderCount.
   * Each Markets row uses DexScreener `holders.count` for that pool address.
   * A count is never copied from the page mint or from another pool. Chain snapshots do not pay for either lookup.
   */
  private async stampHolderCounts(asset: {
    contractAddress: string;
    holderCount: number | null;
    pools: readonly { pairAddress: string; pairHolderCount?: number | null }[];
  }): Promise<void> {
    await Promise.all([
      this.jupiterHoldersEnabled ? this.stampMintHolderCount(asset) : Promise.resolve(),
      this.pairHoldersEnabled ? this.stampPairHolderCounts(asset.pools) : Promise.resolve(),
    ]);
  }

  private async stampMintHolderCount(asset: { contractAddress: string; holderCount: number | null }): Promise<void> {
    const assetMint = asset.contractAddress.trim();
    if (!assetMint) {
      asset.holderCount = null;
      return;
    }
    const counts = await this.holderCountsForMints([assetMint]);
    asset.holderCount = counts.get(assetMint) ?? null;
  }

  private async stampPairHolderCounts(
    pools: readonly { pairAddress: string; pairHolderCount?: number | null }[],
  ): Promise<void> {
    const addresses = pools.map((pool) => pool.pairAddress.trim()).filter(Boolean);
    const counts = await this.pairHolderCountsForAddresses(addresses);
    applyPairHolderCounts(pools, counts);
  }

  private async holderCountsForMints(mints: readonly string[]): Promise<Map<string, number | null>> {
    const unique = [...new Set(mints.map((mint) => mint.trim()).filter(Boolean))];
    const out = new Map<string, number | null>();
    const now = Date.now();
    const toFetch: string[] = [];
    const waiting: Promise<void>[] = [];
    for (const mint of unique) {
      const cached = this.holderCache.get(mint);
      if (cached && cached.expiresAt > now) {
        out.set(mint, cached.count);
        continue;
      }
      const pending = this.holderInflight.get(mint);
      if (pending) {
        waiting.push(
          pending.then((count) => {
            out.set(mint, count);
          }),
        );
        continue;
      }
      toFetch.push(mint);
    }
    if (toFetch.length > 0) {
      const task = this.fetchHolderBatch(toFetch);
      for (const mint of toFetch) {
        this.holderInflight.set(
          mint,
          task.then((counts) => counts.get(mint) ?? null),
        );
      }
      try {
        const fetched = await task;
        for (const [mint, count] of fetched) out.set(mint, count);
      } finally {
        for (const mint of toFetch) this.holderInflight.delete(mint);
      }
    }
    await Promise.all(waiting);
    return out;
  }

  private async fetchHolderBatch(mints: readonly string[]): Promise<Map<string, number | null>> {
    const result = new Map<string, number | null>();
    const timeoutMs = Math.min(this.timeoutMs, HOLDER_FETCH_TIMEOUT_MS);
    for (const batch of chunkValues(mints, JUPITER_TOKEN_SEARCH_BATCH)) {
      const url = `${this.jupiterTokenBaseUrl}${jupiterTokenSearchPath(batch)}`;
      try {
        const payload = await this.gate().run(() =>
          fetchJsonOrText(url, timeoutMs, this.fetchImpl, "Jupiter holder count", 0),
        );
        const parsed = parseJupiterHolderCounts(payload, new Set(batch));
        const expiresAt = Date.now() + this.holderCacheMs;
        for (const mint of batch) {
          const count = parsed.get(mint) ?? null;
          result.set(mint, count);
          this.holderCache.set(mint, { count, expiresAt });
        }
      } catch {
        const expiresAt = Date.now() + MINT_HOLDER_MISS_CACHE_MS;
        for (const mint of batch) {
          result.set(mint, null);
          this.holderCache.set(mint, { count: null, expiresAt });
        }
      }
    }
    return result;
  }

  private async pairHolderCountsForAddresses(addresses: readonly string[]): Promise<Map<string, number | null>> {
    const unique = [...new Set(addresses.map((address) => address.trim()).filter(Boolean))];
    const out = new Map<string, number | null>();
    const now = Date.now();
    const toFetch: string[] = [];
    const waiting: Promise<void>[] = [];
    for (const address of unique) {
      const cached = this.pairHolderCache.get(address);
      if (cached && cached.expiresAt > now) {
        out.set(address, cached.count);
        continue;
      }
      const pending = this.pairHolderInflight.get(address);
      if (pending) {
        waiting.push(
          pending.then((count) => {
            out.set(address, count);
          }),
        );
        continue;
      }
      toFetch.push(address);
    }
    if (toFetch.length > 0) {
      const gate = this.gate();
      const timeoutMs = Math.min(this.timeoutMs, HOLDER_FETCH_TIMEOUT_MS);
      const tasks = toFetch.map((address) => {
        const task = (async () => {
          const path = dexScreenerPairDetailsPath(address);
          if (!path) return null;
          try {
            const payload = await gate.run(() =>
              fetchJsonOrText(
                `${this.dexScreenerIoBaseUrl}${path}`,
                timeoutMs,
                this.fetchImpl,
                "DexScreener pair holders",
                0,
              ),
            );
            const count = parseDexScreenerPairHolderCount(payload);
            this.pairHolderCache.set(address, { count, expiresAt: Date.now() + this.holderCacheMs });
            return count;
          } catch {
            this.pairHolderCache.set(address, {
              count: null,
              expiresAt: Date.now() + MINT_HOLDER_MISS_CACHE_MS,
            });
            return null;
          }
        })();
        this.pairHolderInflight.set(address, task);
        return task.then((count) => {
          out.set(address, count);
        });
      });
      try {
        await Promise.all(tasks);
      } finally {
        for (const address of toFetch) this.pairHolderInflight.delete(address);
      }
    }
    await Promise.all(waiting);
    return out;
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

  async getEquityCardDayVolumeSeries(): Promise<Record<string, VolumeHistoryPoint[]>> {
    return this.ensureCardVolumeSeriesBuild();
  }

  async getEquityCardDayVolumeSeriesSnapshot(): Promise<EquityCardDayVolumeSeriesSnapshot> {
    if (!this.isCardVolumeSeriesReady()) void this.ensureCardVolumeSeriesBuild();
    return {
      series: this.snapshotCardSeries(),
      pending:
        this.cardVolumeSeriesInflight !== null ||
        this.cardVolumeTimer !== null ||
        !this.isCardVolumeSeriesReady(),
    };
  }

  private ensureCardVolumeSeriesBuild(): Promise<Record<string, VolumeHistoryPoint[]>> {
    if (this.cardVolumeSeriesInflight) return this.cardVolumeSeriesInflight;
    if (this.isCardVolumeSeriesReady()) return Promise.resolve(this.snapshotCardSeries());
    const pending = this.buildEquityCardDayVolumeSeries().finally(() => {
      this.cardVolumeSeriesInflight = null;
    });
    this.cardVolumeSeriesInflight = pending;
    return pending;
  }

  private isCardVolumeSeriesReady(now = Date.now()): boolean {
    if (!this.cardVolumeTargetsKnown) return now < this.cardVolumeRetryNotBefore;
    if (now < this.cardVolumeRetryNotBefore) return true;
    if (now - this.cardVolumeTargetsLoadedAt > this.volumeHistoryCacheMs) return false;
    return this.cardVolumeTargetMints.every((mint) => {
      const row = this.cardVolumeResolved.get(mint);
      return Boolean(row && row.expiresAt > now);
    });
  }

  private snapshotCardSeries(now = Date.now()): Record<string, VolumeHistoryPoint[]> {
    const series: Record<string, VolumeHistoryPoint[]> = {};
    const allowed = new Set(this.cardVolumeTargetMints);
    for (const [mint, row] of this.cardVolumeResolved) {
      if (row.expiresAt <= now || !row.points || row.points.length === 0) continue;
      if (this.cardVolumeTargetsKnown && !allowed.has(mint)) continue;
      series[mint] = row.points;
    }
    return series;
  }

  private rememberCardVolume(mint: string, points: VolumeHistoryPoint[] | null, now = Date.now()) {
    this.cardVolumeResolved.set(mint, {
      points,
      expiresAt: now + this.volumeHistoryCacheMs,
    });
  }

  private unresolvedCardTargets(targets: readonly EquityCardVolumeTarget[], now = Date.now()) {
    return targets.filter((target) => {
      const row = this.cardVolumeResolved.get(target.mint);
      return !row || row.expiresAt <= now;
    });
  }

  private markCardVolumeTargets(mints: readonly string[], now = Date.now()) {
    this.cardVolumeTargetsKnown = true;
    this.cardVolumeTargetMints = [...mints];
    this.cardVolumeTargetsLoadedAt = now;
  }

  private clearCardVolumeTimer() {
    if (!this.cardVolumeTimer) return;
    clearTimeout(this.cardVolumeTimer);
    this.cardVolumeTimer = null;
  }

  private scheduleCardVolumeRetry(waitMs: number) {
    this.clearCardVolumeTimer();
    const timer = setTimeout(() => {
      if (this.cardVolumeTimer === timer) this.cardVolumeTimer = null;
      this.cardVolumeRetryNotBefore = 0;
      void this.getEquityCardDayVolumeSeries();
    }, waitMs);
    if (typeof timer.unref === "function") timer.unref();
    this.cardVolumeTimer = timer;
  }

  /**
   * Failures are not stored, so the next pass retries only those pools.
   * A near-empty result uses the short window instead of the 30-minute history TTL.
   */
  private armCardVolumeRetry(targetCount: number, failedCount: number) {
    const ttl = equityCardVolumeSeriesCacheTtlMs({
      targetCount,
      failedCount,
      fullTtlMs: this.volumeHistoryCacheMs,
      sparseTtlMs: this.cardVolumeSeriesSparseCacheMs,
    });
    this.cardVolumeRetryNotBefore = Date.now() + ttl;
    if (ttl > 0 && failedCount > 0 && this.cardVolumeAutoRetries < 1) {
      this.cardVolumeAutoRetries += 1;
      this.scheduleCardVolumeRetry(ttl);
    }
  }

  private async buildEquityCardDayVolumeSeries(): Promise<Record<string, VolumeHistoryPoint[]>> {
    this.clearCardVolumeTimer();
    if (!this.geckoEnabled || this.cardVolumeSeriesMax === 0) {
      this.markCardVolumeTargets([]);
      this.cardVolumeRetryNotBefore = 0;
      this.cardVolumeAutoRetries = 0;
      return {};
    }

    let targets: EquityCardVolumeTarget[];
    try {
      const snapshot = await this.loadCached("full");
      const assets = [
        ...snapshot.mapped.assets,
        ...snapshot.mapped.etfAssets,
        ...snapshot.mapped.privateAssets,
      ];
      targets = selectEquityCardVolumeTargets(assets, this.cardVolumeSeriesMax);
    } catch {
      this.cardVolumeTargetsKnown = false;
      this.armCardVolumeRetry(1, 1);
      return this.snapshotCardSeries();
    }

    this.markCardVolumeTargets(targets.map((target) => target.mint));
    if (targets.length === 0) {
      this.cardVolumeRetryNotBefore = 0;
      this.cardVolumeAutoRetries = 0;
      return {};
    }

    const nowT = Date.now() / 1000;
    await this.fetchEquityCardVolumeTargets(this.unresolvedCardTargets(targets), nowT);
    const failed = this.unresolvedCardTargets(targets).length;
    if (failed === 0) {
      this.cardVolumeRetryNotBefore = 0;
      this.cardVolumeAutoRetries = 0;
    } else {
      this.armCardVolumeRetry(targets.length, failed);
    }
    return this.snapshotCardSeries();
  }

  private async fetchEquityCardVolumeTargets(targets: readonly EquityCardVolumeTarget[], nowT: number) {
    let gapMs = this.cardVolumeSeriesGapMs;
    let cooled = false;
    const maxAttempts = 1 + this.cardVolumeSeriesRetries;

    for (let index = 0; index < targets.length; index += 1) {
      const target = targets[index];
      if (!target) continue;
      if (index > 0 && gapMs > 0) await sleep(gapMs);

      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const result = await this.tryFetchEquityCardVolume(target, nowT);
        if (result.kind === "ok") break;
        if (attempt >= maxAttempts - 1) break;
        if (result.kind === "rate_limited") {
          gapMs = Math.max(gapMs, this.cardVolumeSeriesSlowGapMs);
          if (!cooled) {
            cooled = true;
            const wait = equityCardVolumeRateLimitDelayMs(
              result.retryAfterHeader,
              this.cardVolumeSeriesCooldownMs,
            );
            if (wait > 0) await sleep(wait);
          } else if (gapMs > 0) {
            await sleep(gapMs);
          }
          continue;
        }
        if (this.cardVolumeSeriesTransientRetryMs > 0) await sleep(this.cardVolumeSeriesTransientRetryMs);
      }
    }
  }

  private async tryFetchEquityCardVolume(
    target: EquityCardVolumeTarget,
    nowT: number,
  ): Promise<{ kind: "ok" } | { kind: "rate_limited"; retryAfterHeader: string | null } | { kind: "failed" }> {
    return this.enqueueGecko(async () => {
      try {
        const payload = await this.fetchSource(
          `${this.geckoTerminalBaseUrl}${geckoTerminalOhlcvPath(target.pairAddress, {
            timeframe: "hour",
            limit: 24,
          })}`,
          "GeckoTerminal",
          { retries: 0 },
        );
        const day = sliceEquityCardDayVolumeSeries(parseGeckoTerminalOhlcvSeries(payload).volumes, nowT);
        this.rememberCardVolume(target.mint, day);
        return { kind: "ok" as const };
      } catch (error) {
        // A missing pool is a real omission. A 429 is not — leave it unresolved and retry.
        if (isDefinitiveFetchMiss(error)) {
          this.rememberCardVolume(target.mint, null);
          return { kind: "ok" as const };
        }
        if (responseStatusFromError(error) === 429) {
          const retryAfterHeader = error instanceof SourceRequestError ? error.retryAfterHeader : null;
          this.armGeckoCooldown(retryAfterHeader);
          return { kind: "rate_limited" as const, retryAfterHeader };
        }
        return { kind: "failed" as const };
      }
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
    let mint: string | null = null;
    let pools: Parameters<typeof rankPoolsForMintPrice>[0] = [];
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
      pools = asset.pools;
      if (!selectPrimaryPricePool(pools, mint)) {
        return emptyAssetPriceHistory(
          "This mint has no DexScreener pair address, so there is no GeckoTerminal close series to load.",
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Solana snapshot failed.";
      return emptyAssetPriceHistory(message);
    }

    const poolsToAsk = rankPoolsForMintPrice(pools, mint).slice(0, ASSET_PRICE_POOL_ATTEMPTS);
    let lastPair = poolsToAsk[0] ?? null;

    for (const candidate of poolsToAsk) {
      lastPair = candidate;
      const loaded = await this.loadMintPoolCloses(candidate, mint);
      if (loaded.kind === "stop") break;
      if (loaded.kind === "skip") continue;
      return buildAssetPriceHistory({
        pairAddress: candidate,
        daily: loaded.daily.prices,
        hourly: loaded.hourly.prices,
        dailyVolume: loaded.daily.volumes,
        hourlyVolume: loaded.hourly.volumes,
        fallbackDailyVolume: mint ? this.volumeHistoryCache?.result.seriesByMint[mint] : undefined,
      });
    }

    return buildAssetPriceHistory({
      pairAddress: lastPair,
      daily: [],
      hourly: [],
      dailyVolume: [],
      hourlyVolume: [],
      fallbackDailyVolume: mint ? this.volumeHistoryCache?.result.seriesByMint[mint] : undefined,
      emptyReason: "GeckoTerminal did not return usable USD closes for this mint’s primary pool.",
    });
  }

  /**
   * Day + hour closes for one pool.
   * `skip` means Gecko named a different base token — those closes are not this mint.
   * `stop` means the request failed (often 429 after retries); the next pool would fail the same way.
   */
  private async loadMintPoolCloses(
    pairAddress: string,
    mint: string | null,
  ): Promise<
    | { kind: "use"; daily: ReturnType<typeof parseGeckoTerminalOhlcvSeries>; hourly: ReturnType<typeof parseGeckoTerminalOhlcvSeries> }
    | { kind: "skip" }
    | { kind: "stop" }
  > {
    const dailyPayload = await this.fetchGeckoOhlcvPayload(
      `${this.geckoTerminalBaseUrl}${geckoTerminalOhlcvPath(pairAddress, { timeframe: "day", limit: 90 })}`,
    );
    const hourlyPayload = await this.fetchGeckoOhlcvPayload(
      `${this.geckoTerminalBaseUrl}${geckoTerminalOhlcvPath(pairAddress, { timeframe: "hour", limit: 24 })}`,
    );
    if (!dailyPayload && !hourlyPayload) return { kind: "stop" };

    const base = readGeckoOhlcvBaseAddress(dailyPayload) ?? readGeckoOhlcvBaseAddress(hourlyPayload);
    if (mint && base && base !== mint) return { kind: "skip" };

    const daily = dailyPayload ? parseGeckoTerminalOhlcvSeries(dailyPayload) : { prices: [], volumes: [] };
    const hourly = hourlyPayload ? parseGeckoTerminalOhlcvSeries(hourlyPayload) : { prices: [], volumes: [] };
    if (daily.prices.length === 0 && hourly.prices.length === 0) {
      return dailyPayload === null || hourlyPayload === null ? { kind: "stop" } : { kind: "skip" };
    }
    return { kind: "use", daily, hourly };
  }

  /**
   * Cached cross-pool volume. A hit returns immediately.
   * A miss resumes a background job and does not wait for Gecko.
   * One pool is attempted per turn. A 429 leaves that pool open, arms the
   * shared cooldown, and schedules the next turn outside the Gecko queue.
   * Daily candles finish first. Hourly candles for the 24H line start after that
   * and do not hold the daily snapshot. The detail chart's primary-pool fetch
   * is not part of this path.
   */
  async getAssetAllMarketsVolumeSnapshot(chainId: string, symbol: string): Promise<AssetAllMarketsVolumeSnapshot> {
    if (chainId !== SOLANA_CHAIN_ID || !this.geckoEnabled) return emptyAllMarketsVolumeSnapshot();

    let mint = "";
    let pools: { pairAddress: string; volume24hUsd: number | null }[] = [];
    try {
      const snapshot = await this.loadCached("full");
      const asset = findAssetByKey(
        [...snapshot.mapped.details, ...snapshot.mapped.etfDetails, ...snapshot.mapped.privateDetails],
        symbol,
      );
      if (!asset) return emptyAllMarketsVolumeSnapshot();
      mint = asset.contractAddress.trim();
      pools = uniqueAllMarketsPools(asset.pools);
    } catch {
      return emptyAllMarketsVolumeSnapshot();
    }
    if (!mint || pools.length === 0) return emptyAllMarketsVolumeSnapshot();

    const pairAddresses = pools.map((pool) => pool.pairAddress);
    const pairKey = allMarketsPairKey(pairAddresses);
    const now = Date.now();
    const active = this.allMarketsJobs.get(mint);
    if (active && (!active.finished || active.expiresAt > now)) {
      this.reconcileAllMarketsJob(active, pools);
      const hourly = this.hourlyMarketsJobs.get(mint);
      if (hourly) this.reconcileAllMarketsJob(hourly, pools);
      return this.withHourlySeries(await this.ensureAllMarketsJob(active), mint, this.jobPools(active));
    }

    const stored = await readStoredAllMarketsVolume({
      directory: this.allMarketsVolumeCacheDir,
      mint,
      pairAddresses,
      nowMs: now,
      ttlMs: this.volumeHistoryCacheMs,
    });
    if (stored) {
      const partial = allMarketsLiveSetIsPartial(stored.pairAddresses, pairAddresses);
      const rememberedPools = partial ? this.poolsForStoredSet(stored.pairAddresses, pools) : pools;
      const rememberedKey = allMarketsPairKey(rememberedPools.map((pool) => pool.pairAddress));
      const remembered = this.rememberCompleteAllMarkets(
        mint,
        rememberedKey,
        rememberedPools,
        stored.daily,
        stored.pairAddresses,
        stored.dailyPools,
        now,
      );
      if (stored.hourly !== null) {
        this.rememberCompleteHourly(
          mint,
          rememberedKey,
          rememberedPools,
          stored.hourly,
          stored.pairAddresses,
          stored.hourlyPools,
          now,
        );
      }
      return this.withHourlySeries(await this.ensureAllMarketsJob(remembered), mint, this.jobPools(remembered));
    }

    const raced = this.allMarketsJobs.get(mint);
    if (raced && !raced.finished) {
      this.reconcileAllMarketsJob(raced, pools);
      return this.withHourlySeries(await this.ensureAllMarketsJob(raced), mint, this.jobPools(raced));
    }

    const progress = await readAllMarketsProgress({
      directory: this.allMarketsVolumeCacheDir,
      mint,
      pairAddresses,
      nowMs: now,
      ttlMs: this.volumeHistoryCacheMs,
    });
    if (progress && allMarketsLiveSetIsPartial(progress.pairAddresses, pairAddresses)) {
      const hourlyProgress = await readAllMarketsProgress({
        directory: this.allMarketsVolumeCacheDir,
        mint,
        pairAddresses,
        nowMs: now,
        ttlMs: this.volumeHistoryCacheMs,
        suffix: ALL_MARKETS_HOURLY_PROGRESS_SUFFIX,
      });
      return {
        pending: true,
        complete: false,
        daily: [],
        resolvedPools: progress.pools.length,
        totalPools: progress.pairAddresses.length,
        hourly: [],
        hourlyPending: hourlyProgress !== null && hourlyProgress.pools.length < hourlyProgress.pairAddresses.length,
        hourlyComplete: false,
        hourlyResolvedPools: hourlyProgress?.pools.length ?? 0,
        hourlyTotalPools: hourlyProgress?.pairAddresses.length ?? progress.pairAddresses.length,
      };
    }

    const created = this.createAllMarketsJob(mint, pairKey, pools);
    this.allMarketsJobs.set(mint, created);
    return this.withHourlySeries(await this.ensureAllMarketsJob(created), mint, this.jobPools(created));
  }

  private jobPools(job: AllMarketsJob): { pairAddress: string; volume24hUsd: number | null }[] {
    return job.slots.map((slot) => ({ pairAddress: slot.pairAddress, volume24hUsd: slot.volume24hUsd }));
  }

  /** Keep the saved pair set when the live list is a partial payload. Volumes come from the live rows that overlap. */
  private poolsForStoredSet(
    storedAddresses: readonly string[],
    live: readonly { pairAddress: string; volume24hUsd: number | null }[],
  ): { pairAddress: string; volume24hUsd: number | null }[] {
    const byPair = new Map(live.map((pool) => [pool.pairAddress, pool.volume24hUsd]));
    return storedAddresses.map((pairAddress) => ({
      pairAddress,
      volume24hUsd: byPair.get(pairAddress) ?? null,
    }));
  }

  /**
   * Keep resolved pools when DexScreener's pair list gains or drops a few addresses.
   * A much smaller list is ignored so a partial payload cannot restart a 30-pool fill.
   * A published series stays published while any new pools are still fetching.
   */
  private reconcileAllMarketsJob(
    job: AllMarketsJob,
    livePools: readonly { pairAddress: string; volume24hUsd: number | null }[],
  ): void {
    const live = uniqueAllMarketsPools(livePools);
    const liveAddresses = live.map((pool) => pool.pairAddress);
    const nextKey = allMarketsPairKey(liveAddresses);
    if (nextKey === job.pairKey) {
      const byPair = new Map(live.map((pool) => [pool.pairAddress, pool]));
      for (const slot of job.slots) {
        const row = byPair.get(slot.pairAddress);
        if (row) slot.volume24hUsd = row.volume24hUsd;
      }
      return;
    }
    if (!allMarketsPoolSetCompatible(job.pairAddresses, liveAddresses)) return;

    const previous = new Map(job.slots.map((slot) => [slot.pairAddress, slot]));
    const next: AllMarketsSlot[] = [];
    for (const pool of live) {
      const existing = previous.get(pool.pairAddress);
      if (existing) {
        existing.volume24hUsd = pool.volume24hUsd;
        next.push(existing);
        continue;
      }
      next.push({
        pairAddress: pool.pairAddress,
        volume24hUsd: pool.volume24hUsd,
        status: "open",
        points: null,
      });
    }
    job.slots = next;
    job.pairAddresses = liveAddresses;
    job.pairKey = nextKey;
    job.finished = false;
    if (!job.complete) job.daily = [];
  }

  private createAllMarketsJob(
    mint: string,
    pairKey: string,
    pools: readonly { pairAddress: string; volume24hUsd: number | null }[],
  ): AllMarketsJob {
    return {
      mint,
      pairKey,
      pairAddresses: pools.map((pool) => pool.pairAddress),
      slots: pools.map((pool) => ({
        pairAddress: pool.pairAddress,
        volume24hUsd: pool.volume24hUsd,
        status: "open",
        points: null,
      })),
      series: "daily",
      timer: null,
      running: false,
      hydrated: false,
      hydratePromise: null,
      finished: false,
      complete: false,
      daily: [],
      expiresAt: 0,
    };
  }

  private rememberCompleteAllMarkets(
    mint: string,
    pairKey: string,
    pools: readonly { pairAddress: string; volume24hUsd: number | null }[],
    daily: VolumeHistoryPoint[],
    covered: readonly string[],
    candles: readonly AllMarketsStoredPool[] | null,
    now: number,
  ): AllMarketsJob {
    const job = this.createAllMarketsJob(mint, pairKey, pools);
    this.applyRememberedSeries(job, daily, covered, candles, now);
    this.allMarketsJobs.set(mint, job);
    return job;
  }

  private createHourlyJob(
    mint: string,
    pairKey: string,
    pools: readonly { pairAddress: string; volume24hUsd: number | null }[],
  ): AllMarketsJob {
    const job = this.createAllMarketsJob(mint, pairKey, pools);
    job.series = "hourly";
    return job;
  }

  private rememberCompleteHourly(
    mint: string,
    pairKey: string,
    pools: readonly { pairAddress: string; volume24hUsd: number | null }[],
    hourly: VolumeHistoryPoint[],
    covered: readonly string[],
    candles: readonly AllMarketsStoredPool[] | null,
    now: number,
  ): AllMarketsJob {
    const job = this.createHourlyJob(mint, pairKey, pools);
    this.applyRememberedSeries(job, hourly, covered, candles, now);
    this.hourlyMarketsJobs.set(mint, job);
    return job;
  }

  /** Restore a published series onto the live pool list without zeroing pools that were already summed. */
  private applyRememberedSeries(
    job: AllMarketsJob,
    series: VolumeHistoryPoint[],
    covered: readonly string[],
    candles: readonly AllMarketsStoredPool[] | null,
    now: number,
  ): void {
    const coveredSet = new Set(covered.map((address) => address.trim()).filter((address) => address.length > 0));
    const candleByPair = new Map((candles ?? []).map((pool) => [pool.pairAddress, pool.points]));
    for (const slot of job.slots) {
      if (candles && candleByPair.has(slot.pairAddress)) {
        slot.status = "points";
        slot.points = candleByPair.get(slot.pairAddress) ?? [];
        slot.folded = false;
        continue;
      }
      if (coveredSet.has(slot.pairAddress)) {
        slot.status = "points";
        slot.points = [];
        slot.folded = candles === null;
        continue;
      }
      slot.status = "open";
      slot.points = null;
      slot.folded = false;
    }
    const open = job.slots.some((slot) => slot.status === "open");
    job.hydrated = true;
    job.complete = true;
    job.daily = series;
    job.expiresAt = now + this.volumeHistoryCacheMs;
    job.finished = !open && allMarketsPairKey(job.pairAddresses) === allMarketsPairKey(covered);
  }

  /**
   * Attach the hourly series without delaying a daily snapshot.
   * Hourly work starts only after daily is complete, one pool per later turn.
   * An hourly job already in flight is kept when the pool list wobbles.
   */
  private async withHourlySeries(
    daily: AssetAllMarketsVolumeSnapshot,
    mint: string,
    pools: readonly { pairAddress: string; volume24hUsd: number | null }[],
  ): Promise<AssetAllMarketsVolumeSnapshot> {
    if (!daily.complete) return this.overlayHourly(daily, mint);
    let hourly = this.hourlyMarketsJobs.get(mint);
    if (!hourly || (hourly.finished && hourly.expiresAt <= Date.now() && !hourly.complete)) {
      hourly = this.createHourlyJob(mint, allMarketsPairKey(pools.map((pool) => pool.pairAddress)), pools);
      this.hourlyMarketsJobs.set(mint, hourly);
    }
    const snap = await this.ensureAllMarketsJob(hourly);
    return this.overlayHourlySnapshot(daily, snap);
  }

  private overlayHourly(daily: AssetAllMarketsVolumeSnapshot, mint: string): AssetAllMarketsVolumeSnapshot {
    const hourly = this.hourlyMarketsJobs.get(mint);
    if (!hourly) return daily;
    return this.overlayHourlySnapshot(daily, this.allMarketsSnapshot(hourly));
  }

  private overlayHourlySnapshot(
    daily: AssetAllMarketsVolumeSnapshot,
    hourly: AssetAllMarketsVolumeSnapshot,
  ): AssetAllMarketsVolumeSnapshot {
    return {
      ...daily,
      hourly: hourly.complete ? hourly.daily : [],
      hourlyPending: hourly.pending,
      hourlyComplete: hourly.complete,
      hourlyResolvedPools: hourly.resolvedPools,
      hourlyTotalPools: hourly.totalPools,
    };
  }

  private async ensureAllMarketsJob(job: AllMarketsJob): Promise<AssetAllMarketsVolumeSnapshot> {
    if (!job.hydrated) {
      job.hydratePromise ??= this.hydrateAllMarketsJob(job).then(() => {
        job.hydrated = true;
      });
      await job.hydratePromise;
    }
    if (!job.finished && job.slots.every((slot) => slot.status !== "open")) {
      await this.finishAllMarketsJob(job);
    }
    if (!job.finished) this.kickAllMarkets(job);
    return this.allMarketsSnapshot(job);
  }

  private allMarketsSnapshot(job: AllMarketsJob): AssetAllMarketsVolumeSnapshot {
    const totalPools = job.slots.length;
    const resolvedPools = job.slots.filter((slot) => slot.status !== "open").length;
    const idleHourly = {
      hourly: [] as VolumeHistoryPoint[],
      hourlyPending: false,
      hourlyComplete: false,
      hourlyResolvedPools: 0,
      hourlyTotalPools: totalPools,
    };
    if (job.complete) {
      return { pending: false, complete: true, daily: job.daily, resolvedPools: totalPools, totalPools, ...idleHourly };
    }
    if (job.finished) {
      return { pending: false, complete: false, daily: [], resolvedPools, totalPools, ...idleHourly };
    }
    return { pending: true, complete: false, daily: [], resolvedPools, totalPools, ...idleHourly };
  }

  private progressSuffix(job: AllMarketsJob): string | undefined {
    return job.series === "hourly" ? ALL_MARKETS_HOURLY_PROGRESS_SUFFIX : undefined;
  }

  private kickAllMarkets(job: AllMarketsJob) {
    if (job.finished || job.running || job.timer) return;
    this.scheduleAllMarkets(job, 0);
  }

  private scheduleAllMarkets(job: AllMarketsJob, delayMs: number) {
    if (job.finished) return;
    if (job.timer) clearTimeout(job.timer);
    const timer = setTimeout(() => {
      job.timer = null;
      void this.pumpAllMarkets(job);
    }, Math.max(0, delayMs));
    timer.unref?.();
    job.timer = timer;
  }

  /** Daily fill still has open pools. Hourly waits outside the Gecko queue. */
  private dailyAllMarketsStillOpen(): boolean {
    for (const job of this.allMarketsJobs.values()) {
      if (job.series === "daily" && !job.finished) return true;
    }
    return false;
  }

  /** Chart and card fetches own the lane. A cooldown is waited outside the queue. */
  private allMarketsLaneBlocked(): boolean {
    return (
      this.priceHistoryInflight.size > 0 ||
      this.cardVolumeSeriesInflight !== null ||
      this.geckoCooldownUntil > Date.now()
    );
  }

  private allMarketsDeferDelayMs(): number {
    const cooldown = this.geckoCooldownUntil - Date.now();
    if (cooldown > 0) return cooldown;
    return 250;
  }

  private async hydrateAllMarketsJob(job: AllMarketsJob) {
    const saved = await readAllMarketsProgress({
      directory: this.allMarketsVolumeCacheDir,
      mint: job.mint,
      pairAddresses: job.pairAddresses,
      ttlMs: this.volumeHistoryCacheMs,
      suffix: this.progressSuffix(job),
    });
    if (!saved) return;
    const byPair = new Map(saved.pools.map((pool) => [pool.pairAddress, pool]));
    for (const slot of job.slots) {
      const row = byPair.get(slot.pairAddress);
      if (!row) continue;
      if (row.status === "points") {
        slot.status = "points";
        slot.points = row.points;
        continue;
      }
      slot.status = "definitive_miss";
      slot.points = null;
    }
  }

  private async persistAllMarketsProgress(job: AllMarketsJob) {
    if (job.finished) return;
    const pools: AllMarketsProgressPool[] = [];
    for (const slot of job.slots) {
      if (slot.status === "open") continue;
      pools.push({
        pairAddress: slot.pairAddress,
        status: slot.status,
        points: slot.status === "points" ? (slot.points ?? []) : [],
      });
    }
    await writeAllMarketsProgress({
      directory: this.allMarketsVolumeCacheDir,
      mint: job.mint,
      pairAddresses: job.pairAddresses,
      pools,
      suffix: this.progressSuffix(job),
    });
  }

  private async pumpAllMarkets(job: AllMarketsJob) {
    if (job.finished || job.running) return;
    job.running = true;
    try {
      await this.pumpAllMarketsTurn(job);
    } catch {
      if (!job.finished && !job.timer) {
        const retry = this.cardVolumeSeriesTransientRetryMs;
        this.scheduleAllMarkets(job, retry > 0 ? retry : 1_000);
      }
    } finally {
      job.running = false;
    }
  }

  private async pumpAllMarketsTurn(job: AllMarketsJob) {
    for (;;) {
      if (job.finished) return;
      const open = job.slots.find((slot) => slot.status === "open");
      if (!open) {
        await this.finishAllMarketsJob(job);
        return;
      }
      if (this.allMarketsLaneBlocked()) {
        this.scheduleAllMarkets(job, this.allMarketsDeferDelayMs());
        return;
      }
      const outcome = await this.fetchPoolSeriesVolumeOnce(open.pairAddress, job.series);
      if (job.finished) return;
      if (outcome.kind === "deferred") {
        this.scheduleAllMarkets(job, this.allMarketsDeferDelayMs());
        return;
      }
      if (outcome.kind === "points") {
        open.status = "points";
        open.points = outcome.points;
        await this.persistAllMarketsProgress(job);
        if (this.cardVolumeSeriesGapMs > 0) {
          this.scheduleAllMarkets(job, this.cardVolumeSeriesGapMs);
          return;
        }
        continue;
      }
      if (outcome.kind === "definitive_miss") {
        open.status = "definitive_miss";
        open.points = null;
        await this.persistAllMarketsProgress(job);
        continue;
      }
      if (outcome.kind === "rate_limited") {
        const wait = this.geckoCooldownUntil - Date.now();
        this.scheduleAllMarkets(job, wait > 0 ? wait : 0);
        return;
      }
      const retry = this.cardVolumeSeriesTransientRetryMs;
      this.scheduleAllMarkets(job, retry > 0 ? retry : 0);
      return;
    }
  }

  private slotResults(slots: readonly AllMarketsSlot[]): AllMarketsPoolResult[] {
    return slots.map((slot) => ({
      pairAddress: slot.pairAddress,
      volume24hUsd: slot.volume24hUsd,
      points: slot.status === "points" ? (slot.points ?? []) : null,
      definitiveMiss: slot.status === "definitive_miss",
    }));
  }

  private async finishAllMarketsJob(job: AllMarketsJob) {
    const hadFolded = job.slots.some((slot) => slot.folded);
    let complete = false;
    let series: VolumeHistoryPoint[] = [];
    if (hadFolded) {
      const fresh = job.slots.filter((slot) => !slot.folded);
      const assembled = assembleAllMarketsDaily(this.slotResults(fresh));
      if (assembled.complete) {
        complete = true;
        series = mergeVolumeSeries(job.daily, assembled.daily);
        for (const slot of fresh) slot.folded = true;
      }
    } else {
      const assembled = assembleAllMarketsDaily(this.slotResults(job.slots));
      complete = assembled.complete;
      series = assembled.complete ? assembled.daily : [];
    }
    const now = Date.now();
    job.finished = true;
    job.complete = complete;
    job.daily = series;
    job.expiresAt = now + (complete ? this.volumeHistoryCacheMs : Math.min(this.volumeHistoryCacheMs, 60_000));
    if (job.timer) {
      clearTimeout(job.timer);
      job.timer = null;
    }
    if (!complete) return;
    const poolCandles = hadFolded
      ? undefined
      : job.slots
          .filter((slot) => slot.status === "points")
          .map((slot) => ({ pairAddress: slot.pairAddress, points: slot.points ?? [] }));
    if (job.series === "hourly") {
      const wrote = await writeCompleteAllMarketsHourly({
        directory: this.allMarketsVolumeCacheDir,
        mint: job.mint,
        pairAddresses: job.pairAddresses,
        hourly: series,
        hourlyPools: poolCandles,
      });
      if (wrote) {
        await deleteAllMarketsProgress({
          directory: this.allMarketsVolumeCacheDir,
          mint: job.mint,
          suffix: ALL_MARKETS_HOURLY_PROGRESS_SUFFIX,
        });
      }
      return;
    }
    const wrote = await writeCompleteAllMarketsDaily({
      directory: this.allMarketsVolumeCacheDir,
      mint: job.mint,
      pairAddresses: job.pairAddresses,
      daily: series,
      fetchedAt: now,
      dailyPools: poolCandles,
    });
    if (wrote) {
      await deleteAllMarketsProgress({ directory: this.allMarketsVolumeCacheDir, mint: job.mint });
    }
  }

  /**
   * One OHLCV attempt. Daily uses day candles (limit 60). Hourly uses hour candles (limit 24).
   * A 429 arms the shared cooldown and returns. The wait happens on the job timer, not inside the Gecko queue.
   * Hourly does not enter the queue while a daily fill is still open.
   */
  private async fetchPoolSeriesVolumeOnce(pairAddress: string, series: "daily" | "hourly"): Promise<
    | { kind: "points"; points: VolumeHistoryPoint[] }
    | { kind: "definitive_miss" }
    | { kind: "rate_limited" }
    | { kind: "failed" }
    | { kind: "deferred" }
  > {
    if (series === "hourly" && this.dailyAllMarketsStillOpen()) {
      return { kind: "deferred" };
    }
    const url = `${this.geckoTerminalBaseUrl}${geckoTerminalOhlcvPath(pairAddress, {
      timeframe: series === "hourly" ? "hour" : "day",
      limit: series === "hourly" ? 24 : 60,
    })}`;
    return this.enqueueGecko(async () => {
      if (this.priceHistoryInflight.size > 0 || this.cardVolumeSeriesInflight !== null) {
        return { kind: "deferred" as const };
      }
      if (series === "hourly" && this.dailyAllMarketsStillOpen()) {
        return { kind: "deferred" as const };
      }
      try {
        const payload = await this.fetchSource(url, "GeckoTerminal", { retries: 0 });
        return { kind: "points" as const, points: parseGeckoTerminalOhlcvSeries(payload).volumes };
      } catch (error) {
        if (isDefinitiveFetchMiss(error)) return { kind: "definitive_miss" as const };
        if (responseStatusFromError(error) === 429) {
          const retryAfter = error instanceof SourceRequestError ? error.retryAfterHeader : null;
          this.armGeckoCooldown(retryAfter);
          return { kind: "rate_limited" as const };
        }
        return { kind: "failed" as const };
      }
    });
  }
}
