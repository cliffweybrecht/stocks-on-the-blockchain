import { describe, expect, it } from "vitest";
import {
  ALL_ISSUERS,
  UNKNOWN_ISSUER,
  assetMatchesIssuerFilter,
  issuerFilterLabel,
  issuerQueryValue,
  issuerSlug,
  listIssuerFacets,
  parseIssuerFilter,
} from "../issuer-filter";

const backed = { issuer: "Backed / xStocks" };
const ondo = { issuer: "Ondo" };
const unknown = { issuer: null };
const blank = { issuer: "   " };

describe("issuerSlug", () => {
  it("builds slug-safe tokens from canonical issuer strings", () => {
    expect(issuerSlug("Ondo")).toBe("ondo");
    expect(issuerSlug("Backed / xStocks")).toBe("backed-xstocks");
    expect(issuerSlug("  Dinari  ")).toBe("dinari");
  });
});

describe("parseIssuerFilter", () => {
  it("defaults to all and accepts case-insensitive, slug-safe query values", () => {
    expect(parseIssuerFilter(undefined)).toBe(ALL_ISSUERS);
    expect(parseIssuerFilter("")).toBe(ALL_ISSUERS);
    expect(parseIssuerFilter("all")).toBe(ALL_ISSUERS);
    expect(parseIssuerFilter("Ondo")).toBe("ondo");
    expect(parseIssuerFilter("ondo")).toBe("ondo");
    expect(parseIssuerFilter("ONDO")).toBe("ondo");
    expect(parseIssuerFilter("Backed / xStocks")).toBe("backed-xstocks");
    expect(parseIssuerFilter("backed-xstocks")).toBe("backed-xstocks");
    expect(parseIssuerFilter("unknown")).toBe(UNKNOWN_ISSUER);
    expect(parseIssuerFilter("Unknown")).toBe(UNKNOWN_ISSUER);
    expect(parseIssuerFilter(["Ondo", "Backed"])).toBe("ondo");
  });
});

describe("issuerQueryValue", () => {
  it("omits the default and writes a slug for named issuers", () => {
    expect(issuerQueryValue(ALL_ISSUERS)).toBeNull();
    expect(issuerQueryValue("Ondo")).toBe("ondo");
    expect(issuerQueryValue(UNKNOWN_ISSUER)).toBe("unknown");
  });
});

describe("assetMatchesIssuerFilter", () => {
  it("matches case-insensitively and treats null/blank issuer as Unknown", () => {
    expect(assetMatchesIssuerFilter(ondo, ALL_ISSUERS)).toBe(true);
    expect(assetMatchesIssuerFilter(unknown, ALL_ISSUERS)).toBe(true);

    expect(assetMatchesIssuerFilter(ondo, "ondo")).toBe(true);
    expect(assetMatchesIssuerFilter(ondo, "Ondo")).toBe(true);
    expect(assetMatchesIssuerFilter(backed, "ondo")).toBe(false);
    expect(assetMatchesIssuerFilter({ issuer: "ONDO" }, "ondo")).toBe(true);

    expect(assetMatchesIssuerFilter(backed, "backed-xstocks")).toBe(true);
    expect(assetMatchesIssuerFilter(backed, "Backed / xStocks")).toBe(true);

    expect(assetMatchesIssuerFilter(unknown, UNKNOWN_ISSUER)).toBe(true);
    expect(assetMatchesIssuerFilter(blank, UNKNOWN_ISSUER)).toBe(true);
    expect(assetMatchesIssuerFilter(ondo, UNKNOWN_ISSUER)).toBe(false);
    expect(assetMatchesIssuerFilter(unknown, "ondo")).toBe(false);
  });
});

describe("listIssuerFacets", () => {
  it("derives chips from the current lane with canonical labels and counts", () => {
    const { issuers, unknownCount } = listIssuerFacets([
      ondo,
      backed,
      { issuer: "ondo" },
      unknown,
      blank,
      { issuer: "Dinari" },
    ]);
    expect(issuers.map((facet) => [facet.label, facet.slug, facet.count])).toEqual([
      ["Backed / xStocks", "backed-xstocks", 1],
      ["Dinari", "dinari", 1],
      ["Ondo", "ondo", 2],
    ]);
    expect(unknownCount).toBe(2);
  });
});

describe("issuerFilterLabel", () => {
  it("prefers the canonical display string from the loaded facets", () => {
    const facets = listIssuerFacets([backed, ondo]).issuers;
    expect(issuerFilterLabel(ALL_ISSUERS, facets)).toBeNull();
    expect(issuerFilterLabel(UNKNOWN_ISSUER, facets)).toBe("Unknown");
    expect(issuerFilterLabel("ondo", facets)).toBe("Ondo");
    expect(issuerFilterLabel("missing", facets)).toBe("missing");
  });
});
