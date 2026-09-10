import { describe, expect, it } from "vitest";
import { marketsPairLabel, marketsPoolHref, marketsTokenLogoUrl, marketsTrades24h } from "../markets-pool";

describe("marketsPairLabel", () => {
  it("joins reported base and quote symbols and does not invent a side", () => {
    expect(marketsPairLabel({ baseSymbol: "NKE", quoteSymbol: "USDC" })).toBe("NKE-USDC");
    expect(marketsPairLabel({ baseSymbol: "NKE", quoteSymbol: null })).toBe("NKE");
    expect(marketsPairLabel({ baseSymbol: "  ", quoteSymbol: "USDC" })).toBe("USDC");
    expect(marketsPairLabel({ baseSymbol: null, quoteSymbol: null })).toBeNull();
  });
});

describe("marketsTrades24h", () => {
  it("sums only when both txn sides are present", () => {
    expect(marketsTrades24h(10, 4)).toBe(14);
    expect(marketsTrades24h(0, 0)).toBe(0);
    expect(marketsTrades24h(10, null)).toBeNull();
    expect(marketsTrades24h(null, 4)).toBeNull();
    expect(marketsTrades24h(null, null)).toBeNull();
  });
});

describe("marketsPoolHref", () => {
  it("keeps a reported http URL and otherwise builds a Solana pair href", () => {
    expect(
      marketsPoolHref({
        chainId: "solana",
        pairAddress: "pair-nke",
        url: "https://dexscreener.com/solana/pair-nke",
      }),
    ).toBe("https://dexscreener.com/solana/pair-nke");
    expect(marketsPoolHref({ chainId: "solana", pairAddress: "pair-nke" })).toBe(
      "https://dexscreener.com/solana/pair-nke",
    );
    expect(marketsPoolHref({ chainId: "solana", pairAddress: "", url: "javascript:alert(1)" })).toBeNull();
  });
});

describe("marketsTokenLogoUrl", () => {
  it("accepts only real http(s) logos and never invents a URL", () => {
    expect(marketsTokenLogoUrl("https://cdn.example/nke.png", null)).toBe("https://cdn.example/nke.png");
    expect(marketsTokenLogoUrl(null, "https://cdn.example/mint.png")).toBe("https://cdn.example/mint.png");
    expect(marketsTokenLogoUrl("javascript:alert(1)", "/relative.png")).toBeNull();
    expect(marketsTokenLogoUrl(null, null)).toBeNull();
  });
});
