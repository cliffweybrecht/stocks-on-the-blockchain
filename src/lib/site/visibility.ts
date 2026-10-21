import { BASE_CHAIN_ID, BNB_CHAIN_ID, ROBINHOOD_CHAIN_ID, SOLANA_CHAIN_ID } from "@/lib/market/types";

export const HIDEABLE_DESKS = ["perps", "lending"] as const;

/** Section key for the market-value card, sort, and Volume | Market value switch. */
export const MARKET_VALUE_SECTION = "marketvalue";

export type HideableDesk = (typeof HIDEABLE_DESKS)[number];

export type SiteEnv = Record<string, string | undefined>;

function flagOn(value: string | undefined): boolean {
  const flag = value?.trim().toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes";
}

function hiddenSectionNames(env?: SiteEnv): string[] {
  // Direct `process.env.NEXT_PUBLIC_*` access so the client bundle inlines the build value.
  const raw = (env ? env.NEXT_PUBLIC_HIDE_SECTIONS : process.env.NEXT_PUBLIC_HIDE_SECTIONS) ?? "";
  return raw
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0);
}

/**
 * Desks omitted from the public site.
 * Unset flags hide nothing, so local dev keeps Perps and Lending.
 * `PUBLIC_SITE` hides both. `NEXT_PUBLIC_HIDE_SECTIONS` hides the named desks.
 * `marketvalue` is not a desk. It only hides the market-value UI.
 */
export function hiddenDesks(env?: SiteEnv): HideableDesk[] {
  const source = env ?? process.env;
  const hidden = new Set<HideableDesk>();
  if (flagOn(source.PUBLIC_SITE)) {
    hidden.add("perps");
    hidden.add("lending");
  }
  for (const name of hiddenSectionNames(env)) {
    if (name === "perps" || name === "lending") hidden.add(name);
  }
  return HIDEABLE_DESKS.filter((desk) => hidden.has(desk));
}

/**
 * True when `NEXT_PUBLIC_HIDE_SECTIONS` lists `marketvalue`.
 * Unset leaves the card, sort, and switch visible. `PUBLIC_SITE` alone does not hide them.
 */
export function isMarketValueHidden(env?: SiteEnv): boolean {
  return hiddenSectionNames(env).includes(MARKET_VALUE_SECTION);
}

export function isSectionHidden(desk: HideableDesk, env: SiteEnv = process.env): boolean {
  return hiddenDesks(env).includes(desk);
}

const CHAIN_SITEMAP_PATHS = [SOLANA_CHAIN_ID, ROBINHOOD_CHAIN_ID, BASE_CHAIN_ID, BNB_CHAIN_ID].map(
  (chainId) => `/chains/${chainId}`,
);

/** Indexable paths. Hidden desks stay out, including their sub-routes. */
export function publicSitemapPaths(env: SiteEnv = process.env): string[] {
  const paths = ["/", ...CHAIN_SITEMAP_PATHS];
  if (!isSectionHidden("perps", env)) paths.push("/perps", "/perps/methodology");
  if (!isSectionHidden("lending", env)) paths.push("/lending");
  return paths;
}

/** Path prefixes crawlers should skip. Empty when both desks are public. */
export function hiddenDeskPaths(env: SiteEnv = process.env): string[] {
  const paths: string[] = [];
  if (isSectionHidden("perps", env)) paths.push("/perps");
  if (isSectionHidden("lending", env)) paths.push("/lending");
  return paths;
}
