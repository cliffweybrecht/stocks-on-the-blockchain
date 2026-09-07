import { asNonEmptyString } from "./numbers";
import { tokenIdentityFromFields, type TokenIdentity } from "./solana-classifier";

/** Public Ondo GM mint list (no API key). Candidate source, not an admission list. */
export const DEFAULT_ONDO_REGISTRY_URL =
  "https://raw.githubusercontent.com/ondoprotocol/gm-solana-simulator/main/constants.rs";

const TUPLE_RE = /\("([A-Za-z0-9.]+)",\s*"([1-9A-HJ-NP-Za-km-z]{32,44})"\)/g;

export function parseOndoGmConstants(source: unknown): TokenIdentity[] {
  if (typeof source !== "string" || source.trim().length === 0) {
    throw new Error("Ondo GM token list response was not text.");
  }
  const block = source.match(/GM_TOKENS:\s*\[[^\]]+\]\s*=\s*\[([\s\S]*?)\];/);
  if (!block?.[1]) {
    throw new Error("Ondo GM token list was not found.");
  }

  const identities: TokenIdentity[] = [];
  const seen = new Set<string>();
  TUPLE_RE.lastIndex = 0;
  for (const match of block[1].matchAll(TUPLE_RE)) {
    const symbol = asNonEmptyString(match[1]);
    const address = asNonEmptyString(match[2]);
    if (!symbol || !address || seen.has(address)) continue;
    seen.add(address);
    const identity = tokenIdentityFromFields({
      address,
      symbol,
    });
    if (identity) identities.push(identity);
  }

  if (identities.length === 0) {
    throw new Error("Ondo GM token list parsed zero Solana mints.");
  }
  return identities;
}
