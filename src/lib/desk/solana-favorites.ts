/** Browser-only pin list for Solana mints. Not an admission list. */

export const SOLANA_FAVORITES_STORAGE_KEY = "sotb.solana.favoriteMints.v1";
export const SOLANA_FAVORITES_MAX = 40;

export function parseFavoriteMints(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const mints: string[] = [];
    const seen = new Set<string>();
    for (const value of parsed) {
      if (typeof value !== "string") continue;
      const mint = value.trim();
      if (mint.length < 32 || mint.length > 48) continue;
      if (seen.has(mint)) continue;
      seen.add(mint);
      mints.push(mint);
      if (mints.length >= SOLANA_FAVORITES_MAX) break;
    }
    return mints;
  } catch {
    return [];
  }
}

export function serializeFavoriteMints(mints: readonly string[]): string {
  return JSON.stringify(parseFavoriteMints(JSON.stringify([...mints])));
}

export function toggleFavoriteMint(mints: readonly string[], mint: string): string[] {
  const current = parseFavoriteMints(JSON.stringify([...mints]));
  const needle = mint.trim();
  if (!needle) return current;
  if (current.includes(needle)) return current.filter((row) => row !== needle);
  if (current.length >= SOLANA_FAVORITES_MAX) return current;
  return [...current, needle];
}

export function favoriteSet(mints: readonly string[]): Set<string> {
  return new Set(parseFavoriteMints(JSON.stringify([...mints])));
}
