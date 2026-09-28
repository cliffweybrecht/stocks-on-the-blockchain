import { asNonEmptyString, asNonNegativeNumber } from "./numbers";

/** Successful Jupiter holder responses stay warm so asset views do not refetch. */
export const MINT_HOLDER_CACHE_MS = 10 * 60_000;
/** Failed Jupiter calls retry sooner than a real "no count" response. */
export const MINT_HOLDER_MISS_CACHE_MS = 2 * 60_000;
/** Holder lookup must not hold the asset page for the full DexScreener timeout. */
export const HOLDER_FETCH_TIMEOUT_MS = 4_000;

/**
 * Jupiter Tokens V2 `holderCount` is an integer mint metric.
 * Floats are rejected so we never round a count into existence.
 */
export function asHolderCount(value: unknown): number | null {
  const parsed = asNonNegativeNumber(value);
  if (parsed === null || !Number.isSafeInteger(parsed)) return null;
  return parsed;
}

/**
 * Read `holderCount` for each requested mint.
 * `stats24h.numTraders` is a different metric and is ignored.
 * The first matching row wins. A later row does not fill in a missing count.
 * Mints absent from the payload are omitted — the caller decides how to cache that miss.
 */
export function parseJupiterHolderCounts(
  payload: unknown,
  requestedMints: ReadonlySet<string>,
): Map<string, number | null> {
  const counts = new Map<string, number | null>();
  if (!Array.isArray(payload) || requestedMints.size === 0) return counts;
  for (const row of payload) {
    if (!row || typeof row !== "object") continue;
    const rec = row as { id?: unknown; address?: unknown; holderCount?: unknown };
    const id = asNonEmptyString(rec.id) ?? asNonEmptyString(rec.address);
    if (!id || !requestedMints.has(id) || counts.has(id)) continue;
    counts.set(id, asHolderCount(rec.holderCount));
  }
  return counts;
}

/** Read `holderCount` only from the row whose id is the requested mint. */
export function parseJupiterHolderCount(payload: unknown, mint: string): number | null {
  const requested = asNonEmptyString(mint);
  if (!requested) return null;
  return parseJupiterHolderCounts(payload, new Set([requested])).get(requested) ?? null;
}

/** Set the asset-page mint holder count. Pool rows are not touched. */
export function applyMintHolderCount(asset: { holderCount: number | null }, holderCount: number | null): void {
  asset.holderCount = holderCount;
}

/** Host for DexScreener pair-details. The public pair API does not include LP holders. */
export const DEFAULT_DEXSCREENER_IO_BASE_URL = "https://io.dexscreener.com";

/** One pool per request. An empty address is not fetched. */
export function dexScreenerPairDetailsPath(pairAddress: string): string | null {
  const address = pairAddress.trim();
  if (!address) return null;
  return `/dex/pair-details/v4/solana/${encodeURIComponent(address)}`;
}

/**
 * LP holders of this pool from pair-details `lpHolders.count`.
 * `holders.count` is the base-token mint census and is ignored — it is the same number on every pool of that mint.
 * A missing or null `lpHolders` stays null. It is not filled from `holders` or from a quote-mint count.
 */
export function parseDexScreenerPairHolderCount(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") return null;
  const lpHolders = (payload as { lpHolders?: unknown }).lpHolders;
  if (!lpHolders || typeof lpHolders !== "object") return null;
  return asHolderCount((lpHolders as { count?: unknown }).count);
}

/**
 * Stamp each pool with its own pair address's count.
 * A count stored under a mint, or under a different pool, is not copied across rows.
 */
export function applyPairHolderCounts<T extends { pairAddress: string; pairHolderCount?: number | null }>(
  pools: readonly T[],
  counts: ReadonlyMap<string, number | null>,
): void {
  for (const pool of pools) {
    const address = pool.pairAddress.trim();
    pool.pairHolderCount = address ? (counts.get(address) ?? null) : null;
  }
}
