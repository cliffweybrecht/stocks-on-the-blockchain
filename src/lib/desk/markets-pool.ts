import { dexScreenerPairUrl, isHttpLogoUrl } from "./asset-identity";
import type { AssetPoolMark } from "@/lib/market/types";

/** Markets column header. This pair's DexScreener holder count, not 24h wallets. */
export const MARKETS_HOLDERS_HEADER = "Holders";

/** Markets column header. This pool's DexScreener pairCreatedAt, not a mint age. */
export const MARKETS_TOKEN_AGE_HEADER = "Token age";

/**
 * Holders cell for one pool. Only that pool's pair-details count is read.
 * Mint holder fields that may sit on the same object are ignored.
 */
export function marketsPairHolderCount(pool: { pairHolderCount?: number | null }): number | null {
  const count = pool.pairHolderCount;
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) return null;
  return count;
}

export function marketsPairLabel(pool: Pick<AssetPoolMark, "baseSymbol" | "quoteSymbol">): string | null {
  const base = pool.baseSymbol?.trim() || null;
  const quote = pool.quoteSymbol?.trim() || null;
  if (base && quote) return `${base}-${quote}`;
  return base ?? quote;
}

/** 24h trade count only when both DexScreener txn sides are present. One side missing stays unknown. */
export function marketsTrades24h(buys: number | null, sells: number | null): number | null {
  if (buys === null || sells === null) return null;
  return buys + sells;
}

export function marketsPoolHref(input: {
  chainId: string;
  pairAddress: string | null | undefined;
  url?: string | null;
}): string | null {
  return dexScreenerPairUrl(input.chainId, input.pairAddress, input.url);
}

export function marketsTokenLogoUrl(
  reported: string | null | undefined,
  fallback: string | null | undefined,
): string | null {
  if (isHttpLogoUrl(reported)) return reported;
  if (isHttpLogoUrl(fallback)) return fallback;
  return null;
}
