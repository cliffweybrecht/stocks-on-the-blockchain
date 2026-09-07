import { rollupChainFromAssets, sortByVolumeThenLiquidity } from "./aggregate";
import { asFiniteNumber, asNonEmptyString } from "./numbers";
import { findAllowlistedMint, type SolanaAllowlistedMint } from "./solana-allowlist";
import { SOLANA_SOURCE_NOTE } from "./trust";
import {
  SOLANA_CHAIN_ID,
  type AssetDetail,
  type AssetSummary,
  type ChainVolume,
  type DataProvenance,
  type DexSlice,
} from "./types";

export interface DexScreenerPair {
  chainId?: unknown;
  dexId?: unknown;
  pairAddress?: unknown;
  baseToken?: { address?: unknown; name?: unknown; symbol?: unknown };
  quoteToken?: { address?: unknown; name?: unknown; symbol?: unknown };
  priceUsd?: unknown;
  volume?: { h24?: unknown };
  liquidity?: { usd?: unknown };
  txns?: { h24?: { buys?: unknown; sells?: unknown } };
}

export function unwrapDexScreenerPairs(payload: unknown): DexScreenerPair[] {
  if (Array.isArray(payload)) {
    return payload.filter((row): row is DexScreenerPair => typeof row === "object" && row !== null);
  }
  if (payload && typeof payload === "object" && "pairs" in payload) {
    const pairs = (payload as { pairs?: unknown }).pairs;
    if (Array.isArray(pairs)) {
      return pairs.filter((row): row is DexScreenerPair => typeof row === "object" && row !== null);
    }
  }
  throw new Error("DexScreener response was not a pair list.");
}

function tokenSide(token: DexScreenerPair["baseToken"], mints: readonly SolanaAllowlistedMint[]) {
  const address = asNonEmptyString(token?.address);
  const listed = findAllowlistedMint(address, mints);
  if (!listed || !address) return null;
  return {
    address,
    listed,
    symbol: asNonEmptyString(token?.symbol) ?? listed.symbol,
    name: asNonEmptyString(token?.name) ?? listed.name,
  };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? null;
  const left = sorted[mid - 1];
  const right = sorted[mid];
  if (left === undefined || right === undefined) return null;
  return (left + right) / 2;
}

interface MintAccumulator {
  listed: SolanaAllowlistedMint;
  symbol: string;
  name: string;
  address: string;
  volumes: number[];
  liquidities: number[];
  prices: number[];
  buys: number[];
  sells: number[];
  pairAddresses: Set<string>;
  dexes: Map<string, { liquidity: number[]; poolCount: number }>;
}

function emptyAccumulator(side: NonNullable<ReturnType<typeof tokenSide>>): MintAccumulator {
  return {
    listed: side.listed,
    symbol: side.symbol,
    name: side.name,
    address: side.address,
    volumes: [],
    liquidities: [],
    prices: [],
    buys: [],
    sells: [],
    pairAddresses: new Set(),
    dexes: new Map(),
  };
}

export function mapDexScreenerPairsToSolanaAssets(
  pairs: readonly DexScreenerPair[],
  mints: readonly SolanaAllowlistedMint[],
): { assets: AssetSummary[]; details: AssetDetail[] } {
  const byMint = new Map<string, MintAccumulator>();

  for (const pair of pairs) {
    if (asNonEmptyString(pair.chainId) !== SOLANA_CHAIN_ID) continue;
    const side = tokenSide(pair.baseToken, mints) ?? tokenSide(pair.quoteToken, mints);
    if (!side) continue;

    const bucket = byMint.get(side.address) ?? emptyAccumulator(side);
    const volume = asFiniteNumber(pair.volume?.h24);
    const liquidity = asFiniteNumber(pair.liquidity?.usd);
    const price = asFiniteNumber(typeof pair.priceUsd === "string" ? Number(pair.priceUsd) : pair.priceUsd);
    const buys = asFiniteNumber(pair.txns?.h24?.buys);
    const sells = asFiniteNumber(pair.txns?.h24?.sells);
    if (volume !== null) bucket.volumes.push(volume);
    if (liquidity !== null) bucket.liquidities.push(liquidity);
    if (price !== null) bucket.prices.push(price);
    if (buys !== null) bucket.buys.push(buys);
    if (sells !== null) bucket.sells.push(sells);
    const pairAddress = asNonEmptyString(pair.pairAddress);
    if (pairAddress) bucket.pairAddresses.add(pairAddress);
    const dexId = asNonEmptyString(pair.dexId);
    if (dexId) {
      const dex = bucket.dexes.get(dexId) ?? { liquidity: [], poolCount: 0 };
      if (liquidity !== null) dex.liquidity.push(liquidity);
      dex.poolCount += 1;
      bucket.dexes.set(dexId, dex);
    }
    byMint.set(side.address, bucket);
  }

  const details: AssetDetail[] = [];
  const summaries: AssetSummary[] = [];
  for (const bucket of byMint.values()) {
    const displayedLiquidityUsd =
      bucket.liquidities.length > 0 ? bucket.liquidities.reduce((sum, value) => sum + value, 0) : null;
    const volume24hUsd = bucket.volumes.length > 0 ? bucket.volumes.reduce((sum, value) => sum + value, 0) : null;
    const dexMedianUsd = median(bucket.prices);
    const largestLiquidity = bucket.liquidities.length > 0 ? Math.max(...bucket.liquidities) : null;
    const dexes: DexSlice[] = [...bucket.dexes.entries()]
      .map(([dexId, dex]) => {
        const dexLiquidity = dex.liquidity.length > 0 ? dex.liquidity.reduce((sum, value) => sum + value, 0) : null;
        return {
          dexId,
          displayedLiquidityUsd: dexLiquidity,
          shareOfDisplayedLiquidityPct:
            dexLiquidity !== null && displayedLiquidityUsd && displayedLiquidityUsd > 0
              ? (dexLiquidity / displayedLiquidityUsd) * 100
              : null,
          poolCount: dex.poolCount,
        };
      })
      .sort((a, b) => (b.displayedLiquidityUsd ?? -1) - (a.displayedLiquidityUsd ?? -1));

    const summary: AssetSummary = {
      chainId: SOLANA_CHAIN_ID,
      sourceId: "solana",
      sourceLabel: "DexScreener (xStocks allowlist)",
      symbol: bucket.symbol,
      name: bucket.name,
      contractAddress: bucket.address,
      logoUrl: null,
      volume24hUsd,
      displayedLiquidityUsd,
      usdGLiquidityUsd: null,
      poolCount: bucket.pairAddresses.size || bucket.volumes.length || bucket.liquidities.length,
      dexCount: bucket.dexes.size,
      robinhoodReferencePriceUsd: null,
      dexMedianPriceUsd: dexMedianUsd,
      premiumDiscountPct: null,
      top3ConcentrationPct: null,
      liquidityCoverageComplete: bucket.liquidities.length > 0,
      volume24hCoverageComplete: bucket.volumes.length > 0,
    };

    summaries.push(summary);
    details.push({
      ...summary,
      buys24h: bucket.buys.length > 0 ? bucket.buys.reduce((sum, value) => sum + value, 0) : null,
      sells24h: bucket.sells.length > 0 ? bucket.sells.reduce((sum, value) => sum + value, 0) : null,
      largestPool:
        largestLiquidity !== null
          ? {
              dexId: dexes[0]?.dexId ?? "reported-pair",
              pairAddress: [...bucket.pairAddresses][0] ?? "",
              liquidityUsd: largestLiquidity,
              shareOfDisplayedLiquidityPct:
                displayedLiquidityUsd && displayedLiquidityUsd > 0
                  ? (largestLiquidity / displayedLiquidityUsd) * 100
                  : null,
            }
          : null,
      concentration: { top1Pct: null, top3Pct: null, top5Pct: null },
      dexes,
      quoteAssets: [],
      price: {
        robinhoodReferenceUsd: null,
        robinhoodBidUsd: null,
        robinhoodAskUsd: null,
        robinhoodGeneratedAt: null,
        isTradingHalt: null,
        dexMedianUsd,
        dexLiquidityWeightedUsd: null,
        dexLargestPoolUsd: largestLiquidity !== null && dexMedianUsd !== null ? dexMedianUsd : null,
        premiumDiscountPct: null,
        priceDispersionPct: null,
        priceCoverageComplete: dexMedianUsd !== null,
      },
      detailEnriched: true,
    });
  }

  return {
    assets: sortByVolumeThenLiquidity(summaries),
    details: sortByVolumeThenLiquidity(details),
  };
}

export function solanaChainMeta(): Omit<
  ChainVolume,
  | "volume24hUsd"
  | "displayedLiquidityUsd"
  | "usdGLiquidityUsd"
  | "assetCount"
  | "assetsWithVolume"
  | "reportedPoolCount"
  | "peakDexCount"
> {
  return {
    id: SOLANA_CHAIN_ID,
    name: "Solana",
    shortName: "SOL",
    nativeChainId: "solana",
    sourceId: "solana",
    sourceLabel: "DexScreener (xStocks allowlist)",
    completenessPct: null,
    coverageNote:
      "Curated Backed xStock mints on Solana. Volume is the sum of DexScreener pair volume.h24 for returned pairs. Missing pair metrics stay missing.",
  };
}

export function buildSolanaSnapshot(input: {
  pairs: readonly DexScreenerPair[];
  mints: readonly SolanaAllowlistedMint[];
  fetchedAt: string;
}): {
  chain: ChainVolume;
  assets: AssetSummary[];
  details: AssetDetail[];
  provenance: DataProvenance;
} {
  const { assets, details } = mapDexScreenerPairsToSolanaAssets(input.pairs, input.mints);
  return {
    chain: rollupChainFromAssets(solanaChainMeta(), assets),
    assets,
    details,
    provenance: {
      sourceId: "solana",
      sourceLabel: "DexScreener (xStocks allowlist)",
      fetchedAt: input.fetchedAt,
      generatedAt: input.fetchedAt,
      refreshStartedAt: input.fetchedAt,
      refreshDurationMs: null,
      cacheStatus: "fresh",
      cacheAgeMs: 0,
      notes: [SOLANA_SOURCE_NOTE],
      sourceFailures: [],
    },
  };
}
