import { describe, expect, it } from "vitest";
import { collectSolanaCandidateTokens, selectEquityMints } from "../solana-discover";

describe("discovery filters", () => {
  it("keeps Solana tokenized equities and drops crypto, stables, and other chains", () => {
    const tokens = collectSolanaCandidateTokens([
      {
        chainId: "solana",
        baseToken: {
          address: "XsHoodMint111111111111111111111111111111",
          name: "Robinhood xStock",
          symbol: "HOODx",
        },
        quoteToken: {
          address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          name: "USD Coin",
          symbol: "USDC",
        },
      },
      {
        chainId: "solana",
        baseToken: { address: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", name: "Bonk", symbol: "BONK" },
        quoteToken: { address: "So11111111111111111111111111111111111111112", name: "Wrapped SOL", symbol: "SOL" },
      },
      {
        chainId: "ethereum",
        baseToken: { address: "0xstock", name: "Tesla xStock", symbol: "TSLAx" },
      },
    ]);

    const selected = selectEquityMints(tokens);
    expect(selected.map((row) => row.symbol)).toEqual(["HOODx"]);
    expect(selected[0]?.issuer).toBe("Backed / xStocks");
  });

  it("does not require the historical xStock allowlist for admission", () => {
    const selected = selectEquityMints([
      {
        address: "XsNotOnTheOldAllowlist1111111111111111111",
        symbol: "NFLXx",
        name: "Netflix xStock",
      },
    ]);
    expect(selected).toHaveLength(1);
    expect(selected[0]?.mint).toBe("XsNotOnTheOldAllowlist1111111111111111111");
  });

  it("deduplicates the same mint seen on multiple search pairs", () => {
    const tokens = collectSolanaCandidateTokens([
      {
        chainId: "solana",
        baseToken: { address: "XsMintA111111111111111111111111111111111", name: "Tesla", symbol: "TSLAx" },
        quoteToken: { address: "usdc", symbol: "USDC" },
      },
      {
        chainId: "solana",
        baseToken: { address: "XsMintA111111111111111111111111111111111", name: "Tesla xStock", symbol: "TSLAx" },
        quoteToken: { address: "sol", symbol: "SOL" },
      },
    ]);
    expect(tokens).toHaveLength(3);
    expect(tokens.find((token) => token.address === "XsMintA111111111111111111111111111111111")?.name).toBe(
      "Tesla xStock",
    );
    expect(selectEquityMints(tokens)).toHaveLength(1);
  });
});
