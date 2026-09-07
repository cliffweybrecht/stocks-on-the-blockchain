export const ALL_ISSUERS = "all";
export const UNKNOWN_ISSUER = "unknown";

export type IssuerFilter = typeof ALL_ISSUERS | typeof UNKNOWN_ISSUER | (string & {});

export interface IssuerFacet {
  slug: string;
  label: string;
  count: number;
}

/** Lowercase hyphenated token so ?issuer= stays URL-safe (Backed / xStocks → backed-xstocks). */
export function issuerSlug(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function parseIssuerFilter(value: string | string[] | undefined): IssuerFilter {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw == null) return ALL_ISSUERS;
  const trimmed = raw.trim();
  if (!trimmed) return ALL_ISSUERS;
  const slug = issuerSlug(trimmed);
  if (!slug || slug === ALL_ISSUERS) return ALL_ISSUERS;
  if (slug === UNKNOWN_ISSUER) return UNKNOWN_ISSUER;
  return slug;
}

export function issuerQueryValue(filter: IssuerFilter): string | null {
  if (filter === ALL_ISSUERS) return null;
  const slug = issuerSlug(filter);
  return slug || null;
}

export function assetMatchesIssuerFilter(
  asset: { issuer?: string | null },
  filter: IssuerFilter,
): boolean {
  if (filter === ALL_ISSUERS) return true;
  const label = asset.issuer?.trim() ?? "";
  if (filter === UNKNOWN_ISSUER) return label.length === 0;
  return label.length > 0 && issuerSlug(label) === issuerSlug(filter);
}

export function listIssuerFacets(assets: readonly { issuer?: string | null }[]): {
  issuers: IssuerFacet[];
  unknownCount: number;
} {
  const bySlug = new Map<string, IssuerFacet>();
  let unknownCount = 0;
  for (const asset of assets) {
    const label = asset.issuer?.trim() ?? "";
    if (!label) {
      unknownCount += 1;
      continue;
    }
    const slug = issuerSlug(label);
    if (!slug) {
      unknownCount += 1;
      continue;
    }
    const existing = bySlug.get(slug);
    if (existing) {
      existing.count += 1;
      continue;
    }
    bySlug.set(slug, { slug, label, count: 1 });
  }
  const issuers = [...bySlug.values()].sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
  );
  return { issuers, unknownCount };
}

export function issuerFilterLabel(
  filter: IssuerFilter,
  facets: readonly IssuerFacet[],
): string | null {
  if (filter === ALL_ISSUERS) return null;
  if (filter === UNKNOWN_ISSUER) return "Unknown";
  return facets.find((facet) => facet.slug === issuerSlug(filter))?.label ?? filter;
}
