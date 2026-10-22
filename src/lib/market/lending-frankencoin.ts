import { formatTokenAmount, formatUsdCompact } from "./format";
import { evmChainKey } from "./lending-addresses";
import { classifyLendingSymbol } from "./lending-stocks";
import { lendingApyBand, lendingChainLabel, type LendingAsset, type LendingRow } from "./lending-snapshot";
import { asNonEmptyString, asReportedNumber, tokenCountFromRaw } from "./numbers";

export const FRANKNCOIN_STATS = "https://api.frankencoin.com/ecosystem/collateral/stats";
export const FRANKNCOIN_POSITIONS = "https://api.frankencoin.com/positions/list";

/**
 * Aktionariat private-company shares on Frankencoin.
 * Their API prices are not market prices, so they stay out of the totals.
 * The addresses are the ones the Frankencoin API lists for these shares.
 */
export const FRANKNCOIN_PRIVATE_SHARES = [
  { address: "0x2e880962a9609aa3eab4def919fe9e917e99073b", symbol: "BOSS" },
  { address: "0x8747a3114ef7f0eebd3eb337f745e31dbf81a952", symbol: "DQTS" },
  { address: "0x553c7f9c780316fc1d34b8e14ac2465ab22a090b", symbol: "REALU" },
  { address: "0x343324f53cbeee3ee6d171f2a20f005964c98047", symbol: "LENDS" },
] as const;

const PRIVATE_ADDRESSES = new Set<string>(FRANKNCOIN_PRIVATE_SHARES.map((share) => share.address));

interface FrankencoinCollateral {
  address: string;
  symbol: string;
  decimals: number | null;
  priceUsd: number | null;
  chfUsd: number | null;
  valueUsd: number | null;
  debtLimit: number | null;
}

interface OpenPosition {
  collateral: string;
  balance: number | null;
  minted: number | null;
  apy: number | null;
}

function usd(value: unknown): number | null {
  const parsed = asReportedNumber(value);
  if (parsed === null || parsed < 0) return null;
  return parsed;
}

function emptyRow(message: string, footnote: string | null): LendingRow {
  return {
    id: "frankencoin-ethereum",
    venue: "Frankencoin",
    chainId: "ethereum",
    chainLabel: lendingChainLabel("ethereum"),
    collateralUsd: null,
    stableBorrowedUsd: null,
    lendSupplyUsd: null,
    utilization: null,
    borrowApy: null,
    borrowApyMin: null,
    borrowApyMax: null,
    stockBorrowedUsd: null,
    note: null,
    footnote,
    source: FRANKNCOIN_STATS,
    error: message,
  };
}

function statsMap(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object") return null;
  const map = (payload as { map?: unknown }).map;
  if (!map || typeof map !== "object" || Array.isArray(map)) return null;
  return map as Record<string, unknown>;
}

function readCollateral(value: unknown): FrankencoinCollateral | null {
  if (!value || typeof value !== "object") return null;
  const row = value as {
    address?: unknown;
    symbol?: unknown;
    decimals?: unknown;
    chainId?: unknown;
    totalLimit?: unknown;
    totalValueLocked?: { usd?: unknown };
    price?: { usd?: unknown; chf?: unknown };
  };
  const address = asNonEmptyString(row.address)?.toLowerCase();
  const symbol = asNonEmptyString(row.symbol);
  if (!address || !symbol) return null;
  const chain = asReportedNumber(row.chainId);
  if (chain !== null && chain !== 1) return null;
  const priceUsd = usd(row.price?.usd);
  const priceChf = usd(row.price?.chf);
  const chfUsd = priceUsd !== null && priceChf !== null && priceChf > 0 ? priceUsd / priceChf : null;
  const decimals = asReportedNumber(row.decimals);
  return {
    address,
    symbol,
    decimals: decimals !== null && Number.isInteger(decimals) && decimals >= 0 && decimals <= 36 ? decimals : null,
    priceUsd,
    chfUsd,
    valueUsd: usd(row.totalValueLocked?.usd),
    debtLimit: usd(row.totalLimit),
  };
}

function positionList(payload: unknown): unknown[] | null {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return null;
  const list = (payload as { list?: unknown }).list;
  return Array.isArray(list) ? list : null;
}

function readPosition(value: unknown): OpenPosition | null {
  if (!value || typeof value !== "object") return null;
  const row = value as {
    collateral?: unknown;
    collateralBalance?: unknown;
    collateralDecimals?: unknown;
    minted?: unknown;
    annualInterestPPM?: unknown;
    zchfDecimals?: unknown;
    closed?: unknown;
    denied?: unknown;
  };
  if (row.closed === true || row.denied === true) return null;
  const collateral = asNonEmptyString(row.collateral)?.toLowerCase();
  if (!collateral) return null;
  const collateralDecimals = asReportedNumber(row.collateralDecimals);
  const zchfDecimals = asReportedNumber(row.zchfDecimals);
  const ppm = asReportedNumber(row.annualInterestPPM);
  return {
    collateral,
    balance:
      collateralDecimals !== null && Number.isInteger(collateralDecimals)
        ? tokenCountFromRaw(row.collateralBalance, collateralDecimals)
        : null,
    minted: zchfDecimals !== null && Number.isInteger(zchfDecimals) ? tokenCountFromRaw(row.minted, zchfDecimals) : null,
    apy: ppm !== null && ppm >= 0 ? ppm / 1_000_000 : null,
  };
}

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

/** One plain line. The dollar size is the API's own price, not a market price. */
export function frankencoinPrivateShareFootnote(stats: unknown): string | null {
  const map = statsMap(stats);
  if (!map) return null;
  const found: { symbol: string; usd: number | null }[] = [];
  for (const share of FRANKNCOIN_PRIVATE_SHARES) {
    const row = readCollateral(map[share.address] ?? Object.values(map).find((item) => {
      const collateral = readCollateral(item);
      return collateral?.address === share.address;
    }));
    if (!row) continue;
    found.push({ symbol: row.symbol || share.symbol, usd: row.valueUsd });
  }
  if (found.length === 0) return null;
  let usd = 0;
  let priced = false;
  for (const share of found) {
    if (share.usd === null) continue;
    usd += share.usd;
    priced = true;
  }
  const names = joinNames(found.map((share) => share.symbol));
  const size = priced ? ` The Frankencoin API prices them at about ${formatUsdCompact(usd)}.` : "";
  return `Swiss private-company shares are left out (${names}).${size} Those prices are not real market prices.`;
}

/**
 * Public stock tokens only. A debt limit is not dollars supplied to lend.
 * ZCHF debt is converted with the API's own CHF price and the row says the debt is ZCHF.
 */
export function parseFrankencoin(input: {
  stats: unknown;
  positions: unknown;
  equityAddresses: ReadonlySet<string> | null;
  source?: string;
}): LendingRow {
  const footnote = frankencoinPrivateShareFootnote(input.stats);
  const id = "frankencoin-ethereum";
  const venue = "Frankencoin";
  if (!input.equityAddresses || input.equityAddresses.size === 0) {
    return emptyRow("Verified token addresses were missing, so Frankencoin was not matched by symbol.", footnote);
  }
  const map = statsMap(input.stats);
  if (!map) return emptyRow("Frankencoin collateral stats were not a map.", footnote);
  const positions = positionList(input.positions);
  if (!positions) return emptyRow("Frankencoin positions were not a list.", footnote);

  const byAddress = new Map<string, FrankencoinCollateral>();
  for (const value of Object.values(map)) {
    const collateral = readCollateral(value);
    if (!collateral || PRIVATE_ADDRESSES.has(collateral.address)) continue;
    if (!input.equityAddresses.has(collateral.address)) continue;
    const ticker = classifyLendingSymbol(collateral.symbol, "ethereum").ticker;
    if (ticker === "SLV" || ticker === "TLT" || ticker === "IAU" || ticker === "USO" || ticker === "GLD") continue;
    byAddress.set(collateral.address, collateral);
  }
  if (byAddress.size === 0) {
    return emptyRow("No Frankencoin collateral was a verified public stock token.", footnote);
  }

  const open = positions.map(readPosition).filter((row): row is OpenPosition => row !== null);
  let collateralUsd = 0;
  let collateralSeen = false;
  let zchf = 0;
  let zchfSeen = false;
  let debtUsd = 0;
  let debtSeen = false;
  const points: { apy: number | null; weight: number | null }[] = [];
  const assets: LendingAsset[] = [];
  for (const collateral of byAddress.values()) {
    let tokens = 0;
    let tokensSeen = false;
    let minted = 0;
    let mintedSeen = false;
    const rates: { apy: number; weight: number }[] = [];
    for (const position of open) {
      if (position.collateral !== collateral.address) continue;
      if (position.balance !== null) {
        tokens += position.balance;
        tokensSeen = true;
      }
      if (position.minted !== null) {
        minted += position.minted;
        mintedSeen = true;
        if (position.apy !== null) rates.push({ apy: position.apy, weight: position.minted });
      }
    }
    const dollars = tokensSeen && collateral.priceUsd !== null ? tokens * collateral.priceUsd : collateral.valueUsd;
    if (dollars !== null) {
      collateralUsd += dollars;
      collateralSeen = true;
    }
    if (mintedSeen) {
      zchf += minted;
      zchfSeen = true;
      if (collateral.chfUsd !== null) {
        debtUsd += minted * collateral.chfUsd;
        debtSeen = true;
      }
      for (const rate of rates) points.push(rate);
    }
    assets.push({
      symbol: collateral.symbol,
      address: collateral.address,
      collateralUsd: dollars,
      collateralTokens: tokensSeen ? tokens : null,
      maxLtv: null,
      priceNote: dollars === null ? "Frankencoin did not price this token in dollars." : null,
    });
    void collateral.debtLimit;
  }
  assets.sort((a, b) => (b.collateralUsd ?? -1) - (a.collateralUsd ?? -1) || a.symbol.localeCompare(b.symbol));
  const band = lendingApyBand(points);
  const chain = evmChainKey(1) ?? "ethereum";
  return {
    id,
    venue,
    chainId: chain,
    chainLabel: lendingChainLabel(chain),
    collateralUsd: collateralSeen ? collateralUsd : null,
    stableBorrowedUsd: debtSeen ? debtUsd : null,
    lendSupplyUsd: null,
    utilization: null,
    borrowApy: band.borrowApy,
    borrowApyMin: band.borrowApyMin,
    borrowApyMax: band.borrowApyMax,
    stockBorrowedUsd: null,
    assets,
    note: `The debt is in ZCHF, a Swiss franc coin. It is ${zchfSeen ? formatTokenAmount(zchf) : "—"} ZCHF, shown here in dollars.`,
    footnote,
    source: input.source ?? FRANKNCOIN_STATS,
    error: null,
  };
}
