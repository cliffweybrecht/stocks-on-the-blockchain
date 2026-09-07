import type { DexScreenerPair } from "./map-solana";
import { asNonEmptyString } from "./numbers";
import { classifyTokenizedInstrument, tokenIdentityFromFields, type TokenIdentity } from "./solana-classifier";
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
  "tokenized share",
  "tokenised stock",
  "backed xstock",
  "Ondo Tokenized",
  "Tesla xStock",
  "Meta xStock",
  "Circle xStock",
  "NVIDIA xStock",
  "Apple xStock",
  "Microsoft xStock",
  "Amazon xStock",
  "Alphabet xStock",
  "Robinhood xStock",
  "Tesla (Ondo Tokenized)",
  "NVIDIA (Ondo Tokenized)",
] as const;

export const DEXSCREENER_TOKEN_BATCH_SIZE = 30;

export function solanaSearchPath(query: string): string {
  return `/latest/dex/search?q=${encodeURIComponent(query)}`;
}

export function solanaTokenPairsPath(mint: string): string {
  return `/token-pairs/v1/solana/${mint}`;
}

export function solanaTokensBatchPath(mints: readonly string[]): string {
  return `/tokens/v1/solana/${mints.join(",")}`;
}

export function chunkValues<T>(values: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size) as T[]);
  }
  return chunks;
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
  return (
    (token.name?.length ?? 0) +
    (token.symbol?.length ?? 0) +
    (token.labels?.length ?? 0) * 10 +
    (token.underlyingInstrumentType ? 50 : 0)
  );
}

export function mergeTokenIdentities(groups: readonly TokenIdentity[][]): TokenIdentity[] {
  const byMint = new Map<string, TokenIdentity>();
  for (const group of groups) {
    for (const identity of group) {
      const existing = byMint.get(identity.address);
      if (!existing || scoreIdentity(identity) > scoreIdentity(existing)) {
        byMint.set(identity.address, identity);
      }
    }
  }
  return [...byMint.values()];
}

export function pairsTouchingMints(
  pairs: readonly DexScreenerPair[],
  wanted: ReadonlySet<string>,
): DexScreenerPair[] {
  return pairs.filter((pair) => {
    for (const side of [pair.baseToken, pair.quoteToken]) {
      const address = typeof side?.address === "string" ? side.address : null;
      if (address && wanted.has(address)) return true;
    }
    return false;
  });
}

export function mintsInPairs(
  pairs: readonly { baseToken?: { address?: unknown }; quoteToken?: { address?: unknown } }[],
  wanted: ReadonlySet<string>,
): Set<string> {
  const found = new Set<string>();
  for (const pair of pairs) {
    for (const side of [pair.baseToken, pair.quoteToken]) {
      const address = typeof side?.address === "string" ? side.address : null;
      if (address && wanted.has(address)) found.add(address);
    }
  }
  return found;
}

/**
 * Hydrate DexScreener-known mints before blind registry names so a short budget
 * still returns volume-bearing stocks instead of 0/0 after classify.
 */
export function prioritizeMintsForHydrate(mints: readonly string[], priorityMints: ReadonlySet<string>): string[] {
  const wanted = new Set(mints);
  const seen = new Set<string>();
  const ordered: string[] = [];
  const push = (mint: string) => {
    if (!wanted.has(mint) || seen.has(mint)) return;
    seen.add(mint);
    ordered.push(mint);
  };
  for (const mint of priorityMints) push(mint);
  for (const mint of mints) push(mint);
  return ordered;
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
  kind: "equity" | "etf";
}

function displayNameFor(token: TokenIdentity, issuer: string | null): string | null {
  const named = asNonEmptyString(token.name);
  if (named) return named;
  const symbol = asNonEmptyString(token.symbol);
  if (issuer === "Ondo" && symbol) {
    return `${symbol.replace(/on$/i, "")} (Ondo Tokenized)`;
  }
  return symbol;
}

export function selectInstrumentMints(tokens: readonly TokenIdentity[]): {
  equities: DiscoveredEquityMint[];
  etfs: DiscoveredEquityMint[];
} {
  const equities: DiscoveredEquityMint[] = [];
  const etfs: DiscoveredEquityMint[] = [];
  for (const token of tokens) {
    const classified = classifyTokenizedInstrument(token);
    if (classified.kind === "reject") continue;
    const row: DiscoveredEquityMint = {
      mint: token.address,
      symbol: asNonEmptyString(token.symbol),
      name: displayNameFor(token, classified.issuer),
      issuer: classified.issuer,
      reason: classified.reason,
      kind: classified.kind,
    };
    if (classified.kind === "etf") etfs.push(row);
    else equities.push(row);
  }
  return { equities, etfs };
}

export function selectEquityMints(tokens: readonly TokenIdentity[]): DiscoveredEquityMint[] {
  return selectInstrumentMints(tokens).equities;
}
