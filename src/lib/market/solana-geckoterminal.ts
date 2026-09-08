import { asNonEmptyString } from "./numbers";
import { tokenIdentityFromFields, type TokenIdentity } from "./solana-classifier";

/** Public GeckoTerminal on-chain search (no API key). Candidate source, not an admission list. */
export const DEFAULT_GECKOTERMINAL_BASE_URL = "https://api.geckoterminal.com/api/v2";

export const DEFAULT_GECKOTERMINAL_QUERIES = ["xStock", "Ondo Tokenized", "tokenized stock"] as const;

export function geckoTerminalSearchPath(query: string): string {
  const params = new URLSearchParams({
    query,
    network: "solana",
    include: "base_token,quote_token",
  });
  return `/search/pools?${params.toString()}`;
}

/** Daily USD OHLCV for one Solana pool. Volume is the last tuple element. */
export function geckoTerminalOhlcvPath(poolAddress: string): string {
  const params = new URLSearchParams({
    aggregate: "1",
    limit: "1000",
    currency: "usd",
  });
  return `/networks/solana/pools/${encodeURIComponent(poolAddress)}/ohlcv/day?${params.toString()}`;
}

function readIncludedTokens(payload: unknown): TokenIdentity[] {
  if (!payload || typeof payload !== "object") return [];
  const included = (payload as { included?: unknown }).included;
  if (!Array.isArray(included)) return [];

  const identities: TokenIdentity[] = [];
  for (const row of included) {
    if (!row || typeof row !== "object") continue;
    const item = row as { type?: unknown; attributes?: { address?: unknown; name?: unknown; symbol?: unknown } };
    if (item.type !== "token") continue;
    const identity = tokenIdentityFromFields({
      address: item.attributes?.address,
      symbol: item.attributes?.symbol,
      name: item.attributes?.name,
    });
    if (identity) identities.push(identity);
  }
  return identities;
}

/**
 * Pull Solana token identities out of a GeckoTerminal pool-search payload.
 * Classifier still fail-closes; this is only a candidate feed + hydrate hint.
 */
export function parseGeckoTerminalSearch(payload: unknown): TokenIdentity[] {
  const fromIncluded = readIncludedTokens(payload);
  if (fromIncluded.length > 0) return fromIncluded;

  // Some responses omit `included` and only name tokens on the pool attributes.
  if (!payload || typeof payload !== "object") return [];
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  const identities: TokenIdentity[] = [];
  for (const row of data) {
    if (!row || typeof row !== "object") continue;
    const attrs = (row as { attributes?: { name?: unknown } }).attributes;
    const name = asNonEmptyString(attrs?.name);
    if (!name) continue;
    // Pool names look like "TSLAx / USDC" — not enough to admit a mint without an address.
    void name;
  }
  return identities;
}
