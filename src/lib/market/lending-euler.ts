import { ANCHORED_EXCLUDED_TICKERS } from "./base-markets";
import { evmChainKey } from "./lending-addresses";
import { classifyLendingSymbol } from "./lending-stocks";
import { isStableSymbol } from "./lending-parse";
import { lendingApyBand, lendingChainLabel, lendingUtilization, type LendingAsset, type LendingRow } from "./lending-snapshot";
import { asNonEmptyString, asReportedNumber, tokenCountFromRaw } from "./numbers";

export const EULER_VAULTS = "https://v3.euler.finance/v3/evk/vaults";
export const EULER_METADATA = "https://app.euler.finance/api/public/metadata";
export const EULER_CHAINS = [1, 56, 8453] as const;

/** Euler publishes borrow APY in percent. 6.68 means 6.68% a year. */
export function eulerBorrowApy(value: unknown): number | null {
  const parsed = asReportedNumber(value);
  if (parsed === null || parsed < 0) return null;
  return parsed / 100;
}

/** Euler borrow LTV is parts per 10,000. 8000 means 80%. */
export function eulerLtv(value: unknown): number | null {
  const parsed = asReportedNumber(value);
  if (parsed === null || parsed < 0) return null;
  const fraction = parsed > 1 ? parsed / 10_000 : parsed;
  if (fraction > 1.05) return null;
  return fraction;
}

interface EulerVault {
  address: string;
  symbol: string;
  assetAddress: string;
  assetSymbol: string;
  assetDecimals: number | null;
  totalAssets: unknown;
  supplyUsd: number | null;
  borrowUsd: number | null;
  borrowApy: number | null;
  cluster: string | null;
}

interface EulerCollateral {
  assetAddress: string;
  assetSymbol: string;
  vaultAddress: string;
  borrowLtv: number | null;
}

function usd(value: unknown): number | null {
  const parsed = asReportedNumber(value);
  if (parsed === null || parsed < 0) return null;
  return parsed;
}

function listFrom(payload: unknown): unknown[] | null {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return null;
  const data = (payload as { data?: unknown }).data;
  return Array.isArray(data) ? data : null;
}

function clusterName(metadata: unknown, address: string): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const direct = (metadata as Record<string, unknown>)[address];
  const row =
    direct && typeof direct === "object"
      ? direct
      : Object.values(metadata as Record<string, unknown>).find((item) => {
          if (!item || typeof item !== "object") return false;
          return asNonEmptyString((item as { address?: unknown }).address)?.toLowerCase() === address;
        });
  if (!row || typeof row !== "object") return null;
  return asNonEmptyString((row as { name?: unknown }).name);
}

function readVault(value: unknown, metadata: unknown): EulerVault | null {
  if (!value || typeof value !== "object") return null;
  const row = value as {
    address?: unknown;
    symbol?: unknown;
    asset?: { address?: unknown; symbol?: unknown; decimals?: unknown };
    totalAssets?: unknown;
    totalSupplyUsd?: unknown;
    totalBorrowsUsd?: unknown;
    borrowApy?: unknown;
  };
  const address = asNonEmptyString(row.address)?.toLowerCase();
  const assetAddress = asNonEmptyString(row.asset?.address)?.toLowerCase();
  const assetSymbol = asNonEmptyString(row.asset?.symbol);
  if (!address || !assetAddress || !assetSymbol) return null;
  const decimals = asReportedNumber(row.asset?.decimals);
  return {
    address,
    symbol: asNonEmptyString(row.symbol) ?? assetSymbol,
    assetAddress,
    assetSymbol,
    assetDecimals: decimals !== null && Number.isInteger(decimals) && decimals >= 0 && decimals <= 36 ? decimals : null,
    totalAssets: row.totalAssets,
    supplyUsd: usd(row.totalSupplyUsd),
    borrowUsd: usd(row.totalBorrowsUsd),
    borrowApy: eulerBorrowApy(row.borrowApy),
    cluster: clusterName(metadata, address),
  };
}

export function parseEulerCollateralList(payload: unknown): EulerCollateral[] {
  const list = listFrom(payload) ?? (Array.isArray(payload) ? payload : null);
  if (!list) return [];
  const out: EulerCollateral[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const row = item as {
      asset?: unknown;
      assetSymbol?: unknown;
      collateral?: unknown;
      borrowLTV?: unknown;
    };
    const assetAddress = asNonEmptyString(row.asset)?.toLowerCase();
    const assetSymbol = asNonEmptyString(row.assetSymbol);
    const vaultAddress = asNonEmptyString(row.collateral)?.toLowerCase();
    if (!assetAddress || !assetSymbol || !vaultAddress) continue;
    out.push({
      assetAddress,
      assetSymbol,
      vaultAddress,
      borrowLtv: eulerLtv(row.borrowLTV),
    });
  }
  return out;
}

function isPublicStock(address: string, symbol: string, chainId: string, equities: ReadonlySet<string>): boolean {
  if (!equities.has(address)) return false;
  const ticker = classifyLendingSymbol(symbol, chainId).ticker;
  return !ANCHORED_EXCLUDED_TICKERS.has(ticker);
}

function emptyEuler(chainId: number, source: string, message: string): LendingRow {
  const desk = evmChainKey(chainId) ?? String(chainId);
  return {
    id: `euler-${desk}`,
    venue: "Euler",
    chainId: desk,
    chainLabel: lendingChainLabel(desk),
    collateralUsd: null,
    stableBorrowedUsd: null,
    lendSupplyUsd: null,
    utilization: null,
    borrowApy: null,
    borrowApyMin: null,
    borrowApyMax: null,
    stockBorrowedUsd: null,
    source,
    error: message,
  };
}

/**
 * Stock collateral is the dollars sitting in vaults whose asset is a verified stock token.
 * Borrowed dollars count only when every collateral on that borrow vault is a stock token.
 * A mixed pool stays blank. Silver, bonds, and other non-stocks stay out.
 */
export function parseEulerChain(input: {
  chainId: number;
  vaults: unknown;
  metadata: unknown;
  collaterals: Readonly<Record<string, unknown>> | null;
  equityAddresses: ReadonlySet<string> | null;
  source?: string;
}): LendingRow {
  const source = input.source ?? EULER_VAULTS;
  const desk = evmChainKey(input.chainId);
  if (!desk) return emptyEuler(input.chainId, source, "Euler chain is not a lending desk chain.");
  if (!input.equityAddresses || input.equityAddresses.size === 0) {
    return emptyEuler(input.chainId, source, "Verified token addresses were missing, so Euler was not matched by symbol.");
  }
  const listed = listFrom(input.vaults);
  if (!listed) return emptyEuler(input.chainId, source, "Euler vaults were not a list.");

  const seen = new Set<string>();
  const vaults: EulerVault[] = [];
  for (const item of listed) {
    const vault = readVault(item, input.metadata);
    if (!vault || seen.has(vault.address)) continue;
    seen.add(vault.address);
    vaults.push(vault);
  }
  const equities = input.equityAddresses;
  const stock = vaults.filter((vault) => isPublicStock(vault.assetAddress, vault.assetSymbol, desk, equities));
  if (stock.length === 0) {
    return emptyEuler(input.chainId, source, "No Euler vault held a verified stock token.");
  }

  const ltvByAsset = new Map<string, number>();
  let borrowed = 0;
  let borrowedSeen = false;
  let supply = 0;
  let supplySeen = false;
  let stockBorrowed = 0;
  let stockBorrowedSeen = false;
  const points: { apy: number | null; weight: number | null }[] = [];
  const mixedClusters = new Set<string>();
  let mixed = false;
  let unresolved = false;
  let nonStable = false;
  const collaterals = input.collaterals ?? {};

  for (const vault of vaults) {
    const borrows = vault.borrowUsd;
    if (borrows === null || !(borrows > 0)) continue;
    if (isPublicStock(vault.assetAddress, vault.assetSymbol, desk, equities)) {
      stockBorrowed += borrows;
      stockBorrowedSeen = true;
      continue;
    }
    const listedCollateral = collaterals[vault.address];
    if (listedCollateral == null) {
      // A non-dollar borrow cannot be stablecoin debt. Skip it instead of blaming a missing list.
      if (isStableSymbol(vault.assetSymbol)) unresolved = true;
      continue;
    }
    const rawList = listFrom(listedCollateral);
    const accepted = parseEulerCollateralList(listedCollateral);
    if (!rawList || accepted.length === 0 || accepted.length !== rawList.length) {
      if (isStableSymbol(vault.assetSymbol)) unresolved = true;
      continue;
    }
    const kinds = accepted.map((item) => isPublicStock(item.assetAddress, item.assetSymbol, desk, equities));
    const anyStock = kinds.some(Boolean);
    const allStock = kinds.every(Boolean);
    if (anyStock && !allStock) {
      mixed = true;
      if (vault.cluster) mixedClusters.add(vault.cluster);
      continue;
    }
    if (!allStock) continue;
    for (const item of accepted) {
      if (item.borrowLtv === null) continue;
      const current = ltvByAsset.get(item.assetAddress);
      if (current === undefined || item.borrowLtv > current) ltvByAsset.set(item.assetAddress, item.borrowLtv);
    }
    if (!isStableSymbol(vault.assetSymbol)) {
      nonStable = true;
      continue;
    }
    borrowed += borrows;
    borrowedSeen = true;
    points.push({ apy: vault.borrowApy, weight: borrows });
    if (vault.supplyUsd !== null) {
      supply += vault.supplyUsd;
      supplySeen = true;
    }
  }

  const assets: LendingAsset[] = [];
  let collateral = 0;
  let collateralSeen = false;
  for (const vault of stock) {
    const tokens = vault.assetDecimals !== null ? tokenCountFromRaw(vault.totalAssets, vault.assetDecimals) : null;
    const held = (vault.supplyUsd !== null && vault.supplyUsd > 0) || (tokens !== null && tokens > 0);
    if (!held) continue;
    if (vault.supplyUsd !== null) {
      collateral += vault.supplyUsd;
      collateralSeen = true;
    }
    assets.push({
      symbol: vault.assetSymbol,
      address: vault.assetAddress,
      collateralUsd: vault.supplyUsd,
      collateralTokens: tokens,
      maxLtv: ltvByAsset.get(vault.assetAddress) ?? null,
      priceNote: vault.supplyUsd === null ? "Euler did not price this vault in dollars." : null,
    });
  }
  assets.sort((a, b) => (b.collateralUsd ?? -1) - (a.collateralUsd ?? -1) || a.symbol.localeCompare(b.symbol));
  if (assets.length === 0 && !collateralSeen) {
    return emptyEuler(input.chainId, source, "No Euler vault held a verified stock token.");
  }

  const notes: string[] = [];
  if (mixed) {
    const [only] = [...mixedClusters];
    notes.push(
      mixedClusters.size === 1 && only
        ? `${only} also takes things that are not stocks, so the dollars borrowed there are left blank.`
        : "Some pools also take things that are not stocks, so those borrowed dollars are left blank.",
    );
  }
  if (unresolved) notes.push("A pool's collateral list did not load, so its borrowed dollars stay blank.");
  if (nonStable) notes.push("A pool borrows a coin that is not a dollar coin, so that debt is left blank.");
  const band = lendingApyBand(points);
  const stableBorrowedUsd = borrowedSeen ? borrowed : null;
  const lendSupplyUsd = supplySeen ? supply : null;
  return {
    id: `euler-${desk}`,
    venue: "Euler",
    chainId: desk,
    chainLabel: lendingChainLabel(desk),
    collateralUsd: collateralSeen ? collateral : null,
    stableBorrowedUsd,
    lendSupplyUsd,
    utilization: lendingUtilization(stableBorrowedUsd, lendSupplyUsd),
    borrowApy: band.borrowApy,
    borrowApyMin: band.borrowApyMin,
    borrowApyMax: band.borrowApyMax,
    stockBorrowedUsd: stockBorrowedSeen ? stockBorrowed : null,
    assets,
    note: notes.length > 0 ? notes.join(" ") : null,
    source,
    error: null,
  };
}
