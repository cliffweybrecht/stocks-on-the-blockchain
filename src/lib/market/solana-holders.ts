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
 * Read `holderCount` only from the row whose id is the requested mint.
 * `stats24h.numTraders` is a different metric and is ignored.
 * A matching row with no usable count stays null — we do not scan later rows for a substitute.
 */
export function parseJupiterHolderCount(payload: unknown, mint: string): number | null {
  const requested = asNonEmptyString(mint);
  if (!requested || !Array.isArray(payload)) return null;
  for (const row of payload) {
    if (!row || typeof row !== "object") continue;
    const rec = row as { id?: unknown; address?: unknown; holderCount?: unknown };
    const id = asNonEmptyString(rec.id) ?? asNonEmptyString(rec.address);
    if (id !== requested) continue;
    return asHolderCount(rec.holderCount);
  }
  return null;
}

/**
 * Copy one mint's holder count onto the asset and every pool row.
 * Holders are not a per-pool figure. Passing null clears a previous stamp; it does not become 0.
 */
export function applyMintHolderCount(
  asset: {
    holderCount: number | null;
    pools: readonly { holderCount?: number | null }[];
  },
  holderCount: number | null,
): void {
  asset.holderCount = holderCount;
  for (const pool of asset.pools) {
    pool.holderCount = holderCount;
  }
}
