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

  it("admits Backpack Securities and Tessera T-Tokens into the matching lanes", () => {
    const selected = selectInstrumentMints([
      {
        address: "MUxEsUKSMACyw5fZf68wxf5FLnZVhtU9CwH8uNNGay1",
        symbol: "MU",
        name: "Micron Technology - Backpack Securities",
      },
      {
        address: "NKEda5nHhNGgjrE9nDdMvaEmkmJ96qqxzBVZEcKmjSg",
        symbol: "NKE",
        name: "NIKE - Backpack Securities",
      },
      {
        address: "SH55hfaipFAbwT42nQYhRoM5o5t61QpkmJ6p62vXB3m",
        symbol: "SHOP",
        name: "Shopify - Backpack Securities",
      },
      {
        address: "BArimz1PcKZr8PcPh3tcZ2dg4S7FJLk3cw6R5F8GsHKg",
        symbol: "BA",
        name: "The Boeing Company - Backpack Securities",
      },
      {
        address: "BMKdM4yUxX12moFqVk195k7coMbaybd4RUKCUdm7D1Sk",
        symbol: "IBM",
        name: "International Business Machines - Backpack Securities",
      },
      {
        address: "SNAPcESrvnH8yUdgeMF6xm1hym9b6hW6s8YeqeHdZFz",
        symbol: "SNAP",
        name: "Snap - Backpack Securities",
      },
      {
        address: "TSPXcLV76s6V2zDiZQ18kBfcbnjaE2ZzNT3ga2Pd99v",
        symbol: "tSpaceX",
        name: "T-SpaceX",
      },
      {
        address: "DRAMjSWR7HRfJKjRkvQWYL2bcaejaVhuxEcjf4pAY4Cw",
        symbol: "DRAM",
        name: "Roundhill Memory ETF - Backpack Securities",
      },
      {
        address: "SPCXxcqXj6e5dJDVNovHN8744zkbhM2bYudU45BimGb",
        symbol: "SPCX",
        name: "SpaceX - Backpack Securities",
      },
    ]);
    expect(selected.equities.map((row) => row.symbol)).toEqual(["MU", "NKE", "SHOP", "BA", "IBM", "SNAP"]);
    expect(selected.privates.map((row) => row.symbol)).toEqual(["tSpaceX", "SPCX"]);
    expect(selected.etfs.map((row) => row.symbol)).toEqual(["DRAM"]);
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
