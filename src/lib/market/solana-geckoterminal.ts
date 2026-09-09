import type { DexScreenerPair } from "./map-solana";
import { asFiniteNumber, asNonEmptyString } from "./numbers";
import { tokenIdentityFromFields, type TokenIdentity } from "./solana-classifier";
import { SOLANA_CHAIN_ID } from "./types";

/** Public GeckoTerminal on-chain search (no API key). Candidate source, not an admission list. */
export const DEFAULT_GECKOTERMINAL_BASE_URL = "https://api.geckoterminal.com/api/v2";

export const DEFAULT_GECKOTERMINAL_QUERIES = [
  "xStock",
  "Ondo Tokenized",
  "tokenized stock",
  "PreStocks",
  "Backpack Securities",
  "T-SpaceX",
  "T-Kalshi",
  "T-OpenAI",
] as const;

/**
 * Venues GeckoTerminal indexes for tokenized stocks that DexScreener stock-pair
 * samples do not return (`tessera` / `tessera-v` included if they ever appear).
 * Used only to add non-overlapping pool volume — never as a Tessera V invention.
 */
export const GECKO_SUPPLEMENT_DEX_IDS = new Set([
  "byreal",
  "goonfi",
  "humidifi",
  "solfi",
  "tessera",
  "tessera-v",
  "zerofi",
]);

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

function readIncludedById(payload: unknown): Map<string, { type: string; attributes: Record<string, unknown> }> {
  const byId = new Map<string, { type: string; attributes: Record<string, unknown> }>();
  if (!payload || typeof payload !== "object") return byId;
  const included = (payload as { included?: unknown }).included;
  if (!Array.isArray(included)) return byId;
  for (const row of included) {
    if (!row || typeof row !== "object") continue;
    const item = row as { id?: unknown; type?: unknown; attributes?: unknown };
    const id = asNonEmptyString(item.id);
    const type = asNonEmptyString(item.type);
    if (!id || !type || !item.attributes || typeof item.attributes !== "object") continue;
    byId.set(id, { type, attributes: item.attributes as Record<string, unknown> });
  }
  return byId;
}

function relationshipId(rel: unknown): string | null {
  if (!rel || typeof rel !== "object") return null;
  const data = (rel as { data?: { id?: unknown } }).data;
  return asNonEmptyString(data?.id);
}

function tokenFromIncluded(
  included: Map<string, { type: string; attributes: Record<string, unknown> }>,
  relId: string | null,
): { address: string; name: string | null; symbol: string | null } | null {
  if (!relId) return null;
  const row = included.get(relId);
  if (!row || row.type !== "token") return null;
  const address = asNonEmptyString(row.attributes.address);
  if (!address) {
    const fromId = relId.startsWith("solana_") ? relId.slice("solana_".length) : null;
    if (!fromId) return null;
    return {
      address: fromId,
      name: asNonEmptyString(row.attributes.name),
      symbol: asNonEmptyString(row.attributes.symbol),
    };
  }
  return {
    address,
    name: asNonEmptyString(row.attributes.name),
    symbol: asNonEmptyString(row.attributes.symbol),
  };
}

/**
 * Turn a GeckoTerminal pool-search payload into DexScreener-shaped pair rows.
 * Volume stays on the pair so callers can merge by pairAddress without inventing series.
 */
export function parseGeckoTerminalSearchPools(payload: unknown): DexScreenerPair[] {
  if (!payload || typeof payload !== "object") return [];
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  const included = readIncludedById(payload);
  const pairs: DexScreenerPair[] = [];

  for (const row of data) {
    if (!row || typeof row !== "object") continue;
    const item = row as { attributes?: Record<string, unknown>; relationships?: Record<string, unknown> };
    const attrs = item.attributes;
    if (!attrs) continue;
    const pairAddress = asNonEmptyString(attrs.address);
    if (!pairAddress) continue;
    const rel = item.relationships ?? {};
    const base = tokenFromIncluded(included, relationshipId(rel.base_token));
    const quote = tokenFromIncluded(included, relationshipId(rel.quote_token));
    const dexRel = relationshipId(rel.dex);
    const dexId = dexRel?.replace(/^solana[_-]/i, "") ?? asNonEmptyString(dexRel);
    const volume = attrs.volume_usd;
    const h24 =
      volume && typeof volume === "object"
        ? geckoNumeric((volume as { h24?: unknown }).h24)
        : geckoNumeric(volume);
    const liquidity = geckoNumeric(attrs.reserve_in_usd);
    pairs.push({
      chainId: SOLANA_CHAIN_ID,
      dexId: dexId ?? "unknown",
      pairAddress,
      baseToken: base ?? undefined,
      quoteToken: quote ?? undefined,
      priceUsd: geckoNumeric(attrs.base_token_price_usd),
      volume: { h24: h24 ?? undefined },
      liquidity: { usd: liquidity ?? undefined },
    });
  }
  return pairs;
}

function geckoNumeric(value: unknown): number | null {
  if (typeof value === "number") return asFiniteNumber(value);
  if (typeof value === "string" && value.trim() !== "") return asFiniteNumber(Number(value));
  return null;
}

function pairTouchesMint(pair: DexScreenerPair, wanted: ReadonlySet<string>): boolean {
  for (const side of [pair.baseToken, pair.quoteToken]) {
    const address = typeof side?.address === "string" ? side.address : null;
    if (address && wanted.has(address)) return true;
  }
  return false;
}

/** Keep Gecko pools on supplement venues that DexScreener did not already return. */
export function geckoPairsForSupplement(
  geckoPairs: readonly DexScreenerPair[],
  classifiedMints: ReadonlySet<string>,
  alreadySeenPairAddresses: ReadonlySet<string>,
): DexScreenerPair[] {
  const extra: DexScreenerPair[] = [];
  const seen = new Set(alreadySeenPairAddresses);
  for (const pair of geckoPairs) {
    const dexId = asNonEmptyString(pair.dexId)?.toLowerCase();
    if (!dexId || !GECKO_SUPPLEMENT_DEX_IDS.has(dexId)) continue;
    const pairAddress = asNonEmptyString(pair.pairAddress);
    if (!pairAddress || seen.has(pairAddress)) continue;
    if (!pairTouchesMint(pair, classifiedMints)) continue;
    seen.add(pairAddress);
    extra.push(pair);
  }
  return extra;
}
