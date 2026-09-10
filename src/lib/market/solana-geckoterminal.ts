import { asNonEmptyString } from "./numbers";
import { tokenIdentityFromFields, type TokenIdentity } from "./solana-classifier";

/** Public GeckoTerminal on-chain search (no API key). Candidate source, not an admission list. */
export const DEFAULT_GECKOTERMINAL_BASE_URL = "https://api.geckoterminal.com/api/v2";

export const DEFAULT_GECKOTERMINAL_QUERIES = [
  "xStock",
  "Ondo Tokenized",
  "tokenized stock",
  "PreStocks",
  "Backpack Securities",
  "Nike - Backpack Securities",
  "Shopify - Backpack Securities",
  "Hertz - Backpack Securities",
  "IBM - Backpack Securities",
  "BA - Backpack Securities",
  "SNAP - Backpack Securities",
  "T-SpaceX",
  "T-Kalshi",
  "T-OpenAI",
] as const;

export function geckoTerminalSearchPath(query: string): string {
  const params = new URLSearchParams({
    query,
    network: "solana",
    include: "base_token,quote_token",
  });
  return `/search/pools?${params.toString()}`;
}

export type GeckoOhlcvTimeframe = "day" | "hour";

/** USD OHLCV for one Solana pool. Daily volume uses the last tuple element; price uses close. */
export function geckoTerminalOhlcvPath(
  poolAddress: string,
  options: { timeframe?: GeckoOhlcvTimeframe; limit?: number } = {},
): string {
  const timeframe = options.timeframe ?? "day";
  const limit = options.limit ?? 1000;
  const params = new URLSearchParams({
    aggregate: "1",
    limit: String(limit),
    currency: "usd",
  });
  return `/networks/solana/pools/${encodeURIComponent(poolAddress)}/ohlcv/${timeframe}?${params.toString()}`;
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
 * Volume stays DexScreener — Gecko is not a 24h supplement.
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
