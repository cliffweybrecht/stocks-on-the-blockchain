import { robinhoodChainMeta, rollupChainFromAssets, sortByVolumeThenLiquidity } from "./aggregate";
import { asBoolean, asFiniteNumber, asNonEmptyString } from "./numbers";
import { defaultInstrumentFields } from "./volume-coverage";
import {
  ROBINHOOD_CHAIN_ID,
  type AssetDetail,
  type AssetSummary,
  type ChainVolume,
  type DataProvenance,
  type DexSlice,
  type LargestPoolMark,
  type PriceMarks,
  type QuoteAssetSlice,
  type SourceKind,
} from "./types";

interface TerminalAssetIdentity {
  symbol?: unknown;
  name?: unknown;
  contractAddress?: unknown;
  logoUrl?: unknown;
}

export interface TerminalMarketRow {
  asset?: TerminalAssetIdentity;
  displayedLiquidityUsd?: unknown;
  usdGLiquidityUsd?: unknown;
  poolCount?: unknown;
  dexCount?: unknown;
  observedVolume24h?: unknown;
  buys24h?: unknown;
  sells24h?: unknown;
  largestPoolLiquidityUsd?: unknown;
  top1ConcentrationPct?: unknown;
  top3ConcentrationPct?: unknown;
  top5ConcentrationPct?: unknown;
  liquidityCoverageComplete?: unknown;
  volume24hCoverageComplete?: unknown;
  robinhoodReferencePriceUsd?: unknown;
  dexLiquidityWeightedPriceUsd?: unknown;
  dexMedianPriceUsd?: unknown;
  premiumDiscountPct?: unknown;
  priceDispersionPct?: unknown;
  priceCoverageComplete?: unknown;
}

export interface TerminalSnapshot {
  generatedAt?: unknown;
  refreshStartedAt?: unknown;
  refreshDurationMs?: unknown;
  assetsRequested?: unknown;
  assetsSucceeded?: unknown;
  assetsFailed?: unknown;
  completeness?: { complete?: unknown; successPct?: unknown };
  rows?: unknown;
  failures?: unknown;
  price?: {
    available?: unknown;
    generatedAt?: unknown;
  };
}

export interface TerminalLiquidityEnvelope {
  data?: TerminalSnapshot;
  cache?: {
    status?: unknown;
    ageMs?: unknown;
    ttlMs?: unknown;
  };
}

export interface TerminalAssetLiquidityProfile {
  asset?: TerminalAssetIdentity;
  displayedLiquidityUsd?: unknown;
  usdGLiquidityUsd?: unknown;
  poolCount?: unknown;
  dexCount?: unknown;
  largestPool?: {
    dexId?: unknown;
    pairAddress?: unknown;
    liquidityUsd?: unknown;
    shareOfDisplayedLiquidityPct?: unknown;
  } | null;
  concentration?: {
    top1Pct?: unknown;
    top3Pct?: unknown;
    top5Pct?: unknown;
  };
  quoteAssets?: unknown;
  dexes?: unknown;
  activity?: {
    volume24h?: unknown;
    buys24h?: unknown;
    sells24h?: unknown;
  };
}

export interface TerminalPriceComparison {
  asset?: TerminalAssetIdentity;
  robinhood?: {
    rawUnderlyingBidUsd?: unknown;
    rawUnderlyingAskUsd?: unknown;
    referencePriceUsd?: unknown;
    isTradingHalt?: unknown;
    generatedAt?: unknown;
  };
  dex?: {
    largestPoolPriceUsd?: unknown;
    liquidityWeightedPriceUsd?: unknown;
    medianPriceUsd?: unknown;
    priceDispersionPct?: unknown;
    priceCoverage?: { complete?: unknown };
  };
  comparison?: {
    medianPremiumDiscountPct?: unknown;
  };
}

function readRows(snapshot: TerminalSnapshot): TerminalMarketRow[] {
  if (!Array.isArray(snapshot.rows)) return [];
  return snapshot.rows.filter((row): row is TerminalMarketRow => typeof row === "object" && row !== null);
}

export function unwrapSnapshot(payload: unknown): {
  snapshot: TerminalSnapshot;
  cacheStatus: string | null;
  cacheAgeMs: number | null;
} {
  if (!payload || typeof payload !== "object") {
    throw new Error("Terminal response was empty or not an object.");
  }
  const envelope = payload as TerminalLiquidityEnvelope;
  const snapshot = (envelope.data ?? payload) as TerminalSnapshot;
  if (!snapshot || typeof snapshot !== "object") {
    throw new Error("Terminal response did not include a market snapshot.");
  }
  return {
    snapshot,
    cacheStatus: asNonEmptyString(envelope.cache?.status),
    cacheAgeMs: asFiniteNumber(envelope.cache?.ageMs),
  };
}

export function mapTerminalRowToAsset(row: TerminalMarketRow): AssetSummary | null {
  const symbol = asNonEmptyString(row.asset?.symbol)?.toUpperCase();
  const contractAddress = asNonEmptyString(row.asset?.contractAddress);
  if (!symbol || !contractAddress) return null;

  return {
    chainId: ROBINHOOD_CHAIN_ID,
    sourceId: "terminal",
    sourceLabel: "Robinhood Liquidity Terminal",
    symbol,
    name: asNonEmptyString(row.asset?.name) ?? symbol,
    contractAddress,
    issuer: null,
    logoUrl: asNonEmptyString(row.asset?.logoUrl),
    volume24hUsd: asFiniteNumber(row.observedVolume24h),
    displayedLiquidityUsd: asFiniteNumber(row.displayedLiquidityUsd),
    usdGLiquidityUsd: asFiniteNumber(row.usdGLiquidityUsd),
    poolCount: asFiniteNumber(row.poolCount) ?? 0,
    dexCount: asFiniteNumber(row.dexCount) ?? 0,
    pools: [],
    robinhoodReferencePriceUsd: asFiniteNumber(row.robinhoodReferencePriceUsd),
    dexMedianPriceUsd: asFiniteNumber(row.dexMedianPriceUsd),
    premiumDiscountPct: asFiniteNumber(row.premiumDiscountPct),
    top3ConcentrationPct: asFiniteNumber(row.top3ConcentrationPct),
    liquidityCoverageComplete: asBoolean(row.liquidityCoverageComplete),
    volume24hCoverageComplete: asBoolean(row.volume24hCoverageComplete),
    ...defaultInstrumentFields({
      volume24hUsd: asFiniteNumber(row.observedVolume24h),
      poolCount: asFiniteNumber(row.poolCount) ?? 0,
    }),
  };
}

export function mapTerminalRowToDetail(row: TerminalMarketRow): AssetDetail | null {
  const summary = mapTerminalRowToAsset(row);
  if (!summary) return null;

  const price: PriceMarks = {
    robinhoodReferenceUsd: asFiniteNumber(row.robinhoodReferencePriceUsd),
    robinhoodBidUsd: null,
    robinhoodAskUsd: null,
    robinhoodGeneratedAt: null,
    isTradingHalt: null,
    dexMedianUsd: asFiniteNumber(row.dexMedianPriceUsd),
    dexLiquidityWeightedUsd: asFiniteNumber(row.dexLiquidityWeightedPriceUsd),
    dexLargestPoolUsd: null,
    premiumDiscountPct: asFiniteNumber(row.premiumDiscountPct),
    priceDispersionPct: asFiniteNumber(row.priceDispersionPct),
    priceCoverageComplete: asBoolean(row.priceCoverageComplete),
  };

  return {
    ...summary,
    buys24h: asFiniteNumber(row.buys24h),
    sells24h: asFiniteNumber(row.sells24h),
    largestPool:
      asFiniteNumber(row.largestPoolLiquidityUsd) !== null
        ? {
            dexId: "largest-reported",
            pairAddress: "",
            liquidityUsd: asFiniteNumber(row.largestPoolLiquidityUsd) as number,
            shareOfDisplayedLiquidityPct: asFiniteNumber(row.top1ConcentrationPct),
          }
        : null,
    concentration: {
      top1Pct: asFiniteNumber(row.top1ConcentrationPct),
      top3Pct: asFiniteNumber(row.top3ConcentrationPct),
      top5Pct: asFiniteNumber(row.top5ConcentrationPct),
    },
    dexes: [],
    quoteAssets: [],
    price,
    detailEnriched: false,
    marketCapUsd: null,
    fdvUsd: null,
    priceChange24hPct: null,
    holderCount: null,
    circulatingSupply: null,
    totalSupply: null,
  };
}

function mapDexes(value: unknown): DexSlice[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    const dexId = asNonEmptyString(row.dexId);
    if (!dexId) return [];
    return [
      {
        dexId,
        displayedLiquidityUsd: asFiniteNumber(row.displayedLiquidityUsd),
        shareOfDisplayedLiquidityPct: asFiniteNumber(row.shareOfDisplayedLiquidityPct),
        poolCount: asFiniteNumber(row.poolCount) ?? 0,
      },
    ];
  });
}

function mapQuoteAssets(value: unknown): QuoteAssetSlice[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    const address = asNonEmptyString(row.address);
    if (!address) return [];
    return [
      {
        address,
        symbol: asNonEmptyString(row.symbol) ?? "—",
        symbolConflict: asBoolean(row.symbolConflict) ?? false,
        displayedLiquidityUsd: asFiniteNumber(row.displayedLiquidityUsd),
        shareOfDisplayedLiquidityPct: asFiniteNumber(row.shareOfDisplayedLiquidityPct),
        poolCount: asFiniteNumber(row.poolCount) ?? 0,
      },
    ];
  });
}

export function enrichDetailFromTerminal(
  base: AssetDetail,
  profile: TerminalAssetLiquidityProfile | null,
  comparison: TerminalPriceComparison | null,
): AssetDetail {
  let next: AssetDetail = { ...base, price: { ...base.price }, concentration: { ...base.concentration } };

  if (profile) {
    const largest = profile.largestPool;
    const largestPool: LargestPoolMark | null =
      largest && asFiniteNumber(largest.liquidityUsd) !== null
        ? {
            dexId: asNonEmptyString(largest.dexId) ?? "unknown",
            pairAddress: asNonEmptyString(largest.pairAddress) ?? "",
            liquidityUsd: asFiniteNumber(largest.liquidityUsd) as number,
            shareOfDisplayedLiquidityPct: asFiniteNumber(largest.shareOfDisplayedLiquidityPct),
          }
        : base.largestPool;

    next = {
      ...next,
      displayedLiquidityUsd: asFiniteNumber(profile.displayedLiquidityUsd) ?? next.displayedLiquidityUsd,
      usdGLiquidityUsd: asFiniteNumber(profile.usdGLiquidityUsd) ?? next.usdGLiquidityUsd,
      poolCount: asFiniteNumber(profile.poolCount) ?? next.poolCount,
      dexCount: asFiniteNumber(profile.dexCount) ?? next.dexCount,
      volume24hUsd: asFiniteNumber(profile.activity?.volume24h) ?? next.volume24hUsd,
      buys24h: asFiniteNumber(profile.activity?.buys24h) ?? next.buys24h,
      sells24h: asFiniteNumber(profile.activity?.sells24h) ?? next.sells24h,
      largestPool,
      concentration: {
        top1Pct: asFiniteNumber(profile.concentration?.top1Pct) ?? next.concentration.top1Pct,
        top3Pct: asFiniteNumber(profile.concentration?.top3Pct) ?? next.concentration.top3Pct,
        top5Pct: asFiniteNumber(profile.concentration?.top5Pct) ?? next.concentration.top5Pct,
      },
      dexes: mapDexes(profile.dexes),
      quoteAssets: mapQuoteAssets(profile.quoteAssets),
      detailEnriched: true,
    };
  }

  if (comparison) {
    next = {
      ...next,
      detailEnriched: true,
      robinhoodReferencePriceUsd:
        asFiniteNumber(comparison.robinhood?.referencePriceUsd) ?? next.robinhoodReferencePriceUsd,
      dexMedianPriceUsd: asFiniteNumber(comparison.dex?.medianPriceUsd) ?? next.dexMedianPriceUsd,
      premiumDiscountPct:
        asFiniteNumber(comparison.comparison?.medianPremiumDiscountPct) ?? next.premiumDiscountPct,
      price: {
        ...next.price,
        robinhoodReferenceUsd:
          asFiniteNumber(comparison.robinhood?.referencePriceUsd) ?? next.price.robinhoodReferenceUsd,
        robinhoodBidUsd: asFiniteNumber(comparison.robinhood?.rawUnderlyingBidUsd),
        robinhoodAskUsd: asFiniteNumber(comparison.robinhood?.rawUnderlyingAskUsd),
        robinhoodGeneratedAt: asNonEmptyString(comparison.robinhood?.generatedAt),
        isTradingHalt: asBoolean(comparison.robinhood?.isTradingHalt),
        dexMedianUsd: asFiniteNumber(comparison.dex?.medianPriceUsd) ?? next.price.dexMedianUsd,
        dexLiquidityWeightedUsd:
          asFiniteNumber(comparison.dex?.liquidityWeightedPriceUsd) ?? next.price.dexLiquidityWeightedUsd,
        dexLargestPoolUsd: asFiniteNumber(comparison.dex?.largestPoolPriceUsd),
        premiumDiscountPct:
          asFiniteNumber(comparison.comparison?.medianPremiumDiscountPct) ?? next.price.premiumDiscountPct,
        priceDispersionPct: asFiniteNumber(comparison.dex?.priceDispersionPct) ?? next.price.priceDispersionPct,
        priceCoverageComplete: asBoolean(comparison.dex?.priceCoverage?.complete) ?? next.price.priceCoverageComplete,
      },
    };
  }

  return next;
}

export function mapTerminalSnapshot(input: {
  snapshot: TerminalSnapshot;
  cacheStatus: string | null;
  cacheAgeMs: number | null;
  fetchedAt: string;
  sourceId: SourceKind;
  sourceLabel: string;
  notes: string[];
}): {
  chain: ChainVolume;
  assets: AssetSummary[];
  details: AssetDetail[];
  provenance: DataProvenance;
} {
  const assets = sortByVolumeThenLiquidity(
    readRows(input.snapshot)
      .map(mapTerminalRowToAsset)
      .filter((row): row is AssetSummary => row !== null),
  );
  const details = readRows(input.snapshot)
    .map(mapTerminalRowToDetail)
    .filter((row): row is AssetDetail => row !== null);

  const completenessPct = asFiniteNumber(input.snapshot.completeness?.successPct);
  const chain = rollupChainFromAssets(
    {
      ...robinhoodChainMeta(),
      completenessPct,
      coverageNote:
        asBoolean(input.snapshot.completeness?.complete) === false
          ? `Partial Terminal snapshot: ${asFiniteNumber(input.snapshot.assetsSucceeded) ?? "?"} of ${asFiniteNumber(input.snapshot.assetsRequested) ?? "?"} assets succeeded.`
          : robinhoodChainMeta().coverageNote,
    },
    assets,
  );

  return {
    chain,
    assets,
    details,
    provenance: {
      sourceId: input.sourceId,
      sourceLabel: input.sourceLabel,
      fetchedAt: input.fetchedAt,
      generatedAt: asNonEmptyString(input.snapshot.generatedAt),
      refreshStartedAt: asNonEmptyString(input.snapshot.refreshStartedAt),
      refreshDurationMs: asFiniteNumber(input.snapshot.refreshDurationMs),
      cacheStatus: input.cacheStatus,
      cacheAgeMs: input.cacheAgeMs,
      notes: input.notes,
      sourceFailures: [],
    },
  };
}
