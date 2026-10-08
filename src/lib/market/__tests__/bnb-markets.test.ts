import { describe, expect, it, vi } from "vitest";
import type { DexScreenerPair } from "../map-solana";
import {
  BSTOCKS_ISSUER_LABEL,
  COLB_ISSUER_LABEL,
  DINARI_ISSUER_LABEL,
  ONDO_ISSUER_LABEL,
  PAIMON_ISSUER_LABEL,
  XSTOCKS_ISSUER_LABEL,
  buildBnbMarketLanes,
  classifyBnbInstrument,
  isExcludedBnbProduct,
  mergeBnbTokens,
  parseColbContracts,
  parseJumperBstocks,
  parseOndoBnbAssets,
  parsePaimonDocs,
  parsePaimonTradePage,
  parseStocksonchainBnb,
  parseXStocksAssets,
  parseXStocksProductCatalog,
  parseXStocksTokenList,
  retainVerifiedXStocks,
  selectBnbTokenLogo,
} from "../bnb-markets";
import { loadBnbChainMarkets } from "../bnb-chain-markets";

const AAPLON = "0x390a684EF9cADE28A7AD0DFa61AB1Eb3842618c4";
const AAPLX = "0x9d275685dc284c8eb1c79f6aba7a63dc75ec890a";
const AAPLB = "0x431a3bee82e2ca41e49895cbece5bb0f76a89b7a";
const CSPX = "0xDeAa0f353C507A2F0d9b92d20e3fF0FF06f3ACe9";
const CANP = "0xdc22f0a9a60eee3697e925414bdb4580d1c35f91";
const CREV = "0xe626cd87f9ec3c9cc48ebb2689e427f544554608";
const XSPCX = "0x05353Dabf163Fb2fec87f9e0f00f94Eae4AC1631";
const PSPCX = "0x6DC9a487bF8Fd047e41AB336003AE6e4FE602646";
const XOPAI = "0x7DdEF360f3C2DB4CC41C3967984fefa2598cC9A6";
const PPT = "0x8505c32631034A7cE8800239c08547e0434EdaD9";

describe("BNB issuer parsers", () => {
  it("keeps Ondo and xStocks on bnb-chain, admits Dinari only on that chain, and drops commodities", () => {
    const tokens = parseStocksonchainBnb({
      stocks: [
        soc("AAPL", "Apple Inc.", "stock", "ondo", "bnb-chain", "AAPLon", AAPLON),
        soc("SPY", "SPDR S&P 500 ETF Trust", "etf", "ondo", "bnb-chain", "SPYon", "0x1111111111111111111111111111111111111111"),
        soc("SPCX", "SpaceX", "private", "backed-xstocks", "bnb-chain", "SPCXx", "0x2222222222222222222222222222222222222222"),
        soc("AAPL", "Apple Inc.", "stock", "ondo", "ethereum", "AAPLon", "0x3333333333333333333333333333333333333333"),
        soc("AAPL", "Apple Inc.", "stock", "dinari", "bnb-chain", "AAPL", "0x4444444444444444444444444444444444444444"),
        soc("AAPL", "Apple Inc.", "stock", "dinari", "ethereum", "AAPL", "0x5555555555555555555555555555555555555555"),
        soc("GLD", "SPDR Gold Trust", "etf", "ondo", "bnb-chain", "GLDon", "0x6666666666666666666666666666666666666666"),
        soc("BITX", "2x Bitcoin ETF", "etf", "backed-xstocks", "bnb-chain", "BITXx", "0x7777777777777777777777777777777777777777"),
        soc("ARM", "Arm Holdings plc American Depositary Shares", "etf", "ondo", "bnb-chain", "ARMon", "0x8888888888888888888888888888888888888888"),
      ],
    });
    expect(tokens.find((row) => row.symbol === "AAPLon")).toMatchObject({
      issuer: ONDO_ISSUER_LABEL,
      kind: "equity",
    });
    expect(tokens.find((row) => row.symbol === "SPYon")?.kind).toBe("etf");
    expect(tokens.find((row) => row.symbol === "SPCXx")).toMatchObject({
      issuer: XSTOCKS_ISSUER_LABEL,
      kind: "private",
    });
    expect(tokens.find((row) => row.symbol === "AAPL")).toMatchObject({ issuer: DINARI_ISSUER_LABEL, kind: "equity" });
    expect(tokens.find((row) => row.symbol === "ARMon")?.kind).toBe("equity");
    expect(tokens.map((row) => row.symbol).sort()).toEqual(["AAPL", "AAPLon", "ARMon", "SPCXx", "SPYon"]);
    expect(classifyBnbInstrument("Franklin U.S. Equity Index")).toBe("etf");
    expect(isExcludedBnbProduct("BITXx", "2x Bitcoin ETF")).toBe(true);
    expect(isExcludedBnbProduct("TQQQx", "ProShares UltraPro QQQ")).toBe(true);
    expect(isExcludedBnbProduct("SQQQx", "ProShares Short QQQ")).toBe(true);
    expect(isExcludedBnbProduct("CPERx", "US Copper Index Fund")).toBe(true);
    expect(isExcludedBnbProduct("COPXx", "Global X Copper Miners ETF")).toBe(false);
    expect(isExcludedBnbProduct("SCCO", "Southern Copper")).toBe(false);
    expect(isExcludedBnbProduct("UCTT", "Ultra Clean Holdings")).toBe(false);
    expect(isExcludedBnbProduct("AAPLx", "Apple xStock")).toBe(false);
  });

  it("keeps chain-56 xStocks and drops other chains, gold, and leveraged ETFs", () => {
    const tokens = parseXStocksTokenList({
      tokens: [
        list("AAPLx", "Apple xStock", 56, AAPLX),
        list("GLDx", "SPDR Gold Shares xStock", 56, "0x9999999999999999999999999999999999999999"),
        list("MUULx", "Micron 2x Long ETF xStock", 56, "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
        list("AAPLx", "Apple xStock", 1, "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"),
      ],
    });
    expect(tokens.map((row) => row.symbol)).toEqual(["AAPLx"]);
    expect(tokens[0]).toMatchObject({ issuer: XSTOCKS_ISSUER_LABEL, kind: "equity", address: AAPLX });
  });

  it("keeps a product only when the catalogue names a bsc contract", () => {
    const tokens = parseXStocksProductCatalog({
      products: [
        {
          symbol: "AAPLx",
          name: "Apple xStock",
          iconUrl: "https://xstocks.fi/aaplx.png",
          addresses: { ethereum: AAPLX, bsc: AAPLX },
        },
        {
          symbol: "SHEINx",
          name: "SHEIN xStock",
          addresses: { ethereum: "0x1111111111111111111111111111111111111111", bsc: null },
        },
        {
          symbol: "GLDx",
          name: "Gold xStock",
          addresses: { bsc: "0x9999999999999999999999999999999999999999" },
        },
      ],
    });
    expect(tokens.map((row) => row.symbol)).toEqual(["AAPLx"]);
    expect(tokens[0]).toMatchObject({ issuer: XSTOCKS_ISSUER_LABEL, address: AAPLX, kind: "equity" });

    const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      props: {
        pageProps: {
          products: [
            {
              symbol: "TSLAx",
              name: "Tesla xStock",
              addresses: { bsc: "0x8ad3c73f833d3f9a523ab01476625f269aeb7cf0" },
            },
          ],
        },
      },
    })}</script>`;
    expect(parseXStocksProductCatalog(html).map((row) => row.symbol)).toEqual(["TSLAx"]);
  });

  it("drops xStocks the catalogue did not publish and still keeps other issuers", () => {
    const catalogue = new Set([AAPLX.toLowerCase()]);
    const sony = "0x8c06d627b8d57792803e3caed36f7af2ad883b01";
    const gated = retainVerifiedXStocks(
      [
        { address: AAPLX, symbol: "AAPLx", name: "Apple xStock", issuer: XSTOCKS_ISSUER_LABEL, kind: "equity", logoUrl: null },
        { address: sony, symbol: "SONYx", name: "Sony xStock", issuer: XSTOCKS_ISSUER_LABEL, kind: "equity", logoUrl: null },
        { address: AAPLON, symbol: "AAPLon", name: "Apple Inc.", issuer: ONDO_ISSUER_LABEL, kind: "equity", logoUrl: null },
      ],
      catalogue,
    );
    expect(gated.map((row) => row.symbol).sort()).toEqual(["AAPLon", "AAPLx"]);
    expect(retainVerifiedXStocks(gated, null)).toHaveLength(2);
  });

  it("reads Binance Smart Chain deployments and does not list the wrapper as its own card", () => {
    const tokens = parseXStocksAssets({
      nodes: [
        {
          symbol: "AAPLx",
          name: "Apple xStock",
          logo: "https://xstocks-metadata.backed.fi/logos/tokens/AAPLx.png",
          deployments: [
            {
              network: "BinanceSmartChain",
              address: AAPLX,
              wrapperAddressV2: "0xcccccccccccccccccccccccccccccccccccccccc",
            },
            { network: "Ethereum", address: "0xdddddddddddddddddddddddddddddddddddddddd" },
          ],
        },
      ],
      page: { currentPage: 0, hasNextPage: false },
    });
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.address.toLowerCase()).toBe(AAPLX.toLowerCase());
  });

  it("reads bStocks on bsc from the Jumper catalog and leaves other providers and chains out", () => {
    const html = `self.__next_f.push([1,"{\\"allRows\\":[${JSON.stringify({
      entry: {
        underlying: "AAPL",
        name: "Apple",
        kind: "stock",
        instances: [
          { provider: "bStocks", tokenSymbol: "AAPLB", chain: "bsc", chainId: 56, address: AAPLB },
          { provider: "xStocks", tokenSymbol: "AAPLx", chain: "ethereum", chainId: 1, address: AAPLX },
          { provider: "Robinhood", tokenSymbol: "AAPL", chain: "bsc", chainId: 56, address: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" },
        ],
      },
    }).replace(/"/g, '\\"')}]}"]);`;
    const tokens = parseJumperBstocks(html);
    expect(tokens.map((row) => row.symbol)).toEqual(["AAPLB"]);
    expect(tokens[0]).toMatchObject({ issuer: BSTOCKS_ISSUER_LABEL, kind: "equity" });

    const index = parseJumperBstocks({
      allRows: [
        {
          entry: {
            underlying: "QQQ",
            name: "Nasdaq",
            kind: "etf",
            instances: [{ provider: "bStocks", tokenSymbol: "QQQB", chain: "bsc", chainId: 56, address: AAPLB }],
          },
        },
      ],
    });
    expect(index[0]).toMatchObject({ symbol: "QQQB", kind: "etf", name: "Nasdaq" });
  });

  it("parses Colb BNB share tokens and leaves oracles out", () => {
    const tokens = parseColbContracts(`
### Ethereum
| Colb SpaceX (CSPX) | 0x1111111111111111111111111111111111111111 |

### BNB Chain
<table><tbody>
<tr><td>Colb SpaceX (CSPX)</td><td><code>${CSPX}</code></td></tr>
<tr><td>Colb SpaceX Oracle</td><td><code>0xe55C11f738BD0010331583d83F9Cb8e9416c60Ec</code></td></tr>
<tr><td>Colb Anthropic (CANP)</td><td><code>${CANP}</code></td></tr>
<tr><td>Colb Revolut (CREV)</td><td><code>${CREV}</code></td></tr>
</tbody></table>
### Arbitrum
| Colb Other (COTH) | 0x2222222222222222222222222222222222222222 |
`);
    expect(tokens.map((row) => row.symbol).sort()).toEqual(["CANP", "CREV", "CSPX"]);
    expect(tokens.every((row) => row.issuer === COLB_ISSUER_LABEL && row.kind === "private")).toBe(true);
  });

  it("reads Paimon tradable tokens and the docs pSPCX row, and skips Prime plus infrastructure", () => {
    const trade = parsePaimonTradePage(`
<a>Paimon <!-- -->OpenAI<!-- --> SPV Tradable Token</a>
<span>$<!-- -->xOPAI</span>
<a href="https://bscscan.com/token/${XOPAI}">scan</a>
<a>Paimon <!-- -->Prime<!-- --> SPV Tradable Token</a>
<span>$<!-- -->PPT</span>
<a href="https://bscscan.com/token/${PPT}">scan</a>
`);
    expect(trade.map((row) => row.symbol)).toEqual(["xOPAI"]);
    expect(trade[0]).toMatchObject({
      issuer: PAIMON_ISSUER_LABEL,
      kind: "private",
      name: "Paimon OpenAI SPV Tradable Token",
    });

    const docs = parsePaimonDocs(
      `{"searchText":"PPT (Prime Vault) ${PPT}"} {"searchText":"pSPCX (EIP-3643) ${PSPCX}"} {"searchText":"xSPCX (Shadow) ${XSPCX}"} {"searchText":"StakingModule 0x80D9b50f4f1ECdd30CD61E400bf8B9b74eC8795f"}`,
    );
    expect(docs.map((row) => row.symbol).sort()).toEqual(["pSPCX", "xSPCX"]);
    expect(docs.find((row) => row.symbol === "pSPCX")?.name).toBe("Paimon pSPCX (EIP-3643)");
  });

  it("does not invent an Ondo token unless the payload names BNB Chain", () => {
    expect(parseOndoBnbAssets(null)).toEqual([]);
    expect(parseOndoBnbAssets({ message: "Forbidden" })).toEqual([]);
    expect(
      parseOndoBnbAssets({
        assets: [{ symbol: "AAPLon", name: "Apple (Ondo)", address: AAPLON, chainId: 1 }],
      }),
    ).toEqual([]);
    const [flat] = parseOndoBnbAssets({
      assets: [{ symbol: "NVDAon", name: "NVIDIA (Ondo)", address: "0x4444444444444444444444444444444444444444", chain: "bsc" }],
    });
    expect(flat).toMatchObject({ issuer: ONDO_ISSUER_LABEL, kind: "equity" });
    const [nested] = parseOndoBnbAssets({
      tokens: [
        {
          ticker: "TSLAon",
          name: "Tesla (Ondo)",
          networks: [{ chainId: 56, address: "0x5555555555555555555555555555555555555555" }],
        },
      ],
    });
    expect(nested?.symbol).toBe("TSLAon");
  });
});

describe("BNB market lanes", () => {
  it("sums unique BNB pools and keeps a missing volume missing", () => {
    const tokens = parseStocksonchainBnb({
      stocks: [soc("AAPL", "Apple Inc.", "stock", "ondo", "bnb-chain", "AAPLon", AAPLON)],
    });
    const lanes = buildBnbMarketLanes(tokens, [
      pair({ pairAddress: "0xsame", base: { address: AAPLON, symbol: "AAPLon", name: "Apple Inc." }, volume: 10, liquidity: 100, price: 200 }),
      pair({ pairAddress: "0xsame", base: { address: AAPLON, symbol: "AAPLon", name: "Apple Inc." }, volume: 10, liquidity: 100, price: 200 }),
      pair({ pairAddress: "0xother", base: { address: AAPLON, symbol: "AAPLon", name: "Apple Inc." }, volume: 5, liquidity: 50, price: 240 }),
      pair({ chainId: "solana", pairAddress: "sol", base: { address: AAPLON, symbol: "AAPLon", name: "Apple Inc." }, volume: 999 }),
    ]);
    expect(lanes.assets).toHaveLength(1);
    expect(lanes.assets[0]).toMatchObject({
      issuer: ONDO_ISSUER_LABEL,
      volume24hUsd: 15,
      displayedLiquidityUsd: 150,
      poolCount: 2,
      dexMedianPriceUsd: 200,
      chainId: "bnb",
    });
    const quiet = buildBnbMarketLanes(tokens, []);
    expect(quiet.assets[0]?.volume24hUsd).toBeNull();
    expect(quiet.assets[0]?.displayedLiquidityUsd).toBeNull();
    expect(quiet.assets[0]?.poolCount).toBe(0);
  });

  it("uses a DexScreener base image and otherwise keeps the issuer logo", () => {
    const registry = "https://xstocks-metadata.backed.fi/logos/tokens/AAPLx.png";
    const dexLogo = "https://cdn.dexscreener.com/cms/images/aaplx.png";
    expect(selectBnbTokenLogo({ dexLogoUrl: dexLogo, registryLogoUrl: registry })).toBe(dexLogo);
    expect(selectBnbTokenLogo({ dexLogoUrl: "javascript:alert(1)", registryLogoUrl: registry })).toBe(registry);
    expect(selectBnbTokenLogo({ registryLogoUrl: "data:image/png;base64,aaaa" })).toBeNull();

    const tokens = parseXStocksTokenList({ tokens: [list("AAPLx", "Apple xStock", 56, AAPLX, registry)] });
    const quoteOnly = buildBnbMarketLanes(tokens, [
      pair({
        base: { address: "0xusdc", symbol: "USDC", name: "USD Coin" },
        quote: { address: AAPLX, symbol: "AAPLx", name: "Apple xStock" },
        infoImageUrl: dexLogo,
        volume: 4,
      }),
    ]);
    expect(quoteOnly.assets[0]?.logoUrl).toBe(registry);
    expect(quoteOnly.assets[0]?.pools[0]?.baseLogoUrl).toBeNull();

    const fromDex = buildBnbMarketLanes(tokens, [
      pair({
        base: { address: AAPLX.toLowerCase(), symbol: "AAPLx", name: "Apple xStock" },
        infoImageUrl: dexLogo,
        volume: 9,
      }),
    ]);
    expect(fromDex.assets[0]?.logoUrl).toBe(dexLogo);
  });

  it("collapses one contract and keeps two live contracts for one ticker", () => {
    const upper = AAPLX.toUpperCase();
    const other = "0x8c06d627b8d57792803e3caed36f7af2ad883b01";
    const merged = mergeBnbTokens([
      parseXStocksTokenList({
        tokens: [list("AAPLx", "Apple xStock", 56, AAPLX), list("AAPLx", "Apple xStock", 56, upper), list("AAPLx", "Apple xStock copy", 56, other)],
      }),
    ]);
    expect(merged.map((row) => row.address.toLowerCase()).sort()).toEqual([AAPLX.toLowerCase(), other].sort());
  });

  it("lets the first registry keep a shared contract", () => {
    const ondo = parseStocksonchainBnb({
      stocks: [soc("AAPL", "Apple Inc.", "stock", "ondo", "bnb-chain", "AAPLon", AAPLON)],
    });
    const jumper = parseJumperBstocks({
      allRows: [
        {
          entry: {
            name: "Apple",
            kind: "stock",
            instances: [{ provider: "Ondo", tokenSymbol: "AAPLon", chain: "bsc", chainId: 56, address: AAPLON }],
          },
        },
      ],
    });
    const merged = mergeBnbTokens([ondo, jumper]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.name).toBe("Apple Inc.");
  });
});

describe("loadBnbChainMarkets", () => {
  it("keeps Ondo names when DexScreener token batches fail and records the Dinari soft-fail", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("stocksonchain")) {
        return json({ stocks: [soc("AAPL", "Apple Inc.", "stock", "ondo", "bnb-chain", "AAPLon", AAPLON)] });
      }
      return new Response("nope", { status: 503 });
    });
    const catalog = await loadBnbChainMarkets({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      cache: false,
    });
    expect(catalog.assets.map((row) => row.symbol)).toEqual(["AAPLon"]);
    expect(catalog.assets[0]?.volume24hUsd).toBeNull();
    expect(catalog.volumeHydrated).toBe(false);
    expect(catalog.sourceFailures.some((row) => row.sourceLabel === "Dinari")).toBe(true);
    expect(catalog.assets.some((row) => row.issuer === DINARI_ISSUER_LABEL)).toBe(false);
    expect(catalog.sourceFailures.some((row) => row.sourceLabel === "Ondo metadata API")).toBe(true);
    expect(fetchImpl.mock.calls.some((call) => String(call[0]).includes("bnb.json"))).toBe(false);
  });

  it("hydrates BNB pool volume from DexScreener and still lists xStocks when Stocks On Chain is down", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("stocksonchain")) return new Response("down", { status: 500 });
      if (url.includes("tokenlist")) {
        return json({ tokens: [list("AAPLx", "Apple xStock", 56, AAPLX)] });
      }
      if (url.includes("/tokens/v1/bsc/")) {
        return json([
          pair({
            base: { address: AAPLX, symbol: "AAPLx", name: "Apple xStock" },
            volume: 12,
            liquidity: 30,
            price: 1.5,
          }),
        ]);
      }
      return new Response("missing", { status: 404 });
    });
    const catalog = await loadBnbChainMarkets({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      cache: false,
    });
    expect(catalog.sourceFailures.some((row) => /500/.test(row.message))).toBe(true);
    expect(catalog.assets.find((row) => row.symbol === "AAPLx")).toMatchObject({
      issuer: XSTOCKS_ISSUER_LABEL,
      volume24hUsd: 12,
      dexMedianPriceUsd: 1.5,
    });
  });

  it("does not add an xStocks contract that the product catalogue left off BSC", async () => {
    const sony = "0x8c06d627b8d57792803e3caed36f7af2ad883b01";
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("products")) {
        return json({
          products: [
            { symbol: "AAPLx", name: "Apple xStock", addresses: { ethereum: AAPLX, bsc: AAPLX } },
          ],
        });
      }
      if (url.includes("tokenlist")) {
        return json({
          tokens: [list("AAPLx", "Apple xStock", 56, AAPLX), list("SONYx", "Sony xStock", 56, sony)],
        });
      }
      if (url.includes("stocksonchain")) {
        return json({
          stocks: [
            soc("AAPL", "Apple Inc.", "stock", "ondo", "bnb-chain", "AAPLon", AAPLON),
            soc("SONY", "Sony", "stock", "backed-xstocks", "bnb-chain", "SONYx", sony),
          ],
        });
      }
      if (url.includes("/tokens/v1/bsc/")) return json([]);
      return new Response("missing", { status: 404 });
    });
    const catalog = await loadBnbChainMarkets({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      cache: false,
    });
    const symbols = [...catalog.assets, ...catalog.etfAssets, ...catalog.privateAssets].map((row) => row.symbol);
    expect(symbols.sort()).toEqual(["AAPLon", "AAPLx"]);
    expect(catalog.assets.find((row) => row.symbol === "AAPLx")?.volume24hUsd).toBeNull();
  });

  it("throws a missing list when no issuer returns a token", async () => {
    const fetchImpl = vi.fn(async () => new Response("down", { status: 500 }));
    await expect(
      loadBnbChainMarkets({
        fetchImpl: fetchImpl as unknown as typeof fetch,
        cache: false,
      }),
    ).rejects.toThrow(/missing list/i);
  });
});

function soc(
  ticker: string,
  company: string,
  kind: string,
  issuer: string,
  chain: string,
  symbol: string,
  address: string,
) {
  return {
    ticker,
    company,
    kind,
    listings: [{ issuer, chain, address, onchainSymbol: symbol }],
  };
}

function list(symbol: string, name: string, chainId: number, address: string, logoURI?: string) {
  return {
    chainId,
    address,
    symbol,
    name,
    decimals: 18,
    logoURI: logoURI ?? `https://xstocks-metadata.backed.fi/logos/tokens/${symbol}.png`,
    tags: ["xStocks"],
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
    chainId: input.chainId ?? "bsc",
    dexId: "pancakeswap",
    pairAddress: input.pairAddress ?? `0xpair-${input.base.address.slice(2, 8)}-${input.volume ?? 0}`,
    url: "https://dexscreener.com/bsc/0xpair",
    baseToken: input.base,
    quoteToken: input.quote ?? { address: "0xweth", symbol: "WBNB", name: "WBNB" },
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
