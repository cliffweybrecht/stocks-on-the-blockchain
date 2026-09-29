import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarketsTable } from "./markets-table";
import type { AssetPoolMark } from "@/lib/market/types";

const createdAt = Date.UTC(2026, 5, 1);

function pool(): AssetPoolMark {
  return {
    pairAddress: "nvda-usdc-pair",
    dexId: "raydium",
    volume24hUsd: 1_100_000,
    liquidityUsd: 2_200_000,
    priceUsd: 180,
    baseSymbol: "NVDAx",
    quoteSymbol: "USDC",
    pairHolderCount: 42_130,
    pairCreatedAt: createdAt,
    trades24h: 236,
    tradesChange24hPct: null,
  };
}

describe("Markets table columns", () => {
  const html = renderToStaticMarkup(
    createElement(MarketsTable, {
      asset: { contractAddress: "mint", logoUrl: null, chainId: "solana" },
      pools: [pool()],
    }),
  );
  const headers = [...html.matchAll(/<th\b[^>]*>(.*?)<\/th>/g)].map((match) =>
    match[1]!.replace(/<[^>]+>/g, "").trim(),
  );

  it("orders columns as #, Pair, Token age, Liquidity, 24h Volume, 24h Trades, Venue", () => {
    expect(headers).toEqual(["#", "Pair", "Token age", "Liquidity", "24h Volume", "24h Trades", "Venue"]);
  });

  it("does not render a Holders column", () => {
    expect(headers).not.toContain("Holders");
    expect(html).not.toContain("data-holders");
    expect(html).not.toContain(">Holders<");
  });

  it("keeps the pairCreatedAt age on the Token age cell", () => {
    expect(html).toContain(`data-token-age="${createdAt}"`);
    expect(html).toContain("NVDAx-USDC");
  });
});
