import { describe, expect, it } from "vitest";
import {
  collectSolanaCandidateTokens,
  mergeTokenIdentities,
  prioritizeMintsForHydrate,
  selectEquityMints,
  selectInstrumentMints,
} from "../solana-discover";

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

  it("deduplicates the same mint from search and a registry feed", () => {
    const merged = mergeTokenIdentities([
      [{ address: "XsMintA111111111111111111111111111111111", symbol: "TSLAx", name: "Tesla" }],
      [
        {
          address: "XsMintA111111111111111111111111111111111",
          symbol: "TSLAx",
          name: "Tesla xStock",
          underlyingInstrumentType: "equity",
        },
      ],
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.name).toBe("Tesla xStock");
    expect(merged[0]?.underlyingInstrumentType).toBe("equity");
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

  it("puts PreStocks in the private lane and keeps public equities separate", () => {
    const selected = selectInstrumentMints([
      { address: "XsHoodMint111111111111111111111111111111", symbol: "HOODx", name: "Robinhood xStock" },
      { address: "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF", symbol: "OPENAI", name: "OpenAI PreStocks" },
      { address: "SpaceXMeme111111111111111111111111111111", symbol: "SPACEX", name: "SpaceX" },
    ]);
    expect(selected.equities.map((row) => row.symbol)).toEqual(["HOODx"]);
    expect(selected.privates.map((row) => row.symbol)).toEqual(["OPENAI"]);
    expect(selected.etfs).toEqual([]);
  });

  it("hydrates DexScreener-known mints before blind registry names", () => {
    expect(prioritizeMintsForHydrate(["registry-only", "search-seen", "other"], new Set(["search-seen"]))).toEqual([
      "search-seen",
      "registry-only",
      "other",
    ]);
  });

  it("skips mints already confirmed empty on DexScreener", () => {
    expect(
      prioritizeMintsForHydrate(
        ["registry-only", "search-seen", "empty"],
        new Set(["search-seen"]),
        new Set(["empty"]),
      ),
    ).toEqual(["search-seen", "registry-only"]);
  });
});
