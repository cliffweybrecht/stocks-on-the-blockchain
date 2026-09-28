import {
  listIssuerFacets,
  assetMatchesIssuerFilter,
  type IssuerFacet,
  type IssuerFilter,
} from "@/lib/desk/issuer-filter";
import {
  assetMatchesCoverageFilter,
  type CoverageFilter,
} from "@/lib/market/volume-coverage";
import type { VolumeCoverage } from "@/lib/market/types";

/** Fields the list view already uses to decide whether a card is on screen. */
export interface ListViewAsset {
  volume24hUsd: number | null;
  poolCount: number;
  volumeCoverage?: VolumeCoverage;
  issuer?: string | null;
}

/**
 * Cards the Solana list renders for a lane under the active coverage and issuer
 * filters. Parenthesis counts use this length — not the full registry.
 */
export function assetsMatchingListView<T extends ListViewAsset>(
  assets: readonly T[],
  coverage: CoverageFilter,
  issuer: IssuerFilter,
): T[] {
  return assets.filter(
    (asset) => assetMatchesCoverageFilter(asset, coverage) && assetMatchesIssuerFilter(asset, issuer),
  );
}

/** Lane-chip count: what that lane shows with the current coverage and issuer filters. */
export function displayedLaneCount(
  assets: readonly ListViewAsset[],
  coverage: CoverageFilter,
  issuer: IssuerFilter,
): number {
  return assetsMatchingListView(assets, coverage, issuer).length;
}

/**
 * Issuer-chip counts inside one lane. Coverage is applied; the selected issuer
 * is not, so each chip shows how many cards that issuer would display.
 */
export function displayedIssuerFacets(
  assets: readonly ListViewAsset[],
  coverage: CoverageFilter,
): { issuers: IssuerFacet[]; unknownCount: number } {
  return listIssuerFacets(assets.filter((asset) => assetMatchesCoverageFilter(asset, coverage)));
}
