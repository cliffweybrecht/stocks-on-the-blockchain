import type { VolumeCoverage } from "./types";

export interface SearchableAsset {
  symbol: string;
  name: string;
  issuer: string | null;
  contractAddress: string;
  instrumentKind?: "equity" | "etf";
  volumeCoverage?: VolumeCoverage;
  volume24hUsd?: number | null;
}

export function toJumpAsset(asset: SearchableAsset): SearchableAsset {
  return {
    symbol: asset.symbol,
    name: asset.name,
    issuer: asset.issuer,
    contractAddress: asset.contractAddress,
    instrumentKind: asset.instrumentKind,
    volumeCoverage: asset.volumeCoverage,
    volume24hUsd: asset.volume24hUsd ?? null,
  };
}

export function normalizeSearchNeedle(query: string): string {
  return query.trim().toLowerCase();
}

export function assetMatchesSearch(asset: SearchableAsset, query: string): boolean {
  const needle = normalizeSearchNeedle(query);
  if (!needle) return true;
  return searchScore(asset, needle) > 0;
}

export function searchScore(asset: SearchableAsset, needle: string): number {
  if (!needle) return 0;
  const symbol = asset.symbol.toLowerCase();
  const name = asset.name.toLowerCase();
  const issuer = (asset.issuer ?? "").toLowerCase();
  const mint = asset.contractAddress.toLowerCase();
  if (symbol === needle || mint === needle) return 1000;
  if (symbol.startsWith(needle)) return 800 + Math.round((100 * needle.length) / Math.max(symbol.length, 1));
  if (name.startsWith(needle)) return 700 + Math.round((50 * needle.length) / Math.max(name.length, 1));
  if (symbol.includes(needle)) return 600;
  if (name.includes(needle)) return 500;
  if (issuer.includes(needle)) return 400;
  if (mint.includes(needle)) return 300;
  return 0;
}

export function rankSearchHits<T extends SearchableAsset>(
  assets: readonly T[],
  query: string,
  limit = 12,
): T[] {
  const needle = normalizeSearchNeedle(query);
  if (!needle) return [];
  return [...assets]
    .map((asset) => ({ asset, score: searchScore(asset, needle) }))
    .filter((row) => row.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.asset.symbol.length - b.asset.symbol.length ||
        a.asset.symbol.localeCompare(b.asset.symbol),
    )
    .slice(0, Math.max(1, limit))
    .map((row) => row.asset);
}
