import type { DexScreenerPair } from "./map-solana";
import { asNonEmptyString } from "./numbers";
import { classifyOrNull, tokenIdentityFromFields, type TokenIdentity } from "./solana-classifier";
import { SOLANA_CHAIN_ID } from "./types";

/**
 * Live DexScreener search queries. These are discovery probes, not an admission
 * list. Search is noisy and capped (~30 pairs / query), so coverage is
 * "as discoverable from these queries + classifier", not a full Solana index.
 */
export const DEFAULT_SOLANA_DISCOVERY_QUERIES = [
  "xStock",
  "xStocks",
  "tokenized stock",
  "tokenized equity",
  "tokenised stock",
  "backed xstock",
  "prestocks",
  "dinari stock",
] as const;

export function solanaSearchPath(query: string): string {
  return `/latest/dex/search?q=${encodeURIComponent(query)}`;
}

export function solanaTokenPairsPath(mint: string): string {
  return `/token-pairs/v1/solana/${mint}`;
}

export function readPairLabels(pair: DexScreenerPair): string[] {
  if (!Array.isArray(pair.labels)) return [];
  return pair.labels.flatMap((label) => {
    const value = asNonEmptyString(label);
    return value ? [value] : [];
  });
}

export function tokenIdentityFromSide(
  token: DexScreenerPair["baseToken"],
  labels: readonly string[] = [],
): TokenIdentity | null {
  return tokenIdentityFromFields({
    address: token?.address,
    symbol: token?.symbol,
    name: token?.name,
    labels,
  });
}

function scoreIdentity(token: TokenIdentity): number {
  return (token.name?.length ?? 0) + (token.symbol?.length ?? 0) + (token.labels?.length ?? 0) * 10;
}

export function collectSolanaCandidateTokens(pairs: readonly DexScreenerPair[]): TokenIdentity[] {
  const byMint = new Map<string, TokenIdentity>();

  for (const pair of pairs) {
    if (asNonEmptyString(pair.chainId) !== SOLANA_CHAIN_ID) continue;
    const labels = readPairLabels(pair).filter((label) =>
      /tokenized|equity|stock|etf|index|rwa/i.test(label),
    );
    for (const side of [pair.baseToken, pair.quoteToken]) {
      const identity = tokenIdentityFromSide(side, labels);
      if (!identity) continue;
      const existing = byMint.get(identity.address);
      if (!existing || scoreIdentity(identity) > scoreIdentity(existing)) {
        byMint.set(identity.address, identity);
      }
    }
  }

  return [...byMint.values()];
}

export interface DiscoveredEquityMint {
  mint: string;
  symbol: string | null;
  name: string | null;
  issuer: string | null;
  reason: string;
}

export function selectEquityMints(tokens: readonly TokenIdentity[]): DiscoveredEquityMint[] {
  const selected: DiscoveredEquityMint[] = [];
  for (const token of tokens) {
    const classified = classifyOrNull(token);
    if (!classified) continue;
    selected.push({
      mint: token.address,
      symbol: asNonEmptyString(token.symbol),
      name: asNonEmptyString(token.name),
      issuer: classified.issuer,
      reason: classified.reason,
    });
  }
  return selected;
}
