import { describe, expect, it } from "vitest";
import { formatTokenAge } from "../../market/format";
import {
  MARKETS_HOLDERS_HEADER,
  MARKETS_TOKEN_AGE_HEADER,
  marketsPairHolderCount,
  marketsPairLabel,
  marketsPoolHref,
  marketsTokenLogoUrl,
  marketsTrades24h,
} from "../markets-pool";

describe("markets holders column", () => {
  it("labels the column Holders", () => {
    expect(MARKETS_HOLDERS_HEADER).toBe("Holders");
    expect(MARKETS_HOLDERS_HEADER).not.toMatch(/other holders/i);
    expect(MARKETS_HOLDERS_HEADER).not.toMatch(/24h wallets/i);
  });

  it("reads only that pool's pair holder count and ignores mint holder fields", () => {
    const nvdaUsdc = {
      pairHolderCount: 120_477 as number | null,
      holderCount: 112_538,
      otherHolderCount: 5_250_000,
    };
    const siNvda = {
      pairHolderCount: 20_252 as number | null,
      holderCount: 112_538,
      otherHolderCount: 5_250_000,
    };
    const missing = {
      pairHolderCount: null as number | null,
      holderCount: 5_250_000,
      otherHolderCount: 5_250_000,
    };
    expect(marketsPairHolderCount(nvdaUsdc)).toBe(120_477);
    expect(marketsPairHolderCount(siNvda)).toBe(20_252);
    expect(marketsPairHolderCount(nvdaUsdc)).not.toBe(marketsPairHolderCount(siNvda));
    expect(marketsPairHolderCount(missing)).toBeNull();
    expect(marketsPairHolderCount({ pairHolderCount: 0 })).toBe(0);
  });
});

describe("markets token age column", () => {
  const now = Date.UTC(2026, 8, 28, 12, 0, 0);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  it("labels the column Token age", () => {
    expect(MARKETS_TOKEN_AGE_HEADER).toBe("Token age");
  });

  it("floors a reported pair age into one unit and stays blank when the timestamp is unusable", () => {
    expect(formatTokenAge(now - 3 * day - 5 * hour, now)).toBe("3d");
    expect(formatTokenAge(now - 60 * day, now)).toBe("2mo");
    expect(formatTokenAge(now - 45 * minute, now)).toBe("45m");
    expect(formatTokenAge(now - 5 * hour, now)).toBe("5h");
    expect(formatTokenAge(now - 400 * day, now)).toBe("1y");
    expect(formatTokenAge(now - 20_000, now)).toBe("<1m");
    expect(formatTokenAge(now + 10_000, now)).toBe("<1m");
    expect(formatTokenAge(now + 2 * minute, now)).toBe("—");
    expect(formatTokenAge(null, now)).toBe("—");
    expect(formatTokenAge(undefined, now)).toBe("—");
  });
});

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
