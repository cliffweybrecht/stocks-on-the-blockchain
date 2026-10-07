import {
  ASSET_PRICE_POOL_ATTEMPTS,
  buildAssetPriceHistory,
  emptyAssetPriceHistory,
  parseGeckoTerminalOhlcvSeries,
  rankPoolsForMintPrice,
  readGeckoOhlcvBaseAddress,
} from "./asset-price-history";
import { assembleAllMarketsDaily, uniqueAllMarketsPools } from "./asset-volume-headline";
import { mapWithConcurrency } from "./async-pool";
import { DEFAULT_GECKOTERMINAL_BASE_URL, geckoTerminalOhlcvPath } from "./solana-geckoterminal";
import { fetchJsonOrText, isDefinitiveFetchMiss, responseStatusFromError, SourceRequestError, type FetchLike } from "./solana-http";
import { unwrapDexScreenerPairs, type DexScreenerPair } from "./map-solana";
import { asNonNegativeNumber } from "./numbers";
import { DEFAULT_ROBINHOOD_DEX_BASE_URL } from "./robinhood-chain-markets";
import {
  ONDO_NAMED_UNVERIFIED_LABEL,
  RHJ_ISSUER_LABEL,
  ROBINHOOD_DEX_CHAIN_SLUG,
  buildRobinhoodMarketLanes,
  isAdmittedOndoName,
  isRobinhoodDexChain,
  type RobinhoodListedToken,
} from "./robinhood-markets";
import {
  emptyAllMarketsVolumeSnapshot,
  type AssetAllMarketsVolumeSnapshot,
  type AssetDetail,
  type AssetDetailResult,
  type AssetPriceHistoryResult,
  type VolumeHistoryPoint,
} from "./types";

/** GeckoTerminal network id for EVM chain 4663. DexScreener's slug is the same word. */
export const ROBINHOOD_GECKO_NETWORK = "robinhood";

const DETAIL_CACHE_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 12_000;
const COOLDOWN_FALLBACK_MS = 15_000;
const COOLDOWN_CAP_MS = 60_000;

export interface RobinhoodAssetFetchOptions {
  fetchImpl?: FetchLike;
  dexBaseUrl?: string;
  geckoBaseUrl?: string;
  timeoutMs?: number;
  /** Process cache is for the live desk. Tests pass false or a custom fetch. */
  cache?: boolean;
  nowMs?: number;
}

interface CandleSlot {
  points: VolumeHistoryPoint[] | null;
  definitiveMiss: boolean;
}

interface PoolSlot {
  pairAddress: string;
  volume24hUsd: number | null;
  daily: CandleSlot;
  hourly: CandleSlot;
}

interface AllMarketsJob {
  pools: PoolSlot[];
}

interface SeriesStore {
  details: Map<string, { expiresAt: number; result: AssetDetailResult }>;
  jobs: Map<string, AllMarketsJob>;
  coolingUntil: number;
}

function seriesStore(): SeriesStore {
  const globalForStore = globalThis as typeof globalThis & { __sotbRobinhoodAssetSeries?: SeriesStore };
  if (!globalForStore.__sotbRobinhoodAssetSeries) {
    globalForStore.__sotbRobinhoodAssetSeries = {
      details: new Map(),
      jobs: new Map(),
      coolingUntil: 0,
    };
  }
  return globalForStore.__sotbRobinhoodAssetSeries;
}

export function resetRobinhoodAssetSeriesForTests(): void {
  const store = seriesStore();
  store.details.clear();
  store.jobs.clear();
  store.coolingUntil = 0;
}

export function robinhoodAllMarketsVolumePath(assetKey: string): string {
  return `/api/robinhood/asset-all-markets-volume?asset=${encodeURIComponent(assetKey)}`;
}

/** Ondo-named contracts stay unverified. A stray "Ondo" issuer is not official. */
export function robinhoodListedIssuer(asset: {
  issuer: string | null;
  name: string;
}): RobinhoodListedToken["issuer"] {
  if (asset.issuer === ONDO_NAMED_UNVERIFIED_LABEL || isAdmittedOndoName(asset.name)) {
    return ONDO_NAMED_UNVERIFIED_LABEL;
  }
  return RHJ_ISSUER_LABEL;
}

/**
 * GeckoTerminal `normalized_total_supply` only.
 * `market_cap_usd` and raw `total_supply` are not a circulating figure and are not copied in.
 */
export function parseGeckoRobinhoodTotalSupply(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") return null;
  const supply = (payload as { data?: { attributes?: { normalized_total_supply?: unknown } } }).data?.attributes
    ?.normalized_total_supply;
  return asNonNegativeNumber(supply);
}

/** GeckoTerminal token info `holders.count`. Missing stays null. */
export function parseGeckoRobinhoodHolderCount(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") return null;
  const count = (payload as { data?: { attributes?: { holders?: { count?: unknown } } } }).data?.attributes?.holders
    ?.count;
  const parsed = asNonNegativeNumber(count);
  if (parsed === null || !Number.isSafeInteger(parsed)) return null;
  return parsed;
}

/**
 * A named Gecko base must be this contract. Comparison is case-insensitive.
 * A payload with no base address is not treated as a contradiction.
 */
export function geckoOhlcvBaseMatchesMint(payload: unknown, mint: string): boolean {
  const base = readGeckoOhlcvBaseAddress(payload);
  if (!base) return true;
  return base.trim().toLowerCase() === mint.trim().toLowerCase();
}

/**
 * Total supply and holders are source-reported.
 * FDV is DEX price × that supply. Market cap and circulating supply stay untouched
 * because this desk does not infer them from FDV or from Gecko's market-cap field.
 */
export function applyRobinhoodReportedStats(
  asset: AssetDetail,
  stats: { totalSupply: number | null; holderCount: number | null },
): AssetDetail {
  const totalSupply = stats.totalSupply ?? asset.totalSupply;
  const holderCount = stats.holderCount ?? asset.holderCount;
  const price = asset.price.dexMedianUsd ?? asset.dexMedianPriceUsd;
  const fdvUsd =
    totalSupply !== null && price !== null && price > 0 ? price * totalSupply : asset.fdvUsd;
  return {
    ...asset,
    totalSupply,
    holderCount,
    fdvUsd,
    circulatingSupply: asset.circulatingSupply,
    marketCapUsd: asset.marketCapUsd,
  };
}

/** Replace catalog pools with every DexScreener pair. Issuer and Terminal marks stay. */
export function rebuildRobinhoodAssetFromPairs(
  asset: AssetDetail,
  pairs: readonly DexScreenerPair[],
): AssetDetail {
  const scoped = pairs.filter((pair) => isRobinhoodDexChain(pair.chainId ?? ROBINHOOD_DEX_CHAIN_SLUG));
  if (scoped.length === 0) return asset;
  const token: RobinhoodListedToken = {
    address: asset.contractAddress,
    symbol: asset.symbol,
    name: asset.name,
    issuer: robinhoodListedIssuer(asset),
    kind: asset.instrumentKind,
    logoUrl: asset.logoUrl,
  };
  const next = buildRobinhoodMarketLanes([token], scoped, { volumeHydrated: true }).details[0];
  if (!next) return asset;
  return {
    ...next,
    robinhoodReferencePriceUsd: asset.robinhoodReferencePriceUsd,
    premiumDiscountPct: asset.premiumDiscountPct ?? next.premiumDiscountPct,
    marketCapUsd: asset.marketCapUsd,
    fdvUsd: asset.fdvUsd,
    holderCount: asset.holderCount,
    circulatingSupply: asset.circulatingSupply,
    totalSupply: asset.totalSupply,
    price: {
      ...next.price,
      robinhoodReferenceUsd: asset.price.robinhoodReferenceUsd,
      robinhoodBidUsd: asset.price.robinhoodBidUsd,
      robinhoodAskUsd: asset.price.robinhoodAskUsd,
      robinhoodGeneratedAt: asset.price.robinhoodGeneratedAt,
      isTradingHalt: asset.price.isTradingHalt,
      premiumDiscountPct: next.price.premiumDiscountPct ?? asset.price.premiumDiscountPct,
    },
  };
}

/**
 * All DexScreener pairs for this contract, plus Gecko supply and holders.
 * A failed call keeps the rows already on the asset. Nothing is invented.
 */
export async function enrichRobinhoodAssetDetail(
  result: AssetDetailResult,
  options: RobinhoodAssetFetchOptions = {},
): Promise<AssetDetailResult> {
  const useCache = options.cache !== false && options.fetchImpl == null;
  const cacheKey = result.asset.contractAddress.trim().toLowerCase();
  const store = seriesStore();
  const now = options.nowMs ?? Date.now();
  if (useCache && cacheKey) {
    const cached = store.details.get(cacheKey);
    if (cached && cached.expiresAt > now) return cached.result;
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const dexBase = (options.dexBaseUrl ?? DEFAULT_ROBINHOOD_DEX_BASE_URL).replace(/\/+$/, "");
  const geckoBase = (options.geckoBaseUrl ?? DEFAULT_GECKOTERMINAL_BASE_URL).replace(/\/+$/, "");
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const address = result.asset.contractAddress.trim();

  const [pairs, supply, holders] = await Promise.all([
    readTokenPairs(dexBase, address, timeoutMs, fetchImpl),
    readTotalSupply(geckoBase, address, timeoutMs, fetchImpl),
    readHolderCount(geckoBase, address, timeoutMs, fetchImpl),
  ]);

  let asset = pairs.length > 0 ? rebuildRobinhoodAssetFromPairs(result.asset, pairs) : result.asset;
  asset = applyRobinhoodReportedStats(asset, { totalSupply: supply, holderCount: holders });
  const enriched: AssetDetailResult = { ...result, asset };
  if (useCache && cacheKey) {
    store.details.set(cacheKey, { expiresAt: now + DETAIL_CACHE_MS, result: enriched });
  }
  return enriched;
}

/** Primary-pool USD closes and volume. Soft-fails to an empty series. */
export async function loadRobinhoodAssetPriceHistory(
  asset: Pick<AssetDetail, "contractAddress" | "pools">,
  options: RobinhoodAssetFetchOptions = {},
): Promise<AssetPriceHistoryResult> {
  const mint = asset.contractAddress.trim();
  const ranked = rankPoolsForMintPrice(
    asset.pools.map((pool) => ({
      pairAddress: pool.pairAddress,
      volume24hUsd: pool.volume24hUsd,
      baseAddress: pool.baseAddress?.toLowerCase() ?? null,
    })),
    mint.toLowerCase(),
  ).slice(0, ASSET_PRICE_POOL_ATTEMPTS);

  if (!mint || ranked.length === 0) {
    return emptyAssetPriceHistory(
      "This contract has no DexScreener pair address, so there is no GeckoTerminal close series to load.",
    );
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const geckoBase = (options.geckoBaseUrl ?? DEFAULT_GECKOTERMINAL_BASE_URL).replace(/\/+$/, "");
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let lastPair = ranked[0] ?? null;

  try {
    for (const pairAddress of ranked) {
      lastPair = pairAddress;
      const loaded = await loadPoolCloses(geckoBase, pairAddress, mint, timeoutMs, fetchImpl, options.nowMs);
      if (loaded.kind === "stop") break;
      if (loaded.kind === "skip") continue;
      return buildAssetPriceHistory({
        pairAddress,
        daily: loaded.daily.prices,
        hourly: loaded.hourly.prices,
        dailyVolume: loaded.daily.volumes,
        hourlyVolume: loaded.hourly.volumes,
      });
    }
  } catch (error) {
    return emptyAssetPriceHistory(
      error instanceof Error ? error.message : "GeckoTerminal price history failed. The desk does not invent a series.",
    );
  }

  return buildAssetPriceHistory({
    pairAddress: lastPair,
    daily: [],
    hourly: [],
    dailyVolume: [],
    hourlyVolume: [],
    emptyReason: "GeckoTerminal did not return usable USD closes for this mint’s primary pool.",
  });
}

/**
 * One Gecko candle request per call, daily pools first.
 * The page polls this. A 429 leaves that pool open. A live pool that Gecko rejects
 * is not summed into an all-markets total.
 */
export async function advanceRobinhoodAllMarkets(
  asset: Pick<AssetDetail, "contractAddress" | "pools">,
  options: RobinhoodAssetFetchOptions = {},
): Promise<AssetAllMarketsVolumeSnapshot> {
  const pools = uniqueAllMarketsPools(asset.pools);
  if (!asset.contractAddress.trim() || pools.length === 0) return emptyAllMarketsVolumeSnapshot();
  const job = ensureJob(asset.contractAddress, pools);
  await stepJob(job, options);
  return snapshotFromJob(job);
}

async function readTokenPairs(
  dexBase: string,
  address: string,
  timeoutMs: number,
  fetchImpl: FetchLike,
): Promise<DexScreenerPair[]> {
  try {
    const payload = await fetchJsonOrText(
      `${dexBase}/token-pairs/v1/${ROBINHOOD_DEX_CHAIN_SLUG}/${address}`,
      timeoutMs,
      fetchImpl,
      "DexScreener token pairs",
      1,
    );
    return unwrapDexScreenerPairs(payload).map((pair) => ({
      ...pair,
      chainId: pair.chainId ?? ROBINHOOD_DEX_CHAIN_SLUG,
    }));
  } catch {
    return [];
  }
}

async function readTotalSupply(
  geckoBase: string,
  address: string,
  timeoutMs: number,
  fetchImpl: FetchLike,
): Promise<number | null> {
  try {
    const payload = await fetchJsonOrText(
      `${geckoBase}/networks/${ROBINHOOD_GECKO_NETWORK}/tokens/${address}`,
      timeoutMs,
      fetchImpl,
      "GeckoTerminal token",
      1,
    );
    return parseGeckoRobinhoodTotalSupply(payload);
  } catch {
    return null;
  }
}

async function readHolderCount(
  geckoBase: string,
  address: string,
  timeoutMs: number,
  fetchImpl: FetchLike,
): Promise<number | null> {
  try {
    const payload = await fetchJsonOrText(
      `${geckoBase}/networks/${ROBINHOOD_GECKO_NETWORK}/tokens/${address}/info`,
      timeoutMs,
      fetchImpl,
      "GeckoTerminal token info",
      0,
    );
    return parseGeckoRobinhoodHolderCount(payload);
  } catch {
    return null;
  }
}

async function loadPoolCloses(
  geckoBase: string,
  pairAddress: string,
  mint: string,
  timeoutMs: number,
  fetchImpl: FetchLike,
  nowMs: number | undefined,
): Promise<
  | {
      kind: "use";
      daily: ReturnType<typeof parseGeckoTerminalOhlcvSeries>;
      hourly: ReturnType<typeof parseGeckoTerminalOhlcvSeries>;
    }
  | { kind: "skip" }
  | { kind: "stop" }
> {
  const [dailyPayload, hourlyPayload] = await mapWithConcurrency(
    [
      ohlcvUrl(geckoBase, pairAddress, "day", 90),
      ohlcvUrl(geckoBase, pairAddress, "hour", 24),
    ],
    1,
    (url) => fetchOhlcv(url, timeoutMs, fetchImpl, nowMs),
  );
  if (!dailyPayload && !hourlyPayload) return { kind: "stop" };
  const basePayload = dailyPayload ?? hourlyPayload;
  if (basePayload && !geckoOhlcvBaseMatchesMint(basePayload, mint)) return { kind: "skip" };
  const daily = dailyPayload ? parseGeckoTerminalOhlcvSeries(dailyPayload) : { prices: [], volumes: [] };
  const hourly = hourlyPayload ? parseGeckoTerminalOhlcvSeries(hourlyPayload) : { prices: [], volumes: [] };
  if (daily.prices.length === 0 && hourly.prices.length === 0) {
    return dailyPayload === null || hourlyPayload === null ? { kind: "stop" } : { kind: "skip" };
  }
  return { kind: "use", daily, hourly };
}

async function fetchOhlcv(
  url: string,
  timeoutMs: number,
  fetchImpl: FetchLike,
  nowMs: number | undefined,
): Promise<unknown | null> {
  const store = seriesStore();
  const now = nowMs ?? Date.now();
  if (store.coolingUntil > now) return null;
  try {
    return await fetchJsonOrText(url, timeoutMs, fetchImpl, "GeckoTerminal", 0);
  } catch (error) {
    if (responseStatusFromError(error) === 429) {
      const header = error instanceof SourceRequestError ? error.retryAfterHeader : null;
      store.coolingUntil = now + cooldownMs(header);
    }
    return null;
  }
}

function ohlcvUrl(geckoBase: string, pairAddress: string, timeframe: "day" | "hour", limit: number): string {
  return `${geckoBase}${geckoTerminalOhlcvPath(pairAddress, {
    timeframe,
    limit,
    network: ROBINHOOD_GECKO_NETWORK,
  })}`;
}

function ensureJob(
  mint: string,
  pools: readonly { pairAddress: string; volume24hUsd: number | null }[],
): AllMarketsJob {
  const store = seriesStore();
  const key = mint.trim().toLowerCase();
  const existing = store.jobs.get(key);
  if (!existing) {
    const created = { pools: pools.map(freshPool) };
    store.jobs.set(key, created);
    return created;
  }
  const previous = new Map(existing.pools.map((pool) => [pool.pairAddress.toLowerCase(), pool]));
  existing.pools = pools.map((pool) => {
    const kept = previous.get(pool.pairAddress.toLowerCase());
    if (!kept) return freshPool(pool);
    kept.volume24hUsd = pool.volume24hUsd;
    kept.pairAddress = pool.pairAddress;
    return kept;
  });
  return existing;
}

function freshPool(pool: { pairAddress: string; volume24hUsd: number | null }): PoolSlot {
  return {
    pairAddress: pool.pairAddress,
    volume24hUsd: pool.volume24hUsd,
    daily: { points: null, definitiveMiss: false },
    hourly: { points: null, definitiveMiss: false },
  };
}

async function stepJob(job: AllMarketsJob, options: RobinhoodAssetFetchOptions): Promise<void> {
  const now = options.nowMs ?? Date.now();
  const store = seriesStore();
  if (store.coolingUntil > now) return;
  const open = nextOpen(job);
  if (!open) return;
  const fetchImpl = options.fetchImpl ?? fetch;
  const geckoBase = (options.geckoBaseUrl ?? DEFAULT_GECKOTERMINAL_BASE_URL).replace(/\/+$/, "");
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const limit = open.timeframe === "hour" ? 24 : 90;
  const url = ohlcvUrl(geckoBase, open.pool.pairAddress, open.timeframe, limit);
  try {
    const payload = await fetchJsonOrText(url, timeoutMs, fetchImpl, "GeckoTerminal", 0);
    open.slot.points = parseGeckoTerminalOhlcvSeries(payload).volumes;
    open.slot.definitiveMiss = false;
  } catch (error) {
    if (isDefinitiveFetchMiss(error)) {
      open.slot.points = null;
      open.slot.definitiveMiss = true;
      return;
    }
    if (responseStatusFromError(error) === 429) {
      const header = error instanceof SourceRequestError ? error.retryAfterHeader : null;
      store.coolingUntil = now + cooldownMs(header);
    }
  }
}

function nextOpen(job: AllMarketsJob): { pool: PoolSlot; timeframe: "day" | "hour"; slot: CandleSlot } | null {
  for (const pool of job.pools) {
    if (pool.daily.points === null && !pool.daily.definitiveMiss) {
      return { pool, timeframe: "day", slot: pool.daily };
    }
  }
  for (const pool of job.pools) {
    if (pool.hourly.points === null && !pool.hourly.definitiveMiss) {
      return { pool, timeframe: "hour", slot: pool.hourly };
    }
  }
  return null;
}

function snapshotFromJob(job: AllMarketsJob): AssetAllMarketsVolumeSnapshot {
  const daily = assembleAllMarketsDaily(
    job.pools.map((pool) => ({
      pairAddress: pool.pairAddress,
      volume24hUsd: pool.volume24hUsd,
      points: pool.daily.points,
      definitiveMiss: pool.daily.definitiveMiss,
    })),
  );
  const hourly = assembleAllMarketsDaily(
    job.pools.map((pool) => ({
      pairAddress: pool.pairAddress,
      volume24hUsd: pool.volume24hUsd,
      points: pool.hourly.points,
      definitiveMiss: pool.hourly.definitiveMiss,
    })),
  );
  const dailyOpen = job.pools.some((pool) => pool.daily.points === null && !pool.daily.definitiveMiss);
  const hourlyOpen = job.pools.some((pool) => pool.hourly.points === null && !pool.hourly.definitiveMiss);
  return {
    pending: dailyOpen,
    complete: daily.complete,
    daily: daily.complete ? daily.daily : [],
    resolvedPools: job.pools.filter((pool) => pool.daily.points !== null || pool.daily.definitiveMiss).length,
    totalPools: job.pools.length,
    hourly: hourly.complete ? hourly.daily : [],
    hourlyPending: daily.complete && hourlyOpen,
    hourlyComplete: hourly.complete,
    hourlyResolvedPools: job.pools.filter((pool) => pool.hourly.points !== null || pool.hourly.definitiveMiss).length,
    hourlyTotalPools: job.pools.length,
  };
}

function cooldownMs(header: string | null): number {
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, COOLDOWN_CAP_MS);
  return COOLDOWN_FALLBACK_MS;
}
