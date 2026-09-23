import { describe, expect, it } from "vitest";
import { BACKPACK_SUNRISE_BATCH_TICKERS } from "../solana-discover";
import { parseSunriseTokensPage, sunriseTokensPath } from "../solana-sunrise";

const nkeMint = "NKEda5nHhNGgjrE9nDdMvaEmkmJ96qqxzBVZEcKmjSg";
const shopMint = "SH55hfaipFAbwT42nQYhRoM5o5t61QpkmJ6p62vXB3m";
const baMint = "BArimz1PcKZr8PcPh3tcZ2dg4S7FJLk3cw6R5F8GsHKg";
const ibmMint = "BMKdM4yUxX12moFqVk195k7coMbaybd4RUKCUdm7D1Sk";
const wrongIbmMint = "G5xwBrVmb2QWjDq3WzbksK5dBme8EHECXXP8WxdxUZhi";

/** Official Sunrise names/mints for the 2026-09 Backpack batch. Not an admission list. */
const sunriseBackpackBatch = [
  { symbol: "BA", name: "The Boeing Company - Backpack Securities", address: baMint },
  { symbol: "BABA", name: "Alibaba Group Holding - Backpack Securities", address: "BABANGA4JE7Kkam4nTrALAwAVgsNJUuFJnnkF7S16BZp" },
  { symbol: "BULL", name: "Webull Corporation Class A Ordinary Shares - Backpack Securities", address: "BULL151gUXcFV5wXEUqu9Am2L7Qt4bTJRLRuAUjkcspC" },
  { symbol: "COST", name: "Costco Wholesale - Backpack Securities", address: "CZEB3WNZuF2Yz1z2H81RcCk8T7fsw82KB33zqamASVsg" },
  { symbol: "DELL", name: "Dell Technologies - Backpack Securities", address: "DELL2aRKQz7DMq5DrKLtkn47ZCnbxXPZXrSGbkmd13wy" },
  { symbol: "DJT", name: "Trump Media & Technology Group Corp. Common Stock - Backpack Securities", address: "DJTu7vi8norVzdVAffgvb39VP7wjKeTsgaMBJrzfxvoF" },
  { symbol: "HIMS", name: "Hims & Hers Health - Backpack Securities", address: "HiMSSzzwkZkrXJ4PGVJRdtfLaANeAztjjcgk5Dxe7Lwx" },
  { symbol: "HTZ", name: "Hertz Global Holdings, Inc Common Stock - Backpack Securities", address: "HTZsLG4zqaNvWMwXSLHH3GG5KyJpKwpBRsKVdMG6hvzP" },
  { symbol: "IBM", name: "International Business Machines - Backpack Securities", address: ibmMint },
  { symbol: "JNJ", name: "Johnson & Johnson - Backpack Securities", address: "JNJg1znKdF712Phe7L7z52AATAvEjEytBdN2w8Lnh1Y" },
  { symbol: "LMT", name: "Lockheed Martin - Backpack Securities", address: "LMT3i1BHgixFqPUgcyteJhnEz2dpy9i3cYy4pi9BoeV" },
  { symbol: "LULU", name: "lululemon athletica inc. - Backpack Securities", address: "LULUmT9VMttkfAJE236LXJcYJ2tTP7nunrSWR5G1BdS" },
  { symbol: "MGM", name: "MGM Resorts International - Backpack Securities", address: "MGMuubtUEirmkhfEQdmGUh4pr7HuUdMWcZXFtpPbVJD" },
  { symbol: "PFE", name: "Pfizer - Backpack Securities", address: "PFER6ENqP8r8NF3CqVt4mFowxsin3V5MLidBNQFCC3x" },
  { symbol: "QUBT", name: "Quantum Computing - Backpack Securities", address: "QUBTAD8C9bMU9LvmMNgKPhrmBGbHvxpu6vfWQtThxxw" },
  { symbol: "RBLX", name: "Roblox - Backpack Securities", address: "RBLXDGRD64AtRamHMFVcjqne3Ar7NLWtFtYNtsrf1cE" },
  { symbol: "RDDT", name: "Reddit - Backpack Securities", address: "RDDTGbhHwVXfyCvQMXzzowKjf5qrYBZAnehoXW83ooh" },
  { symbol: "RIVN", name: "Rivian Automotive - Backpack Securities", address: "RcZmt84VMJv9bDhKqmw1uWDahYrUT468VwAChTnfD8p" },
  { symbol: "SHOP", name: "Shopify - Backpack Securities", address: shopMint },
  { symbol: "SNAP", name: "Snap - Backpack Securities", address: "SNAPcESrvnH8yUdgeMF6xm1hym9b6hW6s8YeqeHdZFz" },
] as const;

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
    expect(parsed.logos).toEqual({});
  });

  it("keeps a Sunrise HTTPS icon for that mint and rejects non-http", () => {
    const parsed = parseSunriseTokensPage({
      success: true,
      data: {
        tokens: [
          {
            ...stockRow({ symbol: "NKE", name: "NIKE - Backpack Securities", address: nkeMint }),
            icon: "https://backpack.exchange/api/stock-logo/NKE",
          },
          {
            ...stockRow({ symbol: "SHOP", name: "Shopify - Backpack Securities", address: shopMint }),
            icon: "data:image/png;base64,aaaa",
          },
        ],
        pagination: { nextCursor: null },
      },
    });
    expect(parsed.logos).toEqual({ [nkeMint]: "https://backpack.exchange/api/stock-logo/NKE" });
    expect(parsed.logos[shopMint]).toBeUndefined();
  });

  it("keeps the official Sunrise Backpack batch and drops crypto, pumps, and the DexScreener IBM lookalike", () => {
    expect(sunriseBackpackBatch.map((row) => row.symbol)).toEqual([...BACKPACK_SUNRISE_BATCH_TICKERS]);
    const parsed = parseSunriseTokensPage({
      success: true,
      data: {
        tokens: [
          ...sunriseBackpackBatch.map((row) => stockRow(row)),
          stockRow({
            symbol: "IBM",
            name: "International Business Machines - Backpack Securities",
            address: `${wrongIbmMint}pump`,
          }),
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
        pagination: { nextCursor: null },
      },
    });
    expect(parsed.identities.map((row) => row.symbol)).toEqual([...BACKPACK_SUNRISE_BATCH_TICKERS]);
    expect(parsed.identities.find((row) => row.symbol === "IBM")?.address).toBe(ibmMint);
    expect(parsed.identities.some((row) => row.address === wrongIbmMint || row.address.endsWith("pump"))).toBe(false);
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
