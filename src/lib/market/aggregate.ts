import { compareNullableDesc, maxNullable, sumNullable } from "./numbers";
import {
  ROBINHOOD_CHAIN_ID,
  ROBINHOOD_CHAIN_NATIVE_ID,
  type AssetSummary,
  type ChainVolume,
  type VolumeCoverage,
} from "./types";

/** Lower is better. Reported volume always outranks unknown volume. */
export const VOLUME_COVERAGE_RANK: Record<VolumeCoverage, number> = {
  reported: 0,
  pools_without_volume: 1,
  hydrate_incomplete: 2,
  hydrate_failed: 3,
  no_indexed_pools: 4,
};

export type AssetSortKey =
  | "volume24hUsd"
  | "displayedLiquidityUsd"
  | "marketValueUsd"
  | "poolCount"
  | "premiumDiscountPct";

export interface RankableRow {
  volume24hUsd: number | null;
  displayedLiquidityUsd: number | null;
  marketValueUsd?: number | null;
  poolCount?: number;
  symbol?: string;
  volumeCoverage?: VolumeCoverage;
  premiumDiscountPct?: number | null;
}

export function coverageSortRank(row: RankableRow): number {
  if (row.volumeCoverage) return VOLUME_COVERAGE_RANK[row.volumeCoverage];
  if (row.volume24hUsd !== null) return VOLUME_COVERAGE_RANK.reported;
  if ((row.poolCount ?? 0) > 0) return VOLUME_COVERAGE_RANK.pools_without_volume;
  return VOLUME_COVERAGE_RANK.no_indexed_pools;
}

const VOLUME_SORT_CHAIN = ["coverage", "volume24hUsd", "displayedLiquidityUsd", "poolCount", "symbol"] as const;

type RankKey = (typeof VOLUME_SORT_CHAIN)[number] | "premiumDiscountPct" | "marketValueUsd";

function compareRankKey(a: RankableRow, b: RankableRow, key: RankKey): number {
  switch (key) {
    case "coverage":
      return coverageSortRank(a) - coverageSortRank(b);
    case "volume24hUsd":
      return compareNullableDesc(a.volume24hUsd, b.volume24hUsd);
    case "displayedLiquidityUsd":
      return compareNullableDesc(a.displayedLiquidityUsd, b.displayedLiquidityUsd);
    case "marketValueUsd":
      return compareNullableDesc(a.marketValueUsd ?? null, b.marketValueUsd ?? null);
    case "poolCount":
      return (b.poolCount ?? 0) - (a.poolCount ?? 0);
    case "premiumDiscountPct":
      return compareNullableDesc(a.premiumDiscountPct ?? null, b.premiumDiscountPct ?? null);
    case "symbol":
      return (a.symbol ?? "").localeCompare(b.symbol ?? "");
  }
}

/**
 * Default ranking: coverage tier, then 24h volume (nulls last), liquidity, pool
 * count, symbol. Other primary keys keep those as tie-breaks.
 */
export function compareAssetsByRank(
  a: RankableRow,
  b: RankableRow,
  primary: AssetSortKey = "volume24hUsd",
): number {
  const chain: RankKey[] =
    primary === "volume24hUsd"
      ? [...VOLUME_SORT_CHAIN]
      : [primary, ...VOLUME_SORT_CHAIN.filter((key) => key !== primary)];
  for (const key of chain) {
    const compared = compareRankKey(a, b, key);
    if (compared !== 0) return compared;
  }
  return 0;
}

export function sortByVolumeThenLiquidity<T extends RankableRow>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => compareAssetsByRank(a, b));
}

export function sortAssets<T extends RankableRow>(rows: readonly T[], primary: AssetSortKey = "volume24hUsd"): T[] {
  return [...rows].sort((a, b) => compareAssetsByRank(a, b, primary));
}

export function parseAssetSortKey(value: string | string[] | undefined): AssetSortKey {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === "liquidity" || raw === "displayedLiquidityUsd") return "displayedLiquidityUsd";
  if (raw === "market-value" || raw === "marketValue" || raw === "marketValueUsd") return "marketValueUsd";
  if (raw === "pools" || raw === "poolCount") return "poolCount";
  if (raw === "premium" || raw === "premiumDiscountPct") return "premiumDiscountPct";
  return "volume24hUsd";
}

export function assetSortQueryValue(key: AssetSortKey): string | null {
  if (key === "displayedLiquidityUsd") return "liquidity";
  if (key === "marketValueUsd") return "market-value";
  if (key === "poolCount") return "pools";
  if (key === "premiumDiscountPct") return "premium";
  return null;
}

/** Reported public + private + ETF/index 24h. Null is omitted, not zero. */
export function combinedPublicPrivateVolume24h(
  publicVolume24hUsd: number | null | undefined,
  privateVolume24hUsd: number | null | undefined = null,
  etfVolume24hUsd: number | null | undefined = null,
): number | null {
  return sumNullable([publicVolume24hUsd, privateVolume24hUsd, etfVolume24hUsd]);
}

export function chainCombinedVolume24h(
  chain: Pick<ChainVolume, "volume24hUsd" | "privateVolume24hUsd" | "etfVolume24hUsd">,
): number | null {
  return combinedPublicPrivateVolume24h(
    chain.volume24hUsd,
    chain.privateVolume24hUsd,
    chain.etfVolume24hUsd,
  );
}

export function rollupChainFromAssets(
  chain: Omit<
    ChainVolume,
    | "volume24hUsd"
    | "displayedLiquidityUsd"
    | "usdGLiquidityUsd"
    | "assetCount"
    | "assetsWithVolume"
    | "assetsWithPools"
    | "assetsStillHydrating"
    | "assetsWithNoIndexedPools"
    | "reportedPoolCount"
    | "peakDexCount"
  >,
  assets: readonly AssetSummary[],
  extras?: {
    etfCount?: number;
    etfVolume24hUsd?: number | null;
    privateCount?: number;
    privateVolume24hUsd?: number | null;
    volumeAggregation?: ChainVolume["volumeAggregation"];
  },
): ChainVolume {
  return {
    ...chain,
    volume24hUsd: sumNullable(assets.map((asset) => asset.volume24hUsd)),
    displayedLiquidityUsd: sumNullable(assets.map((asset) => asset.displayedLiquidityUsd)),
    usdGLiquidityUsd: sumNullable(assets.map((asset) => asset.usdGLiquidityUsd)),
    assetCount: assets.length,
    assetsWithVolume: assets.filter((asset) => asset.volume24hUsd !== null).length,
    assetsWithPools: assets.filter((asset) => asset.poolCount > 0).length,
    assetsStillHydrating: assets.filter((asset) => asset.volumeCoverage === "hydrate_incomplete").length,
    assetsWithNoIndexedPools: assets.filter((asset) => asset.volumeCoverage === "no_indexed_pools").length,
    reportedPoolCount: assets.reduce((sum, asset) => sum + asset.poolCount, 0),
    peakDexCount: maxNullable(assets.map((asset) => asset.dexCount)) ?? 0,
    etfCount: extras?.etfCount ?? chain.etfCount ?? 0,
    etfVolume24hUsd: extras?.etfVolume24hUsd ?? chain.etfVolume24hUsd ?? null,
    privateCount: extras?.privateCount ?? chain.privateCount ?? 0,
    privateVolume24hUsd: extras?.privateVolume24hUsd ?? chain.privateVolume24hUsd ?? null,
    volumeAggregation: extras?.volumeAggregation ?? chain.volumeAggregation ?? "all-pools",
  };
}

export function robinhoodChainMeta(): Omit<
  ChainVolume,
  | "volume24hUsd"
  | "displayedLiquidityUsd"
  | "usdGLiquidityUsd"
  | "assetCount"
    | "assetsWithVolume"
    | "assetsWithPools"
    | "assetsStillHydrating"
    | "assetsWithNoIndexedPools"
    | "reportedPoolCount"
    | "peakDexCount"
> {
  return {
    id: ROBINHOOD_CHAIN_ID,
    name: "Robinhood Chain",
    shortName: "RH",
    nativeChainId: ROBINHOOD_CHAIN_NATIVE_ID,
    sourceId: "terminal",
    sourceLabel: "Robinhood Liquidity Terminal",
    completenessPct: null,
    etfCount: 0,
    etfVolume24hUsd: null,
    privateCount: 0,
    privateVolume24hUsd: null,
    volumeAggregation: "all-pools",
    coverageNote:
      "Single-chain Terminal snapshot. Volume is the sum of observedVolume24h across reported stocks; missing values stay missing.",
  };
}
