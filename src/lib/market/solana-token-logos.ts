import { asHttpUrl, asNonEmptyString } from "./numbers";

export const DEFAULT_JUPITER_TOKEN_BASE_URL = "https://lite-api.jup.ag/tokens/v2";
export const JUPITER_TOKEN_SEARCH_BATCH = 80;
export const MINT_LOGO_CACHE_MS = 30 * 60_000;

export type MintLogoCatalog = Map<string, string>;

/** HTTPS logo only. Never javascript:/data:/relative. */
export function httpMintLogoUrl(value: unknown): string | null {
  return asHttpUrl(value);
}

export function rememberMintLogo(catalog: MintLogoCatalog, mint: string, raw: unknown): void {
  const address = asNonEmptyString(mint);
  const url = httpMintLogoUrl(raw);
  if (!address || !url || catalog.has(address)) return;
  catalog.set(address, url);
}

export function mergeMintLogoCatalogs(
  ...catalogs: ReadonlyArray<ReadonlyMap<string, string> | Record<string, string>>
): MintLogoCatalog {
  const merged: MintLogoCatalog = new Map();
  for (const catalog of catalogs) {
    const entries = catalog instanceof Map ? catalog.entries() : Object.entries(catalog);
    for (const [mint, url] of entries) {
      rememberMintLogo(merged, mint, url);
    }
  }
  return merged;
}

/**
 * DexScreener pair image first (caller already gated to the displayed/base mint).
 * Catalog fallback is mint-keyed only — never ticker match, never quote steal.
 */
export function resolveMintLogoUrl(input: {
  mint: string;
  dexScreenerLogoUrl?: string | null;
  catalog?: ReadonlyMap<string, string> | Record<string, string> | null;
}): string | null {
  const fromPair = httpMintLogoUrl(input.dexScreenerLogoUrl);
  if (fromPair) return fromPair;
  const mint = asNonEmptyString(input.mint);
  if (!mint || !input.catalog) return null;
  const catalog = input.catalog;
  const fromCatalog = catalog instanceof Map ? catalog.get(mint) : Reflect.get(catalog, mint);
  return httpMintLogoUrl(fromCatalog);
}

export function applyMintLogoFallbacks<T extends { contractAddress: string; logoUrl: string | null }>(
  rows: T[],
  catalog: ReadonlyMap<string, string> | Record<string, string>,
): T[] {
  for (const row of rows) {
    if (row.logoUrl) continue;
    row.logoUrl = resolveMintLogoUrl({ mint: row.contractAddress, catalog });
  }
  return rows;
}

export function jupiterTokenSearchPath(mints: readonly string[]): string {
  const query = mints.filter((mint) => asNonEmptyString(mint)).join(",");
  return `/search?query=${encodeURIComponent(query)}`;
}

/**
 * Jupiter Tokens V2 search. Only accept `icon` when `id` is a requested mint.
 * Symbol-only hits are ignored so we never attach another token's art.
 */
export function parseJupiterTokenIcons(
  payload: unknown,
  requestedMints: ReadonlySet<string>,
): Record<string, string> {
  if (!Array.isArray(payload) || requestedMints.size === 0) return {};
  const logos: Record<string, string> = {};
  for (const row of payload) {
    if (!row || typeof row !== "object") continue;
    const rec = row as { id?: unknown; address?: unknown; icon?: unknown; logoURI?: unknown };
    const mint = asNonEmptyString(rec.id) ?? asNonEmptyString(rec.address);
    if (!mint || !requestedMints.has(mint)) continue;
    const url = httpMintLogoUrl(rec.icon) ?? httpMintLogoUrl(rec.logoURI);
    if (url) logos[mint] = url;
  }
  return logos;
}
