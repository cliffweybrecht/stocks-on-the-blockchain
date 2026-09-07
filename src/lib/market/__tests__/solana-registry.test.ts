import { describe, expect, it } from "vitest";
import { parseXStocksAssetsPage, xStocksAssetsPath } from "../solana-registry";

describe("xStocks public registry parser", () => {
  it("extracts Solana deployments and ignores other networks", () => {
    const parsed = parseXStocksAssetsPage({
      nodes: [
        {
          name: "Tesla xStock",
          symbol: "TSLAx",
          deployments: [
            { network: "Ethereum", address: "0xnope" },
            { network: "Solana", address: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB" },
          ],
        },
        {
          name: "SP500 xStock",
          symbol: "SPYx",
          deployments: [{ network: "Solana", address: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W" }],
        },
      ],
      page: { currentPage: 0, hasNextPage: true },
    });
    expect(parsed.hasNextPage).toBe(true);
    expect(parsed.identities.map((row) => row.symbol)).toEqual(["TSLAx", "SPYx"]);
    expect(parsed.identities[0]?.address).toBe("XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB");
  });

  it("captures issuer underlying type for the classifier", () => {
    const parsed = parseXStocksAssetsPage({
      nodes: [
        {
          name: "Apple xStock",
          symbol: "AAPLx",
          underlying: { type: "Equity" },
          deployments: [{ network: "Solana", address: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp" }],
        },
        {
          name: "SP500 xStock",
          symbol: "SPYx",
          underlying: { type: "ETF" },
          deployments: [{ network: "Solana", address: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W" }],
        },
      ],
      page: { currentPage: 0, hasNextPage: false },
    });
    expect(parsed.identities[0]?.underlyingInstrumentType).toBe("equity");
    expect(parsed.identities[1]?.underlyingInstrumentType).toBe("etf");
  });

  it("fails closed on a malformed registry payload", () => {
    expect(() => parseXStocksAssetsPage({ items: [] })).toThrow(/asset list/);
  });

  it("builds a paginated public assets path", () => {
    expect(xStocksAssetsPath(2)).toContain("network=Solana");
    expect(xStocksAssetsPath(2)).toContain("page=2");
  });
});
