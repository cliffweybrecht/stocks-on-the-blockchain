import { asNonEmptyString } from "./numbers";
import { tokenIdentityFromFields, type TokenIdentity } from "./solana-classifier";

/** Public Tessera PE T-Token mint list (no API key). Candidate source, not an admission list. */
export const DEFAULT_TESSERA_REGISTRY_URL = "https://docs.tessera.pe/technicals/on-chain-programs.md";

const HEADING_RE = /^####\s+(T-[A-Za-z0-9][A-Za-z0-9-]*)\s+\(([A-Za-z0-9]+)\)\s*$/gm;
const MINT_RE = /\|\s*Mint Address\s*\|\s*`([1-9A-HJ-NP-Za-km-z]{32,44})`/;

/**
 * Pull official T-Token identities out of Tessera's public on-chain-programs docs.
 * Classifier still fail-closes; this is only a candidate feed.
 */
export function parseTesseraTokenMints(source: unknown): TokenIdentity[] {
  if (typeof source !== "string" || source.trim().length === 0) {
    throw new Error("Tessera T-Token list response was not text.");
  }
  const sectionStart = source.search(/###\s+Token Mints\b/);
  if (sectionStart < 0) {
    throw new Error("Tessera T-Token list was not found.");
  }
  const nextHeading = source.slice(sectionStart + 1).search(/\n###\s+/);
  const section = nextHeading >= 0 ? source.slice(sectionStart, sectionStart + 1 + nextHeading) : source.slice(sectionStart);

  const identities: TokenIdentity[] = [];
  const seen = new Set<string>();
  HEADING_RE.lastIndex = 0;
  const headings = [...section.matchAll(HEADING_RE)];
  for (const match of headings) {
    const name = asNonEmptyString(match[1]);
    const symbol = asNonEmptyString(match[2]);
    const blockStart = match.index ?? 0;
    const blockEnd = headings.find((row) => (row.index ?? 0) > blockStart)?.index ?? section.length;
    const block = section.slice(blockStart, blockEnd);
    const mintMatch = block.match(MINT_RE);
    const address = asNonEmptyString(mintMatch?.[1]);
    if (!name || !symbol || !address || seen.has(address)) continue;
    seen.add(address);
    const identity = tokenIdentityFromFields({
      address,
      symbol,
      name,
      labels: ["tessera-t-token"],
      underlyingInstrumentType: "private",
    });
    if (identity) identities.push(identity);
  }

  if (identities.length === 0) {
    throw new Error("Tessera T-Token list parsed zero Solana mints.");
  }
  return identities;
}
