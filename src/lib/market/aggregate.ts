import { compareNullableDesc, maxNullable, sumNullable } from "./numbers";
import {
  ROBINHOOD_CHAIN_ID,
  ROBINHOOD_CHAIN_NATIVE_ID,
  type AssetSummary,
  type ChainVolume,
} from "./types";

export function sortByVolumeThenLiquidity<T extends { volume24hUsd: number | null; displayedLiquidityUsd: number | null; symbol?: string }>(
  rows: readonly T[],
): T[] {
  return [...rows].sort((a, b) => {
    const volume = compareNullableDesc(a.volume24hUsd, b.volume24hUsd);
    if (volume !== 0) return volume;
    const liquidity = compareNullableDesc(a.displayedLiquidityUsd, b.displayedLiquidityUsd);
    if (liquidity !== 0) return liquidity;
    return (a.symbol ?? "").localeCompare(b.symbol ?? "");
  });
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
    | "reportedPoolCount"
    | "peakDexCount"
  >,
  assets: readonly AssetSummary[],
  extras?: { etfCount?: number; volumeAggregation?: ChainVolume["volumeAggregation"] },
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
    reportedPoolCount: assets.reduce((sum, asset) => sum + asset.poolCount, 0),
    peakDexCount: maxNullable(assets.map((asset) => asset.dexCount)) ?? 0,
    etfCount: extras?.etfCount ?? chain.etfCount ?? 0,
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
    volumeAggregation: "all-pools",
    coverageNote:
      "Single-chain Terminal snapshot. Volume is the sum of observedVolume24h across reported stocks; missing values stay missing.",
  };
}
