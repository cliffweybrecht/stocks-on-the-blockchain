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
  BNB_CHAIN_ID,
  type AssetDetail,
  type AssetPoolMark,
  type AssetSummary,
  type DexSlice,
  type InstrumentKind,
  type QuoteAssetSlice,
} from "./types";

export const XSTOCKS_ISSUER_LABEL = "xStocks";
export const ONDO_ISSUER_LABEL = "Ondo";
export const DINARI_ISSUER_LABEL = "Dinari";
export const BSTOCKS_ISSUER_LABEL = "bStocks";
export const COLB_ISSUER_LABEL = "Colb Finance";
export const PAIMON_ISSUER_LABEL = "Paimon";

/** DexScreener and GeckoTerminal slug for chain id 56. The desk id stays `bnb`. */
export const BNB_DEX_CHAIN_SLUG = "bsc";

export const BNB_MARKETS_SOURCE_LABEL = "DexScreener · BNB Chain";

export const BNB_MARKETS_NOTE =
  "BNB Chain names are live public registries: the xStocks product catalogue (addresses.bsc only), Stocks On Chain (Ondo and xStocks on bnb-chain), the xStocks token list and assets API, bStocks rows on Jumper whose chain is bsc, Colb’s BNB Chain token table, and Paimon’s published BSC tokens. When the xStocks catalogue loads, an xStocks card must be one of those BSC addresses; the assets API cannot add a second contract for the same ticker. Dinari is included only when a registry names a BNB Chain contract. The Ondo metadata API is not a name source when it does not return contracts. Commodities, treasuries, bonds, credit, crypto trusts, leveraged and inverse products, fan tokens, perps, and Paimon Prime are excluded. One card is one lowercased contract. Card volume is the sum of DexScreener volume.h24 across unique pools. A missing figure stays missing. A card uses the DexScreener image when that pair lists the contract as the base token. Otherwise it keeps the issuer logo, or a monogram when no logo was published.";

const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/;

const BNB_CHAIN_NAMES = new Set([
  "56",
  "bsc",
  "bnb",
  "bnb-chain",
  "binance",
  "binancesmartchain",
  "binance-smart-chain",
]);

/** Copycats and products this desk does not list. xStocks is an in-scope issuer, so that word is not junk. */
const COPYCAT =
  /\brialto\b|\bprestocks?\b|\barcus\b|\bbackpack\b|\(reality\)|\breality tokenized\b|\brobinhood token\b|\brobinhood chain\b/i;

const LEVERAGED =
  /(?:^|[^a-z0-9])-?\d+(?:\.\d+)?x\b|\binverse\b|\bleveraged\b|\bultrashort\b|\bultra\s+long\b|\bultra\s+short\b|\bultrapro\b|\bproshares\s+(?:short|ultra)\b/i;

const COMMODITY_OR_CREDIT =
  /\bgold\b|\bsilver\b|\bplatinum\b|\bpalladium\b|\bcrude\b|\bbrent\b|\bpetroleum\b|\boil\b|\bcommodity\b|\bcopper\s+(?:index|fund)\b|\btreasury\b|\bt-bills?\b|\btbills?\b|\bgovies\b|\bgovernment bond\b|\bbonds?\b|\bhigh yield\b|\bcorporate bond\b|\bclo\b|\bbitcoin\b|\bethereum\b|\bether\b|\bcrypto\b/i;

const FAN_OR_PERP = /\bfan token\b|\bperps?\b/i;

const PRIME = /\bprime vault\b|\bpaimon prime\b/i;

const ETF_NAME = /\betf\b|\bfund\b|\bindex\b|^ishares\b|^invesco qqq\b|\bs&p 500\b|\bnasdaq[- ]100\b|\bqqq\b/i;

const PRIVATE_NAME =
  /\bspace exploration technologies\b|\bspacex\b|\bopenai\b|\banthropic\b|\bkalshi\b|\bpolymarket\b|\brevolut\b|\bpre-ipo\b|\bpreipo\b/i;

const STOCKSONCHAIN_ISSUERS: Record<string, string> = {
  "backed-xstocks": XSTOCKS_ISSUER_LABEL,
  xstocks: XSTOCKS_ISSUER_LABEL,
  backed: XSTOCKS_ISSUER_LABEL,
  ondo: ONDO_ISSUER_LABEL,
  dinari: DINARI_ISSUER_LABEL,
};

const JUMPER_PROVIDERS: Record<string, string> = {
  xstocks: XSTOCKS_ISSUER_LABEL,
  ondo: ONDO_ISSUER_LABEL,
  bstocks: BSTOCKS_ISSUER_LABEL,
};

/** Infrastructure rows in the Paimon contract table. They are not tokenized stocks. */
const PAIMON_INFRASTRUCTURE = /launchpad|badge|points|staking|prime/i;

export interface BnbListedToken {
  address: string;
  symbol: string;
  name: string;
  issuer: string;
  kind: InstrumentKind;
  logoUrl: string | null;
}

export function isBnbDexChain(chainId: unknown): boolean {
  if (chainId === 56) return true;
  const value = asNonEmptyString(chainId)?.toLowerCase().replace(/[\s_]+/g, "");
  if (!value) return false;
  return BNB_CHAIN_NAMES.has(value) || BNB_CHAIN_NAMES.has(value.replace(/-/g, ""));
}

export function isEvmAddress(value: string): boolean {
  return EVM_ADDRESS.test(value.trim());
}

/** Leveraged products, commodities, treasuries, bonds, crypto trusts, and copycats. */
export function isExcludedBnbProduct(symbol: string, name: string): boolean {
  const blob = `${symbol} ${name}`;
  if (COPYCAT.test(blob)) return true;
  if (LEVERAGED.test(blob)) return true;
  if (COMMODITY_OR_CREDIT.test(blob)) return true;
  if (FAN_OR_PERP.test(blob)) return true;
  if (PRIME.test(blob)) return true;
  return false;
}

/**
 * ETF/index before private.
 * A registry kind of `etf` is not enough: some stock rows are mislabeled.
 * A registry kind of `private` / `preipo` is trusted when the name is not an ETF.
 */
export function classifyBnbInstrument(name: string, registryKind?: unknown): InstrumentKind {
  if (ETF_NAME.test(name)) return "etf";
  const value = asNonEmptyString(registryKind)?.toLowerCase();
  // Trust an explicit etf/index kind. Callers that see mislabeled stock rows should omit it.
  if (value === "etf" || value === "index") return "etf";
  if (value === "private" || value === "preipo" || value === "pre-ipo" || PRIVATE_NAME.test(name)) return "private";
  return "equity";
}

/**
 * Ondo, xStocks, and Dinari rows whose listing chain is `bnb-chain`.
 * Other chains and other issuers are ignored. A missing address is not invented.
 */
export function parseStocksonchainBnb(payload: unknown): BnbListedToken[] {
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
    if (!listing || !isBnbDexChain(listing.chain)) return null;
    const issuer = stocksonchainIssuer(listing.issuer);
    if (!issuer) return null;
    const company = asNonEmptyString(packed.stock?.company) ?? asNonEmptyString(packed.stock?.ticker);
    const symbol = asNonEmptyString(listing.onchainSymbol) ?? asNonEmptyString(packed.stock?.ticker);
    if (!company || !symbol) return null;
    return listedToken({
      address: listing.address,
      symbol,
      name: company,
      logoUrl: null,
      issuer,
      registryKind: privateRegistryKind(packed.stock?.kind),
    });
  });
}

/** xStocks token list rows on chain id 56. Other chains stay out. */
export function parseXStocksTokenList(payload: unknown): BnbListedToken[] {
  const tokens = arrayField(payload, "tokens");
  return collectTokens(tokens, (row) => {
    if (!row || typeof row !== "object") return null;
    const rec = row as {
      chainId?: unknown;
      address?: unknown;
      symbol?: unknown;
      name?: unknown;
      logoURI?: unknown;
      tags?: unknown;
    };
    if (!isBnbDexChain(rec.chainId)) return null;
    const tags = Array.isArray(rec.tags) ? rec.tags.map((tag) => String(tag).toLowerCase()) : [];
    const name = asNonEmptyString(rec.name) ?? "";
    if (!tags.includes("xstocks") && !/xstock/i.test(name)) return null;
    return listedToken({
      address: rec.address,
      symbol: rec.symbol,
      name: rec.name,
      logoUrl: rec.logoURI,
      issuer: XSTOCKS_ISSUER_LABEL,
    });
  });
}

/**
 * xStocks public assets API.
 * Only a deployment whose network is Binance Smart Chain is admitted.
 * `wrapperAddressV2` is not a second card: the published symbol is attached to `address`.
 */
export function parseXStocksAssets(payload: unknown): BnbListedToken[] {
  const nodes = arrayField(payload, "nodes");
  const drafted: BnbListedToken[] = [];
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    const rec = node as { symbol?: unknown; name?: unknown; logo?: unknown; deployments?: unknown };
    if (!Array.isArray(rec.deployments)) continue;
    for (const deployment of rec.deployments) {
      if (!deployment || typeof deployment !== "object") continue;
      const dep = deployment as { network?: unknown; address?: unknown };
      if (!isBnbDexChain(dep.network)) continue;
      const token = listedToken({
        address: dep.address,
        symbol: rec.symbol,
        name: rec.name,
        logoUrl: rec.logo,
        issuer: XSTOCKS_ISSUER_LABEL,
      });
      if (token) drafted.push(token);
    }
  }
  return dedupeTokens(drafted);
}

export function xStocksAssetsHasNextPage(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const page = (payload as { page?: { hasNextPage?: unknown } }).page;
  return page?.hasNextPage === true;
}

/**
 * Official xStocks product catalogue.
 * A card exists only when `addresses.bsc` is a contract. Null and other networks add nothing.
 * The same address on ethereum is not copied in: only the `bsc` field is read.
 */
export function parseXStocksProductCatalog(payload: unknown): BnbListedToken[] {
  return collectTokens(readXStocksProducts(payload), (row) => {
    if (!row || typeof row !== "object") return null;
    const rec = row as {
      symbol?: unknown;
      name?: unknown;
      iconUrl?: unknown;
      logo?: unknown;
      addresses?: unknown;
    };
    const addresses = rec.addresses;
    if (!addresses || typeof addresses !== "object" || Array.isArray(addresses)) return null;
    const bsc = (addresses as Record<string, unknown>).bsc;
    if (bsc == null || bsc === "") return null;
    return listedToken({
      address: bsc,
      symbol: rec.symbol,
      name: rec.name,
      logoUrl: rec.iconUrl ?? rec.logo,
      issuer: XSTOCKS_ISSUER_LABEL,
    });
  });
}

/**
 * When the xStocks catalogue published BSC addresses, other registries may not add an xStocks
 * contract that catalogue left out. Other issuers are unchanged. A null allowlist means the
 * catalogue did not load, so chain-56 rows from the other registries stay.
 */
export function retainVerifiedXStocks(
  tokens: readonly BnbListedToken[],
  catalogueAddresses: ReadonlySet<string> | null,
): BnbListedToken[] {
  if (!catalogueAddresses) return [...tokens];
  return tokens.filter(
    (token) =>
      token.issuer !== XSTOCKS_ISSUER_LABEL || catalogueAddresses.has(token.address.toLowerCase()),
  );
}

/**
 * Jumper issuer page embedded catalog.
 * Only xStocks, Ondo, and bStocks instances whose chain is bsc / 56.
 * Robinhood, Backpack, and Coinbase instances on that page are not BNB Chain stocks.
 */
export function parseJumperBstocks(payload: unknown): BnbListedToken[] {
  const rows = readJumperRows(payload);
  const drafted: BnbListedToken[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const entry = (row as { entry?: unknown }).entry;
    if (!entry || typeof entry !== "object") continue;
    const rec = entry as {
      name?: unknown;
      kind?: unknown;
      logoURI?: unknown;
      instances?: unknown;
    };
    if (!Array.isArray(rec.instances)) continue;
    for (const instance of rec.instances) {
      if (!instance || typeof instance !== "object") continue;
      const inst = instance as {
        provider?: unknown;
        tokenSymbol?: unknown;
        chain?: unknown;
        chainId?: unknown;
        address?: unknown;
        logoURI?: unknown;
      };
      const issuer = jumperIssuer(inst.provider);
      if (!issuer) continue;
      if (!isBnbDexChain(inst.chain) && !isBnbDexChain(inst.chainId)) continue;
      const token = listedToken({
        address: inst.address,
        symbol: inst.tokenSymbol,
        name: rec.name,
        logoUrl: inst.logoURI ?? rec.logoURI,
        issuer,
        registryKind: rec.kind,
      });
      if (token) drafted.push(token);
    }
  }
  return dedupeTokens(drafted);
}

/**
 * Colb’s BNB Chain table.
 * Only `Colb {Company} ({SYMBOL})` share tokens. Oracles, aggregators, and factories have no ticker and stay out.
 */
export function parseColbContracts(markdown: string): BnbListedToken[] {
  const bnb = markdown.split(/###\s+BNB Chain/i)[1] ?? "";
  const section = bnb.split(/###\s+/)[0] ?? bnb;
  const drafted: BnbListedToken[] = [];
  const re =
    /Colb\s+([A-Za-z0-9][A-Za-z0-9 .'-]*?)\s*\(([A-Za-z0-9]+)\)[\s\S]{0,400}?(0x[a-fA-F0-9]{40})/gi;
  for (const match of section.matchAll(re)) {
    const company = match[1]?.trim();
    const symbol = match[2]?.trim();
    const address = match[3];
    if (!company || !symbol || !address) continue;
    if (/oracle|aggregator|factory|manager|controller/i.test(company)) continue;
    const token = listedToken({
      address,
      symbol,
      name: `Colb ${company}`,
      logoUrl: null,
      issuer: COLB_ISSUER_LABEL,
      kind: "private",
    });
    if (token) drafted.push(token);
  }
  return dedupeTokens(drafted);
}

/**
 * Paimon trade page.
 * Each card publishes a company, a symbol, and a bscscan token URL. Prime is not a stock.
 */
export function parsePaimonTradePage(html: string): BnbListedToken[] {
  const drafted: BnbListedToken[] = [];
  const re =
    /Paimon\s*(?:<!--\s*-->\s*)?([A-Za-z0-9][^<]{0,40}?)\s*(?:<!--\s*-->\s*)?SPV Tradable Token[\s\S]{0,2000}?\$\s*(?:<!--\s*-->\s*)?([A-Za-z0-9]+)[\s\S]{0,800}?bscscan\.com\/token\/(0x[a-fA-F0-9]{40})/gi;
  for (const match of html.matchAll(re)) {
    const company = match[1]?.trim();
    const symbol = match[2]?.trim();
    const address = match[3];
    if (!company || !symbol || !address) continue;
    if (PRIME.test(company) || PAIMON_INFRASTRUCTURE.test(company)) continue;
    const token = listedToken({
      address,
      symbol,
      name: `Paimon ${company} SPV Tradable Token`,
      logoUrl: null,
      issuer: PAIMON_ISSUER_LABEL,
      kind: "private",
    });
    if (token) drafted.push(token);
  }
  return dedupeTokens(drafted);
}

/**
 * Paimon docs contract table, via the published `searchText` rows.
 * Only `p*` / `x*` stock tokens. Prime, badges, points, and staking stay out.
 */
export function parsePaimonDocs(html: string): BnbListedToken[] {
  const text = html.replace(/\\"/g, '"');
  const drafted: BnbListedToken[] = [];
  const re = /"searchText":"([^"]+?)\s+(0x[a-fA-F0-9]{40})"/g;
  for (const match of text.matchAll(re)) {
    const label = match[1]?.trim();
    const address = match[2];
    if (!label || !address) continue;
    const symbol = label.split(/[\s(]/)[0]?.trim() ?? "";
    if (!/^[px][A-Z0-9]{2,}$/.test(symbol)) continue;
    if (PRIME.test(label) || PAIMON_INFRASTRUCTURE.test(label)) continue;
    const token = listedToken({
      address,
      symbol,
      name: `Paimon ${label}`,
      logoUrl: null,
      issuer: PAIMON_ISSUER_LABEL,
      kind: "private",
    });
    if (token) drafted.push(token);
  }
  return dedupeTokens(drafted);
}

/**
 * Ondo metadata rows are admitted only when the payload itself names BNB Chain / 56 / bsc.
 * A 403, a missing chain, or an unrecognized shape adds nothing.
 */
export function parseOndoBnbAssets(payload: unknown): BnbListedToken[] {
  const list = arrayField(payload, "assets").length > 0 ? arrayField(payload, "assets") : arrayField(payload, "tokens");
  const rows = list.length > 0 ? list : Array.isArray(payload) ? payload : [];
  return collectTokens(rows, (row) => {
    if (!row || typeof row !== "object") return null;
    const rec = row as Record<string, unknown>;
    const symbol = asNonEmptyString(rec.symbol) ?? asNonEmptyString(rec.ticker);
    const name = asNonEmptyString(rec.name) ?? asNonEmptyString(rec.underlyingName);
    const logoUrl = rec.logoUrl ?? rec.logoURI ?? rec.icon_url;
    const flatChain = rec.chainId ?? rec.chain ?? rec.network;
    const flatAddress = rec.address ?? rec.contractAddress ?? rec.contract_address;
    if (symbol && name && isBnbDexChain(flatChain)) {
      return listedToken({
        address: flatAddress,
        symbol,
        name,
        logoUrl,
        issuer: ONDO_ISSUER_LABEL,
      });
    }
    const fromMap = addressFromChainMap(rec.addresses ?? rec.contracts);
    if (symbol && name && fromMap) {
      return listedToken({
        address: fromMap,
        symbol,
        name,
        logoUrl,
        issuer: ONDO_ISSUER_LABEL,
      });
    }
    const nested = addressFromDeployments(rec.networks ?? rec.deployments ?? rec.chains);
    if (symbol && name && nested) {
      return listedToken({
        address: nested,
        symbol,
        name,
        logoUrl,
        issuer: ONDO_ISSUER_LABEL,
      });
    }
    return null;
  });
}

/**
 * One card per lowercased contract. The first registry to claim an address wins.
 * The same issuer and ticker with two different addresses stays two cards: those are
 * distinct contracts, not a second copy of one deployment. Wrappers are not given a symbol here.
 */
export function mergeBnbTokens(groups: readonly (readonly BnbListedToken[])[]): BnbListedToken[] {
  return dedupeTokens(groups.flat());
}

export interface BnbMarketLanes {
  assets: AssetSummary[];
  etfAssets: AssetSummary[];
  privateAssets: AssetSummary[];
  details: AssetDetail[];
}

/**
 * Card logo for one BNB Chain contract.
 * DexScreener's base-token image wins. The issuer registry URL is the fallback.
 * The caller must not pass a quote-side image. A missing logo stays null so the UI can draw a monogram.
 */
export function selectBnbTokenLogo(input: {
  dexLogoUrl?: string | null;
  registryLogoUrl?: string | null;
}): string | null {
  return asHttpUrl(input.dexLogoUrl) ?? asHttpUrl(input.registryLogoUrl);
}

export function buildBnbMarketLanes(
  tokens: readonly BnbListedToken[],
  pairs: readonly DexScreenerPair[],
  options?: { volumeHydrated?: boolean },
): BnbMarketLanes {
  const volumeHydrated = options?.volumeHydrated !== false;
  const byAddress = new Map<string, BnbListedToken>();
  for (const token of tokens) byAddress.set(token.address.toLowerCase(), token);

  const buckets = new Map<string, PairBucket>();
  for (const pair of pairs) {
    if (!isBnbDexChain(pair.chainId)) continue;
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

export function findBnbDetail(details: readonly AssetDetail[], key: string): AssetDetail | undefined {
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

function toDetail(token: BnbListedToken, bucket: PairBucket, volumeHydrated: boolean): AssetDetail {
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
  const logoUrl = selectBnbTokenLogo({
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
    chainId: BNB_CHAIN_ID,
    sourceId: "bnb",
    sourceLabel: BNB_MARKETS_SOURCE_LABEL,
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
  registryKind?: unknown;
  kind?: InstrumentKind;
}): BnbListedToken | null {
  const symbol = asNonEmptyString(input.symbol);
  const name = asNonEmptyString(input.name);
  const address = asNonEmptyString(input.address);
  if (!symbol || !name || !address || !isEvmAddress(address) || symbol.length > 32) return null;
  if (isExcludedBnbProduct(symbol, name)) return null;
  return {
    address,
    symbol,
    name,
    issuer: input.issuer,
    kind: input.kind ?? classifyBnbInstrument(name, input.registryKind),
    logoUrl: asHttpUrl(input.logoUrl),
  };
}

/** Stocks On Chain marks some ordinary shares as `etf`. Only private/pre-IPO is trusted from that field. */
function privateRegistryKind(kind: unknown): string | undefined {
  const value = asNonEmptyString(kind)?.toLowerCase();
  if (value === "private" || value === "preipo" || value === "pre-ipo") return value;
  return undefined;
}

function stocksonchainIssuer(value: unknown): string | null {
  const key = asNonEmptyString(value)?.toLowerCase();
  if (!key) return null;
  return STOCKSONCHAIN_ISSUERS[key] ?? null;
}

function jumperIssuer(value: unknown): string | null {
  const key = asNonEmptyString(value)?.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!key) return null;
  return JUMPER_PROVIDERS[key] ?? null;
}

function addressFromChainMap(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  for (const [chain, address] of Object.entries(value as Record<string, unknown>)) {
    if (!isBnbDexChain(chain)) continue;
    const text = asNonEmptyString(address);
    if (text && isEvmAddress(text)) return text;
    if (address && typeof address === "object") {
      const nested = asNonEmptyString((address as { address?: unknown }).address);
      if (nested && isEvmAddress(nested)) return nested;
    }
  }
  return null;
}

function addressFromDeployments(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const rec = row as { network?: unknown; chain?: unknown; chainId?: unknown; address?: unknown };
    const chain = rec.chainId ?? rec.chain ?? rec.network;
    if (!isBnbDexChain(chain)) continue;
    const address = asNonEmptyString(rec.address);
    if (address && isEvmAddress(address)) return address;
  }
  return null;
}

function readJumperRows(payload: unknown): unknown[] {
  if (payload && typeof payload === "object") {
    const direct = (payload as { allRows?: unknown }).allRows;
    if (Array.isArray(direct)) return direct;
  }
  const text = typeof payload === "string" ? payload : "";
  if (!text) return [];
  return extractJsonArray(text, "allRows") ?? extractJsonArray(text.replace(/\\"/g, '"'), "allRows") ?? [];
}

function extractJsonArray(text: string, key: string): unknown[] | null {
  const marker = `"${key}":`;
  const start = text.indexOf(marker);
  if (start < 0) return null;
  const bracket = text.indexOf("[", start + marker.length);
  if (bracket < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = bracket; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "[" || char === "{") depth += 1;
    else if (char === "]" || char === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(text.slice(bracket, index + 1)) as unknown;
          return Array.isArray(parsed) ? parsed : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function readXStocksProducts(payload: unknown): unknown[] {
  if (payload && typeof payload === "object") {
    const direct = arrayField(payload, "products");
    if (direct.length > 0) return direct;
    const pageProps = (payload as { props?: { pageProps?: { products?: unknown } } }).props?.pageProps?.products;
    if (Array.isArray(pageProps)) return pageProps;
  }
  if (typeof payload !== "string" || !payload.includes("__NEXT_DATA__")) return [];
  const match = payload.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match?.[1]) return [];
  try {
    return readXStocksProducts(JSON.parse(match[1]) as unknown);
  } catch {
    return [];
  }
}

function arrayField(payload: unknown, key: string): unknown[] {
  if (!payload || typeof payload !== "object") return [];
  const value = (payload as Record<string, unknown>)[key];
  return Array.isArray(value) ? value : [];
}

function collectTokens<T>(rows: readonly T[], mapRow: (row: T) => BnbListedToken | null): BnbListedToken[] {
  const drafted: BnbListedToken[] = [];
  for (const row of rows) {
    const token = mapRow(row);
    if (token) drafted.push(token);
  }
  return dedupeTokens(drafted);
}

function dedupeTokens(tokens: readonly BnbListedToken[]): BnbListedToken[] {
  const byAddress = new Map<string, BnbListedToken>();
  for (const token of tokens) {
    const key = token.address.toLowerCase();
    if (!byAddress.has(key)) byAddress.set(key, token);
  }
  return [...byAddress.values()];
}
