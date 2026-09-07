/** Resolve a desk row by mint first, then by unique symbol. Duplicate symbols stay distinct. */
export function findAssetByKey<T extends { symbol: string; contractAddress: string }>(
  assets: readonly T[],
  key: string,
): T | undefined {
  const needle = key.trim();
  if (!needle) return undefined;
  const byMint = assets.find((asset) => asset.contractAddress === needle);
  if (byMint) return byMint;
  const matches = assets.filter((asset) => asset.symbol.toLowerCase() === needle.toLowerCase());
  return matches.length === 1 ? matches[0] : undefined;
}

export function assetRouteKey<T extends { symbol: string; contractAddress: string }>(
  asset: T,
  assets: readonly T[],
): string {
  const collisions = assets.filter((row) => row.symbol.toLowerCase() === asset.symbol.toLowerCase());
  return collisions.length > 1 ? asset.contractAddress : asset.symbol;
}
