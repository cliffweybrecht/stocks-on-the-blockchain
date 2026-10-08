import { uniqueAllMarketsPools } from "./asset-volume-headline";
import type { DexScreenerPair } from "./map-solana";
import { asNonEmptyString, asNonNegativeNumber } from "./numbers";
import { classifyTokenizedInstrument, tokenIdentityFromFields } from "./solana-classifier";

export const NO_INDEXABLE_POOLS_REASON =
  "No indexable DexScreener or GeckoTerminal pools for this mint.";

export const POOL_LOOKUP_RETRY_REASON = "Pool lookup did not finish. It will retry.";

const SOLANA_MINT_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,48}$/;

export function isSolanaMintAddress(value: string): boolean {
  return SOLANA_MINT_ADDRESS.test(value.trim());
}

export interface IndexablePool {
  pairAddress: string;
  volume24hUsd: number | null;
}

/**
 * Classified mint whose symbol matches the route key.
 * Search for a ticker also returns unrelated tokens that share the letters.
 * The highest 24h pair wins when more than one classified mint matches.
 */
export function pickClassifiedMintForSymbol(pairs: readonly DexScreenerPair[], symbol: string): string | null {
  const needle = symbol.trim().toLowerCase();
  if (!needle) return null;
  let best: { mint: string; volume: number } | null = null;
  for (const pair of pairs) {
    const volume = asNonNegativeNumber(pair.volume?.h24) ?? 0;
    for (const token of [pair.baseToken, pair.quoteToken]) {
      const identity = tokenIdentityFromFields({
        address: token?.address,
        symbol: token?.symbol,
        name: token?.name,
      });
      if (!identity) continue;
      if ((identity.symbol ?? "").trim().toLowerCase() !== needle) continue;
      if (classifyTokenizedInstrument(identity).kind === "reject") continue;
      if (!best || volume > best.volume) best = { mint: identity.address, volume };
    }
  }
  return best?.mint ?? null;
}

/** Pools whose base or quote is this mint. Empty pair addresses are dropped. */
export function volumePoolsForMint(pairs: readonly DexScreenerPair[], mint: string): IndexablePool[] {
  const needle = mint.trim();
  if (!needle) return [];
  const rows: IndexablePool[] = [];
  for (const pair of pairs) {
    const pairAddress = asNonEmptyString(pair.pairAddress);
    if (!pairAddress) continue;
    const base = asNonEmptyString(pair.baseToken?.address);
    const quote = asNonEmptyString(pair.quoteToken?.address);
    if (base !== needle && quote !== needle) continue;
    rows.push({
      pairAddress,
      volume24hUsd: asNonNegativeNumber(pair.volume?.h24),
    });
  }
  return uniqueAllMarketsPools(rows);
}
