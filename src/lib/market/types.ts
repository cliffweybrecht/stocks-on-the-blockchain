/**
 * Multi-chain market model for tokenized / on-chain stocks.
 *
 * Terminal (robinhood-liquidity-terminal) is a single-chain HTTP source.
 * Its market-liquidity snapshot maps cleanly to one ChainVolume entry
 * (`robinhood-chain`). Additional chains come from other adapters later.
 */

export type SourceKind = "mock" | "terminal" | "solana" | "composite";
export type TrustKind = "fact" | "interpretive";
export type InstrumentKind = "equity" | "etf";
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
  provenance: DataProvenance;
}

export interface AssetDetailResult {
  chain: ChainVolume;
  asset: AssetDetail;
  provenance: DataProvenance;
}

export interface VolumeHistoryPoint {
  t: number;
  volumeUsd: number;
  cumulativeUsd: number;
}

export interface EquityVolumeHistoryResult {
  available: boolean;
  points: VolumeHistoryPoint[];
  definition: string;
  sourceLabel: string;
  poolCount: number;
  poolCountAttempted: number;
  mintCount: number;
  firstObservableAt: string | null;
  lastObservableAt: string | null;
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
}

export const ROBINHOOD_CHAIN_ID = "robinhood-chain";
export const ROBINHOOD_CHAIN_NATIVE_ID = "4663";
