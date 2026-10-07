/**
 * Multi-chain market model for tokenized / on-chain stocks.
 *
 * Terminal (robinhood-liquidity-terminal) is a single-chain HTTP source.
 * Its market-liquidity snapshot maps cleanly to one ChainVolume entry
 * (`robinhood-chain`). Additional chains come from other adapters later.
 */

export type SourceKind = "mock" | "terminal" | "solana" | "robinhood" | "composite";
export type TrustKind = "fact" | "interpretive";
export type InstrumentKind = "equity" | "etf" | "private";
export type VolumeAggregation = "all-pools" | "primary-pair" | "none";
export type VolumeCoverage =
  | "reported"
  | "no_indexed_pools"
  | "pools_without_volume"
  | "hydrate_failed"
  | "hydrate_incomplete";

export interface SourceFailure {
  sourceId: SourceKind;
  sourceLabel: string;
  message: string;
}

export interface DataProvenance {
  sourceId: SourceKind;
  sourceLabel: string;
  fetchedAt: string;
  generatedAt: string | null;
  refreshStartedAt: string | null;
  refreshDurationMs: number | null;
  cacheStatus: string | null;
  cacheAgeMs: number | null;
  notes: string[];
  sourceFailures: readonly SourceFailure[];
}

export interface ChainVolume {
  id: string;
  name: string;
  shortName: string;
  nativeChainId: string | null;
  sourceId: SourceKind;
  sourceLabel: string;
  volume24hUsd: number | null;
  displayedLiquidityUsd: number | null;
  usdGLiquidityUsd: number | null;
  assetCount: number;
  assetsWithVolume: number;
  assetsWithPools: number;
  assetsStillHydrating: number;
  assetsWithNoIndexedPools: number;
  reportedPoolCount: number;
  peakDexCount: number;
  etfCount: number;
  privateCount: number;
  /** Labeled private-market 24h rollup. Never mixed into volume24hUsd (public ranking). Headline, Solana card, and DexScreener snapshot history add it via sumNullable. Null is unknown, not $0. */
  privateVolume24hUsd: number | null;
  /** Labeled ETF/index 24h rollup. Never mixed into volume24hUsd (public ranking). Headline, Solana card, and DexScreener snapshot history add it via sumNullable. Null is unknown, not $0. */
  etfVolume24hUsd: number | null;
  volumeAggregation: VolumeAggregation;
  completenessPct: number | null;
  coverageNote: string;
}

export interface AssetPoolMark {
  pairAddress: string;
  dexId: string;
  volume24hUsd: number | null;
  liquidityUsd: number | null;
  priceUsd: number | null;
  /** DexScreener base token symbol when reported. */
  baseSymbol?: string | null;
  quoteSymbol?: string | null;
  baseName?: string | null;
  quoteName?: string | null;
  baseAddress?: string | null;
  quoteAddress?: string | null;
  /** Real http(s) logo only. Quote sides do not inherit the pair imageUrl. */
  baseLogoUrl?: string | null;
  quoteLogoUrl?: string | null;
  /** DexScreener pair `url` when reported, else a constructed Solana pair href. */
  url?: string | null;
  /** DexScreener pair `labels` when reported (CLMM, DLMM, wp, …). */
  labels?: readonly string[] | null;
  /** buys + sells when DexScreener reported both `txns.h24` sides. */
  trades24h?: number | null;
  /** Unique wallets are not on the DexScreener pair payload we fetch. */
  wallets24h?: number | null;
  /**
   * DexScreener pair-details `holders.count` for this pool's base token.
   * Not copied from the page mint or from another pool. Unknown stays null.
   */
  pairHolderCount?: number | null;
  /**
   * DexScreener `pairCreatedAt` in unix milliseconds for this pool.
   * Not a token mint time and not copied from another pool. Unknown stays null.
   */
  pairCreatedAt?: number | null;
  tradesChange24hPct?: number | null;
  walletsChange24hPct?: number | null;
}

export interface AssetSummary {
  chainId: string;
  sourceId: SourceKind;
  sourceLabel: string;
  symbol: string;
  name: string;
  contractAddress: string;
  issuer: string | null;
  logoUrl: string | null;
  volume24hUsd: number | null;
  displayedLiquidityUsd: number | null;
  usdGLiquidityUsd: number | null;
  poolCount: number;
  dexCount: number;
  pools: readonly AssetPoolMark[];
  robinhoodReferencePriceUsd: number | null;
  dexMedianPriceUsd: number | null;
  premiumDiscountPct: number | null;
  top3ConcentrationPct: number | null;
  liquidityCoverageComplete: boolean | null;
  volume24hCoverageComplete: boolean | null;
  instrumentKind: InstrumentKind;
  volumeCoverage: VolumeCoverage;
  coverageNote: string | null;
  /** DexScreener `priceChange.h24` from the highest-volume pair that reported it. */
  priceChange24hPct: number | null;
}

export interface LargestPoolMark {
  dexId: string;
  pairAddress: string;
  liquidityUsd: number;
  shareOfDisplayedLiquidityPct: number | null;
}

export interface DexSlice {
  dexId: string;
  displayedLiquidityUsd: number | null;
  shareOfDisplayedLiquidityPct: number | null;
  poolCount: number;
}

export interface QuoteAssetSlice {
  address: string;
  symbol: string;
  symbolConflict: boolean;
  displayedLiquidityUsd: number | null;
  shareOfDisplayedLiquidityPct: number | null;
  poolCount: number;
}

export interface PriceMarks {
  robinhoodReferenceUsd: number | null;
  robinhoodBidUsd: number | null;
  robinhoodAskUsd: number | null;
  robinhoodGeneratedAt: string | null;
  isTradingHalt: boolean | null;
  dexMedianUsd: number | null;
  dexLiquidityWeightedUsd: number | null;
  dexLargestPoolUsd: number | null;
  premiumDiscountPct: number | null;
  priceDispersionPct: number | null;
  priceCoverageComplete: boolean | null;
}

export interface AssetDetail extends AssetSummary {
  buys24h: number | null;
  sells24h: number | null;
  largestPool: LargestPoolMark | null;
  concentration: {
    top1Pct: number | null;
    top3Pct: number | null;
    top5Pct: number | null;
  };
  dexes: readonly DexSlice[];
  quoteAssets: readonly QuoteAssetSlice[];
  price: PriceMarks;
  detailEnriched: boolean;
  /** DEX median price × circulating supply when both are known. Never a pool's reported market cap. */
  marketCapUsd: number | null;
  /** DEX median price × total supply when both are known. Never a pool's reported FDV. */
  fdvUsd: number | null;
  /** Jupiter Tokens V2 holderCount for this mint. Unknown stays null — never inferred. */
  holderCount: number | null;
  /** Source-reported circulating supply. Never inferred from market cap, price, or liquidity. */
  circulatingSupply: number | null;
  /** Source-reported total supply. Never inferred from FDV, price, or liquidity. */
  totalSupply: number | null;
}

export interface ChainListResult {
  chains: ChainVolume[];
  provenance: DataProvenance;
}

export const SOLANA_CHAIN_ID = "solana";

export interface ChainDetailResult {
  chain: ChainVolume;
  assets: AssetSummary[];
  etfAssets?: AssetSummary[];
  privateAssets?: AssetSummary[];
  provenance: DataProvenance;
}

export interface AssetDetailResult {
  chain: ChainVolume;
  asset: AssetDetail;
  provenance: DataProvenance;
}

/**
 * Asset page reads.
 * `enrich: false` is the list-cache row only — no Jupiter, pair-detail, RPC, or Gecko.
 * `pairHolders: false` still loads the mint holder and outstanding supply for Statistics.
 */
export interface AssetReadOptions {
  enrich?: boolean;
  pairHolders?: boolean;
}

export type VolumeHistoryPointKind = "calendar_day" | "rolling_24h";

export interface VolumeHistoryPoint {
  t: number;
  volumeUsd: number;
  kind?: VolumeHistoryPointKind;
}

/** Public, private, and ETF/index 24h legs. Null is unreported, not zero. */
export interface DeskLiveRolling24h {
  publicVolume24hUsd: number | null;
  privateVolume24hUsd: number | null;
  etfVolume24hUsd: number | null;
}

export interface EquityVolumeHistoryResult {
  available: boolean;
  points: VolumeHistoryPoint[];
  /** Last ~7 UTC days of per-mint equity volume from the same pool OHLCV as `points`. */
  seriesByMint: Record<string, VolumeHistoryPoint[]>;
  definition: string;
  sourceLabel: string;
  poolCount: number;
  poolCountAttempted: number;
  mintCount: number;
  volume24hUsd: number | null;
  firstObservableAt: string | null;
  lastObservableAt: string | null;
  generatedAt: string;
  emptyReason: string | null;
}

export type PriceChartRangeId = "24h" | "7d" | "30d" | "90d";

export interface PriceHistoryPoint {
  t: number;
  priceUsd: number;
}

export type AssetChartMode = "price" | "volume";

export interface AssetPriceHistoryResult {
  available: boolean;
  pairAddress: string | null;
  sourceLabel: string;
  definition: string;
  daily: PriceHistoryPoint[];
  hourly: PriceHistoryPoint[];
  /** Same-pool GeckoTerminal OHLCV volume (6th tuple). Missing volume stays missing. */
  dailyVolume: VolumeHistoryPoint[];
  hourlyVolume: VolumeHistoryPoint[];
  generatedAt: string;
  emptyReason: string | null;
}

/**
 * Cross-pool USD volume for one mint.
 * `daily` / `hourly` are set only when every pool resolved for that candle size.
 * `pending` means daily pools are still open, including across Gecko 429 cooldowns.
 * The page must not wait on them. `hourlyPending` is the same for the 24H series
 * and stays independent so a finished daily total can paint before hourly does.
 * Resolved counts are candles or a definitive miss. They are not a partial sum.
 */
export interface AssetAllMarketsVolumeSnapshot {
  pending: boolean;
  complete: boolean;
  daily: VolumeHistoryPoint[];
  resolvedPools: number;
  totalPools: number;
  /** Summed hourly candles. Empty unless `hourlyComplete`. */
  hourly: VolumeHistoryPoint[];
  hourlyPending: boolean;
  hourlyComplete: boolean;
  hourlyResolvedPools: number;
  hourlyTotalPools: number;
}

export function emptyAllMarketsVolumeSnapshot(): AssetAllMarketsVolumeSnapshot {
  return {
    pending: false,
    complete: false,
    daily: [],
    resolvedPools: 0,
    totalPools: 0,
    hourly: [],
    hourlyPending: false,
    hourlyComplete: false,
    hourlyResolvedPools: 0,
    hourlyTotalPools: 0,
  };
}

export interface MarketDataSource {
  readonly id: SourceKind;
  readonly label: string;
  listChains(): Promise<ChainListResult>;
  getChain(chainId: string): Promise<ChainDetailResult | null>;
  getAsset(chainId: string, symbol: string, options?: AssetReadOptions): Promise<AssetDetailResult | null>;
  getEquityVolumeHistory(): Promise<EquityVolumeHistoryResult>;
  /**
   * Closed America/New_York desk snapshot days from `solana.json` for the
   * 7D/14D/30D chart poll. Does not call DexScreener, does not write the
   * snapshot file, and does not read `solana-hourly.json`. The in-progress
   * Eastern day stays off the series.
   */
  getClosedDeskVolumeHistory(): Promise<EquityVolumeHistoryResult>;
  /**
   * Last ~24 America/New_York hours of DexScreener rolling h24 desk totals
   * from `solana-hourly.json`. Each point is `kind: "rolling_24h"` with
   * `volumeUsd` = combined public + private + ETF/index and `t` = that
   * Eastern hour’s unix start. Captured hours only — missing hours are not
   * stored as points. The 24H chart still marks every Eastern hour in the
   * window and leaves a miss empty. Does not read or write the closed-day file.
   */
  getEquityHourlyRollingVolumeHistory(): Promise<EquityVolumeHistoryResult>;
  /**
   * Live DexScreener all-markets 24h legs for the volume-chart headline.
   * Reuses the in-memory desk snapshot (default fresh for 5 minutes).
   * Does not write `solana.json` and does not read `solana-hourly.json`.
   * Null means the snapshot is unavailable — callers keep the last headline.
   */
  getLiveDeskRolling24h(): Promise<DeskLiveRolling24h | null>;
  getAssetPriceHistory(chainId: string, symbol: string): Promise<AssetPriceHistoryResult>;
  /** Primary-pool Gecko hourly volume for card sparklines. Missing mints are omitted. */
  getEquityCardDayVolumeSeries(): Promise<Record<string, VolumeHistoryPoint[]>>;
  /**
   * Current card series without waiting out the remaining Gecko pool calls.
   * `pending` stays true while fetches are in flight or a rate-limit retry is scheduled.
   */
  getEquityCardDayVolumeSeriesSnapshot(): Promise<EquityCardDayVolumeSeriesSnapshot>;
  /**
   * Cached sum of Gecko volume across every pool for the mint.
   * Daily candles feed 7D/30D. Hourly candles feed the 24H series.
   * A cold cache returns immediately and fills in the background.
   */
  getAssetAllMarketsVolumeSnapshot(chainId: string, symbol: string): Promise<AssetAllMarketsVolumeSnapshot>;
}

export interface EquityCardDayVolumeSeriesSnapshot {
  series: Record<string, VolumeHistoryPoint[]>;
  pending: boolean;
}

export const ROBINHOOD_CHAIN_ID = "robinhood-chain";
export const ROBINHOOD_CHAIN_NATIVE_ID = "4663";
