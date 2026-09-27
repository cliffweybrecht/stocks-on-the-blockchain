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

/** Set the asset-page mint holder count. Pool rows keep their own counterparty counts. */
export function applyMintHolderCount(asset: { holderCount: number | null }, holderCount: number | null): void {
  asset.holderCount = holderCount;
}

export interface PairHolderSide {
  baseAddress?: string | null;
  quoteAddress?: string | null;
  baseSymbol?: string | null;
  quoteSymbol?: string | null;
}

/**
 * The mint on this pair that is not the asset page.
 * SI-NVDAx on the NVDAx page is SI. NVDAx-USDC is USDC. WOOLLY-NVDAx is WOOLLY.
 * A pair that does not include the page mint has no counterparty to show.
 */
export function counterpartyHolderSide(
  pool: PairHolderSide,
  assetMint: string,
): { mint: string; symbol: string | null } | null {
  const asset = assetMint.trim();
  if (!asset) return null;
  const base = asNonEmptyString(pool.baseAddress);
  const quote = asNonEmptyString(pool.quoteAddress);
  if (base === asset && quote && quote !== asset) {
    return { mint: quote, symbol: asNonEmptyString(pool.quoteSymbol) };
  }
  if (quote === asset && base && base !== asset) {
    return { mint: base, symbol: asNonEmptyString(pool.baseSymbol) };
  }
  return null;
}

/**
 * Stamp each pool with the other mint's holder count.
 * A missing mint or a missing count stays null. It is not replaced with the page asset's count.
 */
export function applyOtherHolderCounts<T extends PairHolderSide & { otherHolderCount?: number | null }>(
  assetMint: string,
  pools: readonly T[],
  counts: ReadonlyMap<string, number | null>,
): void {
  for (const pool of pools) {
    const side = counterpartyHolderSide(pool, assetMint);
    pool.otherHolderCount = side ? (counts.get(side.mint) ?? null) : null;
  }
}
