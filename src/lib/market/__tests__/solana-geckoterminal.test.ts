import { describe, expect, it } from "vitest";
import { geckoTerminalSearchPath, parseGeckoTerminalSearch } from "../solana-geckoterminal";

describe("parseGeckoTerminalSearch", () => {
  it("reads Solana token identities from included pool search rows", () => {
    const identities = parseGeckoTerminalSearch({
      data: [{ id: "solana_pool", type: "pool" }],
      included: [
        {
          type: "token",
          attributes: {
            address: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB",
            name: "Tesla xStock",
            symbol: "TSLAx",
          },
        },
        { type: "dex", attributes: { name: "raydium" } },
      ],
    });
    expect(identities).toEqual([
      {
        address: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB",
        symbol: "TSLAx",
        name: "Tesla xStock",
        labels: [],
        underlyingInstrumentType: null,
      },
    ]);
  });

  it("returns an empty list for a non-object payload instead of inventing mints", () => {
    expect(parseGeckoTerminalSearch("nope")).toEqual([]);
    expect(parseGeckoTerminalSearch({ data: [] })).toEqual([]);
  });
});

describe("geckoTerminalSearchPath", () => {
  it("scopes search to Solana and asks for token includes", () => {
    expect(geckoTerminalSearchPath("Ondo Tokenized")).toContain("query=Ondo");
    expect(geckoTerminalSearchPath("Ondo Tokenized")).toContain("network=solana");
    expect(geckoTerminalSearchPath("Ondo Tokenized")).toContain("include=base_token");
  });
});
