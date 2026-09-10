/**
 * Multi-chain market model for tokenized / on-chain stocks.
 *
 * Terminal (robinhood-liquidity-terminal) is a single-chain HTTP source.
 * Its market-liquidity snapshot maps cleanly to one ChainVolume entry
 * (`robinhood-chain`). Additional chains come from other adapters later.
 */

export type SourceKind = "mock" | "terminal" | "solana" | "composite";
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
  /** Labeled private-market 24h rollup. Never mixed into volume24hUsd (public ranking) or the Gecko chart series. Headline / Solana card add it via sumNullable. Null is unknown, not $0. */
  privateVolume24hUsd: number | null;
  /** Labeled ETF/index 24h rollup. Never mixed into volume24hUsd (public ranking) or the Gecko chart series. Headline / Solana card add it via sumNullable. Null is unknown, not $0. */
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
  /** buys + sells when DexScreener reported both `txns.h24` sides. */
  trades24h?: number | null;
  /** Unique wallets are not on the DexScreener pair payload we fetch. */
  wallets24h?: number | null;
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
  /** DexScreener pair `marketCap` when reported. Never computed from supply × price. */
  marketCapUsd: number | null;
  /** DexScreener pair `fdv` when reported. Never computed from supply × price. */
  fdvUsd: number | null;
  /** DexScreener `priceChange.h24` from the highest-volume pair that reported it. */
  priceChange24hPct: number | null;
  /** Source-reported holder count. Unknown stays null — this desk has no holder indexer. */
  holderCount: number | null;
  /** Source-reported circulating supply. Never inferred from market cap / price. */
  circulatingSupply: number | null;
  /** Source-reported total supply. Never inferred from FDV / price. */
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

export type VolumeHistoryPointKind = "calendar_day" | "rolling_24h";

export interface VolumeHistoryPoint {
  t: number;
  volumeUsd: number;
  kind?: VolumeHistoryPointKind;
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

export interface AssetPriceHistoryResult {
  available: boolean;
  pairAddress: string | null;
  sourceLabel: string;
  definition: string;
  daily: PriceHistoryPoint[];
  hourly: PriceHistoryPoint[];
  generatedAt: string;
  emptyReason: string | null;
}

export interface MarketDataSource {
  readonly id: SourceKind;
  readonly label: string;
  listChains(): Promise<ChainListResult>;
  getChain(chainId: string): Promise<ChainDetailResult | null>;
  getAsset(chainId: string, symbol: string): Promise<AssetDetailResult | null>;
  getEquityVolumeHistory(): Promise<EquityVolumeHistoryResult>;
  getAssetPriceHistory(chainId: string, symbol: string): Promise<AssetPriceHistoryResult>;
}

export const ROBINHOOD_CHAIN_ID = "robinhood-chain";
export const ROBINHOOD_CHAIN_NATIVE_ID = "4663";
