import type { EquityAddressBook } from "./lending-addresses";
import { evmChainKey } from "./lending-addresses";
import {
  lendingApyBand,
  lendingChainLabel,
  lendingUtilization,
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
  for (const item of payload) {
    if (!item || typeof item !== "object") continue;
    const row = item as {
      liquidityToken?: unknown;
      liquidityTokenMint?: unknown;
      totalSupplyUsd?: unknown;
      totalBorrowUsd?: unknown;
      borrowApy?: unknown;
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
  const raw = asReportedNumber(amount);
  if (raw === null || raw < 0 || token.price === null) return null;
  return (raw / 10 ** token.decimals) * token.price;
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
    };
    const supplyToken = jupiterToken(vault.supplyToken);
    const borrowToken = jupiterToken(vault.borrowToken);
    if (!borrowToken) continue;
    const borrowUsd = baseUnitsUsd(vault.totalBorrow, borrowToken);
    if (borrowUsd !== null) allBorrowByToken.set(borrowToken.address, (allBorrowByToken.get(borrowToken.address) ?? 0) + borrowUsd);
    if (!supplyToken || !input.equityMints.has(supplyToken.address)) continue;
    const supplyUsd = baseUnitsUsd(vault.totalSupply, supplyToken);
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
  collateralUsd: number | null;
  borrowUsd: number | null;
  supplyUsd: number | null;
  borrowApy: number | null;
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
    collateralUsd: usd(row.state?.collateralAssetsUsd),
    borrowUsd: usd(row.state?.borrowAssetsUsd),
    supplyUsd: usd(row.state?.supplyAssetsUsd),
    borrowApy: fractionFromRate(row.state?.borrowApy),
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
    if (!collateralIsEquity) continue;
    if (market.collateralUsd !== null) {
      collateral += market.collateralUsd;
      collateralSeen = true;
    }
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
  });
}

export function parseVenusMarkets(payload: unknown, source: string): LendingRow {
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
  for (const item of result) {
    if (!item || typeof item !== "object") continue;
    const row = item as {
      category?: unknown;
      totalSupplyUnderlyingCents?: unknown;
      totalBorrowCents?: unknown;
    };
    if (asNonEmptyString(row.category) !== "bstocks") continue;
    bstocks += 1;
    const supplyCents = usd(row.totalSupplyUnderlyingCents);
    const borrowCents = usd(row.totalBorrowCents);
    if (supplyCents !== null) {
      collateral += supplyCents / 100;
      collateralSeen = true;
    }
    if (borrowCents !== null) {
      stockBorrowed += borrowCents / 100;
      stockSeen = true;
    }
  }
  if (bstocks === 0) {
    return missingRow({ id, venue, chainId: "bnb", source, message: "Venus returned no bStocks markets." });
  }
  return rowShell({
    id,
    venue,
    chainId: "bnb",
    source,
    collateralUsd: collateralSeen ? collateral : null,
    stableBorrowedUsd: null,
    lendSupplyUsd: null,
    utilization: null,
    stockBorrowedUsd: stockSeen ? stockBorrowed : null,
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
