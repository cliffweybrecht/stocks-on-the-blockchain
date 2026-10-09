import type { EquityAddressBook } from "./lending-addresses";
import { evmChainKey } from "./lending-addresses";
import { formatUsdCompact } from "./format";
import {
  lendingApyBand,
  lendingChainLabel,
  lendingUtilization,
  type LendingAsset,
  type LendingBorrowEstimate,
  type LendingRow,
  type LendingSourceNote,
} from "./lending-snapshot";
import { asNonEmptyString, asReportedNumber } from "./numbers";

const STABLE_SYMBOLS = new Set([
  "USDC",
  "USDT",
  "USDG",
  "PYUSD",
  "USDS",
  "USD1",
  "U",
  "USDE",
  "SUSDE",
  "GHO",
  "EURC",
  "DAI",
  "FRAX",
  "LUSD",
  "FDUSD",
  "USDM",
  "CRVUSD",
  "GHO",
  "USDBC",
  "USDCE",
  "JUPUSD",
]);

export function isStableSymbol(symbol: unknown): boolean {
  const value = asNonEmptyString(symbol)?.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!value) return false;
  return STABLE_SYMBOLS.has(value);
}

function usd(value: unknown): number | null {
  const parsed = asReportedNumber(value);
  if (parsed === null || parsed < 0) return null;
  return parsed;
}

function fractionFromRate(value: unknown): number | null {
  const parsed = asReportedNumber(value);
  if (parsed === null || parsed < 0) return null;
  // Jupiter reports borrow rates in basis points (477 = 4.77%). Fractions stay fractions.
  if (parsed >= 1) return parsed / 10_000;
  return parsed;
}

/** Aave `value` is a 0–1 fraction. `normalized` is that same rate in percent. */
function aaveFraction(field: { value?: unknown; normalized?: unknown } | undefined): number | null {
  const fraction = asReportedNumber(field?.value);
  if (fraction !== null && fraction >= 0 && fraction <= 5) return fraction;
  const percent = asReportedNumber(field?.normalized);
  if (percent === null || percent < 0) return null;
  return percent / 100;
}

interface ApyPoint {
  apy: number | null;
  weight: number | null;
}

function rowShell(input: {
  id: string;
  venue: string;
  chainId: string;
  source: string;
  collateralUsd: number | null;
  stableBorrowedUsd: number | null;
  lendSupplyUsd: number | null;
  utilization?: number | null;
  points?: readonly ApyPoint[];
  stockBorrowedUsd?: number | null;
  assets?: LendingAsset[];
  note?: string | null;
  borrowEstimate?: LendingBorrowEstimate | null;
  error?: string | null;
}): LendingRow {
  const band = lendingApyBand(input.points ?? []);
  const utilization =
    input.utilization !== undefined && input.utilization !== null
      ? input.utilization
      : lendingUtilization(input.stableBorrowedUsd, input.lendSupplyUsd);
  return {
    id: input.id,
    venue: input.venue,
    chainId: input.chainId,
    chainLabel: lendingChainLabel(input.chainId),
    collateralUsd: input.collateralUsd,
    stableBorrowedUsd: input.stableBorrowedUsd,
    lendSupplyUsd: input.lendSupplyUsd,
    utilization,
    borrowApy: band.borrowApy,
    borrowApyMin: band.borrowApyMin,
    borrowApyMax: band.borrowApyMax,
    stockBorrowedUsd: input.stockBorrowedUsd ?? null,
    assets: input.assets ?? [],
    note: input.note ?? null,
    borrowEstimate: input.borrowEstimate ?? null,
    source: input.source,
    error: input.error ?? null,
  };
}

function missingRow(input: { id: string; venue: string; chainId: string; source: string; message: string }): LendingRow {
  return rowShell({
    id: input.id,
    venue: input.venue,
    chainId: input.chainId,
    source: input.source,
    collateralUsd: null,
    stableBorrowedUsd: null,
    lendSupplyUsd: null,
    utilization: null,
    stockBorrowedUsd: null,
    error: input.message,
  });
}

interface ReserveBucket {
  collateral: number | null;
  stockBorrowed: number | null;
  stableBorrowed: number | null;
  lendSupply: number | null;
  points: ApyPoint[];
  sawEquity: boolean;
  sawStable: boolean;
}

function emptyBucket(): ReserveBucket {
  return {
    collateral: null,
    stockBorrowed: null,
    stableBorrowed: null,
    lendSupply: null,
    points: [],
    sawEquity: false,
    sawStable: false,
  };
}

function addAmount(current: number | null, value: number | null, seen: boolean): { next: number | null; seen: boolean } {
  if (value === null) return { next: current, seen };
  return { next: (current ?? 0) + value, seen: true };
}

export function parseKaminoReserveMetrics(payload: unknown, options: {
  id: string;
  venue: string;
  equityMints: ReadonlySet<string>;
  source: string;
}): LendingRow {
  if (!Array.isArray(payload)) {
    return missingRow({ ...options, chainId: "solana", message: "Kamino reserve metrics were not a list." });
  }
  const bucket = emptyBucket();
  const assets: LendingAsset[] = [];
  for (const item of payload) {
    if (!item || typeof item !== "object") continue;
    const row = item as {
      liquidityToken?: unknown;
      liquidityTokenMint?: unknown;
      totalSupplyUsd?: unknown;
      totalBorrowUsd?: unknown;
      borrowApy?: unknown;
      maxLtv?: unknown;
    };
    const mint = asNonEmptyString(row.liquidityTokenMint);
    if (!mint) continue;
    const supply = usd(row.totalSupplyUsd);
    const borrow = usd(row.totalBorrowUsd);
    if (options.equityMints.has(mint)) {
      bucket.sawEquity = true;
      const collateral = addAmount(bucket.collateral, supply, bucket.sawEquity);
      bucket.collateral = collateral.next;
      const shorts = addAmount(bucket.stockBorrowed, borrow, true);
      bucket.stockBorrowed = shorts.next;
      assets.push({
        symbol: asNonEmptyString(row.liquidityToken) ?? mint,
        address: mint,
        collateralUsd: supply,
        collateralTokens: null,
        maxLtv: unitFraction(row.maxLtv),
      });
      continue;
    }
    if (!isStableSymbol(row.liquidityToken)) continue;
    bucket.sawStable = true;
    bucket.lendSupply = addAmount(bucket.lendSupply, supply, true).next;
    bucket.stableBorrowed = addAmount(bucket.stableBorrowed, borrow, true).next;
    bucket.points.push({ apy: fractionFromRate(row.borrowApy), weight: borrow });
  }
  if (!bucket.sawEquity) {
    return missingRow({
      ...options,
      chainId: "solana",
      message: "No verified xStock reserves in this Kamino market.",
    });
  }
  return rowShell({
    id: options.id,
    venue: options.venue,
    chainId: "solana",
    source: options.source,
    collateralUsd: bucket.collateral,
    stableBorrowedUsd: bucket.sawStable ? bucket.stableBorrowed : null,
    lendSupplyUsd: bucket.sawStable ? bucket.lendSupply : null,
    points: bucket.points,
    stockBorrowedUsd: bucket.stockBorrowed,
    assets: sortAssets(assets),
  });
}

interface JupiterToken {
  address: string;
  symbol: string;
  decimals: number;
  price: number | null;
}

function jupiterToken(value: unknown): JupiterToken | null {
  if (!value || typeof value !== "object") return null;
  const row = value as { address?: unknown; symbol?: unknown; decimals?: unknown; price?: unknown };
  const address = asNonEmptyString(row.address);
  const symbol = asNonEmptyString(row.symbol) ?? "";
  const decimals = asReportedNumber(row.decimals);
  if (!address || decimals === null || decimals < 0 || decimals > 18) return null;
  return { address, symbol, decimals, price: usd(row.price) };
}

function baseUnitsUsd(amount: unknown, token: JupiterToken): number | null {
  const tokens = tokenCount(amount, token.decimals);
  if (tokens === null || token.price === null) return null;
  return tokens * token.price;
}

function tokenCount(amount: unknown, decimals: number): number | null {
  const raw = asReportedNumber(amount);
  if (raw === null || raw < 0 || decimals < 0 || decimals > 18) return null;
  const tokens = raw / 10 ** decimals;
  return Number.isFinite(tokens) ? tokens : null;
}

export function parseJupiterLend(input: {
  vaults: unknown;
  liquidityTokens: unknown;
  equityMints: ReadonlySet<string>;
  source: string;
}): LendingRow {
  const id = "jupiter-lend";
  const venue = "Jupiter Lend";
  if (!Array.isArray(input.vaults)) {
    return missingRow({ id, venue, chainId: "solana", source: input.source, message: "Jupiter borrow vaults were not a list." });
  }
  if (input.equityMints.size === 0) {
    return missingRow({
      id,
      venue,
      chainId: "solana",
      source: input.source,
      message: "xStock mint list was empty, so Jupiter vaults were not matched.",
    });
  }
  let collateral = 0;
  let collateralSeen = false;
  let borrowed = 0;
  let borrowedSeen = false;
  let unpriced = 0;
  const points: ApyPoint[] = [];
  const assets: LendingAsset[] = [];
  const xStockBorrowByToken = new Map<string, number>();
  const allBorrowByToken = new Map<string, number>();

  for (const item of input.vaults) {
    if (!item || typeof item !== "object") continue;
    const vault = item as {
      supplyToken?: unknown;
      borrowToken?: unknown;
      totalSupply?: unknown;
      totalBorrow?: unknown;
      borrowRate?: unknown;
      collateralFactor?: unknown;
    };
    const supplyToken = jupiterToken(vault.supplyToken);
    const borrowToken = jupiterToken(vault.borrowToken);
    if (!borrowToken) continue;
    const borrowUsd = baseUnitsUsd(vault.totalBorrow, borrowToken);
    if (borrowUsd !== null) allBorrowByToken.set(borrowToken.address, (allBorrowByToken.get(borrowToken.address) ?? 0) + borrowUsd);
    if (!supplyToken || !input.equityMints.has(supplyToken.address)) continue;
    const supplyUsd = baseUnitsUsd(vault.totalSupply, supplyToken);
    const supplyTokens = tokenCount(vault.totalSupply, supplyToken.decimals);
    if (supplyUsd === null || borrowUsd === null) {
      unpriced += 1;
      continue;
    }
    collateral += supplyUsd;
    collateralSeen = true;
    borrowed += borrowUsd;
    borrowedSeen = true;
    xStockBorrowByToken.set(borrowToken.address, (xStockBorrowByToken.get(borrowToken.address) ?? 0) + borrowUsd);
    points.push({ apy: fractionFromRate(vault.borrowRate), weight: borrowUsd });
    const existing = assets.find((asset) => asset.address === supplyToken.address);
    const maxLtv = jupiterLtv(vault.collateralFactor);
    if (existing) {
      existing.collateralUsd = (existing.collateralUsd ?? 0) + supplyUsd;
      existing.collateralTokens = supplyTokens === null ? existing.collateralTokens : (existing.collateralTokens ?? 0) + supplyTokens;
      if (maxLtv !== null && (existing.maxLtv === null || maxLtv > existing.maxLtv)) existing.maxLtv = maxLtv;
    } else {
      assets.push({
        symbol: supplyToken.symbol || supplyToken.address,
        address: supplyToken.address,
        collateralUsd: supplyUsd,
        collateralTokens: supplyTokens,
        maxLtv,
      });
    }
  }

  if (!collateralSeen) {
    return missingRow({
      id,
      venue,
      chainId: "solana",
      source: input.source,
      message: unpriced > 0 ? "Jupiter xStock vaults had no priced collateral." : "No xStock collateral vaults on Jupiter Lend.",
    });
  }

  return rowShell({
    id,
    venue,
    chainId: "solana",
    source: input.source,
    collateralUsd: collateral,
    stableBorrowedUsd: borrowedSeen ? borrowed : null,
    lendSupplyUsd: null,
    utilization: jupiterPoolUtilization(input.liquidityTokens, xStockBorrowByToken, allBorrowByToken),
    points,
    stockBorrowedUsd: null,
    assets: sortAssets(assets),
    error: unpriced > 0 ? `${unpriced} xStock vault${unpriced === 1 ? "" : "s"} had no price and were left out.` : null,
  });
}

function jupiterPoolUtilization(
  liquidityTokens: unknown,
  xStockBorrowByToken: ReadonlyMap<string, number>,
  allBorrowByToken: ReadonlyMap<string, number>,
): number | null {
  if (!Array.isArray(liquidityTokens) || xStockBorrowByToken.size === 0) return null;
  const supplyByAsset = new Map<string, number>();
  for (const item of liquidityTokens) {
    if (!item || typeof item !== "object") continue;
    const row = item as { asset?: unknown; decimals?: unknown; liquiditySupplyData?: { supply?: unknown } };
    const asset = jupiterToken(row.asset);
    if (!asset) continue;
    const supply = baseUnitsUsd(row.liquiditySupplyData?.supply, { ...asset, decimals: asset.decimals });
    if (supply === null || !(supply > 0)) continue;
    supplyByAsset.set(asset.address, supply);
  }
  let weighted = 0;
  let weight = 0;
  for (const [address, xStockBorrow] of xStockBorrowByToken) {
    if (!(xStockBorrow > 0)) continue;
    const supply = supplyByAsset.get(address);
    const poolBorrow = allBorrowByToken.get(address);
    if (supply === undefined || poolBorrow === undefined) continue;
    const utilization = poolBorrow / supply;
    if (!Number.isFinite(utilization) || utilization < 0 || utilization > 1.05) continue;
    weighted += utilization * xStockBorrow;
    weight += xStockBorrow;
  }
  if (!(weight > 0)) return null;
  return weighted / weight;
}

interface MorphoMarket {
  chainId: number;
  collateral: string | null;
  loan: string | null;
  loanSymbol: string | null;
  collateralSymbol: string | null;
  collateralUsd: number | null;
  borrowUsd: number | null;
  supplyUsd: number | null;
  borrowApy: number | null;
  lltv: number | null;
}

function parseMorphoMarket(value: unknown, chainId: number): MorphoMarket | null {
  if (!value || typeof value !== "object") return null;
  const row = value as {
    loanAsset?: { address?: unknown; symbol?: unknown } | null;
    collateralAsset?: { address?: unknown; symbol?: unknown } | null;
    state?: {
      collateralAssetsUsd?: unknown;
      borrowAssetsUsd?: unknown;
      supplyAssetsUsd?: unknown;
      borrowApy?: unknown;
    } | null;
  };
  const loan = asNonEmptyString(row.loanAsset?.address)?.toLowerCase() ?? null;
  const collateral = asNonEmptyString(row.collateralAsset?.address)?.toLowerCase() ?? null;
  return {
    chainId,
    collateral,
    loan,
    loanSymbol: asNonEmptyString(row.loanAsset?.symbol),
    collateralSymbol: asNonEmptyString(row.collateralAsset?.symbol),
    collateralUsd: usd(row.state?.collateralAssetsUsd),
    borrowUsd: usd(row.state?.borrowAssetsUsd),
    supplyUsd: usd(row.state?.supplyAssetsUsd),
    borrowApy: fractionFromRate(row.state?.borrowApy),
    lltv: wadFraction((row as { lltv?: unknown }).lltv ?? (row.state as { lltv?: unknown } | null)?.lltv),
  };
}

export function parseMorphoMarkets(payload: unknown, options: {
  chainId: number;
  book: EquityAddressBook;
  source: string;
}): LendingRow {
  const deskChain = evmChainKey(options.chainId);
  const id = `morpho-${deskChain ?? options.chainId}`;
  const venue = "Morpho";
  const chainId = deskChain ?? String(options.chainId);
  if (!deskChain) {
    return missingRow({ id, venue, chainId, source: options.source, message: "Morpho chain is not a lending desk chain." });
  }
  const equities = options.book.evm.get(options.chainId);
  if (!equities || equities.size === 0) {
    return missingRow({
      id,
      venue,
      chainId,
      source: options.source,
      message: "Verified token addresses were missing, so Morpho was not matched by symbol.",
    });
  }
  const markets = Array.isArray(payload) ? payload : null;
  if (!markets) {
    return missingRow({ id, venue, chainId, source: options.source, message: "Morpho markets were not a list." });
  }
  let collateral = 0;
  let collateralSeen = false;
  let borrowed = 0;
  let borrowedSeen = false;
  let supply = 0;
  let supplySeen = false;
  let stockBorrowed = 0;
  let stockSeen = false;
  const points: ApyPoint[] = [];
  const assetMap = new Map<string, LendingAsset>();
  let matched = 0;
  for (const item of markets) {
    const market = parseMorphoMarket(item, options.chainId);
    if (!market) continue;
    const collateralIsEquity = market.collateral !== null && equities.has(market.collateral);
    const loanIsEquity = market.loan !== null && equities.has(market.loan);
    if (!collateralIsEquity && !loanIsEquity) continue;
    matched += 1;
    if (loanIsEquity && !collateralIsEquity) {
      if (market.borrowUsd !== null) {
        stockBorrowed += market.borrowUsd;
        stockSeen = true;
      }
      continue;
    }
    if (!collateralIsEquity || market.collateral === null) continue;
    if (market.collateralUsd !== null) {
      collateral += market.collateralUsd;
      collateralSeen = true;
    }
    rememberAsset(assetMap, {
      symbol: market.collateralSymbol ?? market.collateral,
      address: market.collateral,
      collateralUsd: market.collateralUsd,
      collateralTokens: null,
      maxLtv: market.lltv,
    });
    const loanIsStable = market.loan !== null && !equities.has(market.loan) && isStableSymbol(market.loanSymbol);
    if (!loanIsStable) {
      if (loanIsEquity && market.borrowUsd !== null) {
        stockBorrowed += market.borrowUsd;
        stockSeen = true;
      }
      continue;
    }
    if (market.borrowUsd !== null) {
      borrowed += market.borrowUsd;
      borrowedSeen = true;
      points.push({ apy: market.borrowApy, weight: market.borrowUsd });
    }
    if (market.supplyUsd !== null) {
      supply += market.supplyUsd;
      supplySeen = true;
    }
  }
  if (matched === 0) {
    return missingRow({
      id,
      venue,
      chainId,
      source: options.source,
      message: "No Morpho markets used a verified stock token as collateral.",
    });
  }
  return rowShell({
    id,
    venue,
    chainId,
    source: options.source,
    collateralUsd: collateralSeen ? collateral : null,
    stableBorrowedUsd: borrowedSeen ? borrowed : null,
    lendSupplyUsd: supplySeen ? supply : null,
    points,
    stockBorrowedUsd: stockSeen ? stockBorrowed : null,
    assets: sortAssets([...assetMap.values()]),
  });
}

interface AaveAsset {
  address: string | null;
  symbol: string | null;
  suppliedUsd: number | null;
  borrowedUsd: number | null;
  borrowApy: number | null;
  utilization: number | null;
}

function parseAaveAsset(value: unknown): AaveAsset | null {
  if (!value || typeof value !== "object") return null;
  const row = value as {
    underlying?: { address?: unknown; info?: { symbol?: unknown } };
    summary?: {
      supplied?: { exchange?: { value?: unknown } };
      borrowed?: { exchange?: { value?: unknown } };
      borrowApy?: { normalized?: unknown; value?: unknown };
      utilizationRate?: { normalized?: unknown; value?: unknown };
    };
  };
  return {
    address: asNonEmptyString(row.underlying?.address)?.toLowerCase() ?? null,
    symbol: asNonEmptyString(row.underlying?.info?.symbol),
    suppliedUsd: usd(row.summary?.supplied?.exchange?.value),
    borrowedUsd: usd(row.summary?.borrowed?.exchange?.value),
    borrowApy: aaveFraction(row.summary?.borrowApy),
    utilization: aaveFraction(row.summary?.utilizationRate),
  };
}

export function parseAaveEquitiesHub(payload: unknown, options: {
  equityAddresses: ReadonlySet<string> | null;
  source: string;
}): LendingRow {
  const id = "aave-v4-base-coinbase";
  const venue = "Aave V4 Coinbase stocks";
  if (!Array.isArray(payload)) {
    return missingRow({ id, venue, chainId: "base", source: options.source, message: "Aave hub assets were not a list." });
  }
  if (options.equityAddresses && options.equityAddresses.size === 0) {
    return missingRow({
      id,
      venue,
      chainId: "base",
      source: options.source,
      message: "Base token addresses were missing, so the Aave hub was not matched.",
    });
  }
  let collateral = 0;
  let collateralSeen = false;
  let borrowed = 0;
  let borrowedSeen = false;
  let supply = 0;
  let supplySeen = false;
  let stockBorrowed = 0;
  let stockSeen = false;
  const points: ApyPoint[] = [];
  const assets: LendingAsset[] = [];
  let matched = 0;
  for (const item of payload) {
    const asset = parseAaveAsset(item);
    if (!asset) continue;
    const stable = isStableSymbol(asset.symbol);
    if (!stable) {
      if (options.equityAddresses && (asset.address === null || !options.equityAddresses.has(asset.address))) continue;
      matched += 1;
      if (asset.suppliedUsd !== null) {
        collateral += asset.suppliedUsd;
        collateralSeen = true;
      }
      if (asset.borrowedUsd !== null) {
        stockBorrowed += asset.borrowedUsd;
        stockSeen = true;
      }
      if (asset.address) {
        assets.push({
          symbol: asset.symbol ?? asset.address,
          address: asset.address,
          collateralUsd: asset.suppliedUsd,
          collateralTokens: null,
          maxLtv: null,
        });
      }
      continue;
    }
    matched += 1;
    if (asset.suppliedUsd !== null) {
      supply += asset.suppliedUsd;
      supplySeen = true;
    }
    if (asset.borrowedUsd !== null) {
      borrowed += asset.borrowedUsd;
      borrowedSeen = true;
      points.push({ apy: asset.borrowApy, weight: asset.borrowedUsd });
    }
  }
  if (matched === 0) {
    return missingRow({
      id,
      venue,
      chainId: "base",
      source: options.source,
      message: "Aave Coinbase stocks hub had no verified assets.",
    });
  }
  return rowShell({
    id,
    venue,
    chainId: "base",
    source: options.source,
    collateralUsd: collateralSeen ? collateral : null,
    stableBorrowedUsd: borrowedSeen ? borrowed : null,
    lendSupplyUsd: supplySeen ? supply : null,
    points,
    stockBorrowedUsd: stockSeen ? stockBorrowed : null,
    assets: sortAssets(assets),
  });
}

export interface VenusBorrowEstimateInput {
  usd: number;
  lowerBoundUsd: number | null;
  method: string;
  asOf: string;
}

export function parseVenusMarkets(
  payload: unknown,
  source: string,
  options?: { equityAddresses?: ReadonlySet<string> | null; estimate?: VenusBorrowEstimateInput | null },
): LendingRow {
  const id = "venus-bnb";
  const venue = "Venus";
  const result = payload && typeof payload === "object" && Array.isArray((payload as { result?: unknown }).result)
    ? (payload as { result: unknown[] }).result
    : Array.isArray(payload)
      ? payload
      : null;
  if (!result) {
    return missingRow({ id, venue, chainId: "bnb", source, message: "Venus markets were not a list." });
  }
  let collateral = 0;
  let collateralSeen = false;
  let stockBorrowed = 0;
  let stockSeen = false;
  let bstocks = 0;
  const assets: LendingAsset[] = [];
  const allow = options?.equityAddresses;
  const requireAddress = allow !== undefined && allow !== null && allow.size > 0;
  for (const item of result) {
    if (!item || typeof item !== "object") continue;
    const row = item as {
      category?: unknown;
      underlyingSymbol?: unknown;
      underlyingAddress?: unknown;
      totalSupplyUnderlyingCents?: unknown;
      totalBorrowCents?: unknown;
      collateralFactorMantissa?: unknown;
    };
    if (asNonEmptyString(row.category) !== "bstocks") continue;
    const address = asNonEmptyString(row.underlyingAddress)?.toLowerCase() ?? null;
    if (requireAddress && (address === null || !allow.has(address))) continue;
    bstocks += 1;
    const supplyCents = usd(row.totalSupplyUnderlyingCents);
    const borrowCents = usd(row.totalBorrowCents);
    const supplyUsd = supplyCents === null ? null : supplyCents / 100;
    if (supplyUsd !== null) {
      collateral += supplyUsd;
      collateralSeen = true;
    }
    if (borrowCents !== null) {
      stockBorrowed += borrowCents / 100;
      stockSeen = true;
    }
    if (address) {
      assets.push({
        symbol: asNonEmptyString(row.underlyingSymbol) ?? address,
        address,
        collateralUsd: supplyUsd,
        collateralTokens: null,
        maxLtv: venusFraction(row.collateralFactorMantissa),
      });
    }
  }
  if (bstocks === 0) {
    return missingRow({ id, venue, chainId: "bnb", source, message: "Venus returned no bStocks markets." });
  }
  const estimate = options?.estimate ?? null;
  return rowShell({
    id,
    venue,
    chainId: "bnb",
    source,
    collateralUsd: collateralSeen ? collateral : null,
    stableBorrowedUsd: estimate ? estimate.usd : null,
    lendSupplyUsd: null,
    utilization: null,
    stockBorrowedUsd: stockSeen ? stockBorrowed : null,
    assets: sortAssets(assets),
    note: venusNote(estimate),
    borrowEstimate: estimate
      ? { method: estimate.method, asOf: estimate.asOf, lowerBoundUsd: estimate.lowerBoundUsd }
      : null,
  });
}

export function parseListaBStock(payload: unknown, source: string): LendingRow {
  const id = "lista-bnb";
  const venue = "Lista";
  const data = payload && typeof payload === "object" ? (payload as { data?: unknown; bStock?: unknown }).data ?? payload : null;
  const bStock = data && typeof data === "object" ? (data as { bStock?: unknown }).bStock : null;
  if (!bStock || typeof bStock !== "object") {
    return missingRow({ id, venue, chainId: "bnb", source, message: "Lista bStock totals were missing." });
  }
  const book = bStock as { totalCollateral?: unknown; totalBorrowed?: unknown; totalAvailable?: unknown };
  const collateral = usd(book.totalCollateral);
  const borrowed = usd(book.totalBorrowed);
  const available = usd(book.totalAvailable);
  const supply = borrowed !== null && available !== null ? borrowed + available : null;
  return rowShell({
    id,
    venue,
    chainId: "bnb",
    source,
    collateralUsd: collateral,
    stableBorrowedUsd: borrowed,
    lendSupplyUsd: supply,
    stockBorrowedUsd: null,
  });
}

export function listaBorrowApy(markets: unknown): { borrowApy: number | null; borrowApyMin: number | null; borrowApyMax: number | null } {
  if (!Array.isArray(markets)) return { borrowApy: null, borrowApyMin: null, borrowApyMax: null };
  const points: ApyPoint[] = [];
  for (const item of markets) {
    if (!item || typeof item !== "object") continue;
    const row = item as { rate?: unknown; totalBorrowAsset?: unknown; loan?: unknown };
    if (!isStableSymbol(row.loan)) continue;
    const weight = usd(row.totalBorrowAsset);
    const apy = fractionFromRate(row.rate);
    if (weight === null || !(weight > 0) || apy === null) continue;
    points.push({ apy, weight });
  }
  return lendingApyBand(points);
}

export function withListaApy(row: LendingRow, markets: unknown): LendingRow {
  if (row.error && row.collateralUsd === null && row.stableBorrowedUsd === null) return row;
  const band = listaBorrowApy(markets);
  return { ...row, ...band };
}

export function noteFromRow(row: LendingRow): LendingSourceNote | null {
  if (!row.error) return null;
  return { source: row.venue, message: row.error };
}

/** bStock beacon proxy. Zone-5 collateral is checked against this, not against a symbol. */
export const BSTOCK_BEACON = "0x156d6dce9a4f6139a3406f1f021f1a4880de93a3";

export function tokenAmountUsd(raw: unknown, price: unknown, decimals = 18): number | null {
  const amount = asReportedNumber(raw);
  const px = asReportedNumber(price);
  if (amount === null || px === null || decimals < 0 || decimals > 36) return null;
  const usdValue = (amount / 10 ** decimals) * px;
  if (!Number.isFinite(usdValue) || usdValue < 0) return null;
  return usdValue;
}

/**
 * Lista dollars come from the bStock block on /overall.
 * The market set is allMarkets zone 5 only. A market where a bStock is the loan
 * (someone borrowing the stock) is stock-token lending, not collateral.
 * Collateral addresses that are positively not on the bStock beacon are left out,
 * and the headline totals stay blank rather than mixing them in.
 */
export function parseListaBook(input: {
  overall: unknown;
  markets: unknown;
  rejectedCollateral?: ReadonlySet<string> | null;
  symbols?: ReadonlyMap<string, string>;
  loanPrices?: ReadonlyMap<string, number>;
  rates?: readonly ApyPoint[];
  source: string;
}): LendingRow {
  const id = "lista-bnb";
  const venue = "Lista";
  const parsed = parseListaMarketParams(input.markets);
  if (!parsed) {
    return missingRow({ id, venue, chainId: "bnb", source: input.source, message: "Lista markets were not a list." });
  }
  const rejected = input.rejectedCollateral ?? new Set<string>();
  const zone5 = parsed.filter((market) => market.zone === 5 && isBsc(market.chain));
  if (zone5.length === 0) {
    return missingRow({ id, venue, chainId: "bnb", source: input.source, message: "Lista returned no zone-5 bStock markets." });
  }
  const dropped = zone5.filter((market) => rejected.has(market.collateralToken));
  const kept = zone5.filter((market) => !rejected.has(market.collateralToken));
  const collateralTokens = new Set(kept.map((market) => market.collateralToken));
  const tops = listaTopCollateral(input.overall);
  const assetMap = new Map<string, LendingAsset>();
  for (const market of kept) {
    const top = tops.get(market.collateralToken);
    const current = assetMap.get(market.collateralToken);
    const symbol = input.symbols?.get(market.collateralToken) ?? top?.symbol ?? market.collateralToken;
    if (!current) {
      assetMap.set(market.collateralToken, {
        symbol,
        address: market.collateralToken,
        collateralUsd: top?.usd ?? null,
        collateralTokens: null,
        maxLtv: market.lltv,
      });
      continue;
    }
    if (market.lltv !== null && (current.maxLtv === null || market.lltv > current.maxLtv)) current.maxLtv = market.lltv;
    if (symbol !== market.collateralToken) current.symbol = symbol;
  }
  const stock = listaStockBorrowed(parsed, collateralTokens, input.loanPrices);
  const assets = sortAssets([...assetMap.values()]);
  if (dropped.length > 0) {
    return rowShell({
      id,
      venue,
      chainId: "bnb",
      source: input.source,
      collateralUsd: null,
      stableBorrowedUsd: null,
      lendSupplyUsd: null,
      utilization: null,
      stockBorrowedUsd: stock.usd,
      assets,
      note: `${dropped.length} zone-5 collateral token${dropped.length === 1 ? "" : "s"} ${dropped.length === 1 ? "is" : "are"} not on the bStock beacon, so Lista totals are left blank.`,
      error: stock.unpriced ? "A bStock loan market had borrow without a price, so stock-token lending was left blank." : null,
    });
  }
  const base = parseListaBStock(input.overall, input.source);
  const band = input.rates ? lendingApyBand(input.rates) : null;
  return {
    ...base,
    stockBorrowedUsd: stock.usd,
    assets,
    note: null,
    borrowApy: band ? band.borrowApy : base.borrowApy,
    borrowApyMin: band ? band.borrowApyMin : base.borrowApyMin,
    borrowApyMax: band ? band.borrowApyMax : base.borrowApyMax,
    error: stock.unpriced ? "A bStock loan market had borrow without a price, so stock-token lending was left blank." : base.error,
  };
}

function listaStockBorrowed(
  markets: readonly ListaMarketParam[],
  collateralTokens: ReadonlySet<string>,
  prices: ReadonlyMap<string, number> | undefined,
): { usd: number | null; unpriced: boolean } {
  let usdSum = 0;
  let seen = false;
  for (const market of markets) {
    if (market.zone === 5) continue;
    if (!collateralTokens.has(market.loanToken)) continue;
    if (market.totalBorrowAssets === null || !(market.totalBorrowAssets > 0)) continue;
    const price = prices?.get(market.id);
    const borrowUsd = price === undefined ? null : tokenAmountUsd(market.totalBorrowAssets, price);
    if (borrowUsd === null) return { usd: null, unpriced: true };
    usdSum += borrowUsd;
    seen = true;
  }
  return { usd: seen ? usdSum : null, unpriced: false };
}

interface ListaMarketParam {
  id: string;
  zone: number;
  chain: string;
  collateralToken: string;
  loanToken: string;
  lltv: number | null;
  totalBorrowAssets: number | null;
}

function parseListaMarketParams(payload: unknown): ListaMarketParam[] | null {
  const list = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as { data?: unknown }).data)
      ? (payload as { data: unknown[] }).data
      : null;
  if (!list) return null;
  const markets: ListaMarketParam[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const row = item as {
      id?: unknown;
      zone?: unknown;
      chain?: unknown;
      collateralToken?: unknown;
      loanToken?: unknown;
      lltv?: unknown;
      totalBorrowAssets?: unknown;
    };
    const collateralToken = asNonEmptyString(row.collateralToken)?.toLowerCase();
    const loanToken = asNonEmptyString(row.loanToken)?.toLowerCase();
    const id = asNonEmptyString(row.id)?.toLowerCase();
    const zone = asReportedNumber(row.zone);
    if (!collateralToken || !loanToken || !id || zone === null) continue;
    markets.push({
      id,
      zone,
      chain: asNonEmptyString(row.chain)?.toLowerCase() ?? "",
      collateralToken,
      loanToken,
      lltv: wadFraction(row.lltv),
      totalBorrowAssets: asReportedNumber(row.totalBorrowAssets),
    });
  }
  return markets;
}

function listaTopCollateral(payload: unknown): Map<string, { symbol: string; usd: number | null }> {
  const map = new Map<string, { symbol: string; usd: number | null }>();
  const data = payload && typeof payload === "object" ? ((payload as { data?: unknown }).data ?? payload) : null;
  const bStock = data && typeof data === "object" ? (data as { bStock?: unknown }).bStock : null;
  const tops = bStock && typeof bStock === "object" ? (bStock as { topCollateralTokens?: unknown }).topCollateralTokens : null;
  if (!Array.isArray(tops)) return map;
  for (const item of tops) {
    if (!item || typeof item !== "object") continue;
    const row = item as { tokenAddress?: unknown; tokenSymbol?: unknown; collateralUsd?: unknown };
    const address = asNonEmptyString(row.tokenAddress)?.toLowerCase();
    if (!address) continue;
    map.set(address, {
      symbol: asNonEmptyString(row.tokenSymbol) ?? address,
      usd: usd(row.collateralUsd),
    });
  }
  return map;
}

function isBsc(chain: string): boolean {
  return chain === "bsc" || chain === "bnb" || chain === "56";
}

function rememberAsset(map: Map<string, LendingAsset>, asset: LendingAsset) {
  const key = asset.address.toLowerCase();
  const current = map.get(key);
  if (!current) {
    map.set(key, { ...asset, address: key });
    return;
  }
  if (asset.collateralUsd !== null) current.collateralUsd = (current.collateralUsd ?? 0) + asset.collateralUsd;
  if (asset.collateralTokens !== null) current.collateralTokens = (current.collateralTokens ?? 0) + asset.collateralTokens;
  if (asset.maxLtv !== null && (current.maxLtv === null || asset.maxLtv > current.maxLtv)) current.maxLtv = asset.maxLtv;
  if (asset.symbol && asset.symbol !== key) current.symbol = asset.symbol;
}

function sortAssets(assets: readonly LendingAsset[]): LendingAsset[] {
  return [...assets].sort((a, b) => {
    const byUsd = (b.collateralUsd ?? -1) - (a.collateralUsd ?? -1);
    if (byUsd !== 0) return byUsd;
    return a.symbol.localeCompare(b.symbol);
  });
}

function unitFraction(value: unknown): number | null {
  const parsed = asReportedNumber(value);
  if (parsed === null || parsed < 0 || parsed > 1.05) return null;
  return parsed;
}

/** Jupiter collateral factors are in thousandths. 650 means 65%. */
function jupiterLtv(value: unknown): number | null {
  const parsed = asReportedNumber(value);
  if (parsed === null || parsed < 0) return null;
  const fraction = parsed > 1 ? parsed / 1000 : parsed;
  if (fraction > 1.05) return null;
  return fraction;
}

function wadFraction(value: unknown): number | null {
  const parsed = asReportedNumber(value);
  if (parsed === null || parsed < 0) return null;
  const fraction = parsed > 5 ? parsed / 1e18 : parsed;
  if (fraction > 1.05) return null;
  return fraction;
}

function venusFraction(value: unknown): number | null {
  return wadFraction(value);
}

function venusNote(estimate: VenusBorrowEstimateInput | null): string {
  const shared = "These stocks sit in Venus's shared pool with other coins.";
  if (!estimate) {
    return `${shared} Dollars borrowed, how full, and the yearly cost stay blank, because those dollars are mixed. Borrowing the stock tokens themselves is turned off.`;
  }
  const lower =
    estimate.lowerBoundUsd === null
      ? ""
      : ` Accounts that use only these stocks as collateral have borrowed ${formatUsdCompact(estimate.lowerBoundUsd)}.`;
  return `${shared} Dollars borrowed are an estimate: each account's borrow times the share of its borrowing power that comes from these stocks.${lower} How full and the yearly cost are not available. Borrowing the stock tokens themselves is turned off.`;
}
