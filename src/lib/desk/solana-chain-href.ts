import { type AssetSortKey, assetSortQueryValue } from "../market/aggregate";
import type { InstrumentKind } from "../market/types";
import type { CoverageFilter } from "../market/volume-coverage";
import { ALL_ISSUERS, type IssuerFilter, issuerQueryValue } from "./issuer-filter";

export function parsePinnedFilter(value: string | string[] | undefined): boolean {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === "1" || raw === "true" || raw === "pinned";
}

export function solanaChainHref(input: {
  chainId: string;
  lane?: InstrumentKind;
  coverage?: CoverageFilter;
  defaultCoverage?: CoverageFilter;
  sortKey?: AssetSortKey;
  pinned?: boolean;
  issuer?: IssuerFilter;
}): string {
  const params = new URLSearchParams();
  if (input.lane === "etf") params.set("lane", "etf");
  const coverage = input.coverage ?? input.defaultCoverage ?? "all";
  const fallback = input.defaultCoverage ?? "all";
  if (coverage !== fallback) params.set("coverage", coverage);
  const sortQuery = assetSortQueryValue(input.sortKey ?? "volume24hUsd");
  if (sortQuery) params.set("sort", sortQuery);
  if (input.pinned) params.set("pinned", "1");
  const issuer = issuerQueryValue(input.issuer ?? ALL_ISSUERS);
  if (issuer) params.set("issuer", issuer);
  const query = params.toString();
  return query ? `/chains/${input.chainId}?${query}` : `/chains/${input.chainId}`;
}
