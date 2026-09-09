import { describe, expect, it } from "vitest";
import {
  geckoPairsForSupplement,
  geckoTerminalOhlcvPath,
  geckoTerminalSearchPath,
  parseGeckoTerminalSearch,
  parseGeckoTerminalSearchPools,
} from "../solana-geckoterminal";

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

describe("parseGeckoTerminalSearchPools", () => {
  it("reads pool volume and mint sides without inventing a series", () => {
    const pairs = parseGeckoTerminalSearchPools({
      data: [
        {
          attributes: {
            address: "9XVKRT2D53LEDyA5jyhBLMEv23kw91iNrXBzvghUDfT9",
            name: "MU / USDC",
            volume_usd: { h24: "2435003.15" },
            reserve_in_usd: "1000.5",
            base_token_price_usd: "12.5",
          },
          relationships: {
            base_token: { data: { id: "solana_MUxEsUKSMACyw5fZf68wxf5FLnZVhtU9CwH8uNNGay1" } },
            quote_token: { data: { id: "solana_EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" } },
            dex: { data: { id: "zerofi" } },
          },
        },
      ],
      included: [
        {
          id: "solana_MUxEsUKSMACyw5fZf68wxf5FLnZVhtU9CwH8uNNGay1",
          type: "token",
          attributes: {
            address: "MUxEsUKSMACyw5fZf68wxf5FLnZVhtU9CwH8uNNGay1",
            name: "Micron Technology - Backpack Securities",
            symbol: "MU",
          },
        },
        {
          id: "solana_EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          type: "token",
          attributes: { address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC" },
        },
      ],
    });
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.dexId).toBe("zerofi");
    expect(pairs[0]?.volume?.h24).toBeCloseTo(2_435_003.15);
    expect(pairs[0]?.baseToken?.address).toBe("MUxEsUKSMACyw5fZf68wxf5FLnZVhtU9CwH8uNNGay1");
  });
});

describe("geckoPairsForSupplement", () => {
  it("keeps only unindexed venues and drops DexScreener pair addresses", () => {
    const geckoPairs = parseGeckoTerminalSearchPools({
      data: [
        {
          attributes: { address: "already-on-dexscreener", volume_usd: { h24: "99" } },
          relationships: {
            base_token: { data: { id: "solana_MUxEsUKSMACyw5fZf68wxf5FLnZVhtU9CwH8uNNGay1" } },
            dex: { data: { id: "zerofi" } },
          },
        },
        {
          attributes: { address: "zerofi-only", volume_usd: { h24: "50" } },
          relationships: {
            base_token: { data: { id: "solana_MUxEsUKSMACyw5fZf68wxf5FLnZVhtU9CwH8uNNGay1" } },
            dex: { data: { id: "zerofi" } },
          },
        },
        {
          attributes: { address: "meteora-overlap", volume_usd: { h24: "80" } },
          relationships: {
            base_token: { data: { id: "solana_MUxEsUKSMACyw5fZf68wxf5FLnZVhtU9CwH8uNNGay1" } },
            dex: { data: { id: "meteora" } },
          },
        },
      ],
      included: [
        {
          id: "solana_MUxEsUKSMACyw5fZf68wxf5FLnZVhtU9CwH8uNNGay1",
          type: "token",
          attributes: { address: "MUxEsUKSMACyw5fZf68wxf5FLnZVhtU9CwH8uNNGay1" },
        },
      ],
    });
    const extra = geckoPairsForSupplement(
      geckoPairs,
      new Set(["MUxEsUKSMACyw5fZf68wxf5FLnZVhtU9CwH8uNNGay1"]),
      new Set(["already-on-dexscreener"]),
    );
    expect(extra.map((pair) => pair.pairAddress)).toEqual(["zerofi-only"]);
  });
});

describe("geckoTerminalOhlcvPath", () => {
  it("asks for daily USD candles on a Solana pool", () => {
    const path = geckoTerminalOhlcvPath("8aDaBQkTrS6HVMjyc6EZebgdiaXhLYGriDWKWWp1NpFF");
    expect(path).toContain("/networks/solana/pools/8aDaBQkTrS6HVMjyc6EZebgdiaXhLYGriDWKWWp1NpFF/ohlcv/day");
    expect(path).toContain("currency=usd");
    expect(path).toContain("limit=1000");
  });
});
