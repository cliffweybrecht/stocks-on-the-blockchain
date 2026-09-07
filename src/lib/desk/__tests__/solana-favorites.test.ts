import { describe, expect, it } from "vitest";
import { parsePinnedFilter, solanaChainHref } from "../solana-chain-href";
import {
  parseFavoriteMints,
  serializeFavoriteMints,
  SOLANA_FAVORITES_MAX,
  toggleFavoriteMint,
} from "../solana-favorites";

describe("parseFavoriteMints", () => {
  it("keeps unique plausible Solana mints and drops junk", () => {
    const mint = "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB";
    expect(parseFavoriteMints(JSON.stringify([mint, mint, "nope", 12, ""])) ).toEqual([mint]);
    expect(parseFavoriteMints("{")).toEqual([]);
    expect(parseFavoriteMints(null)).toEqual([]);
  });
});

describe("serializeFavoriteMints", () => {
  it("round-trips valid mints and drops junk", () => {
    const mint = "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB";
    expect(serializeFavoriteMints([mint, "nope", mint])).toBe(JSON.stringify([mint]));
    expect(parseFavoriteMints(serializeFavoriteMints([mint]))).toEqual([mint]);
  });
});

describe("toggleFavoriteMint", () => {
  it("pins and unpins by mint without inventing addresses", () => {
    const mint = "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB";
    const next = toggleFavoriteMint([], mint);
    expect(next).toEqual([mint]);
    expect(toggleFavoriteMint(next, mint)).toEqual([]);
  });

  it("caps the pin list", () => {
    const mints = Array.from({ length: SOLANA_FAVORITES_MAX }, (_, index) => `Xs${"A".repeat(30)}${String(index).padStart(4, "0")}`);
    const extra = "XsBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
    expect(toggleFavoriteMint(mints, extra)).toHaveLength(SOLANA_FAVORITES_MAX);
  });
});

describe("solanaChainHref", () => {
  it("omits default coverage and records pinned + hydrating filters", () => {
    expect(solanaChainHref({ chainId: "solana", defaultCoverage: "with-volume" })).toBe("/chains/solana");
    expect(
      solanaChainHref({
        chainId: "solana",
        coverage: "hydrating",
        defaultCoverage: "with-volume",
        pinned: true,
        sortKey: "poolCount",
        lane: "etf",
      }),
    ).toBe("/chains/solana?lane=etf&coverage=hydrating&sort=pools&pinned=1");
  });

  it("combines a slug-safe issuer param with existing desk filters", () => {
    expect(solanaChainHref({ chainId: "solana", defaultCoverage: "with-volume", issuer: "all" })).toBe(
      "/chains/solana",
    );
    expect(
      solanaChainHref({
        chainId: "solana",
        defaultCoverage: "with-volume",
        issuer: "Ondo",
      }),
    ).toBe("/chains/solana?issuer=ondo");
    expect(
      solanaChainHref({
        chainId: "solana",
        coverage: "all",
        defaultCoverage: "with-volume",
        sortKey: "poolCount",
        lane: "etf",
        issuer: "Backed / xStocks",
      }),
    ).toBe("/chains/solana?lane=etf&coverage=all&sort=pools&issuer=backed-xstocks");
  });
});

describe("parsePinnedFilter", () => {
  it("reads pinned=1 from the query string", () => {
    expect(parsePinnedFilter("1")).toBe(true);
    expect(parsePinnedFilter("pinned")).toBe(true);
    expect(parsePinnedFilter("0")).toBe(false);
    expect(parsePinnedFilter(undefined)).toBe(false);
  });
});
