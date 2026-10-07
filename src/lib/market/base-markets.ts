import { sortByVolumeThenLiquidity } from "./aggregate";
import { parsePairCreatedAt, type DexScreenerPair } from "./map-solana";
import {
  asHttpUrl,
  asNonEmptyString,
  asNonNegativeNumber,
  asReportedNumber,
  compareNullableDesc,
} from "./numbers";
import { inferVolumeCoverage } from "./volume-coverage";
import {
  BASE_CHAIN_ID,
  type AssetDetail,
  type AssetPoolMark,
  type AssetSummary,
  type DexSlice,
  type InstrumentKind,
  type QuoteAssetSlice,
} from "./types";

export const COINBASE_ISSUER_LABEL = "Coinbase";
export const ST0X_ISSUER_LABEL = "ST0x";
export const CENTRIFUGE_ISSUER_LABEL = "Centrifuge";
export const DINARI_ISSUER_LABEL = "Dinari";
export const BACKED_ISSUER_LABEL = "Backed";
export const ANCHORED_ISSUER_LABEL = "Anchored";
export const ONDO_ISSUER_LABEL = "Ondo";

export const BASE_DEX_CHAIN_SLUG = "base";

export const BASE_MARKETS_SOURCE_LABEL = "DexScreener · Base";

export const BASE_MARKETS_NOTE =
  "Base names are live issuer registries: Coinbase tokenized stocks, the ST0x Base token list, Centrifuge SPXA and deSPXA share tokens, Dinari dShares from Stocks On Chain, Backed b* and wb* tokens, and Anchored a* stocks. Ondo is included only when its address API names a Base contract. Commodities, treasury, bonds, credit vaults, xStock and PreStocks lookalikes, and Robinhood-named dust are excluded. Card volume is the sum of DexScreener volume.h24 across unique pools. A missing figure stays missing. A card uses the DexScreener image when that pair lists the contract as the base token. Otherwise it keeps the issuer logo, or a monogram when no logo was published.";

/**
 * Published Centrifuge share tokens on Base.
 * The USDC vault rows on the same deployments page are not share tokens and are not listed.
 * JTRSY, JAAA, and the other treasury/credit products are not listed.
 */
export const CENTRIFUGE_BASE_SHARES = [
  {
    address: "0x09b61343097c1f9b159a3ae7151298efd10f0db2",
    symbol: "SPXA",
    name: "S&P 500 (Centrifuge)",
  },
  {
    address: "0x9c5C365e764829876243d0b289733B9D2b729685",
    symbol: "deSPXA",
    name: "S&P 500 DeFi (Centrifuge)",
  },
] as const;

/** Anchored tickers that are commodity or treasury products, not equities. */
export const ANCHORED_EXCLUDED_TICKERS = new Set([
  "BIL",
  "BNO",
  "GLD",
  "IAU",
  "PALL",
  "PPLT",
  "SGOV",
  "SIVR",
  "SLV",
  "TBT",
  "TLT",
  "USO",
]);

/** Anchored fund tickers. The docs table publishes symbols, not instrument kind. */
export const ANCHORED_ETF_TICKERS = new Set([
  "AIQ",
  "ARKQ",
  "BOTZ",
  "EWY",
  "FLKR",
  "GDX",
  "QQQ",
  "SMH",
  "SOXL",
  "SPY",
  "SQQQ",
  "TQQQ",
  "TSLZ",
  "XLK",
]);

const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/;

/** Robinhood Chain launchpad dust that sometimes shows up on Base searches. */
const JUNK_SYMBOLS = new Set(["hoodon", "bmnron", "cperon"]);

const COPYCAT =
  /\brialto\b|\bxstocks?\b|\bprestocks?\b|\barcus\b|\bbackpack\b|\bbstocks?\b|\(reality\)|\breality tokenized\b|\brobinhood token\b|\brobinhood chain\b/i;

const COMMODITY_OR_CREDIT =
  /\bgold\b|\bsilver\b|\bplatinum\b|\bpalladium\b|\bcrude\b|\bbrent\b|\bpetroleum\b|\boil\b|\btreasury\b|\bt-bills?\b|\btbills?\b|\bgovies\b|\bgovernment bond\b|\bultrashort bond\b|\bcorporate bond\b|\bcorp bond\b|\bhigh yield\b|\bbonds?\b|\bbitcoin\b|\bincome opportunity\b|\bincome trust\b|\blimited duration income\b|\bprivate credit\b|\bcredit vault\b/i;

const ETF_NAME =
  /\betf\b|\bfund\b|\bindex fund\b|^ishares\b|^invesco qqq\b|\bs&p 500\b|\bnasdaq[- ]100\b|\bqqq\b/i;

const PRIVATE_NAME = /\bspace exploration technologies\b|\bspacex\b|\bpre-ipo\b|\bpreipo\b/i;

export interface BaseListedToken {
  address: string;
  symbol: string;
  name: string;
  issuer: string;
  kind: InstrumentKind;
  logoUrl: string | null;
}

export function isBaseDexChain(chainId: unknown): boolean {
  if (chainId === 8453) return true;
  const value = asNonEmptyString(chainId)?.toLowerCase();
  return value === BASE_DEX_CHAIN_SLUG || value === "8453";
}

export function isEvmAddress(value: string): boolean {
  return EVM_ADDRESS.test(value.trim());
}

/** Launchpad copycats, Robinhood-named dust, and commodity/treasury/bond products. */
export function isExcludedBaseProduct(symbol: string, name: string): boolean {
  if (JUNK_SYMBOLS.has(symbol.trim().toLowerCase())) return true;
  const blob = `${symbol} ${name}`;
  if (COPYCAT.test(blob)) return true;
  if (COMMODITY_OR_CREDIT.test(blob)) return true;
  return false;
}

/** ETF/index before private. Word boundaries keep Netflix from matching "etf". */
export function classifyBaseInstrument(name: string): InstrumentKind {
  if (ETF_NAME.test(name)) return "etf";
  if (PRIVATE_NAME.test(name)) return "private";
  return "equity";
}

export function parseCoinbaseTokenizedStocks(payload: unknown): BaseListedToken[] {
  const list = arrayField(payload, "tokens");
  return collectTokens(list, (row) => {
    if (!row || typeof row !== "object") return null;
    const rec = row as {
      contract_address?: unknown;
      symbol?: unknown;
      name?: unknown;
      icon_url?: unknown;
      is_live?: unknown;
      chain?: unknown;
      network?: unknown;
      chain_id?: unknown;
    };
    if (rec.is_live === false) return null;
    const chain = rec.chain ?? rec.network ?? rec.chain_id;
    if (chain != null && chain !== "" && !isBaseDexChain(chain)) return null;
    return listedToken({
      address: rec.contract_address,
      symbol: rec.symbol,
      name: rec.name,
      logoUrl: rec.icon_url,
      issuer: COINBASE_ISSUER_LABEL,
    });
  });
}

export function parseSt0xTokenList(payload: unknown): BaseListedToken[] {
  const list = arrayField(payload, "tokens");
  return collectTokens(list, (row) => {
    if (!row || typeof row !== "object") return null;
    const rec = row as {
      chainId?: unknown;
      address?: unknown;
      symbol?: unknown;
      name?: unknown;
      logoURI?: unknown;
    };
    if (!isBaseDexChain(rec.chainId)) return null;
    return listedToken({
      address: rec.address,
      symbol: rec.symbol,
      name: rec.name,
      logoUrl: rec.logoURI,
      issuer: ST0X_ISSUER_LABEL,
    });
  });
}

/**
 * Admit only the two published Base share tokens.
 * A USDC vault address, or JTRSY/JAAA-style treasury rows, stay out even if the symbol is echoed.
 */
export function parseCentrifugeShareRows(
  rows: readonly { symbol?: unknown; address?: unknown; network?: unknown; asset?: unknown }[],
): BaseListedToken[] {
  const official = new Map(CENTRIFUGE_BASE_SHARES.map((row) => [row.address.toLowerCase(), row]));
  return collectTokens(rows, (row) => {
    const asset = asNonEmptyString(row.asset);
    if (asset && asset.toUpperCase() !== "SHARE") return null;
    const network = row.network;
    if (network != null && network !== "" && !isBaseDexChain(network) && String(network).toLowerCase() !== "base") {
      return null;
    }
    const address = asNonEmptyString(row.address);
    const symbol = asNonEmptyString(row.symbol);
    if (!address || !symbol) return null;
    const match = official.get(address.toLowerCase());
    if (!match || match.symbol.toLowerCase() !== symbol.toLowerCase()) return null;
    return {
      address: match.address,
      symbol: match.symbol,
      name: match.name,
      issuer: CENTRIFUGE_ISSUER_LABEL,
      kind: "etf" as const,
      logoUrl: null,
    };
  });
}

export function centrifugeBaseShareTokens(): BaseListedToken[] {
  return CENTRIFUGE_BASE_SHARES.map((row) => ({
    address: row.address,
    symbol: row.symbol,
    name: row.name,
    issuer: CENTRIFUGE_ISSUER_LABEL,
    kind: "etf" as const,
    logoUrl: null,
  }));
}

/** Dinari dShares on Base from the Stocks On Chain tokens snapshot. Other issuers and chains are ignored. */
export function parseDinariStocksonchain(payload: unknown): BaseListedToken[] {
  const stocks = arrayField(payload, "stocks");
  const rows: unknown[] = [];
  for (const stock of stocks) {
    if (!stock || typeof stock !== "object") continue;
    const rec = stock as { company?: unknown; kind?: unknown; ticker?: unknown; listings?: unknown };
    if (!Array.isArray(rec.listings)) continue;
    for (const listing of rec.listings) rows.push({ stock: rec, listing });
  }
  return collectTokens(rows, (row) => {
    const packed = row as {
      stock?: { company?: unknown; kind?: unknown; ticker?: unknown };
      listing?: { issuer?: unknown; chain?: unknown; address?: unknown; onchainSymbol?: unknown };
    };
    const listing = packed.listing;
    if (!listing || String(listing.issuer) !== "dinari" || !isBaseDexChain(listing.chain)) return null;
    const company = asNonEmptyString(packed.stock?.company) ?? asNonEmptyString(packed.stock?.ticker);
    const symbol = asNonEmptyString(listing.onchainSymbol) ?? asNonEmptyString(packed.stock?.ticker);
    if (!company || !symbol) return null;
    const name = company.toLowerCase().includes("dinari") ? company : `${company} - Dinari`;
    if (isExcludedBaseProduct(symbol, `${name} ${company}`)) return null;
    const kind = dinariKind(packed.stock?.kind, name);
    const address = asNonEmptyString(listing.address);
    if (!address || !isEvmAddress(address) || symbol.length > 32) return null;
    return {
      address,
      symbol,
      name,
      issuer: DINARI_ISSUER_LABEL,
      kind,
      logoUrl: null,
    };
  });
}

export function parseBackedAssets(payload: unknown): BaseListedToken[] {
  const nodes = arrayField(payload, "nodes");
  const drafted: BaseListedToken[] = [];
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    const rec = node as {
      symbol?: unknown;
      name?: unknown;
      logo?: unknown;
      deployments?: unknown;
    };
    const symbol = asNonEmptyString(rec.symbol);
    const name = asNonEmptyString(rec.name);
    if (!symbol || !name || !Array.isArray(rec.deployments)) continue;
    if (!isBackedEquitySymbol(symbol)) continue;
    for (const deployment of rec.deployments) {
      if (!deployment || typeof deployment !== "object") continue;
      const dep = deployment as { network?: unknown; address?: unknown; wrapperAddress?: unknown; wrapperAddressV2?: unknown };
      if (String(dep.network) !== "Base") continue;
      const token = listedToken({
        address: dep.address,
        symbol,
        name,
        logoUrl: rec.logo,
        issuer: BACKED_ISSUER_LABEL,
      });
      if (token) drafted.push(token);
      const wrapper = asNonEmptyString(dep.wrapperAddress) ?? asNonEmptyString(dep.wrapperAddressV2);
      if (!wrapper) continue;
      const wrapped = listedToken({
        address: wrapper,
        symbol: wrappedBackedSymbol(symbol),
        name: `Wrapped ${name}`,
        logoUrl: rec.logo,
        issuer: BACKED_ISSUER_LABEL,
      });
      if (wrapped) drafted.push(wrapped);
    }
  }
  return dedupeTokens(drafted);
}

/**
 * Anchored tokenized-stock table.
 * Parsing stops at the Ethereum-only fund section so aDHF and the other fund shares stay off Base.
 */
export function parseAnchoredTokenDocs(markdown: string): BaseListedToken[] {
  const stockSection = markdown.split(/#{0,3}\s*Tokenized funds/i)[0] ?? markdown;
  const drafted: BaseListedToken[] = [];
  const rows: Array<[string, string]> = [];
  for (const line of stockSection.split("\n")) {
    const match = line.match(/^\|\s*(a[A-Za-z0-9.]+)\s*\|\s*(0x[a-fA-F0-9]{40})\s*\|/);
    if (match?.[1] && match[2]) rows.push([match[1], match[2]]);
  }
  for (const match of stockSection.matchAll(/<td>\s*(a[A-Za-z0-9.]+)\s*<\/td>\s*<td>\s*(0x[a-fA-F0-9]{40})\s*<\/td>/gi)) {
    if (match[1] && match[2]) rows.push([match[1], match[2]]);
  }
  for (const [symbol, address] of rows) {
    const ticker = symbol.slice(1).toUpperCase();
    if (ANCHORED_EXCLUDED_TICKERS.has(ticker)) continue;
    const name = `Anchored ${ticker}`;
    if (isExcludedBaseProduct(symbol, name)) continue;
    drafted.push({
      address,
      symbol,
      name,
      issuer: ANCHORED_ISSUER_LABEL,
      kind: anchoredKind(ticker),
      logoUrl: null,
    });
  }
  return dedupeTokens(drafted);
}

/**
 * Ondo rows are admitted only when the payload itself names chain Base / 8453.
 * A missing chain, a 403, or an unrecognized shape adds nothing.
 */
export function parseOndoBaseAssets(payload: unknown): BaseListedToken[] {
  const list = arrayField(payload, "assets").length > 0 ? arrayField(payload, "assets") : arrayField(payload, "tokens");
  const rows = list.length > 0 ? list : Array.isArray(payload) ? payload : [];
  return collectTokens(rows, (row) => {
    if (!row || typeof row !== "object") return null;
    const rec = row as {
      address?: unknown;
      contractAddress?: unknown;
      contract_address?: unknown;
      symbol?: unknown;
      ticker?: unknown;
      name?: unknown;
      chainId?: unknown;
      chain?: unknown;
      network?: unknown;
      logoUrl?: unknown;
      logoURI?: unknown;
    };
    const chain = rec.chainId ?? rec.chain ?? rec.network;
    if (!isBaseDexChain(chain)) return null;
    const symbol = asNonEmptyString(rec.symbol) ?? asNonEmptyString(rec.ticker);
    const name = asNonEmptyString(rec.name);
    if (!symbol || !name) return null;
    if (!/ondo/i.test(`${symbol} ${name}`)) return null;
    return listedToken({
      address: rec.address ?? rec.contractAddress ?? rec.contract_address,
      symbol,
      name,
      logoUrl: rec.logoUrl ?? rec.logoURI,
      issuer: ONDO_ISSUER_LABEL,
    });
  });
}

/** First registry to claim an address wins. Later lookalikes on the same contract are ignored. */
export function mergeBaseTokens(groups: readonly (readonly BaseListedToken[])[]): BaseListedToken[] {
  return dedupeTokens(groups.flat());
}

export interface BaseMarketLanes {
  assets: AssetSummary[];
  etfAssets: AssetSummary[];
  privateAssets: AssetSummary[];
  details: AssetDetail[];
}

/**
 * Card logo for one Base contract.
 * DexScreener's base-token image wins. The issuer registry URL is the fallback.
 * The caller must not pass a quote-side image. A missing logo stays null so the UI can draw a monogram.
 */
export function selectBaseTokenLogo(input: {
  dexLogoUrl?: string | null;
  registryLogoUrl?: string | null;
}): string | null {
  return asHttpUrl(input.dexLogoUrl) ?? asHttpUrl(input.registryLogoUrl);
}

export function buildBaseMarketLanes(
  tokens: readonly BaseListedToken[],
  pairs: readonly DexScreenerPair[],
  options?: { volumeHydrated?: boolean },
): BaseMarketLanes {
  const volumeHydrated = options?.volumeHydrated !== false;
  const byAddress = new Map<string, BaseListedToken>();
  for (const token of tokens) byAddress.set(token.address.toLowerCase(), token);

  const buckets = new Map<string, PairBucket>();
  for (const pair of pairs) {
    if (!isBaseDexChain(pair.chainId)) continue;
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

export function findBaseDetail(details: readonly AssetDetail[], key: string): AssetDetail | undefined {
  const needle = key.trim().toLowerCase();
  if (!needle) return undefined;
  const byAddress = details.find((row) => row.contractAddress.toLowerCase() === needle);
  if (byAddress) return byAddress;
  const bySymbol = details.filter((row) => row.symbol.toLowerCase() === needle);
  return bySymbol.length === 1 ? bySymbol[0] : undefined;
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
    pairCreatedAt: parsePairCreatedAt(pair.pairCreatedAt),
    tradesChange24hPct: null,
    walletsChange24hPct: null,
  };
  bucket.pools.push(pool);
}

function toDetail(token: BaseListedToken, bucket: PairBucket, volumeHydrated: boolean): AssetDetail {
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
  const logoUrl = selectBaseTokenLogo({
    dexLogoUrl: bucket.logoUrl,
    registryLogoUrl: token.logoUrl,
  });
  const listed = token.address.toLowerCase();
  const pools = [...bucket.pools]
    .map((pool) => {
      if (pool.baseAddress?.toLowerCase() !== listed || pool.baseLogoUrl) return pool;
      return logoUrl ? { ...pool, baseLogoUrl: logoUrl } : pool;
    })
    .sort((a, b) => {
      const byVolume = compareNullableDesc(a.volume24hUsd, b.volume24hUsd);
      if (byVolume !== 0) return byVolume;
      return compareNullableDesc(a.liquidityUsd, b.liquidityUsd);
    });
  const summary: AssetSummary = {
    chainId: BASE_CHAIN_ID,
    sourceId: "base",
    sourceLabel: BASE_MARKETS_SOURCE_LABEL,
    symbol: token.symbol,
    name: token.name,
    contractAddress: token.address,
    issuer: token.issuer,
    logoUrl,
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
    dexes: dexSlices(bucket, displayedLiquidityUsd),
    quoteAssets: quoteSlices(bucket, displayedLiquidityUsd),
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

function listedToken(input: {
  address: unknown;
  symbol: unknown;
  name: unknown;
  logoUrl: unknown;
  issuer: string;
}): BaseListedToken | null {
  const symbol = asNonEmptyString(input.symbol);
  const name = asNonEmptyString(input.name);
  const address = asNonEmptyString(input.address);
  if (!symbol || !name || !address || !isEvmAddress(address) || symbol.length > 32) return null;
  if (isExcludedBaseProduct(symbol, name)) return null;
  return {
    address,
    symbol,
    name,
    issuer: input.issuer,
    kind: classifyBaseInstrument(name),
    logoUrl: asHttpUrl(input.logoUrl),
  };
}

function isBackedEquitySymbol(symbol: string): boolean {
  return /^wb[A-Za-z0-9.]+$/.test(symbol) || /^b[A-Za-z0-9.]+$/.test(symbol);
}

function wrappedBackedSymbol(symbol: string): string {
  if (symbol.toLowerCase().startsWith("wb")) return symbol;
  return `wb${symbol.slice(1)}`;
}

function anchoredKind(ticker: string): InstrumentKind {
  if (ANCHORED_ETF_TICKERS.has(ticker)) return "etf";
  if (ticker === "SPCX") return "private";
  return "equity";
}

function dinariKind(kind: unknown, name: string): InstrumentKind {
  const value = asNonEmptyString(kind)?.toLowerCase();
  if (value === "private" || PRIVATE_NAME.test(name)) return "private";
  if (value === "etf" || ETF_NAME.test(name)) return "etf";
  return "equity";
}

function arrayField(payload: unknown, key: string): unknown[] {
  if (!payload || typeof payload !== "object") return [];
  const value = (payload as Record<string, unknown>)[key];
  return Array.isArray(value) ? value : [];
}

function collectTokens<T>(rows: readonly T[], mapRow: (row: T) => BaseListedToken | null): BaseListedToken[] {
  const drafted: BaseListedToken[] = [];
  for (const row of rows) {
    const token = mapRow(row);
    if (token) drafted.push(token);
  }
  return dedupeTokens(drafted);
}

function dedupeTokens(tokens: readonly BaseListedToken[]): BaseListedToken[] {
  const byAddress = new Map<string, BaseListedToken>();
  for (const token of tokens) {
    const key = token.address.toLowerCase();
    if (!byAddress.has(key)) byAddress.set(key, token);
  }
  return [...byAddress.values()];
}
