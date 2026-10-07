import { describe, expect, it, vi } from "vitest";
import type { DexScreenerPair } from "../map-solana";
import {
  ONDO_NAMED_UNVERIFIED_LABEL,
  RHJ_ISSUER_LABEL,
  buildRobinhoodMarketLanes,
  classifyRobinhoodInstrument,
  isAdmittedOndoName,
  isRobinhoodChainJunk,
  mergeRobinhoodTokens,
  ondoTokensFromPairs,
  overlayTerminalReference,
  parseRhjRegistry,
  robinhoodLanesFromTerminal,
  selectRobinhoodTokenLogo,
} from "../robinhood-markets";
import { loadRobinhoodChainMarkets } from "../robinhood-chain-markets";
import type { AssetSummary } from "../types";

const NVDA = "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC";
const SPCX = "0x1111111111111111111111111111111111111111";
const QQQ = "0x2222222222222222222222222222222222222222";
const NFLX = "0x3333333333333333333333333333333333333333";
const ONDO_NVDA = "0x4444444444444444444444444444444444444444";

function rhj(symbol: string, name: string, address: string) {
  return {
    tokenSymbol: symbol,
    tokenName: name,
    logoUrl: `https://cdn.robinhood.com/logos/${address}.png`,
    deployments: [{ contractAddress: address, chainId: 4663 }],
  };
}

describe("Robinhood Chain name rules", () => {
  it("keeps RHJ equities, ETFs, and fail-closed private names apart", () => {
    const tokens = parseRhjRegistry({
      assets: [
        rhj("NVDA", "NVIDIA • Robinhood Token", NVDA),
        rhj("NFLX", "Netflix • Robinhood Token", NFLX),
        rhj("QQQ", "Invesco QQQ • Robinhood Token", QQQ),
        rhj("SPY", "SPDR S&P 500 ETF Trust • Robinhood Token", "0x5555555555555555555555555555555555555555"),
        rhj("SGOV", "iShares 0-3 Month Treasury Bond • Robinhood Token", "0x6666666666666666666666666666666666666666"),
        rhj("SPCX", "Space Exploration Technologies Corp. Class A Common Stock • Robinhood Token", SPCX),
        rhj("ON", "ON Semiconductor • Robinhood Token", "0x7777777777777777777777777777777777777777"),
      ],
    });
    expect(tokens.find((row) => row.symbol === "NVDA")).toMatchObject({ issuer: RHJ_ISSUER_LABEL, kind: "equity" });
    expect(tokens.find((row) => row.symbol === "NFLX")?.kind).toBe("equity");
    expect(tokens.find((row) => row.symbol === "QQQ")?.kind).toBe("etf");
    expect(tokens.find((row) => row.symbol === "SPY")?.kind).toBe("etf");
    expect(tokens.find((row) => row.symbol === "SGOV")?.kind).toBe("etf");
    expect(tokens.find((row) => row.symbol === "SPCX")?.kind).toBe("private");
    expect(tokens.find((row) => row.symbol === "ON")?.kind).toBe("equity");
    expect(classifyRobinhoodInstrument("United States Oil Fund • Robinhood Token")).toBe("etf");
  });

  it("drops launchpad junk and does not call Ondo-named tokens official Ondo", () => {
    expect(isRobinhoodChainJunk("HOODon", "Hood on")).toBe(true);
    expect(isRobinhoodChainJunk("BMNRon", "BMNR")).toBe(true);
    expect(isRobinhoodChainJunk("CPERon", "CPER")).toBe(true);
    expect(isRobinhoodChainJunk("RACE", "Ferrari xStock")).toBe(true);
    expect(isRobinhoodChainJunk("OPENAI", "OpenAI PreStocks")).toBe(true);
    expect(isRobinhoodChainJunk("HOOD", "Robinhood Markets - Backpack Securities")).toBe(true);
    expect(isRobinhoodChainJunk("ARC", "Arcus leveraged NVDA")).toBe(true);
    expect(isRobinhoodChainJunk("RIALTO", "Rialto")).toBe(true);
    expect(isRobinhoodChainJunk("ON", "ON Semiconductor • Robinhood Token")).toBe(false);

    expect(isAdmittedOndoName("NVIDIA Tokenized Stock (Ondo)")).toBe(true);
    expect(isAdmittedOndoName("iShares Core S&P 500 Tokenized ETF (Ondo)")).toBe(true);
    expect(isAdmittedOndoName("Tesla (Ondo Tokenized)")).toBe(true);
    expect(isAdmittedOndoName("U.S. Dollar Tokenized Currency (Ondo)")).toBe(false);
    expect(isAdmittedOndoName("NVIDIA xStock")).toBe(false);
    expect(isAdmittedOndoName(`${"Tokenized Stock (Ondo) ".repeat(20)}`)).toBe(false);

    const [ondo] = ondoTokensFromPairs([
      pair({
        base: { address: ONDO_NVDA, symbol: "NVDAON", name: "NVIDIA Tokenized Stock (Ondo)" },
        volume: 40,
      }),
      pair({
        chainId: "bsc",
        base: { address: "0xabc", symbol: "NVDAON", name: "NVIDIA Tokenized Stock (Ondo)" },
      }),
      pair({
        base: { address: "0x9999999999999999999999999999999999999999", symbol: "HOODON", name: "HOOD Tokenized Stock (Ondo)" },
      }),
    ]);
    expect(ondo).toMatchObject({
      symbol: "NVDAON",
      issuer: ONDO_NAMED_UNVERIFIED_LABEL,
      kind: "equity",
    });
    expect(ondo?.issuer).not.toBe("Ondo");
  });

  it("sums unique Robinhood pools and keeps a missing volume missing", () => {
    const tokens = parseRhjRegistry({
      assets: [rhj("NVDA", "NVIDIA • Robinhood Token", NVDA)],
    });
    const lanes = buildRobinhoodMarketLanes(tokens, [
      pair({
        pairAddress: "0xsame",
        base: { address: NVDA, symbol: "NVDA", name: "NVIDIA • Robinhood Token" },
        volume: 10,
        liquidity: 100,
        price: 200,
      }),
      pair({
        pairAddress: "0xsame",
        base: { address: NVDA, symbol: "NVDA", name: "NVIDIA • Robinhood Token" },
        volume: 10,
        liquidity: 100,
        price: 200,
      }),
      pair({
        pairAddress: "0xother",
        base: { address: NVDA, symbol: "NVDA", name: "NVIDIA • Robinhood Token" },
        quote: { address: "0xusdg", symbol: "USDG", name: "Global Dollar" },
        volume: 5,
        liquidity: 50,
        price: 240,
      }),
      pair({
        chainId: "solana",
        pairAddress: "sol",
        base: { address: NVDA, symbol: "NVDA", name: "NVIDIA • Robinhood Token" },
        volume: 999,
      }),
    ]);
    expect(lanes.assets).toHaveLength(1);
    expect(lanes.assets[0]).toMatchObject({
      issuer: RHJ_ISSUER_LABEL,
      volume24hUsd: 15,
      displayedLiquidityUsd: 150,
      usdGLiquidityUsd: 50,
      poolCount: 2,
      dexMedianPriceUsd: 200,
      priceChange24hPct: 0.32,
    });

    const quiet = buildRobinhoodMarketLanes(tokens, []);
    expect(quiet.assets[0]?.volume24hUsd).toBeNull();
    expect(quiet.assets[0]?.poolCount).toBe(0);
  });

  it("lets RHJ replace an Ondo hit on the same contract and keeps Terminal marks", () => {
    const rhjTokens = parseRhjRegistry({
      assets: [rhj("NVDA", "NVIDIA • Robinhood Token", NVDA)],
    });
    const ondo = ondoTokensFromPairs([
      pair({
        base: { address: NVDA, symbol: "NVDA", name: "NVIDIA Tokenized Stock (Ondo)" },
      }),
    ]);
    const merged = mergeRobinhoodTokens(rhjTokens, ondo);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.issuer).toBe(RHJ_ISSUER_LABEL);

    const [overlaid] = overlayTerminalReference(buildRobinhoodMarketLanes(rhjTokens, []).assets, [
      summary({
        symbol: "NVDA",
        name: "NVIDIA • Robinhood Token",
        contractAddress: NVDA,
        robinhoodReferencePriceUsd: 199,
        premiumDiscountPct: 1.2,
      }),
    ]);
    expect(overlaid?.robinhoodReferencePriceUsd).toBe(199);
    expect(overlaid?.premiumDiscountPct).toBe(1.2);
    expect(overlaid?.issuer).toBe(RHJ_ISSUER_LABEL);
  });

  it("uses a DexScreener base image and otherwise keeps the RHJ mark", () => {
    const feather = `https://cdn.robinhood.com/logos/${NVDA}.png`;
    const dexLogo = "https://cdn.dexscreener.com/cms/images/nvda.png";
    expect(selectRobinhoodTokenLogo({ dexLogoUrl: dexLogo, registryLogoUrl: feather })).toBe(dexLogo);
    expect(selectRobinhoodTokenLogo({ dexLogoUrl: "javascript:alert(1)", registryLogoUrl: feather })).toBe(feather);
    expect(selectRobinhoodTokenLogo({ registryLogoUrl: feather })).toBe(feather);
    expect(selectRobinhoodTokenLogo({ registryLogoUrl: "data:image/png;base64,aaaa" })).toBeNull();

    const tokens = parseRhjRegistry({
      assets: [rhj("NVDA", "NVIDIA • Robinhood Token", NVDA)],
    });
    const quoteOnly = buildRobinhoodMarketLanes(tokens, [
      pair({
        base: { address: "0xusdg", symbol: "USDG", name: "Global Dollar" },
        quote: { address: NVDA, symbol: "NVDA", name: "NVIDIA • Robinhood Token" },
        infoImageUrl: dexLogo,
        volume: 4,
      }),
    ]);
    expect(quoteOnly.assets[0]?.logoUrl).toBe(feather);
    expect(quoteOnly.assets[0]?.pools[0]?.baseLogoUrl).toBeNull();

    const fromDex = buildRobinhoodMarketLanes(tokens, [
      pair({
        base: { address: NVDA.toLowerCase(), symbol: "NVDA", name: "NVIDIA • Robinhood Token" },
        infoImageUrl: dexLogo,
        volume: 9,
      }),
    ]);
    expect(fromDex.assets[0]?.logoUrl).toBe(dexLogo);
    expect(fromDex.assets[0]?.pools[0]?.baseLogoUrl).toBe(dexLogo);

    const featherOnly = buildRobinhoodMarketLanes(tokens, []);
    expect(featherOnly.assets[0]?.logoUrl).toBe(feather);
  });

  it("classifies a Terminal fallback without keeping junk", () => {
    const lanes = robinhoodLanesFromTerminal([
      summary({ symbol: "QQQ", name: "Invesco QQQ • Robinhood Token", contractAddress: QQQ }),
      summary({ symbol: "NVDAON", name: "NVIDIA Tokenized Stock (Ondo)", contractAddress: ONDO_NVDA }),
      summary({ symbol: "HOODon", name: "HOOD Tokenized Stock (Ondo)", contractAddress: "0x8888888888888888888888888888888888888888" }),
      summary({ symbol: "AAPL", name: "Apple", contractAddress: "0x9990000000000000000000000000000000000001", issuer: null }),
    ]);
    expect(lanes.etfAssets.map((row) => row.symbol)).toEqual(["QQQ"]);
    expect(lanes.assets.map((row) => row.symbol).sort()).toEqual(["AAPL", "NVDAON"]);
    expect(lanes.assets.find((row) => row.symbol === "NVDAON")?.issuer).toBe(ONDO_NAMED_UNVERIFIED_LABEL);
    expect(lanes.assets.find((row) => row.symbol === "AAPL")?.issuer).toBeNull();
  });
});

describe("loadRobinhoodChainMarkets", () => {
  it("keeps RHJ names when DexScreener search and token batches fail", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("rhj/assets")) {
        return json({ assets: [rhj("NVDA", "NVIDIA • Robinhood Token", NVDA)] });
      }
      return new Response("nope", { status: 503 });
    });
    const catalog = await loadRobinhoodChainMarkets({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      cache: false,
      searchQueries: ["Tokenized Stock (Ondo)"],
    });
    expect(catalog.assets.map((row) => row.symbol)).toEqual(["NVDA"]);
    expect(catalog.assets[0]?.volume24hUsd).toBeNull();
    expect(catalog.volumeHydrated).toBe(false);
    expect(catalog.assets[0]?.issuer).toBe(RHJ_ISSUER_LABEL);
    expect(catalog.assets[0]?.logoUrl).toBe(`https://cdn.robinhood.com/logos/${NVDA}.png`);
  });

  it("still lists Ondo-named tokens when the RHJ registry is down", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("rhj/assets")) return new Response("down", { status: 500 });
      if (url.includes("/latest/dex/search")) {
        return json({
          pairs: [
            pair({
              base: { address: ONDO_NVDA, symbol: "NVDAON", name: "NVIDIA Tokenized Stock (Ondo)" },
              volume: 12,
              price: 1,
            }),
          ],
        });
      }
      if (url.includes("/tokens/v1/robinhood/")) {
        return json([
          pair({
            base: { address: ONDO_NVDA, symbol: "NVDAON", name: "NVIDIA Tokenized Stock (Ondo)" },
            volume: 12,
            liquidity: 30,
            price: 1.5,
          }),
        ]);
      }
      return new Response("missing", { status: 404 });
    });
    const catalog = await loadRobinhoodChainMarkets({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      cache: false,
      searchQueries: ["Tokenized Stock (Ondo)"],
    });
    expect(catalog.registryError).toMatch(/500/);
    expect(catalog.assets[0]).toMatchObject({
      symbol: "NVDAON",
      issuer: ONDO_NAMED_UNVERIFIED_LABEL,
      volume24hUsd: 12,
      dexMedianPriceUsd: 1.5,
    });
    expect(catalog.assets[0]?.issuer).not.toBe("Ondo");
  });

  it("lets a DexScreener base image replace the RHJ mark for that contract only", async () => {
    const dexLogo = "https://cdn.dexscreener.com/cms/images/crcl.png";
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("rhj/assets")) {
        return json({
          assets: [
            rhj("NVDA", "NVIDIA • Robinhood Token", NVDA),
            rhj("CRCL", "Circle Internet Group • Robinhood Token", "0x5555555555555555555555555555555555555555"),
          ],
        });
      }
      if (url.includes("/latest/dex/search")) return json({ pairs: [] });
      if (url.includes("/tokens/v1/robinhood/")) {
        return json([
          pair({
            base: { address: "0x5555555555555555555555555555555555555555", symbol: "CRCL", name: "Circle" },
            infoImageUrl: dexLogo,
            volume: 8,
          }),
          pair({
            base: { address: "0xusdg", symbol: "USDG", name: "Global Dollar" },
            quote: { address: NVDA, symbol: "NVDA", name: "NVIDIA • Robinhood Token" },
            infoImageUrl: "https://cdn.dexscreener.com/cms/images/not-nvda.png",
            volume: 3,
          }),
        ]);
      }
      return new Response("missing", { status: 404 });
    });
    const catalog = await loadRobinhoodChainMarkets({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      cache: false,
      searchQueries: ["Tokenized Stock (Ondo)"],
    });
    expect(fetchImpl.mock.calls.some(([url]) => String(url).includes("geckoterminal"))).toBe(false);
    expect(catalog.assets.find((row) => row.symbol === "CRCL")?.logoUrl).toBe(dexLogo);
    expect(catalog.assets.find((row) => row.symbol === "NVDA")?.logoUrl).toBe(
      `https://cdn.robinhood.com/logos/${NVDA}.png`,
    );
  });
});

function pair(input: {
  chainId?: string;
  pairAddress?: string;
  base: { address: string; symbol: string; name: string };
  quote?: { address: string; symbol: string; name: string };
  volume?: number;
  liquidity?: number;
  price?: number;
  infoImageUrl?: string;
}): DexScreenerPair {
  return {
    chainId: input.chainId ?? "robinhood",
    dexId: "uniswap",
    pairAddress: input.pairAddress ?? `0xpair-${input.base.address.slice(2, 8)}-${input.volume ?? 0}`,
    url: "https://dexscreener.com/robinhood/0xpair",
    baseToken: input.base,
    quoteToken: input.quote ?? { address: "0xweth", symbol: "WETH", name: "WETH" },
    info: input.infoImageUrl ? { imageUrl: input.infoImageUrl } : undefined,
    priceUsd: input.price ?? null,
    priceChange: { h24: input.price != null ? 0.32 : null },
    volume: { h24: input.volume ?? null },
    liquidity: { usd: input.liquidity ?? null },
  };
}

function summary(partial: Partial<AssetSummary> & Pick<AssetSummary, "symbol" | "name" | "contractAddress">): AssetSummary {
  return {
    chainId: "robinhood-chain",
    sourceId: "terminal",
    sourceLabel: "Robinhood Liquidity Terminal",
    issuer: null,
    logoUrl: null,
    volume24hUsd: 1,
    displayedLiquidityUsd: 2,
    usdGLiquidityUsd: null,
    poolCount: 1,
    dexCount: 1,
    pools: [],
    robinhoodReferencePriceUsd: null,
    dexMedianPriceUsd: 3,
    premiumDiscountPct: null,
    top3ConcentrationPct: null,
    liquidityCoverageComplete: true,
    volume24hCoverageComplete: true,
    instrumentKind: "equity",
    volumeCoverage: "reported",
    coverageNote: null,
    priceChange24hPct: null,
    ...partial,
  };
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
