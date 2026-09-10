import { formatAddress } from "@/lib/market/format";
import { asHttpUrl } from "@/lib/market/numbers";
import type { InstrumentKind, SourceKind } from "@/lib/market/types";

const SKIP_WORDS = new Set([
  "a",
  "an",
  "and",
  "chain",
  "for",
  "in",
  "of",
  "on",
  "onchain",
  "or",
  "the",
  "to",
  "token",
  "tokenized",
  "tokens",
  "wrapper",
  "xstock",
  "xstocks",
]);

function significantWords(name: string): string[] {
  return name
    .split(/[\s/·•\-_(),.]+/)
    .map((part) => part.replace(/[^A-Za-z0-9]/g, ""))
    .filter((part) => part.length > 0 && !SKIP_WORDS.has(part.toLowerCase()));
}

/** One- or two-letter monogram from a real name/ticker. Never a logo URL. */
export function assetMonogram(name: string, symbol: string): string {
  const words = significantWords(name);
  const ticker = symbol.replace(/[^A-Za-z0-9]/g, "");
  if (words.length >= 2) {
    return `${words[0]![0]}${words[1]![0]}`.toUpperCase();
  }
  if (ticker.length >= 2) return ticker.slice(0, 2).toUpperCase();
  if (ticker.length === 1) return ticker.toUpperCase();
  if (words.length === 1) {
    const word = words[0]!;
    return word.length >= 2 ? word.slice(0, 2).toUpperCase() : word.toUpperCase();
  }
  return "?";
}

export function isHttpLogoUrl(value: string | null | undefined): value is string {
  return asHttpUrl(value) !== null;
}

export function instrumentKindMetaLabel(kind: InstrumentKind): string {
  if (kind === "etf") return "ETF";
  if (kind === "private") return "PRIVATE";
  return "TOKEN";
}

export function sourceRowLabel(sourceId: SourceKind): string {
  if (sourceId === "mock") return "Demo row";
  if (sourceId === "solana") return "DexScreener row";
  if (sourceId === "composite") return "Live sources";
  return "Terminal row";
}

export function dexScreenerTokenUrl(chainId: string, mint: string): string | null {
  if (chainId !== "solana" || !mint.trim()) return null;
  return `https://dexscreener.com/solana/${mint}`;
}

export function assetIdentityMetaParts(input: {
  instrumentKind: InstrumentKind;
  symbol: string;
  contractAddress: string;
}): { kind: string; symbol: string; mint: string } {
  return {
    kind: instrumentKindMetaLabel(input.instrumentKind),
    symbol: input.symbol,
    mint: formatAddress(input.contractAddress),
  };
}
