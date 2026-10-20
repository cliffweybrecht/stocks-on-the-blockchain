import { describe, expect, it } from "vitest";
import { ETHEREUM_CHAIN, isChainEnabled } from "../chain-config";
import { MOCK_CHAINS } from "../mock-data";
import { MockMarketDataSource } from "../mock-source";

describe("ethereum chain flag", () => {
  it("keeps the seed row and hides it with one enabled flag", () => {
    expect(ETHEREUM_CHAIN).toEqual({ id: "ethereum", name: "Ethereum", enabled: false });
    expect(isChainEnabled("ethereum")).toBe(false);
    expect(isChainEnabled("solana")).toBe(true);
    expect(isChainEnabled("base")).toBe(true);
    expect(isChainEnabled("bnb")).toBe(true);
    expect(isChainEnabled("robinhood-chain")).toBe(true);
    expect(MOCK_CHAINS.some((chain) => chain.id === "ethereum")).toBe(true);
  });

  it("omits Ethereum from the seed adapter without changing the other chains", async () => {
    const source = new MockMarketDataSource();
    const listed = await source.listChains();
    expect(listed.chains.map((chain) => chain.id)).not.toContain("ethereum");
    for (const chain of MOCK_CHAINS.filter((entry) => entry.id !== "ethereum")) {
      expect(listed.chains.find((entry) => entry.id === chain.id)).toEqual(chain);
    }
    expect(await source.getChain("ethereum")).toBeNull();
    expect(await source.getChain("base")).not.toBeNull();
    const apple = await source.getAsset("ethereum", "AAPLon");
    const tesla = await source.getAsset("ethereum", "TSLAon");
    expect(apple).toBeNull();
    expect(tesla).toBeNull();
  });
});
