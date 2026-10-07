import { sortByVolumeThenLiquidity } from "./aggregate";
import type { DexScreenerPair } from "./map-solana";
import {
  asHttpUrl,
  asNonEmptyString,
  asNonNegativeNumber,
  asReportedNumber,
  compareNullableDesc,
} from "./numbers";
import { inferVolumeCoverage } from "./volume-coverage";
import {
  ROBINHOOD_CHAIN_ID,
  type AssetDetail,
  type AssetPoolMark,
  type AssetSummary,
  type DexSlice,
  type InstrumentKind,
  type QuoteAssetSlice,
} from "./types";

/** Verified issuer. Robinhood Assets Jersey registry rows only. */
export const RHJ_ISSUER_LABEL = "RHJ";

/**
 * Chain 4663 tokens whose on-chain name says Ondo.
 * This is not the official Ondo issuer and must not be labeled "Ondo".
 */
export const ONDO_NAMED_UNVERIFIED_LABEL = "Ondo-named (unverified)";

export const ROBINHOOD_DEX_CHAIN_SLUG = "robinhood";

export const ROBINHOOD_MARKETS_SOURCE_LABEL = "DexScreener · Robinhood Chain";

export const ROBINHOOD_MARKETS_NOTE =
  "Robinhood Chain names are the public RHJ registry plus Ondo-named tokens DexScreener search returned on chain 4663. Ondo-named (unverified) is not official Ondo. Rialto, launchpad xStock and PreStocks, Backpack lookalikes, Arcus, and HOODon/BMNRon/CPERon are excluded. Card volume is the sum of DexScreener volume.h24 across unique pools. A missing figure stays missing.";

/** DexScreener search probes. Capped and noisy — not an admission list. */
export const ROBINHOOD_ONDO_SEARCH_QUERIES = [
  "Tokenized Stock (Ondo)",
  "Tokenized ETF (Ondo)",
  "Tokenized Fund (Ondo)",
  "(Ondo Tokenized)",
  "SpaceX Tokenized Stock (Ondo)",
] as const;

const JUNK_SYMBOLS = new Set(["hoodon", "bmnron", "cperon"]);

const JUNK_NAME =
  /\brialto\b|\bxstocks?\b|\bprestocks?\b|\barcus\b|\bbackpack\b|\bbstocks?\b|\(reality\)|\breality tokenized\b/i;

const ONDO_NAME =
  /tokenized stock \(ondo\)|tokenized (?:etf|fund) \(ondo\)|\(ondo tokenized\)/i;

export interface RobinhoodListedToken {
  address: string;
  symbol: string;
  name: string;
  issuer: typeof RHJ_ISSUER_LABEL | typeof ONDO_NAMED_UNVERIFIED_LABEL;
  kind: InstrumentKind;
  logoUrl: string | null;
}

export function isRobinhoodDexChain(chainId: unknown): boolean {
  const value = asNonEmptyString(chainId)?.toLowerCase();
  return value === ROBINHOOD_DEX_CHAIN_SLUG || value === "4663";
}

/** Launchpad copycats and named junk. Official RHJ tickers such as ON stay. */
export function isRobinhoodChainJunk(symbol: string, name: string): boolean {
  const sym = symbol.trim().toLowerCase();
  if (JUNK_SYMBOLS.has(sym)) return true;
  return JUNK_NAME.test(`${symbol} ${name}`);
}

/** ETF/index before private. Word boundaries keep Netflix from matching "etf". */
export function classifyRobinhoodInstrument(name: string): InstrumentKind {
  if (
    /\betf\b/i.test(name) ||
    /\bfund\b/i.test(name) ||
    /\btrust\b/i.test(name) ||
    /^ishares\b/i.test(name.trim()) ||
    /^invesco qqq\b/i.test(name.trim()) ||
    /\btokenized etf\b/i.test(name) ||
    /\btokenized fund\b/i.test(name)
  ) {
    return "etf";
  }
  if (
    /\bspace exploration technologies\b/i.test(name) ||
    /\bspacex\b/i.test(name) ||
    /\bpre-ipo\b/i.test(name) ||
    /\bpreipo\b/i.test(name)
  ) {
    return "private";
  }
  return "equity";
}

/**
 * Admit only a single Ondo-named stock, ETF, or fund.
 * A concatenated DexScreener mega-token that mentions Ondo in passing is not a name.
 */
export function isAdmittedOndoName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 160) return false;
  const tokenizedHits = trimmed.match(/tokenized/gi)?.length ?? 0;
  if (tokenizedHits > 2) return false;
  if (isRobinhoodChainJunk("", trimmed)) return false;
  return ONDO_NAME.test(trimmed);
}

export function parseRhjRegistry(payload: unknown): RobinhoodListedToken[] {
  if (!payload || typeof payload !== "object") return [];
  const list = (payload as { assets?: unknown }).assets;
  if (!Array.isArray(list)) return [];
  const byAddress = new Map<string, RobinhoodListedToken>();
  for (const row of list) {
    const token = rhjRowToToken(row);
    if (!token) continue;
    byAddress.set(token.address.toLowerCase(), token);
  }
  return [...byAddress.values()];
}

export function ondoTokensFromPairs(pairs: readonly DexScreenerPair[]): RobinhoodListedToken[] {
  const byAddress = new Map<string, RobinhoodListedToken>();
  for (const pair of pairs) {
    if (!isRobinhoodDexChain(pair.chainId)) continue;
    for (const side of [pair.baseToken, pair.quoteToken]) {
      const token = ondoSideToToken(side);
      if (!token) continue;
      const key = token.address.toLowerCase();
      if (!byAddress.has(key)) byAddress.set(key, token);
    }
  }
  return [...byAddress.values()];
}

/** RHJ wins when the same contract shows up in an Ondo search hit. */
export function mergeRobinhoodTokens(
  rhj: readonly RobinhoodListedToken[],
  ondo: readonly RobinhoodListedToken[],
): RobinhoodListedToken[] {
  const byAddress = new Map<string, RobinhoodListedToken>();
  for (const token of ondo) byAddress.set(token.address.toLowerCase(), token);
  for (const token of rhj) byAddress.set(token.address.toLowerCase(), token);
  return [...byAddress.values()];
}

export interface RobinhoodMarketLanes {
  assets: AssetSummary[];
  etfAssets: AssetSummary[];
  privateAssets: AssetSummary[];
  details: AssetDetail[];
}

export function buildRobinhoodMarketLanes(
  tokens: readonly RobinhoodListedToken[],
  pairs: readonly DexScreenerPair[],
  options?: { volumeHydrated?: boolean },
): RobinhoodMarketLanes {
  const volumeHydrated = options?.volumeHydrated !== false;
  const byAddress = new Map<string, RobinhoodListedToken>();
  for (const token of tokens) byAddress.set(token.address.toLowerCase(), token);

  const buckets = new Map<string, PairBucket>();
  for (const pair of pairs) {
    if (!isRobinhoodDexChain(pair.chainId)) continue;
    const pairAddress = asNonEmptyString(pair.pairAddress)?.toLowerCase();
    if (!pairAddress) continue;
    for (const side of [pair.baseToken, pair.quoteToken]) {
      const address = asNonEmptyString(side?.address)?.toLowerCase();
      if (!address) continue;
      const token = byAddress.get(address);
      if (!token) continue;
      const bucket = buckets.get(address) ?? emptyBucket();
      if (bucket.pairAddresses.has(pairAddress)) {
        buckets.set(address, bucket);
        continue;
      }
      addPair(bucket, pair, token.address, pairAddress);
      buckets.set(address, bucket);
    }
  }

  const details: AssetDetail[] = [];
  for (const token of byAddress.values()) {
    const bucket = buckets.get(token.address.toLowerCase()) ?? emptyBucket();
    details.push(toDetail(token, bucket, volumeHydrated));
  }

  const summaries = details.map(toSummary);
  return {
    assets: sortByVolumeThenLiquidity(summaries.filter((row) => row.instrumentKind === "equity")),
    etfAssets: sortByVolumeThenLiquidity(summaries.filter((row) => row.instrumentKind === "etf")),
    privateAssets: sortByVolumeThenLiquidity(summaries.filter((row) => row.instrumentKind === "private")),
    details: sortByVolumeThenLiquidity(details),
  };
}

export function findRobinhoodDetail(
  details: readonly AssetDetail[],
  key: string,
): AssetDetail | undefined {
  const needle = key.trim().toLowerCase();
  if (!needle) return undefined;
  const byAddress = details.find((row) => row.contractAddress.toLowerCase() === needle);
  if (byAddress) return byAddress;
  const bySymbol = details.filter((row) => row.symbol.toLowerCase() === needle);
  return bySymbol.length === 1 ? bySymbol[0] : undefined;
}

/** Keep Terminal reference marks when the same contract was discovered on DexScreener. */
export function overlayTerminalReference<T extends AssetSummary>(
  rows: readonly T[],
  terminal: readonly AssetSummary[],
): T[] {
  if (terminal.length === 0) return [...rows];
  const byAddress = new Map(terminal.map((row) => [row.contractAddress.toLowerCase(), row]));
  return rows.map((row) => {
    const extra = byAddress.get(row.contractAddress.toLowerCase());
    if (!extra) return row;
    return {
      ...row,
      robinhoodReferencePriceUsd: row.robinhoodReferencePriceUsd ?? extra.robinhoodReferencePriceUsd,
      premiumDiscountPct: row.premiumDiscountPct ?? extra.premiumDiscountPct,
    };
  });
}

/**
 * Terminal rows are a fallback list when DexScreener discovery did not load.
 * Junk is still dropped. Ondo-named rows stay unverified.
 */
export function robinhoodLanesFromTerminal(rows: readonly AssetSummary[]): RobinhoodMarketLanes {
  const details: AssetDetail[] = [];
  for (const row of rows) {
    if (row.chainId !== ROBINHOOD_CHAIN_ID) continue;
    if (isRobinhoodChainJunk(row.symbol, row.name)) continue;
    const issuer = isAdmittedOndoName(row.name)
      ? ONDO_NAMED_UNVERIFIED_LABEL
      : /\brobinhood token\b/i.test(row.name)
        ? RHJ_ISSUER_LABEL
        : row.issuer;
    const summary: AssetSummary = {
      ...row,
      issuer,
      instrumentKind: classifyRobinhoodInstrument(row.name),
    };
    details.push(summaryToShellDetail(summary));
  }
  const sorted = sortByVolumeThenLiquidity(details);
  return {
    assets: sorted.filter((row) => row.instrumentKind === "equity"),
    etfAssets: sorted.filter((row) => row.instrumentKind === "etf"),
    privateAssets: sorted.filter((row) => row.instrumentKind === "private"),
    details: sorted,
  };
}

interface PairBucket {
  pairAddresses: Set<string>;
  volumes: number[];
  liquidities: number[];
  usdGLiquidities: number[];
  pools: AssetPoolMark[];
  buys: number[];
  sells: number[];
  dexes: Map<string, { liquidity: number[]; poolCount: number }>;
  quotes: Map<string, { symbol: string; liquidity: number[]; poolCount: number }>;
  bestVolume: number;
  spotPriceUsd: number | null;
  priceChange24hPct: number | null;
  largestPool: { dexId: string; pairAddress: string; liquidityUsd: number } | null;
  logoUrl: string | null;
}

function emptyBucket(): PairBucket {
  return {
    pairAddresses: new Set(),
    volumes: [],
    liquidities: [],
    usdGLiquidities: [],
    pools: [],
    buys: [],
    sells: [],
    dexes: new Map(),
    quotes: new Map(),
    bestVolume: -1,
    spotPriceUsd: null,
    priceChange24hPct: null,
    largestPool: null,
    logoUrl: null,
  };
}

function addPair(bucket: PairBucket, pair: DexScreenerPair, tokenAddress: string, pairAddress: string) {
  bucket.pairAddresses.add(pairAddress);
  const volume = asNonNegativeNumber(pair.volume?.h24);
  const liquidity = asNonNegativeNumber(pair.liquidity?.usd);
  const price = asNonNegativeNumber(pair.priceUsd);
  const buys = asNonNegativeNumber(pair.txns?.h24?.buys);
  const sells = asNonNegativeNumber(pair.txns?.h24?.sells);
  if (volume !== null) bucket.volumes.push(volume);
  if (liquidity !== null) bucket.liquidities.push(liquidity);
  if (buys !== null) bucket.buys.push(buys);
  if (sells !== null) bucket.sells.push(sells);

  const baseAddress = asNonEmptyString(pair.baseToken?.address);
  const listedIsBase = baseAddress?.toLowerCase() === tokenAddress.toLowerCase();
  const quoteAddress = asNonEmptyString(pair.quoteToken?.address);
  const quoteSymbol = asNonEmptyString(listedIsBase ? pair.quoteToken?.symbol : pair.baseToken?.symbol);
  if (quoteSymbol?.toUpperCase() === "USDG" && liquidity !== null) bucket.usdGLiquidities.push(liquidity);
  if (quoteAddress && quoteSymbol) {
    const key = quoteAddress.toLowerCase();
    const quote = bucket.quotes.get(key) ?? { symbol: quoteSymbol, liquidity: [], poolCount: 0 };
    if (liquidity !== null) quote.liquidity.push(liquidity);
    quote.poolCount += 1;
    bucket.quotes.set(key, quote);
  }

  const dexId = asNonEmptyString(pair.dexId) ?? "unknown";
  const dex = bucket.dexes.get(dexId) ?? { liquidity: [], poolCount: 0 };
  if (liquidity !== null) dex.liquidity.push(liquidity);
  dex.poolCount += 1;
  bucket.dexes.set(dexId, dex);

  if (liquidity !== null && (bucket.largestPool === null || liquidity > bucket.largestPool.liquidityUsd)) {
    bucket.largestPool = { dexId, pairAddress, liquidityUsd: liquidity };
  }

  const rank = volume ?? -1;
  if (price !== null && price > 0 && rank >= bucket.bestVolume) {
    bucket.bestVolume = rank;
    bucket.spotPriceUsd = price;
    bucket.priceChange24hPct = asReportedNumber(pair.priceChange?.h24);
  }

  const logo = listedIsBase ? asHttpUrl(pair.info?.imageUrl) : null;
  if (logo && !bucket.logoUrl) bucket.logoUrl = logo;

  const pool: AssetPoolMark = {
    pairAddress,
    dexId,
    volume24hUsd: volume,
    liquidityUsd: liquidity,
    priceUsd: price,
    baseSymbol: asNonEmptyString(pair.baseToken?.symbol),
    quoteSymbol: asNonEmptyString(pair.quoteToken?.symbol),
    baseName: asNonEmptyString(pair.baseToken?.name),
    quoteName: asNonEmptyString(pair.quoteToken?.name),
    baseAddress,
    quoteAddress,
    baseLogoUrl: listedIsBase ? asHttpUrl(pair.info?.imageUrl) : null,
    quoteLogoUrl: null,
    url: asHttpUrl(pair.url),
    labels: pairLabels(pair.labels),
    trades24h: buys !== null && sells !== null ? buys + sells : null,
    wallets24h: null,
    pairHolderCount: null,
    pairCreatedAt: null,
    tradesChange24hPct: null,
    walletsChange24hPct: null,
  };
  bucket.pools.push(pool);
}

function toDetail(token: RobinhoodListedToken, bucket: PairBucket, volumeHydrated: boolean): AssetDetail {
  const volume24hUsd = bucket.volumes.length > 0 ? bucket.volumes.reduce((sum, value) => sum + value, 0) : null;
  const displayedLiquidityUsd =
    bucket.liquidities.length > 0 ? bucket.liquidities.reduce((sum, value) => sum + value, 0) : null;
  const usdGLiquidityUsd =
    bucket.usdGLiquidities.length > 0 ? bucket.usdGLiquidities.reduce((sum, value) => sum + value, 0) : null;
  const poolCount = bucket.pairAddresses.size;
  const volumeCoverage = inferVolumeCoverage({
    volume24hUsd,
    poolCount,
    hydrateFailed: !volumeHydrated && poolCount === 0 && volume24hUsd === null,
  });
  const pools = [...bucket.pools].sort((a, b) => {
    const byVolume = compareNullableDesc(a.volume24hUsd, b.volume24hUsd);
    if (byVolume !== 0) return byVolume;
    return compareNullableDesc(a.liquidityUsd, b.liquidityUsd);
  });
  const dexes = dexSlices(bucket, displayedLiquidityUsd);
  const quoteAssets = quoteSlices(bucket, displayedLiquidityUsd);
  const summary: AssetSummary = {
    chainId: ROBINHOOD_CHAIN_ID,
    sourceId: "robinhood",
    sourceLabel: ROBINHOOD_MARKETS_SOURCE_LABEL,
    symbol: token.symbol,
    name: token.name,
    contractAddress: token.address,
    issuer: token.issuer,
    logoUrl: token.logoUrl ?? bucket.logoUrl,
    volume24hUsd,
    displayedLiquidityUsd,
    usdGLiquidityUsd,
    poolCount,
    dexCount: bucket.dexes.size,
    pools,
    robinhoodReferencePriceUsd: null,
    dexMedianPriceUsd: bucket.spotPriceUsd,
    premiumDiscountPct: null,
    top3ConcentrationPct: null,
    liquidityCoverageComplete: bucket.liquidities.length > 0,
    volume24hCoverageComplete: bucket.volumes.length > 0,
    instrumentKind: token.kind,
    volumeCoverage,
    coverageNote: null,
    priceChange24hPct: bucket.priceChange24hPct,
  };
  return {
    ...summary,
    buys24h: bucket.buys.length > 0 ? bucket.buys.reduce((sum, value) => sum + value, 0) : null,
    sells24h: bucket.sells.length > 0 ? bucket.sells.reduce((sum, value) => sum + value, 0) : null,
    largestPool: bucket.largestPool
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
    quoteAssets,
    price: {
      robinhoodReferenceUsd: null,
      robinhoodBidUsd: null,
      robinhoodAskUsd: null,
      robinhoodGeneratedAt: null,
      isTradingHalt: null,
      dexMedianUsd: bucket.spotPriceUsd,
      dexLiquidityWeightedUsd: null,
      dexLargestPoolUsd: bucket.spotPriceUsd,
      premiumDiscountPct: null,
      priceDispersionPct: null,
      priceCoverageComplete: bucket.spotPriceUsd !== null,
    },
    detailEnriched: true,
    marketCapUsd: null,
    fdvUsd: null,
    holderCount: null,
    circulatingSupply: null,
    totalSupply: null,
  };
}

function toSummary(detail: AssetDetail): AssetSummary {
  return {
    chainId: detail.chainId,
    sourceId: detail.sourceId,
    sourceLabel: detail.sourceLabel,
    symbol: detail.symbol,
    name: detail.name,
    contractAddress: detail.contractAddress,
    issuer: detail.issuer,
    logoUrl: detail.logoUrl,
    volume24hUsd: detail.volume24hUsd,
    displayedLiquidityUsd: detail.displayedLiquidityUsd,
    usdGLiquidityUsd: detail.usdGLiquidityUsd,
    poolCount: detail.poolCount,
    dexCount: detail.dexCount,
    pools: detail.pools,
    robinhoodReferencePriceUsd: detail.robinhoodReferencePriceUsd,
    dexMedianPriceUsd: detail.dexMedianPriceUsd,
    premiumDiscountPct: detail.premiumDiscountPct,
    top3ConcentrationPct: detail.top3ConcentrationPct,
    liquidityCoverageComplete: detail.liquidityCoverageComplete,
    volume24hCoverageComplete: detail.volume24hCoverageComplete,
    instrumentKind: detail.instrumentKind,
    volumeCoverage: detail.volumeCoverage,
    coverageNote: detail.coverageNote,
    priceChange24hPct: detail.priceChange24hPct,
  };
}

function summaryToShellDetail(summary: AssetSummary): AssetDetail {
  return {
    ...summary,
    buys24h: null,
    sells24h: null,
    largestPool: null,
    concentration: { top1Pct: null, top3Pct: null, top5Pct: null },
    dexes: [],
    quoteAssets: [],
    price: {
      robinhoodReferenceUsd: summary.robinhoodReferencePriceUsd,
      robinhoodBidUsd: null,
      robinhoodAskUsd: null,
      robinhoodGeneratedAt: null,
      isTradingHalt: null,
      dexMedianUsd: summary.dexMedianPriceUsd,
      dexLiquidityWeightedUsd: null,
      dexLargestPoolUsd: null,
      premiumDiscountPct: summary.premiumDiscountPct,
      priceDispersionPct: null,
      priceCoverageComplete: summary.dexMedianPriceUsd !== null,
    },
    detailEnriched: false,
    marketCapUsd: null,
    fdvUsd: null,
    holderCount: null,
    circulatingSupply: null,
    totalSupply: null,
  };
}

function dexSlices(bucket: PairBucket, displayedLiquidityUsd: number | null): DexSlice[] {
  return [...bucket.dexes.entries()]
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
}

function quoteSlices(bucket: PairBucket, displayedLiquidityUsd: number | null): QuoteAssetSlice[] {
  return [...bucket.quotes.entries()].map(([address, quote]) => {
    const liquidity = quote.liquidity.length > 0 ? quote.liquidity.reduce((sum, value) => sum + value, 0) : null;
    return {
      address,
      symbol: quote.symbol,
      symbolConflict: false,
      displayedLiquidityUsd: liquidity,
      shareOfDisplayedLiquidityPct:
        liquidity !== null && displayedLiquidityUsd && displayedLiquidityUsd > 0
          ? (liquidity / displayedLiquidityUsd) * 100
          : null,
      poolCount: quote.poolCount,
    };
  });
}

function pairLabels(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const labels = value.flatMap((label) => {
    const text = asNonEmptyString(label);
    return text ? [text] : [];
  });
  return labels.length > 0 ? labels : null;
}

function rhjRowToToken(row: unknown): RobinhoodListedToken | null {
  if (!row || typeof row !== "object") return null;
  const rec = row as {
    tokenSymbol?: unknown;
    tokenName?: unknown;
    logoUrl?: unknown;
    deployments?: unknown;
  };
  const symbol = asNonEmptyString(rec.tokenSymbol)?.toUpperCase();
  const name = asNonEmptyString(rec.tokenName);
  if (!symbol || !name || isRobinhoodChainJunk(symbol, name)) return null;
  if (!Array.isArray(rec.deployments)) return null;
  const deployment = rec.deployments.find((item) => {
    if (!item || typeof item !== "object") return false;
    return String((item as { chainId?: unknown }).chainId) === "4663";
  }) as { contractAddress?: unknown } | undefined;
  const address = asNonEmptyString(deployment?.contractAddress);
  if (!address) return null;
  return {
    address,
    symbol,
    name,
    issuer: RHJ_ISSUER_LABEL,
    kind: classifyRobinhoodInstrument(name),
    logoUrl: asHttpUrl(rec.logoUrl),
  };
}

function ondoSideToToken(
  side: DexScreenerPair["baseToken"] | undefined,
): RobinhoodListedToken | null {
  const symbol = asNonEmptyString(side?.symbol)?.toUpperCase();
  const name = asNonEmptyString(side?.name);
  const address = asNonEmptyString(side?.address);
  if (!symbol || !name || !address) return null;
  if (symbol.length > 16) return null;
  if (!isAdmittedOndoName(name) || isRobinhoodChainJunk(symbol, name)) return null;
  return {
    address,
    symbol,
    name,
    issuer: ONDO_NAMED_UNVERIFIED_LABEL,
    kind: classifyRobinhoodInstrument(name),
    logoUrl: null,
  };
}
