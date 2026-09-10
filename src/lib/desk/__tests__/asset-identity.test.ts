import { describe, expect, it } from "vitest";
import {
  assetIdentityMetaParts,
  assetMonogram,
  BREADCRUMB_CURRENT_CLASS,
  dexScreenerTokenUrl,
  instrumentKindMetaLabel,
  isHttpLogoUrl,
  sourceRowLabel,
} from "../asset-identity";
import { asHttpUrl } from "@/lib/market/numbers";

describe("assetMonogram", () => {
  it("uses the first two significant words", () => {
    expect(assetMonogram("The Boeing Company", "BA")).toBe("BC");
    expect(assetMonogram("NVIDIA • Robinhood Token", "NVDA")).toBe("NR");
  });

  it("skips xStock / wrapper suffixes and uses the ticker for a single remaining name", () => {
    expect(assetMonogram("Microsoft xStock", "MSFTx")).toBe("MS");
    expect(assetMonogram("NVIDIA xStock", "NVDAX")).toBe("NV");
    expect(assetMonogram("Microsoft (on-chain wrapper)", "MSFT")).toBe("MS");
  });

  it("falls back to the ticker when the name is empty", () => {
    expect(assetMonogram("", "MSFTx")).toBe("MS");
    expect(assetMonogram("   ", "A")).toBe("A");
    expect(assetMonogram("", "")).toBe("?");
  });
});

describe("instrument and source labels", () => {
  it("labels instrument kind in the TOKEN • SYMBOL spirit", () => {
    expect(instrumentKindMetaLabel("equity")).toBe("TOKEN");
    expect(instrumentKindMetaLabel("etf")).toBe("ETF");
    expect(instrumentKindMetaLabel("private")).toBe("PRIVATE");
  });

  it("keeps existing source-row wording", () => {
    expect(sourceRowLabel("mock")).toBe("Demo row");
    expect(sourceRowLabel("solana")).toBe("DexScreener row");
    expect(sourceRowLabel("terminal")).toBe("Terminal row");
  });
});

describe("assetIdentityMetaParts", () => {
  it("builds TOKEN • symbol • truncated mint without inventing fields", () => {
    expect(
      assetIdentityMetaParts({
        instrumentKind: "equity",
        symbol: "MSFTx",
        contractAddress: "XspzW1dRMXaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }),
    ).toEqual({
      kind: "TOKEN",
      symbol: "MSFTx",
      mint: "XspzW1…aaaa",
    });
  });
});

describe("breadcrumb current segment", () => {
  it("uses ordinary foreground color, not a yellow or primary accent", () => {
    expect(BREADCRUMB_CURRENT_CLASS).toBe("text-foreground");
    expect(BREADCRUMB_CURRENT_CLASS).not.toMatch(/primary|interpretive|yellow|amber/);
  });
});

describe("logo and DexScreener URLs", () => {
  it("accepts only real http(s) logo URLs", () => {
    expect(isHttpLogoUrl("https://cdn.example/logo.png")).toBe(true);
    expect(isHttpLogoUrl("http://cdn.example/logo.png")).toBe(true);
    expect(isHttpLogoUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpLogoUrl("data:image/png;base64,aaaa")).toBe(false);
    expect(isHttpLogoUrl("/relative.png")).toBe(false);
    expect(isHttpLogoUrl(null)).toBe(false);
    expect(asHttpUrl("https://dd.dexscreener.com/ds-data/tokens/solana/x.png")).toMatch(/^https:\/\//);
  });

  it("links DexScreener only for Solana mints", () => {
    expect(dexScreenerTokenUrl("solana", "Mint111")).toBe("https://dexscreener.com/solana/Mint111");
    expect(dexScreenerTokenUrl("robinhood-chain", "0xabc")).toBeNull();
    expect(dexScreenerTokenUrl("solana", "")).toBeNull();
  });
});
