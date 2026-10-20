import { BASE_CHAIN_ID, BNB_CHAIN_ID, ROBINHOOD_CHAIN_ID, SOLANA_CHAIN_ID } from "@/lib/market/types";

export const HIDEABLE_DESKS = ["perps", "lending"] as const;

export type HideableDesk = (typeof HIDEABLE_DESKS)[number];

export type SiteEnv = Record<string, string | undefined>;

function flagOn(value: string | undefined): boolean {
  const flag = value?.trim().toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes";
}

/**
 * Desks omitted from the public site.
 * Unset flags hide nothing, so local dev keeps Perps and Lending.
 * `PUBLIC_SITE` hides both. `NEXT_PUBLIC_HIDE_SECTIONS` hides the named desks.
 */
export function hiddenDesks(env: SiteEnv = process.env): HideableDesk[] {
  const hidden = new Set<HideableDesk>();
  if (flagOn(env.PUBLIC_SITE)) {
    hidden.add("perps");
    hidden.add("lending");
  }
  for (const part of (env.NEXT_PUBLIC_HIDE_SECTIONS ?? "").split(",")) {
    const name = part.trim().toLowerCase();
    if (name === "perps" || name === "lending") hidden.add(name);
  }
  return HIDEABLE_DESKS.filter((desk) => hidden.has(desk));
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
