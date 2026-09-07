import { describe, expect, it } from "vitest";
import { SOLANA_XSTOCK_MINTS } from "../solana-allowlist";
import { SolanaMarketDataSource } from "../solana-source";

const tslaMint = SOLANA_XSTOCK_MINTS[0]!.mint;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("SolanaMarketDataSource", () => {
  it("maps a mocked DexScreener payload into the Solana chain", async () => {
    const source = new SolanaMarketDataSource({
      fetchImpl: async () =>
        jsonResponse([
          {
            chainId: "solana",
            dexId: "raydium",
            pairAddress: "pair-1",
            baseToken: { address: tslaMint, name: "Tesla xStock", symbol: "TSLAx" },
            quoteToken: { address: "usdc", name: "USDC", symbol: "USDC" },
            priceUsd: "100.5",
            volume: { h24: 1_250.25 },
            liquidity: { usd: 9_000 },
            txns: { h24: { buys: 4, sells: 3 } },
          },
        ]),
    });

    const list = await source.listChains();
    expect(list.chains).toHaveLength(1);
    expect(list.chains[0]?.id).toBe("solana");
    expect(list.chains[0]?.sourceId).toBe("solana");
    expect(list.chains[0]?.volume24hUsd).toBeCloseTo(1_250.25);

    const chain = await source.getChain("solana");
    expect(chain?.assets[0]?.symbol).toBe("TSLAx");
    expect(await source.getChain("robinhood-chain")).toBeNull();

    const asset = await source.getAsset("solana", "tslax");
    expect(asset?.asset.contractAddress).toBe(tslaMint);
    expect(asset?.provenance.sourceId).toBe("solana");
  });

  it("fails closed when DexScreener returns an HTTP error", async () => {
    const source = new SolanaMarketDataSource({
      fetchImpl: async () => jsonResponse({ error: "nope" }, 502),
    });
    await expect(source.listChains()).rejects.toThrow(/502/);
  });

  it("fails closed when the payload is not a pair list", async () => {
    const source = new SolanaMarketDataSource({
      fetchImpl: async () => jsonResponse({ unexpected: true }),
    });
    await expect(source.listChains()).rejects.toThrow(/pair list/);
  });
});
