import { asNonEmptyString } from "./numbers";
import type { TokenIdentity, UnderlyingInstrumentType } from "./solana-classifier";
import { httpMintLogoUrl } from "./solana-token-logos";

/**
 * Public Securitize Stocks catalog (no API key). Candidate source, not an admission list.
 * The page embeds a dehydrated React Query cache: `tradingConfig.tokenAddress` on each stock.
 * https://stocks.securitize.io
 * Launch note: https://www.prnewswire.com/news-releases/securitize-launches-global-onchain-trading-of-us-stocks-with-security-entitlements-302902107.html
 */
export const DEFAULT_SECURITIZE_STOCKS_URL = "https://stocks.securitize.io";

/** On-chain Token-2022 metadata host. https only. */
export const SECURITIZE_METADATA_HOST = "metadata.securitize.io";

export interface SecuritizeOfficialMint {
  symbol: string;
  /** Token-2022 metadata name, verified against the mint account. */
  name: string;
  address: string;
  metadataUri: string;
  /** `image` from that metadata document. Official CDN only — never a page data-URI. */
  logoUrl: string;
  lane: Exclude<UnderlyingInstrumentType, "etf">;
}

/**
 * Verified 2026-10-09 against `stocks.securitize.io` (`tradingConfig.tokenAddress`,
 * chainNamespace solana, 6 decimals) and mainnet Token-2022 metadata
 * (program `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`).
 * USDC on the same page is the settlement stablecoin and is not listed.
 * SECZ's on-chain name is "Securitize Corp." and its image is `secz_logo.png`.
 * A page row whose mint is not in this set is dropped until it is re-verified.
 */
export const SECURITIZE_OFFICIAL_MINTS: readonly SecuritizeOfficialMint[] = [
  {
    symbol: "AAPL",
    name: "Apple - Securitize",
    address: "3J7XcwApkHKUKnNL6bbrA5pmFhCKZ3RB9VG63aAukBzD",
    metadataUri: "https://metadata.securitize.io/aapl.json",
    logoUrl: "https://metadata.securitize.io/aapl.png",
    lane: "equity",
  },
  {
    symbol: "AMZN",
    name: "Amazon.com - Securitize",
    address: "8kVtvtb8cj512xeweEchkNVUccvcXq2Yo7CvDPZpytBP",
    metadataUri: "https://metadata.securitize.io/amzn.json",
    logoUrl: "https://metadata.securitize.io/amzn.png",
    lane: "equity",
  },
  {
    symbol: "CRCL",
    name: "Circle - Securitize",
    address: "8NxJNxfZKW2ST1ZmNbthRoHbXB9yB4Gi7V7vVV3KH38h",
    metadataUri: "https://metadata.securitize.io/crcl.json",
    logoUrl: "https://metadata.securitize.io/crcl.png",
    lane: "equity",
  },
  {
    symbol: "GOOGL",
    name: "Alphabet Class A - Securitize",
    address: "2qXFRgxeYUkc19JBAzRvZZReAhVTWFd31m9qM2C3a2GK",
    metadataUri: "https://metadata.securitize.io/googl.json",
    logoUrl: "https://metadata.securitize.io/googl.png",
    lane: "equity",
  },
  {
    symbol: "META",
    name: "Meta Class A - Securitize",
    address: "3jVWyof7Ks14Kpd4GmKk6c8ktErxPMEwD9XR2VfJKeu1",
    metadataUri: "https://metadata.securitize.io/meta.json",
    logoUrl: "https://metadata.securitize.io/meta.png",
    lane: "equity",
  },
  {
    symbol: "MSFT",
    name: "Microsoft - Securitize",
    address: "6V4gLu7aC63e6CTEJXu71wtx5FMrZ3FQoST7UXXqgPuQ",
    metadataUri: "https://metadata.securitize.io/msft.json",
    logoUrl: "https://metadata.securitize.io/msft.png",
    lane: "equity",
  },
  {
    symbol: "MSTR",
    name: "Strategy - Securitize",
    address: "4V3ZstipcG21LbEB5usTx4VcJGjcsxKnrExPK1QwaJC1",
    metadataUri: "https://metadata.securitize.io/mstr.json",
    logoUrl: "https://metadata.securitize.io/mstr.png",
    lane: "equity",
  },
  {
    symbol: "NFLX",
    name: "Netflix - Securitize",
    address: "3i57nfnGeTccVgPfNG2PGAkdH7Mfs81mG2CwijtBTbcX",
    metadataUri: "https://metadata.securitize.io/nflx.json",
    logoUrl: "https://metadata.securitize.io/nflx.png",
    lane: "equity",
  },
  {
    symbol: "NVDA",
    name: "NVIDIA - Securitize",
    address: "6yqHep7MGiy3tTkQv54BkjiATGdVszWZCp36j1VPCsF3",
    metadataUri: "https://metadata.securitize.io/nvda.json",
    logoUrl: "https://metadata.securitize.io/nvda.png",
    lane: "equity",
  },
  {
    symbol: "PLTR",
    name: "Palantir - Securitize",
    address: "hRhNSeHmMDuUntu44WSu5D25gy8R35ctw3UG3HeCHKi",
    metadataUri: "https://metadata.securitize.io/pltr.json",
    logoUrl: "https://metadata.securitize.io/pltr.png",
    lane: "equity",
  },
  {
    symbol: "SPCX",
    name: "SpaceX Class A - Securitize",
    address: "CkZoZ5vu2uuayHzJgavBjARyEeGrTMWMmbbt867jAFrj",
    metadataUri: "https://metadata.securitize.io/spcx.json",
    logoUrl: "https://metadata.securitize.io/spcx.png",
    lane: "private",
  },
  {
    symbol: "TSLA",
    name: "Tesla - Securitize",
    address: "HMgreFGFGZswE8L2zF2hNeWaSunwFAV93gWiTB9tjFUv",
    metadataUri: "https://metadata.securitize.io/tsla.json",
    logoUrl: "https://metadata.securitize.io/tsla.png",
    lane: "equity",
  },
  {
    symbol: "SECZ",
    name: "Securitize Corp.",
    address: "5VzwKkvynPJzcgwhBe7ESEyNgqMbo15yBu7Sehssd9ED",
    metadataUri: "https://metadata.securitize.io/secz.json",
    logoUrl: "https://metadata.securitize.io/secz_logo.png",
    lane: "equity",
  },
];

const OFFICIAL_BY_ADDRESS = new Map(SECURITIZE_OFFICIAL_MINTS.map((row) => [row.address, row]));

export function isSecuritizeOfficialMint(address: string): boolean {
  return OFFICIAL_BY_ADDRESS.has(address);
}

/** True when the URI is https on metadata.securitize.io. Other hosts, including lookalikes, fail. */
export function isSecuritizeMetadataUri(value: unknown): boolean {
  const raw = asNonEmptyString(value);
  if (!raw) return false;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && url.hostname === SECURITIZE_METADATA_HOST;
  } catch {
    return false;
  }
}

const CATALOG_SCRIPT_RE =
  /<script id="__REACT_QUERY_STATE__" type="application\/json">([\s\S]*?)<\/script>/;

function catalogRows(state: unknown): unknown[] | null {
  if (!state || typeof state !== "object") return null;
  const queries = (state as { queries?: unknown }).queries;
  if (!Array.isArray(queries)) return null;
  let fallback: unknown[] | null = null;
  for (const query of queries) {
    if (!query || typeof query !== "object") continue;
    const row = query as { queryKey?: unknown; state?: { data?: unknown } };
    const data = row.state?.data;
    if (!Array.isArray(data)) continue;
    const key = JSON.stringify(row.queryKey ?? "");
    if (key.includes("stocks-catalog")) return data;
    if (!fallback && data.some((item) => item && typeof item === "object" && "tradingConfig" in item)) {
      fallback = data;
    }
  }
  return fallback;
}

/**
 * Pull official Securitize stock identities out of the public stocks page.
 * Classifier still fail-closes. Page data-URI icons are ignored.
 * Rows that are not in {@link SECURITIZE_OFFICIAL_MINTS} are dropped.
 */
export function parseSecuritizeStocksPage(source: unknown): {
  identities: TokenIdentity[];
  logos: Record<string, string>;
} {
  if (typeof source !== "string" || source.trim().length === 0) {
    throw new Error("Securitize stocks page was not HTML.");
  }
  const match = source.match(CATALOG_SCRIPT_RE);
  if (!match?.[1]) {
    throw new Error("Securitize stocks catalog was not found.");
  }
  let state: unknown;
  try {
    state = JSON.parse(match[1]);
  } catch {
    throw new Error("Securitize stocks catalog was not JSON.");
  }
  const rows = catalogRows(state);
  if (!rows) {
    throw new Error("Securitize stocks catalog was not found.");
  }

  const identities: TokenIdentity[] = [];
  const logos: Record<string, string> = {};
  const seen = new Set<string>();
  for (const node of rows) {
    if (!node || typeof node !== "object") continue;
    const row = node as {
      type?: unknown;
      chainNamespace?: unknown;
      symbol?: unknown;
      decimals?: unknown;
      tradingConfig?: { tokenAddress?: unknown };
    };
    if (asNonEmptyString(row.type) !== "stock") continue;
    const chain = asNonEmptyString(row.chainNamespace);
    if (chain && chain !== "solana") continue;
    if (row.decimals != null && row.decimals !== 6) continue;
    const address = asNonEmptyString(row.tradingConfig?.tokenAddress);
    const symbol = asNonEmptyString(row.symbol);
    if (!address || !symbol || seen.has(address)) continue;
    const official = OFFICIAL_BY_ADDRESS.get(address);
    if (!official || official.symbol.toUpperCase() !== symbol.toUpperCase()) continue;
    seen.add(address);
    const identity: TokenIdentity = {
      address: official.address,
      symbol: official.symbol,
      name: official.name,
      labels: [],
      underlyingInstrumentType: official.lane,
      metadataUri: official.metadataUri,
    };
    identities.push(identity);
    const logo = httpMintLogoUrl(official.logoUrl);
    if (logo) logos[official.address] = logo;
  }

  if (identities.length === 0) {
    throw new Error("Securitize stocks page parsed zero Solana mints.");
  }
  return { identities, logos };
}
