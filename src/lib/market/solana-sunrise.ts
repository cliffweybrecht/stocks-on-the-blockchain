import { asNonEmptyString } from "./numbers";
import { isPumpFunMint, tokenIdentityFromFields, type TokenIdentity } from "./solana-classifier";

/** Public Sunrise token list (no API key). Candidate source, not an admission list. */
export const DEFAULT_SUNRISE_REGISTRY_BASE_URL = "https://api.sunrise.xyz";
export const SUNRISE_REGISTRY_PAGE_SIZE = 200;
export const SUNRISE_REGISTRY_MAX_PAGES = 5;

const BACKPACK_NAME = /\bbackpack\s+securities\b/i;

export function sunriseTokensPath(cursor?: string, limit = SUNRISE_REGISTRY_PAGE_SIZE): string {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set("cursor", cursor);
  return `/v1/tokens?${params.toString()}`;
}

function isBackpackStockCandidate(row: {
  assetClass?: string | null;
  issuer?: string | null;
  name?: string | null;
}): boolean {
  if (row.assetClass === "stock") return true;
  if (row.issuer === "backpack_securities") return true;
  return Boolean(row.name && BACKPACK_NAME.test(row.name));
}

/**
 * Pull official Backpack / stock identities out of Sunrise's public token list.
 * Classifier still fail-closes; this is only a candidate feed.
 * Crypto and commodity Sunrise rows are ignored.
 */
export function parseSunriseTokensPage(payload: unknown): {
  identities: TokenIdentity[];
  nextCursor: string | null;
} {
  if (!payload || typeof payload !== "object") {
    throw new Error("Sunrise token list response was not an object.");
  }
  const body = payload as {
    success?: unknown;
    data?: { tokens?: unknown; pagination?: { nextCursor?: unknown } };
  };
  if (body.success !== true || !body.data || !Array.isArray(body.data.tokens)) {
    throw new Error("Sunrise token list was not a token page.");
  }

  const identities: TokenIdentity[] = [];
  const seen = new Set<string>();
  for (const node of body.data.tokens) {
    if (!node || typeof node !== "object") continue;
    const row = node as {
      chain?: unknown;
      address?: unknown;
      symbol?: unknown;
      name?: unknown;
      assetClass?: unknown;
      issuer?: unknown;
    };
    const address = asNonEmptyString(row.address);
    const name = asNonEmptyString(row.name);
    const symbol = asNonEmptyString(row.symbol);
    const chain = asNonEmptyString(row.chain);
    if (!address || seen.has(address)) continue;
    if (chain && chain !== "solana") continue;
    if (isPumpFunMint(address)) continue;
    if (
      !isBackpackStockCandidate({
        assetClass: asNonEmptyString(row.assetClass),
        issuer: asNonEmptyString(row.issuer),
        name,
      })
    ) {
      continue;
    }
    const identity = tokenIdentityFromFields({
      address,
      symbol,
      name,
    });
    if (!identity) continue;
    seen.add(address);
    identities.push(identity);
  }

  const nextCursor = asNonEmptyString(body.data.pagination?.nextCursor) ?? null;
  return { identities, nextCursor };
}
