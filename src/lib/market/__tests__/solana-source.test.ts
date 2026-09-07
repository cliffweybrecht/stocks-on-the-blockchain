import { describe, expect, it } from "vitest";
import { DEFAULT_SOLANA_DISCOVERY_QUERIES } from "../solana-discover";
import { SolanaMarketDataSource } from "../solana-source";

const tslaMint = "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB";
const hoodMint = "NotAllowlisted111111111111111111111111111";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function tslaPair() {
  return {
    chainId: "solana",
    dexId: "raydium",
    pairAddress: "pair-1",
    baseToken: { address: tslaMint, name: "Tesla xStock", symbol: "TSLAx" },
    quoteToken: { address: "usdc", name: "USDC", symbol: "USDC" },
    priceUsd: "100.5",
    volume: { h24: 1_250.25 },
    liquidity: { usd: 9_000 },
    txns: { h24: { buys: 4, sells: 3 } },
  };
}

describe("SolanaMarketDataSource", () => {
  it("discovers via search, hydrates token-pairs, and aggregates by mint", async () => {
    const urls: string[] = [];
    const source = new SolanaMarketDataSource({
      requestGapMs: 0,
      discoveryQueries: ["xStock"],
      fetchImpl: async (input) => {
        urls.push(String(input));
        if (String(input).includes("/latest/dex/search")) {
          return jsonResponse({ pairs: [tslaPair()] });
        }
        if (String(input).includes(`/token-pairs/v1/solana/${tslaMint}`)) {
          return jsonResponse([
            tslaPair(),
            {
              ...tslaPair(),
              dexId: "orca",
              pairAddress: "pair-2",
              volume: { h24: 10 },
              liquidity: { usd: 100 },
            },
          ]);
        }
        return jsonResponse({ unexpected: true }, 404);
      },
    });

    const list = await source.listChains();
    expect(list.chains).toHaveLength(1);
    expect(list.chains[0]?.id).toBe("solana");
    expect(list.chains[0]?.volume24hUsd).toBeCloseTo(1_260.25);
    expect(urls.some((url) => url.includes("/latest/dex/search?q=xStock"))).toBe(true);
    expect(urls.some((url) => url.includes(`/token-pairs/v1/solana/${tslaMint}`))).toBe(true);

    const chain = await source.getChain("solana");
    expect(chain?.assets[0]?.symbol).toBe("TSLAx");
    expect(chain?.assets[0]?.poolCount).toBe(2);
    expect(chain?.assets[0]?.issuer).toBe("Backed / xStocks");
    expect(await source.getChain("robinhood-chain")).toBeNull();

    const asset = await source.getAsset("solana", "tslax");
    expect(asset?.asset.contractAddress).toBe(tslaMint);
    expect(asset?.asset.pools).toHaveLength(2);
    expect(await source.getAsset("solana", tslaMint)).not.toBeNull();
  });

  it("admits a classified equity that is not on the historical allowlist", async () => {
    const source = new SolanaMarketDataSource({
      requestGapMs: 0,
      discoveryQueries: ["xStock"],
      fetchImpl: async (input) => {
        const pair = {
          chainId: "solana",
          dexId: "raydium",
          pairAddress: "pair-hood",
          baseToken: { address: hoodMint, name: "Robinhood xStock", symbol: "HOODx" },
          volume: { h24: 40 },
          liquidity: { usd: 12 },
        };
        if (String(input).includes("/latest/dex/search")) return jsonResponse({ pairs: [pair] });
        return jsonResponse([pair]);
      },
    });

    const chain = await source.getChain("solana");
    expect(chain?.assets.map((asset) => asset.symbol)).toEqual(["HOODx"]);
  });

  it("fails closed when search finds only crypto", async () => {
    const source = new SolanaMarketDataSource({
      requestGapMs: 0,
      discoveryQueries: ["xStock"],
      fetchImpl: async () =>
        jsonResponse({
          pairs: [
            {
              chainId: "solana",
              baseToken: { address: "bonk", name: "Bonk", symbol: "BONK" },
              volume: { h24: 9_000_000 },
            },
          ],
        }),
    });
    await expect(source.listChains()).rejects.toThrow(/No verifiable Solana tokenized stocks/);
  });

  it("fails closed when DexScreener returns an HTTP error", async () => {
    const source = new SolanaMarketDataSource({
      requestGapMs: 0,
      fetchImpl: async () => jsonResponse({ error: "nope" }, 502),
    });
    await expect(source.listChains()).rejects.toThrow(/502/);
  });

  it("fails closed when the search payload is not a pair list", async () => {
    const source = new SolanaMarketDataSource({
      requestGapMs: 0,
      discoveryQueries: ["xStock"],
      fetchImpl: async () => jsonResponse({ unexpected: true }),
    });
    await expect(source.listChains()).rejects.toThrow(/search response/);
  });

  it("uses the default discovery query set", () => {
    expect(DEFAULT_SOLANA_DISCOVERY_QUERIES).toContain("xStock");
    expect(DEFAULT_SOLANA_DISCOVERY_QUERIES).toContain("tokenized stock");
  });
});
