import { describe, expect, it } from "vitest";
import { assetMatchesSearch, rankSearchHits } from "../asset-search";

const tsla = {
  symbol: "TSLAx",
  name: "Tesla xStock",
  issuer: "Backed / xStocks",
  contractAddress: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB",
};
const tslaOn = {
  symbol: "TSLAon",
  name: "Tesla (Ondo Tokenized)",
  issuer: "Ondo",
  contractAddress: "KeGv7bsfR4MheC1CkmnAVceoApjrkvBhHYjWb67ondo",
};
const hood = {
  symbol: "HOODx",
  name: "Robinhood xStock",
  issuer: "Backed / xStocks",
  contractAddress: "XsvNBAYkrDRNhA7wPHQfX3ZUXZyZLdnCQDfHZ56bzpg",
};

describe("asset search", () => {
  it("matches symbol, name, issuer, and mint without treating empty as a hit list", () => {
    expect(assetMatchesSearch(tsla, "tsla")).toBe(true);
    expect(assetMatchesSearch(tsla, "ondo")).toBe(false);
    expect(assetMatchesSearch(tslaOn, "Ondo")).toBe(true);
    expect(assetMatchesSearch(hood, "XsvNBAYkr")).toBe(true);
    expect(assetMatchesSearch(hood, "   ")).toBe(true);
  });

  it("ranks exact symbol ahead of substring name hits and deep-links stay mint-distinct", () => {
    const ranked = rankSearchHits([tslaOn, hood, tsla], "tsla", 8);
    expect(ranked.map((row) => row.symbol)).toEqual(["TSLAx", "TSLAon"]);
    expect(rankSearchHits([tsla, hood], "zzz")).toEqual([]);
  });
});
