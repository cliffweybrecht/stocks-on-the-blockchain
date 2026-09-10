import { describe, expect, it } from "vitest";
import { parseSunriseTokensPage, sunriseTokensPath } from "../solana-sunrise";

const nkeMint = "NKEda5nHhNGgjrE9nDdMvaEmkmJ96qqxzBVZEcKmjSg";
const shopMint = "SH55hfaipFAbwT42nQYhRoM5o5t61QpkmJ6p62vXB3m";
const baMint = "BArimz1PcKZr8PcPh3tcZ2dg4S7FJLk3cw6R5F8GsHKg";

function stockRow(input: { symbol: string; name: string; address: string; issuer?: string | null }) {
  return {
    chain: "solana",
    address: input.address,
    symbol: input.symbol,
    name: input.name,
    decimals: 6,
    platform: "svm",
    assetClass: "stock",
    issuer: input.issuer === undefined ? "backpack_securities" : input.issuer,
    icon: null,
    tokenProgram: null,
    stock: null,
  };
}

describe("parseSunriseTokensPage", () => {
  it("extracts Backpack stock rows without treating Sunrise as an admission list", () => {
    const parsed = parseSunriseTokensPage({
      success: true,
      data: {
        count: 4,
        tokens: [
          stockRow({ symbol: "NKE", name: "NIKE - Backpack Securities", address: nkeMint, issuer: null }),
          stockRow({ symbol: "SHOP", name: "Shopify - Backpack Securities", address: shopMint }),
          stockRow({ symbol: "BA", name: "The Boeing Company - Backpack Securities", address: baMint }),
          {
            chain: "solana",
            address: "BPxxfRCXkUVhig4HS1Lh7kZqV6SPJhzfEk4x6fVBjPCy",
            symbol: "BP",
            name: "Backpack",
            decimals: 6,
            platform: "svm",
            assetClass: "crypto",
            issuer: null,
            icon: null,
            tokenProgram: null,
            stock: null,
          },
        ],
        pagination: { limit: 200, nextCursor: null },
      },
      timestamp: "2026-09-10T00:00:00.000Z",
    });
    expect(parsed.nextCursor).toBeNull();
    expect(parsed.identities.map((row) => row.symbol)).toEqual(["NKE", "SHOP", "BA"]);
    expect(parsed.identities[0]?.address).toBe(nkeMint);
    expect(parsed.identities[0]?.name).toBe("NIKE - Backpack Securities");
  });

  it("skips pump.fun copycats even when Sunrise branding is present", () => {
    const parsed = parseSunriseTokensPage({
      success: true,
      data: {
        tokens: [
          stockRow({
            symbol: "NKE",
            name: "NIKE - Backpack Securities",
            address: "CopycatNikeBackpack1111111111111111111pump",
          }),
          stockRow({ symbol: "BA", name: "The Boeing Company - Backpack Securities", address: baMint }),
        ],
        pagination: { nextCursor: "nextpage" },
      },
    });
    expect(parsed.nextCursor).toBe("nextpage");
    expect(parsed.identities.map((row) => row.symbol)).toEqual(["BA"]);
  });

  it("fails closed on a malformed payload", () => {
    expect(() => parseSunriseTokensPage("no tokens here")).toThrow(/not an object/);
    expect(() => parseSunriseTokensPage({ success: false, data: { tokens: [] } })).toThrow(/not a token page/);
    expect(() => parseSunriseTokensPage({ tokens: [] })).toThrow(/not a token page/);
  });
});

describe("sunriseTokensPath", () => {
  it("pages the public tokens endpoint", () => {
    expect(sunriseTokensPath()).toBe("/v1/tokens?limit=200");
    expect(sunriseTokensPath("abc")).toContain("cursor=abc");
  });
});
