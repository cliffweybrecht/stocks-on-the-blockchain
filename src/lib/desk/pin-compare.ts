import type { InstrumentKind, VolumeCoverage } from "../market/types";

export const PIN_COMPARE_MAX = 8;

export interface PinCompareAsset {
  symbol: string;
  name: string;
  issuer: string | null;
  contractAddress: string;
  volume24hUsd: number | null;
  displayedLiquidityUsd: number | null;
  poolCount: number;
  volumeCoverage: VolumeCoverage;
  instrumentKind: InstrumentKind;
}

export function toPinCompareAsset(asset: PinCompareAsset): PinCompareAsset {
  return {
    symbol: asset.symbol,
    name: asset.name,
    issuer: asset.issuer,
    contractAddress: asset.contractAddress,
    volume24hUsd: asset.volume24hUsd,
    displayedLiquidityUsd: asset.displayedLiquidityUsd,
    poolCount: asset.poolCount,
    volumeCoverage: asset.volumeCoverage,
    instrumentKind: asset.instrumentKind ?? "equity",
  };
}

/** Resolve pinned mints against the catalog in pin order. Missing mints are dropped. */
export function selectPinnedCompareRows<T extends { contractAddress: string }>(
  catalog: readonly T[],
  favoriteMints: readonly string[],
  limit = PIN_COMPARE_MAX,
): T[] {
  const byMint = new Map(catalog.map((asset) => [asset.contractAddress, asset]));
  const rows: T[] = [];
  const seen = new Set<string>();
  for (const mint of favoriteMints) {
    if (seen.has(mint)) continue;
    const asset = byMint.get(mint);
    if (!asset) continue;
    seen.add(mint);
    rows.push(asset);
    if (rows.length >= Math.max(1, limit)) break;
  }
  return rows;
}

export function shouldShowPinCompare(rows: readonly unknown[]): boolean {
  return rows.length >= 2;
}
