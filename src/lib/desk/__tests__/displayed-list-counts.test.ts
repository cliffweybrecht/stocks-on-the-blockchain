import { describe, expect, it } from "vitest";
import {
  assetsMatchingListView,
  displayedIssuerFacets,
  displayedLaneCount,
} from "../displayed-list-counts";
import type { ListViewAsset } from "../displayed-list-counts";

function row(issuer: string | null, volume24hUsd: number | null, poolCount = volume24hUsd == null ? 0 : 1): ListViewAsset {
  return {
    issuer,
    volume24hUsd,
    poolCount,
    volumeCoverage: volume24hUsd == null ? "no_indexed_pools" : "reported",
  };
}

const equities: ListViewAsset[] = [
  row("Ondo", 10),
  row("Ondo", null),
  row("Backed / xStocks", 5),
  row("Backed / xStocks", null),
  row("Backed / xStocks", 0),
  row(null, 1),
  row(null, null),
];

describe("displayedLaneCount", () => {
  it("counts only assets the with-volume list actually shows", () => {
    expect(displayedLaneCount(equities, "with-volume", "all")).toBe(4);
    expect(displayedLaneCount(equities, "all", "all")).toBe(equities.length);
  });

  it("matches the cards on screen when an issuer chip is selected", () => {
    expect(displayedLaneCount(equities, "with-volume", "ondo")).toBe(1);
    expect(displayedLaneCount(equities, "with-volume", "backed-xstocks")).toBe(2);
    expect(displayedLaneCount(equities, "with-volume", "unknown")).toBe(1);
  });

  it("keeps a reported zero in the with-volume count", () => {
    const shown = assetsMatchingListView(equities, "with-volume", "backed-xstocks");
    expect(shown.map((asset) => asset.volume24hUsd)).toEqual([5, 0]);
  });
});

describe("displayedIssuerFacets", () => {
  it("counts issuers inside the coverage-filtered lane, not the full registry", () => {
    const { issuers, unknownCount } = displayedIssuerFacets(equities, "with-volume");
    expect(issuers.map((facet) => [facet.slug, facet.count])).toEqual([
      ["backed-xstocks", 2],
      ["ondo", 1],
    ]);
    expect(unknownCount).toBe(1);
    expect(issuers.reduce((sum, facet) => sum + facet.count, 0) + unknownCount).toBe(
      displayedLaneCount(equities, "with-volume", "all"),
    );
  });

  it("keeps every issuer's displayed count when one issuer is selected", () => {
    const { issuers } = displayedIssuerFacets(equities, "with-volume");
    const ondo = issuers.find((facet) => facet.slug === "ondo");
    expect(ondo?.count).toBe(displayedLaneCount(equities, "with-volume", "ondo"));
    expect(issuers.find((facet) => facet.slug === "backed-xstocks")?.count).toBe(2);
  });
});
