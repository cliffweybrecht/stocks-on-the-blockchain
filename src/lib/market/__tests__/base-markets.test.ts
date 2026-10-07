import { describe, expect, it, vi } from "vitest";
import type { DexScreenerPair } from "../map-solana";
import {
  ANCHORED_ISSUER_LABEL,
  BACKED_ISSUER_LABEL,
  CENTRIFUGE_BASE_SHARES,
  CENTRIFUGE_ISSUER_LABEL,
  COINBASE_ISSUER_LABEL,
  DINARI_ISSUER_LABEL,
  ONDO_ISSUER_LABEL,
  ST0X_ISSUER_LABEL,
  buildBaseMarketLanes,
  classifyBaseInstrument,
  isExcludedBaseProduct,
  mergeBaseTokens,
  parseAnchoredTokenDocs,
  parseBackedAssets,
  parseCentrifugeShareRows,
  parseCoinbaseTokenizedStocks,
  parseDinariStocksonchain,
  parseOndoBaseAssets,
  parseSt0xTokenList,
  selectBaseTokenLogo,
} from "../base-markets";
import { loadBaseChainMarkets } from "../base-chain-markets";

const AAPL = "0xb200000000000000000000C2e324d24d7eEcd1fb";
const SPCX = "0xb2000000000000000000007b9fcbd005511aCBd5";
const NVDA = "0xFb5B41acdbA20a3230F84BE995173CFb98b8D6E7";
const SGOV = "0x78c31580c9000000000000000000000000000001";
const DINARI_AAPL = "0x41F7A63713e76c0aB800Be03Bae9F17B8A356348";
const BTSLA = "0x14a5f2872396802c3cc8942a39ab3e4118ee5038";
const WBTSLA = "0x1f82284C1658Ad71C576f7230E6C2DEE7901c1FA";
const AAAPL = "0x17683e492d0C8910F7c0157D04af31Cb7A23Ad71";

describe("Base issuer parsers", () => {
  it("keeps Coinbase equities and SpaceX private, and drops a non-Base chain row", () => {
    const tokens = parseCoinbaseTokenizedStocks({
      tokens: [
        coinbase("AAPLc", "Apple Inc.", AAPL),
        coinbase("NFLXc", "Netflix Inc", "0xb2000000000000000000000000000000000000aa"),
        coinbase("SPCXc", "Space Exploration Technologies Corp.", SPCX),
        { ...coinbase("GOOGLc", "Alphabet Inc.", "0xb2000000000000000000000000000000000000bb"), chain: "ethereum" },
        coinbase("GLDc", "SPDR Gold Shares", "0xb2000000000000000000000000000000000000cc"),
      ],
    });
    expect(tokens.find((row) => row.symbol === "AAPLc")).toMatchObject({
      issuer: COINBASE_ISSUER_LABEL,
      kind: "equity",
    });
    expect(tokens.find((row) => row.symbol === "NFLXc")?.kind).toBe("equity");
    expect(tokens.find((row) => row.symbol === "SPCXc")?.kind).toBe("private");
    expect(tokens.map((row) => row.symbol).sort()).toEqual(["AAPLc", "NFLXc", "SPCXc"]);
    expect(classifyBaseInstrument("United States Oil Fund")).toBe("etf");
  });

  it("keeps ST0x equities and equity ETFs and drops gold, treasury, and income funds", () => {
    const tokens = parseSt0xTokenList({
      tokens: [
        st0x("wtNVDA", "Wrapped NVIDIA Corporation ST0x", NVDA),
        st0x("wtSPYM", "Wrapped SPDR Portfolio S&P 500 ETF ST0x", "0x31C2C14134000000000000000000000000000002"),
        st0x("wtSPCX", "Wrapped Space Exploration Technologies Corp. ST0x", "0x19F89aaEf8000000000000000000000000000003"),
        st0x("wtIAU", "Wrapped iShares Gold Trust ST0x", "0x1E46d7eFef000000000000000000000000000004"),
        st0x("wtSGOV", "Wrapped iShares 0-3 Month Treasury Bond ETF ST0x", SGOV),
        st0x("wtPTY", "Wrapped PIMCO Corporate & Income Opportunity Fund ST0x", "0x0000000000000000000000000000000000000005"),
        { ...st0x("wtAAPL", "Wrapped Apple Inc. ST0x", "0x1020EC8Aa3000000000000000000000000000006"), chainId: 1 },
      ],
    });
    expect(tokens.map((row) => row.symbol).sort()).toEqual(["wtNVDA", "wtSPCX", "wtSPYM"]);
    expect(tokens.find((row) => row.symbol === "wtNVDA")).toMatchObject({ issuer: ST0X_ISSUER_LABEL, kind: "equity" });
    expect(tokens.find((row) => row.symbol === "wtSPYM")?.kind).toBe("etf");
    expect(tokens.find((row) => row.symbol === "wtSPCX")?.kind).toBe("private");
  });

  it("admits only Centrifuge SPXA and deSPXA share tokens", () => {
    const tokens = parseCentrifugeShareRows([
      { symbol: "SPXA", address: CENTRIFUGE_BASE_SHARES[0].address, network: "Base" },
      { symbol: "deSPXA", address: CENTRIFUGE_BASE_SHARES[1].address, network: "Base" },
      { symbol: "JTRSY", address: "0x8c213ee79581ff4984583c6a801e5263418c4b86", network: "Base" },
      { symbol: "SPXA", address: "0x99e9092bae6d4394e54034ecb1e45441678323b9", network: "Base", asset: "USDC" },
      { symbol: "deSPXA", address: "0x2da40f061536c2f3a8f95f23a5f4c133d07d393a", network: "Base", asset: "USDC" },
      { symbol: "SPXA", address: CENTRIFUGE_BASE_SHARES[0].address, network: "Ethereum" },
    ]);
    expect(tokens.map((row) => row.symbol)).toEqual(["SPXA", "deSPXA"]);
    expect(tokens[0]).toMatchObject({ issuer: CENTRIFUGE_ISSUER_LABEL, kind: "etf" });
  });

  it("reads Dinari Base dShares and skips other chains, bitcoin ETFs, and xStock copycats", () => {
    const tokens = parseDinariStocksonchain({
      stocks: [
        dinari("AAPL", "Apple Inc.", "stock", "base", DINARI_AAPL),
        dinari("AAPL", "Apple Inc.", "stock", "ethereum", "0x68E670D2f9B792f034a1826cF4A8F180C9952Cb6"),
        dinari("ARKK", "ARK Innovation ETF", "etf", "base", "0x6309645495F8f2BbeAb5d5e18423B38fCD191DFe"),
        dinari("ARKB", "ARK 21Shares Bitcoin ETF", "etf", "base", "0x4B959bB4C00D25E52A87cB1865401Dd97Cb5631D"),
        dinari("OPENAI", "OpenAI PreStocks", "private", "base", "0x00000000000000000000000000000000000000ab"),
      ],
    });
    expect(tokens.map((row) => row.symbol).sort()).toEqual(["AAPL", "ARKK"]);
    expect(tokens.find((row) => row.symbol === "AAPL")).toMatchObject({
      issuer: DINARI_ISSUER_LABEL,
      kind: "equity",
    });
    expect(tokens.find((row) => row.symbol === "ARKK")?.kind).toBe("etf");
  });

  it("keeps Backed b* and wb* Base equities and the S&P token, and drops bonds and other chains", () => {
    const tokens = parseBackedAssets({
      nodes: [
        backed("bTSLA", "Backed Tesla Inc", "Base", BTSLA, WBTSLA),
        backed("bCSPX", "Backed CSPX Core S&P 500", "Base", "0xc3ce78b037dda1b966d31ec7979d3f3a38571a8e"),
        backed("bIB01", "Backed IB01 $ Treasury Bond 0-1yr", "Base", "0xca30c93b02514f86d5c86a6e375e3a330b435fb5"),
        backed("bTSLA", "Backed Tesla Inc", "Ethereum", "0x1111111111111111111111111111111111111111"),
        backed("TSLAx", "Tesla xStock", "Base", "0x2222222222222222222222222222222222222222"),
      ],
    });
    expect(tokens.map((row) => row.symbol).sort()).toEqual(["bCSPX", "bTSLA", "wbTSLA"]);
    expect(tokens.find((row) => row.symbol === "bTSLA")).toMatchObject({ issuer: BACKED_ISSUER_LABEL, kind: "equity" });
    expect(tokens.find((row) => row.symbol === "wbTSLA")?.address.toLowerCase()).toBe(WBTSLA.toLowerCase());
    expect(tokens.find((row) => row.symbol === "bCSPX")?.kind).toBe("etf");
  });

  it("parses Anchored Base stocks and leaves commodity, treasury, and Ethereum-only funds out", () => {
    const tokens = parseAnchoredTokenDocs(`
| Asset | Ethereum, Monad, Base, and Arbitrum contract address |
| aAAPL | ${AAAPL} |
| aSPY | 0x4716Cfb68C73BfF797Eea4f94ffAD8d198aEfC4B |
| aSPCX | 0x12473790e09D415ABAc7441401F7AbeC64Fa959C |
| aGLD | 0x3e4A2f26Fc4F92d92D7CD1e49ddaDe32869D00A4 |
| aBIL | 0x4FC5B9f8933597D3ecf84d0611687E1Dc8DD576f |
| aTSLA | 0x10FAD4A60Adb421F8F5Ca6f9f2eAf2DbC110E146 |

### Tokenized funds

| aDHF | 0x0ca21052CF746bCAC4807DbbE0A15269CC83EA3C |
`);
    expect(tokens.map((row) => row.symbol).sort()).toEqual(["aAAPL", "aSPCX", "aSPY", "aTSLA"]);
    expect(tokens.find((row) => row.symbol === "aAAPL")).toMatchObject({
      issuer: ANCHORED_ISSUER_LABEL,
      kind: "equity",
      logoUrl: null,
    });
    expect(tokens.find((row) => row.symbol === "aSPY")?.kind).toBe("etf");
    expect(tokens.find((row) => row.symbol === "aSPCX")?.kind).toBe("private");

    const html = parseAnchoredTokenDocs(
      `<table><tbody><tr><td>aAAPL</td><td>${AAAPL}</td></tr><tr><td>aGLD</td><td>0x3e4A2f26Fc4F92d92D7CD1e49ddaDe32869D00A4</td></tr></tbody></table>
### Tokenized funds
<table><tbody><tr><td>aDHF</td><td>0x0ca21052CF746bCAC4807DbbE0A15269CC83EA3C</td></tr></tbody></table>`,
    );
    expect(html.map((row) => row.symbol)).toEqual(["aAAPL"]);
  });

  it("does not invent an Ondo token unless the payload names Base", () => {
    expect(parseOndoBaseAssets(null)).toEqual([]);
    expect(
      parseOndoBaseAssets({
        assets: [{ symbol: "AAPLon", name: "Apple (Ondo)", address: "0x3333333333333333333333333333333333333333", chainId: 1 }],
      }),
    ).toEqual([]);
    const [ondo] = parseOndoBaseAssets({
      assets: [
        {
          symbol: "NVDAon",
          name: "NVIDIA Tokenized Stock (Ondo)",
          address: "0x4444444444444444444444444444444444444444",
          chain: "base",
        },
      ],
    });
    expect(ondo).toMatchObject({ issuer: ONDO_ISSUER_LABEL, kind: "equity" });
  });

  it("drops Robinhood-named dust and PreStocks even when a registry echoes them", () => {
    expect(isExcludedBaseProduct("HOODon", "HOOD Tokenized Stock")).toBe(true);
    expect(isExcludedBaseProduct("OPENAI", "OpenAI PreStocks")).toBe(true);
    expect(isExcludedBaseProduct("NVDA", "NVIDIA • Robinhood Token")).toBe(true);
    expect(isExcludedBaseProduct("wtHOOD", "Wrapped Robinhood Markets, Inc. ST0x")).toBe(false);
  });
});

describe("Base market lanes", () => {
  it("sums unique Base pools and keeps a missing volume missing", () => {
    const tokens = parseCoinbaseTokenizedStocks({
      tokens: [coinbase("AAPLc", "Apple Inc.", AAPL, "https://metadata.coinbase.com/equity_icons/aapl.png")],
    });
    const lanes = buildBaseMarketLanes(tokens, [
      pair({
        pairAddress: "0xsame",
        base: { address: AAPL, symbol: "AAPLc", name: "Apple Inc." },
        volume: 10,
        liquidity: 100,
        price: 200,
      }),
      pair({
        pairAddress: "0xsame",
        base: { address: AAPL, symbol: "AAPLc", name: "Apple Inc." },
        volume: 10,
        liquidity: 100,
        price: 200,
      }),
      pair({
        pairAddress: "0xother",
        base: { address: AAPL, symbol: "AAPLc", name: "Apple Inc." },
        volume: 5,
        liquidity: 50,
        price: 240,
      }),
      pair({
        chainId: "solana",
        pairAddress: "sol",
        base: { address: AAPL, symbol: "AAPLc", name: "Apple Inc." },
        volume: 999,
      }),
    ]);
    expect(lanes.assets).toHaveLength(1);
    expect(lanes.assets[0]).toMatchObject({
      issuer: COINBASE_ISSUER_LABEL,
      volume24hUsd: 15,
      displayedLiquidityUsd: 150,
      poolCount: 2,
      dexMedianPriceUsd: 200,
    });
    const quiet = buildBaseMarketLanes(tokens, []);
    expect(quiet.assets[0]?.volume24hUsd).toBeNull();
    expect(quiet.assets[0]?.displayedLiquidityUsd).toBeNull();
    expect(quiet.assets[0]?.poolCount).toBe(0);
  });

  it("uses a DexScreener base image and otherwise keeps the issuer logo", () => {
    const registry = "https://metadata.coinbase.com/equity_icons/aapl.png";
    const dexLogo = "https://cdn.dexscreener.com/cms/images/aaplc.png";
    expect(selectBaseTokenLogo({ dexLogoUrl: dexLogo, registryLogoUrl: registry })).toBe(dexLogo);
    expect(selectBaseTokenLogo({ dexLogoUrl: "javascript:alert(1)", registryLogoUrl: registry })).toBe(registry);
    expect(selectBaseTokenLogo({ registryLogoUrl: registry })).toBe(registry);
    expect(selectBaseTokenLogo({ registryLogoUrl: "data:image/png;base64,aaaa" })).toBeNull();

    const tokens = parseCoinbaseTokenizedStocks({
      tokens: [coinbase("AAPLc", "Apple Inc.", AAPL, registry)],
    });
    const quoteOnly = buildBaseMarketLanes(tokens, [
      pair({
        base: { address: "0xusdc", symbol: "USDC", name: "USD Coin" },
        quote: { address: AAPL, symbol: "AAPLc", name: "Apple Inc." },
        infoImageUrl: dexLogo,
        volume: 4,
      }),
    ]);
    expect(quoteOnly.assets[0]?.logoUrl).toBe(registry);
    expect(quoteOnly.assets[0]?.pools[0]?.baseLogoUrl).toBeNull();

    const fromDex = buildBaseMarketLanes(tokens, [
      pair({
        base: { address: AAPL.toLowerCase(), symbol: "AAPLc", name: "Apple Inc." },
        infoImageUrl: dexLogo,
        volume: 9,
      }),
    ]);
    expect(fromDex.assets[0]?.logoUrl).toBe(dexLogo);
    expect(fromDex.assets[0]?.pools[0]?.baseLogoUrl).toBe(dexLogo);
  });

  it("lets the first registry keep a shared contract", () => {
    const coinbaseTokens = parseCoinbaseTokenizedStocks({
      tokens: [coinbase("AAPLc", "Apple Inc.", AAPL)],
    });
    const dinariTokens = parseDinariStocksonchain({
      stocks: [dinari("AAPLc", "Apple Inc.", "stock", "base", AAPL)],
    });
    const merged = mergeBaseTokens([coinbaseTokens, dinariTokens]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.issuer).toBe(COINBASE_ISSUER_LABEL);
  });
});

describe("loadBaseChainMarkets", () => {
  it("keeps Coinbase and Centrifuge names when DexScreener token batches fail", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("tokenized-stocks")) return json({ tokens: [coinbase("AAPLc", "Apple Inc.", AAPL)] });
      return new Response("nope", { status: 503 });
    });
    const catalog = await loadBaseChainMarkets({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      cache: false,
    });
    expect(catalog.assets.map((row) => row.symbol)).toEqual(["AAPLc"]);
    expect(catalog.assets[0]?.volume24hUsd).toBeNull();
    expect(catalog.volumeHydrated).toBe(false);
    expect(catalog.etfAssets.map((row) => row.symbol).sort()).toEqual(["SPXA", "deSPXA"]);
    expect(catalog.sourceFailures.some((row) => row.sourceLabel === "Ondo address API")).toBe(true);
    expect(catalog.assets.some((row) => row.issuer === ONDO_ISSUER_LABEL)).toBe(false);
    expect(catalog.privateAssets).toEqual([]);
  });

  it("still lists Dinari when Coinbase is down and hydrates Base pool volume", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("tokenized-stocks")) return new Response("down", { status: 500 });
      if (url.includes("stocksonchain")) {
        return json({ stocks: [dinari("AAPL", "Apple Inc.", "stock", "base", DINARI_AAPL)] });
      }
      if (url.includes("/tokens/v1/base/")) {
        return json([
          pair({
            base: { address: DINARI_AAPL, symbol: "AAPL", name: "Apple Inc. - Dinari" },
            volume: 12,
            liquidity: 30,
            price: 1.5,
          }),
        ]);
      }
      return new Response("missing", { status: 404 });
    });
    const catalog = await loadBaseChainMarkets({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      cache: false,
    });
    expect(catalog.sourceFailures.some((row) => /500/.test(row.message))).toBe(true);
    expect(catalog.assets.find((row) => row.symbol === "AAPL")).toMatchObject({
      issuer: DINARI_ISSUER_LABEL,
      volume24hUsd: 12,
      dexMedianPriceUsd: 1.5,
    });
  });

  it("keeps the Centrifuge share tokens when every HTTP name source fails", async () => {
    const fetchImpl = vi.fn(async () => new Response("down", { status: 500 }));
    const catalog = await loadBaseChainMarkets({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      cache: false,
    });
    expect(catalog.etfAssets.map((row) => row.symbol).sort()).toEqual(["SPXA", "deSPXA"]);
    expect(catalog.assets).toEqual([]);
  });

  it("throws a missing list when no issuer returns a token", async () => {
    const fetchImpl = vi.fn(async () => new Response("down", { status: 500 }));
    await expect(
      loadBaseChainMarkets({
        fetchImpl: fetchImpl as unknown as typeof fetch,
        cache: false,
        includeCentrifuge: false,
      }),
    ).rejects.toThrow(/missing list/i);
  });
});

function coinbase(symbol: string, name: string, address: string, icon?: string) {
  return {
    contract_address: address,
    symbol,
    name,
    icon_url: icon ?? `https://metadata.coinbase.com/equity_icons/${symbol}.png`,
    is_live: true,
  };
}

function st0x(symbol: string, name: string, address: string) {
  return {
    chainId: 8453,
    address,
    symbol,
    name,
    logoURI: `https://st0x.io/images/${symbol}.png`,
  };
}

function dinari(symbol: string, company: string, kind: string, chain: string, address: string) {
  return {
    ticker: symbol,
    company,
    kind,
    listings: [{ issuer: "dinari", chain, address, onchainSymbol: symbol }],
  };
}

function backed(symbol: string, name: string, network: string, address: string, wrapper?: string) {
  return {
    symbol,
    name,
    logo: `https://xstocks-metadata.backed.fi/logos/tokens/${symbol}.png`,
    deployments: [
      {
        network,
        address,
        ...(wrapper ? { wrapperAddress: wrapper } : {}),
      },
    ],
  };
}

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
    chainId: input.chainId ?? "base",
    dexId: "uniswap",
    pairAddress: input.pairAddress ?? `0xpair-${input.base.address.slice(2, 8)}-${input.volume ?? 0}`,
    url: "https://dexscreener.com/base/0xpair",
    baseToken: input.base,
    quoteToken: input.quote ?? { address: "0xweth", symbol: "WETH", name: "WETH" },
    info: input.infoImageUrl ? { imageUrl: input.infoImageUrl } : undefined,
    priceUsd: input.price ?? null,
    priceChange: { h24: input.price != null ? 0.32 : null },
    volume: { h24: input.volume ?? null },
    liquidity: { usd: input.liquidity ?? null },
  };
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
