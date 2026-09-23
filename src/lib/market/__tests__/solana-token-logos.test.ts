import { describe, expect, it } from "vitest";
import {
  applyMintLogoFallbacks,
  httpMintLogoUrl,
  jupiterTokenSearchPath,
  parseJupiterTokenIcons,
  resolveMintLogoUrl,
} from "../solana-token-logos";

const tslaMint = "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB";
const otherMint = "XsOtherTeslaMint111111111111111111111111";
const pairLogo = "https://dd.dexscreener.com/ds-data/tokens/solana/tsla.png";
const catalogLogo = "https://xstocks-metadata.backed.fi/logos/tokens/TSLAx.png";

describe("httpMintLogoUrl", () => {
  it("keeps http(s) and rejects invented schemes", () => {
    expect(httpMintLogoUrl("https://cdn.example/logo.png")).toBe("https://cdn.example/logo.png");
    expect(httpMintLogoUrl("http://cdn.example/logo.png")).toBe("http://cdn.example/logo.png");
    expect(httpMintLogoUrl("javascript:alert(1)")).toBeNull();
    expect(httpMintLogoUrl("data:image/png;base64,aaaa")).toBeNull();
    expect(httpMintLogoUrl("/relative.png")).toBeNull();
    expect(httpMintLogoUrl(null)).toBeNull();
  });
});

describe("resolveMintLogoUrl", () => {
  it("prefers a DexScreener pair image over the mint catalog", () => {
    expect(
      resolveMintLogoUrl({
        mint: tslaMint,
        dexScreenerLogoUrl: pairLogo,
        catalog: { [tslaMint]: catalogLogo },
      }),
    ).toBe(pairLogo);
  });

  it("falls back to a mint-keyed catalog URL and never matches another mint", () => {
    expect(
      resolveMintLogoUrl({
        mint: tslaMint,
        dexScreenerLogoUrl: null,
        catalog: { [tslaMint]: catalogLogo, [otherMint]: "https://example.com/other.png" },
      }),
    ).toBe(catalogLogo);
    expect(
      resolveMintLogoUrl({
        mint: tslaMint,
        catalog: { [otherMint]: catalogLogo },
      }),
    ).toBeNull();
  });
});

describe("applyMintLogoFallbacks", () => {
  it("fills only missing logoUrl and does not overwrite DexScreener", () => {
    const rows = [
      { contractAddress: tslaMint, logoUrl: pairLogo },
      { contractAddress: otherMint, logoUrl: null },
    ];
    applyMintLogoFallbacks(rows, {
      [tslaMint]: catalogLogo,
      [otherMint]: "https://example.com/other.png",
    });
    expect(rows[0]?.logoUrl).toBe(pairLogo);
    expect(rows[1]?.logoUrl).toBe("https://example.com/other.png");
  });
});

describe("parseJupiterTokenIcons", () => {
  it("accepts icon only when id is a requested mint", () => {
    const found = parseJupiterTokenIcons(
      [
        { id: tslaMint, symbol: "TSLAx", icon: catalogLogo },
        { id: "So11111111111111111111111111111111111111112", symbol: "SOL", icon: "https://example.com/sol.png" },
        { id: otherMint, symbol: "TSLAx", icon: "https://example.com/impostor.png" },
        { id: tslaMint, symbol: "TSLAx", icon: "javascript:alert(1)" },
      ],
      new Set([tslaMint]),
    );
    expect(found).toEqual({ [tslaMint]: catalogLogo });
    expect(found[otherMint]).toBeUndefined();
  });

  it("returns empty on garbage instead of inventing URLs", () => {
    expect(parseJupiterTokenIcons({ tokens: [] }, new Set([tslaMint]))).toEqual({});
    expect(parseJupiterTokenIcons([{ symbol: "TSLAx", icon: catalogLogo }], new Set([tslaMint]))).toEqual({});
  });
});

describe("jupiterTokenSearchPath", () => {
  it("queries by comma-separated mints", () => {
    expect(jupiterTokenSearchPath([tslaMint, otherMint])).toContain(encodeURIComponent(`${tslaMint},${otherMint}`));
  });
});
