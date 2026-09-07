import { rollupChainFromAssets, sortByVolumeThenLiquidity } from "./aggregate";
import { asFiniteNumber, asNonEmptyString, compareNullableDesc } from "./numbers";
import { classifyTokenizedInstrument, tokenIdentityFromFields } from "./solana-classifier";
import type { DiscoveredEquityMint } from "./solana-discover";
import { SOLANA_SOURCE_LABEL, SOLANA_SOURCE_NOTE } from "./trust";
import { inferVolumeCoverage, volumeCoverageNote } from "./volume-coverage";
import {
  SOLANA_CHAIN_ID,
  type AssetDetail,
  type AssetPoolMark,
  type AssetSummary,
  type ChainVolume,
  type DataProvenance,
  type DexSlice,
  type InstrumentKind,
  type VolumeAggregation,
  type VolumeCoverage,
} from "./types";

export interface DexScreenerPair {
  chainId?: unknown;
  dexId?: unknown;
  pairAddress?: unknown;
  labels?: unknown;
  baseToken?: { address?: unknown; name?: unknown; symbol?: unknown; labels?: unknown };
  quoteToken?: { address?: unknown; name?: unknown; symbol?: unknown; labels?: unknown };
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

export function unwrapDexScreenerSearch(payload: unknown): DexScreenerPair[] {
  if (payload && typeof payload === "object" && "pairs" in payload) {
    const pairs = (payload as { pairs?: unknown }).pairs;
    if (pairs == null) return [];
    if (Array.isArray(pairs)) {
      return pairs.filter((row): row is DexScreenerPair => typeof row === "object" && row !== null);
    }
  }
  if (Array.isArray(payload)) {
    return payload.filter((row): row is DexScreenerPair => typeof row === "object" && row !== null);
  }
  throw new Error("DexScreener search response was not a pair list.");
}

function classifiedSide(token: DexScreenerPair["baseToken"]) {
  const identity = tokenIdentityFromFields({
    address: token?.address,
    symbol: token?.symbol,
    name: token?.name,
  });
  if (!identity) return null;
  const classified = classifyTokenizedInstrument(identity);
  if (classified.kind === "reject") return null;
  return {
    address: identity.address,
    symbol: asNonEmptyString(identity.symbol) ?? identity.address.slice(0, 8),
    name: asNonEmptyString(identity.name) ?? asNonEmptyString(identity.symbol) ?? identity.address,
    issuer: classified.issuer,
    kind: classified.kind,
    reason: classified.reason,
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

function pairPriceUsd(pair: DexScreenerPair): number | null {
  return asFiniteNumber(typeof pair.priceUsd === "string" ? Number(pair.priceUsd) : pair.priceUsd);
}

interface MintAccumulator {
  symbol: string;
  name: string;
  address: string;
  issuer: string | null;
  kind: InstrumentKind;
  volumes: number[];
  liquidities: number[];
  prices: number[];
  buys: number[];
  sells: number[];
  pairAddresses: Set<string>;
  pools: AssetPoolMark[];
  dexes: Map<string, { liquidity: number[]; poolCount: number }>;
  largestPool: { dexId: string; pairAddress: string; liquidityUsd: number } | null;
}

function emptyAccumulator(side: NonNullable<ReturnType<typeof classifiedSide>>): MintAccumulator {
  return {
    symbol: side.symbol,
    name: side.name,
    address: side.address,
    issuer: side.issuer,
    kind: side.kind,
    volumes: [],
    liquidities: [],
    prices: [],
    buys: [],
    sells: [],
    pairAddresses: new Set(),
    pools: [],
    dexes: new Map(),
    largestPool: null,
  };
}

function addPairToBucket(bucket: MintAccumulator, pair: DexScreenerPair) {
  const pairAddress = asNonEmptyString(pair.pairAddress);
  if (pairAddress && bucket.pairAddresses.has(pairAddress)) return;
  if (pairAddress) bucket.pairAddresses.add(pairAddress);

  const volume = asFiniteNumber(pair.volume?.h24);
  const liquidity = asFiniteNumber(pair.liquidity?.usd);
  const price = pairPriceUsd(pair);
  const buys = asFiniteNumber(pair.txns?.h24?.buys);
  const sells = asFiniteNumber(pair.txns?.h24?.sells);
  const dexId = asNonEmptyString(pair.dexId) ?? "unknown";

  if (volume !== null) bucket.volumes.push(volume);
  if (liquidity !== null) bucket.liquidities.push(liquidity);
  if (price !== null && price > 0) bucket.prices.push(price);
  if (buys !== null) bucket.buys.push(buys);
  if (sells !== null) bucket.sells.push(sells);

  bucket.pools.push({
    pairAddress: pairAddress ?? "",
    dexId,
    volume24hUsd: volume,
    liquidityUsd: liquidity,
    priceUsd: price,
  });

  const dex = bucket.dexes.get(dexId) ?? { liquidity: [], poolCount: 0 };
  if (liquidity !== null) dex.liquidity.push(liquidity);
  dex.poolCount += 1;
  bucket.dexes.set(dexId, dex);

  if (liquidity !== null && (bucket.largestPool === null || liquidity > bucket.largestPool.liquidityUsd)) {
    bucket.largestPool = { dexId, pairAddress: pairAddress ?? "", liquidityUsd: liquidity };
  }
}

export function mapDexScreenerPairsToSolanaAssets(
  pairs: readonly DexScreenerPair[],
): {
  assets: AssetSummary[];
  details: AssetDetail[];
  etfAssets: AssetSummary[];
  etfDetails: AssetDetail[];
} {
  const byMint = new Map<string, MintAccumulator>();

  for (const pair of pairs) {
    if (asNonEmptyString(pair.chainId) !== SOLANA_CHAIN_ID) continue;
    const sides = [classifiedSide(pair.baseToken), classifiedSide(pair.quoteToken)].filter(
      (side): side is NonNullable<ReturnType<typeof classifiedSide>> => side !== null,
    );
    if (sides.length === 0) continue;

    for (const side of sides) {
      const bucket = byMint.get(side.address) ?? emptyAccumulator(side);
      if (!bucket.issuer && side.issuer) bucket.issuer = side.issuer;
      addPairToBucket(bucket, pair);
      byMint.set(side.address, bucket);
    }
  }

  const details: AssetDetail[] = [];
  const summaries: AssetSummary[] = [];
  for (const bucket of byMint.values()) {
    const displayedLiquidityUsd =
      bucket.liquidities.length > 0 ? bucket.liquidities.reduce((sum, value) => sum + value, 0) : null;
    const volume24hUsd = bucket.volumes.length > 0 ? bucket.volumes.reduce((sum, value) => sum + value, 0) : null;
    const dexMedianUsd = median(bucket.prices);
    const pools = [...bucket.pools].sort((a, b) => {
      const volume = compareNullableDesc(a.volume24hUsd, b.volume24hUsd);
      if (volume !== 0) return volume;
      return compareNullableDesc(a.liquidityUsd, b.liquidityUsd);
    });
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

    const poolCount = bucket.pairAddresses.size || bucket.pools.length;
    const volumeCoverage: VolumeCoverage = inferVolumeCoverage({ volume24hUsd, poolCount });
    const summary: AssetSummary = {
      chainId: SOLANA_CHAIN_ID,
      sourceId: "solana",
      sourceLabel: SOLANA_SOURCE_LABEL,
      symbol: bucket.symbol,
      name: bucket.name,
      contractAddress: bucket.address,
      issuer: bucket.issuer,
      logoUrl: null,
      volume24hUsd,
      displayedLiquidityUsd,
      usdGLiquidityUsd: null,
      poolCount,
      dexCount: bucket.dexes.size,
      pools,
      robinhoodReferencePriceUsd: null,
      dexMedianPriceUsd: dexMedianUsd,
      premiumDiscountPct: null,
      top3ConcentrationPct: null,
      liquidityCoverageComplete: bucket.liquidities.length > 0,
      volume24hCoverageComplete: bucket.volumes.length > 0,
      instrumentKind: bucket.kind,
      volumeCoverage,
      coverageNote: null,
    };

    summaries.push(summary);
    details.push({
      ...summary,
      buys24h: bucket.buys.length > 0 ? bucket.buys.reduce((sum, value) => sum + value, 0) : null,
      sells24h: bucket.sells.length > 0 ? bucket.sells.reduce((sum, value) => sum + value, 0) : null,
      largestPool:
        bucket.largestPool !== null
          ? {
              dexId: bucket.largestPool.dexId,
              pairAddress: bucket.largestPool.pairAddress,
              liquidityUsd: bucket.largestPool.liquidityUsd,
              shareOfDisplayedLiquidityPct:
                displayedLiquidityUsd && displayedLiquidityUsd > 0
                  ? (bucket.largestPool.liquidityUsd / displayedLiquidityUsd) * 100
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
        dexLargestPoolUsd: bucket.largestPool !== null && dexMedianUsd !== null ? dexMedianUsd : null,
        premiumDiscountPct: null,
        priceDispersionPct: null,
        priceCoverageComplete: dexMedianUsd !== null,
      },
      detailEnriched: true,
    });
  }

  const equitySummaries = summaries.filter((row) => row.instrumentKind === "equity");
  const equityDetails = details.filter((row) => row.instrumentKind === "equity");
  const etfSummaries = summaries.filter((row) => row.instrumentKind === "etf");
  const etfDetails = details.filter((row) => row.instrumentKind === "etf");

  return {
    assets: sortByVolumeThenLiquidity(equitySummaries),
    details: sortByVolumeThenLiquidity(equityDetails),
    etfAssets: sortByVolumeThenLiquidity(etfSummaries),
    etfDetails: sortByVolumeThenLiquidity(etfDetails),
  };
}

export function solanaChainMeta(): Omit<
  ChainVolume,
  | "volume24hUsd"
  | "displayedLiquidityUsd"
  | "usdGLiquidityUsd"
  | "assetCount"
  | "assetsWithVolume"
  | "assetsWithPools"
  | "reportedPoolCount"
  | "peakDexCount"
> {
  return {
    id: SOLANA_CHAIN_ID,
    name: "Solana",
    shortName: "SOL",
    nativeChainId: "solana",
    sourceId: "solana",
    sourceLabel: SOLANA_SOURCE_LABEL,
    completenessPct: null,
    etfCount: 0,
    volumeAggregation: "all-pools",
    coverageNote:
      "Tokenized public equities discovered from the live xStocks public registry, the public Ondo GM mint list, and DexScreener search, then classified fail-closed. Volume is the sum of pair volume.h24 across every Solana pool for that mint. Coverage is as discoverable from those live sources + the classifier, not a full Solana indexer. Missing pair metrics stay missing — a dash is not zero. ETF/index products are catalogued separately and are not mixed into equity ranking.",
  };
}

export function unpairedSolanaAsset(
  row: DiscoveredEquityMint,
  options: {
    failedMints?: ReadonlySet<string>;
    incompleteMints?: ReadonlySet<string>;
    aggregation?: VolumeAggregation;
  } = {},
): AssetDetail {
  const volumeCoverage = inferVolumeCoverage({
    volume24hUsd: null,
    poolCount: 0,
    hydrateFailed: options.failedMints?.has(row.mint) ?? false,
    hydrateIncomplete: options.incompleteMints?.has(row.mint) ?? false,
  });
  const summary: AssetSummary = {
    chainId: SOLANA_CHAIN_ID,
    sourceId: "solana",
    sourceLabel: SOLANA_SOURCE_LABEL,
    symbol: row.symbol ?? row.mint.slice(0, 8),
    name: row.name ?? row.symbol ?? row.mint,
    contractAddress: row.mint,
    issuer: row.issuer,
    logoUrl: null,
    volume24hUsd: null,
    displayedLiquidityUsd: null,
    usdGLiquidityUsd: null,
    poolCount: 0,
    dexCount: 0,
    pools: [],
    robinhoodReferencePriceUsd: null,
    dexMedianPriceUsd: null,
    premiumDiscountPct: null,
    top3ConcentrationPct: null,
    liquidityCoverageComplete: false,
    volume24hCoverageComplete: false,
    instrumentKind: row.kind ?? "equity",
    volumeCoverage,
    coverageNote: volumeCoverageNote(volumeCoverage, {
      poolCount: 0,
      volume24hUsd: null,
      aggregation: options.aggregation ?? "all-pools",
    }),
  };
  return {
    ...summary,
    buys24h: null,
    sells24h: null,
    largestPool: null,
    concentration: { top1Pct: null, top3Pct: null, top5Pct: null },
    dexes: [],
    quoteAssets: [],
    price: {
      robinhoodReferenceUsd: null,
      robinhoodBidUsd: null,
      robinhoodAskUsd: null,
      robinhoodGeneratedAt: null,
      isTradingHalt: null,
      dexMedianUsd: null,
      dexLiquidityWeightedUsd: null,
      dexLargestPoolUsd: null,
      premiumDiscountPct: null,
      priceDispersionPct: null,
      priceCoverageComplete: false,
    },
    detailEnriched: true,
  };
}

function annotateMappedCoverage(
  rows: AssetDetail[],
  aggregation: VolumeAggregation,
): AssetDetail[] {
  return rows.map((row) => {
    const coverageNote = volumeCoverageNote(row.volumeCoverage, {
      poolCount: row.poolCount,
      volume24hUsd: row.volume24hUsd,
      aggregation,
    });
    return { ...row, coverageNote };
  });
}

export function mergeUnpairedSolanaAssets(
  mapped: { assets: AssetSummary[]; details: AssetDetail[] },
  discovered: readonly DiscoveredEquityMint[],
  options: {
    failedMints?: ReadonlySet<string>;
    incompleteMints?: ReadonlySet<string>;
    aggregation?: VolumeAggregation;
  } = {},
): { assets: AssetSummary[]; details: AssetDetail[] } {
  const seen = new Set(mapped.details.map((row) => row.contractAddress));
  const extras = discovered.filter((row) => !seen.has(row.mint)).map((row) => unpairedSolanaAsset(row, options));
  const details = sortByVolumeThenLiquidity(annotateMappedCoverage([...mapped.details, ...extras], options.aggregation ?? "all-pools"));
  const assets = sortByVolumeThenLiquidity(details);
  return { assets, details };
}

export function buildSolanaSnapshot(input: {
  pairs: readonly DexScreenerPair[];
  fetchedAt: string;
  discovered?: readonly DiscoveredEquityMint[];
  discoveredEtfs?: readonly DiscoveredEquityMint[];
  extraNotes?: readonly string[];
  failedMints?: ReadonlySet<string>;
  incompleteMints?: ReadonlySet<string>;
  aggregation?: VolumeAggregation;
  refreshDurationMs?: number | null;
  cacheStatus?: string | null;
  cacheAgeMs?: number | null;
}): {
  chain: ChainVolume;
  assets: AssetSummary[];
  details: AssetDetail[];
  etfAssets: AssetSummary[];
  etfDetails: AssetDetail[];
  provenance: DataProvenance;
} {
  const aggregation = input.aggregation ?? "all-pools";
  const mapped = mapDexScreenerPairsToSolanaAssets(input.pairs);
  const equities = mergeUnpairedSolanaAssets(
    { assets: mapped.assets, details: mapped.details },
    (input.discovered ?? []).filter((row) => row.kind !== "etf"),
    {
      failedMints: input.failedMints,
      incompleteMints: input.incompleteMints,
      aggregation,
    },
  );
  const etfs = mergeUnpairedSolanaAssets(
    { assets: mapped.etfAssets, details: mapped.etfDetails },
    input.discoveredEtfs ?? (input.discovered ?? []).filter((row) => row.kind === "etf"),
    {
      failedMints: input.failedMints,
      incompleteMints: input.incompleteMints,
      aggregation,
    },
  );
  const classified = equities.assets.length;
  const withVolume = equities.assets.filter((asset) => asset.volume24hUsd !== null).length;
  const withPools = equities.assets.filter((asset) => asset.poolCount > 0).length;
  const meta = solanaChainMeta();
  const coverageNote =
    `${meta.coverageNote} This snapshot: ${classified} classified equities, ${withVolume} with reported DexScreener volume, ${withPools} with indexed pools. ` +
    (aggregation === "primary-pair"
      ? "Home rollup uses DexScreener primary-pair volume per mint; the chain page aggregates every Solana pool."
      : "Chain ranking uses aggregate volume across every returned Solana pool for that mint.") +
    (etfs.assets.length > 0 ? ` ${etfs.assets.length} ETF/index products are listed separately and are not in the equity ranking.` : "");

  return {
    chain: rollupChainFromAssets({ ...meta, coverageNote }, equities.assets, {
      etfCount: etfs.assets.length,
      volumeAggregation: aggregation,
    }),
    assets: equities.assets,
    details: equities.details,
    etfAssets: etfs.assets,
    etfDetails: etfs.details,
    provenance: {
      sourceId: "solana",
      sourceLabel: SOLANA_SOURCE_LABEL,
      fetchedAt: input.fetchedAt,
      generatedAt: input.fetchedAt,
      refreshStartedAt: input.fetchedAt,
      refreshDurationMs: input.refreshDurationMs ?? null,
      cacheStatus: input.cacheStatus ?? "fresh",
      cacheAgeMs: input.cacheAgeMs ?? 0,
      notes: [SOLANA_SOURCE_NOTE, ...(input.extraNotes ?? [])],
      sourceFailures: [],
    },
  };
}
