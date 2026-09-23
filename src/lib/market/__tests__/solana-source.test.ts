import { describe, expect, it } from "vitest";
import { BACKPACK_SUNRISE_BATCH_TICKERS, DEFAULT_SOLANA_DISCOVERY_QUERIES } from "../solana-discover";
import { SolanaMarketDataSource, type SolanaMarketDataSourceOptions } from "../solana-source";
import { MemoryDeskVolumeSnapshotStore } from "../volume-snapshots";

const tslaMint = "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB";
const hoodMint = "XsNotAllowlisted1111111111111111111111111";
const spyMint = "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W";
const unpairedMint = "XsUnpairedHood111111111111111111111111111";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function testSource(options: SolanaMarketDataSourceOptions) {
  return new SolanaMarketDataSource({
    requestGapMs: 0,
    retries: 0,
    discoveryQueries: ["xStock"],
    enableRegistry: false,
    enableOndoRegistry: false,
    enableTesseraRegistry: false,
    enableSunriseRegistry: false,
    enableGeckoTerminal: false,
    enableJupiterTokenLogos: false,
    backgroundEnrichment: false,
    volumeSnapshotStore: new MemoryDeskVolumeSnapshotStore(),
    ...options,
  });
}

function tslaPair() {
  return {
    chainId: "solana",
    dexId: "raydium",
    pairAddress: "pair-1",
    baseToken: { address: tslaMint, name: "Tesla xStock", symbol: "TSLAx" },
    quoteToken: { address: "usdc", name: "USDC", symbol: "USDC" },
    priceUsd: "100.5",
    volume: { h24: 1_250.25 },
    liquidity: { usd: 9_000 },
    txns: { h24: { buys: 4, sells: 3 } },
  };
}

describe("SolanaMarketDataSource", () => {
  it("discovers via search, hydrates batched token pools, and aggregates by mint", async () => {
    const urls: string[] = [];
    const source = testSource({
      requestGapMs: 0,
      fetchImpl: async (input) => {
        urls.push(String(input));
        if (String(input).includes("/latest/dex/search")) {
          return jsonResponse({ pairs: [tslaPair()] });
        }
        if (String(input).includes(`/tokens/v1/solana/${tslaMint}`)) {
          return jsonResponse([tslaPair()]);
        }
        if (String(input).includes(`/token-pairs/v1/solana/${tslaMint}`)) {
          return jsonResponse([
            tslaPair(),
            {
              ...tslaPair(),
              dexId: "orca",
              pairAddress: "pair-2",
              volume: { h24: 10 },
              liquidity: { usd: 100 },
            },
          ]);
        }
        return jsonResponse({ unexpected: true }, 404);
      },
    });

    const list = await source.listChains();
    expect(list.chains).toHaveLength(1);
    expect(list.chains[0]?.id).toBe("solana");
    expect(list.chains[0]?.volume24hUsd).toBeCloseTo(1_250.25);
    expect(list.chains[0]?.assetsWithPools).toBe(1);
    expect(urls.some((url) => url.includes("/latest/dex/search?q=xStock"))).toBe(true);
    expect(urls.some((url) => url.includes(`/tokens/v1/solana/${tslaMint}`))).toBe(false);
    expect(urls.some((url) => url.includes(`/token-pairs/v1/solana/${tslaMint}`))).toBe(false);

    const chain = await source.getChain("solana");
    expect(chain?.assets[0]?.symbol).toBe("TSLAx");
    expect(chain?.assets[0]?.poolCount).toBe(2);
    expect(chain?.assets[0]?.volume24hUsd).toBeCloseTo(1_260.25);
    expect(chain?.assets[0]?.issuer).toBe("Backed / xStocks");
    expect(chain?.chain.volumeAggregation).toBe("all-pools");
    expect(urls.some((url) => url.includes(`/token-pairs/v1/solana/${tslaMint}`))).toBe(true);
    expect(await source.getChain("robinhood-chain")).toBeNull();

    const asset = await source.getAsset("solana", "tslax");
    expect(asset?.asset.contractAddress).toBe(tslaMint);
    expect(asset?.asset.pools).toHaveLength(2);
    expect(await source.getAsset("solana", tslaMint)).not.toBeNull();
  });

  it("admits a classified equity that is not on the historical allowlist", async () => {
    const source = testSource({
      requestGapMs: 0,
      fetchImpl: async (input) => {
        const pair = {
          chainId: "solana",
          dexId: "raydium",
          pairAddress: "pair-hood",
          baseToken: { address: hoodMint, name: "Robinhood xStock", symbol: "HOODx" },
          volume: { h24: 40 },
          liquidity: { usd: 12 },
        };
        if (String(input).includes("/latest/dex/search")) return jsonResponse({ pairs: [pair] });
        if (String(input).includes("/tokens/v1/solana/")) return jsonResponse([pair]);
        if (String(input).includes("/token-pairs/v1/solana/")) return jsonResponse([pair]);
        return jsonResponse({ unexpected: true }, 404);
      },
    });

    const chain = await source.getChain("solana");
    expect(chain?.assets.map((asset) => asset.symbol)).toEqual(["HOODx"]);
  });

  it("merges the live xStocks registry with search and still rejects ETFs", async () => {
    const urls: string[] = [];
    const source = testSource({
      requestGapMs: 0,
      discoveryQueries: ["xStock"],
      enableRegistry: true,
      enableOndoRegistry: false,
      registryBaseUrl: "https://api.xstocks.fi/api/v2",
      fetchImpl: async (input) => {
        const url = String(input);
        urls.push(url);
        if (url.includes("/latest/dex/search")) {
          return jsonResponse({ pairs: [] });
        }
        if (url.includes("/public/assets")) {
          return jsonResponse({
            nodes: [
              {
                name: "Tesla xStock",
                symbol: "TSLAx",
                deployments: [{ network: "Solana", address: tslaMint }],
              },
              {
                name: "SP500 xStock",
                symbol: "SPYx",
                deployments: [{ network: "Solana", address: spyMint }],
              },
              {
                name: "Netflix xStock",
                symbol: "NFLXx",
                deployments: [{ network: "Solana", address: unpairedMint }],
              },
            ],
            page: { currentPage: 0, hasNextPage: false },
          });
        }
        if (url.includes("/tokens/v1/solana/")) {
          return jsonResponse([tslaPair()]);
        }
        if (url.includes(`/token-pairs/v1/solana/${tslaMint}`)) {
          return jsonResponse([tslaPair()]);
        }
        return jsonResponse({ unexpected: true }, 404);
      },
    });

    const chain = await source.getChain("solana");
    expect(chain?.assets.map((asset) => asset.symbol).sort()).toEqual(["NFLXx", "TSLAx"]);
    expect(chain?.etfAssets?.map((asset) => asset.symbol)).toEqual(["SPYx"]);
    expect(chain?.chain.etfCount).toBe(1);
    expect(chain?.chain.etfVolume24hUsd).toBeNull();
    expect(chain?.assets.find((asset) => asset.symbol === "TSLAx")?.volume24hUsd).toBeCloseTo(1_250.25);
    const nflx = chain?.assets.find((asset) => asset.symbol === "NFLXx");
    expect(nflx?.volume24hUsd).toBeNull();
    expect(nflx?.poolCount).toBe(0);
    expect(urls.some((url) => url.includes("/public/assets"))).toBe(true);
    expect(urls.some((url) => url.includes("/tokens/v1/solana/"))).toBe(true);
  });

  it("classifies PreStocks in a private lane and keeps public 24h honest", async () => {
    const openaiMint = "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF";
    const openaiPair = {
      chainId: "solana",
      dexId: "raydium",
      pairAddress: "pair-openai",
      baseToken: { address: openaiMint, name: "OpenAI PreStocks", symbol: "OPENAI" },
      quoteToken: { address: "usdc", name: "USDC", symbol: "USDC" },
      volume: { h24: 88_000 },
      liquidity: { usd: 12_000 },
    };
    const source = testSource({
      requestGapMs: 0,
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("/latest/dex/search")) return jsonResponse({ pairs: [tslaPair(), openaiPair] });
        if (url.includes("/tokens/v1/solana/")) return jsonResponse([tslaPair(), openaiPair]);
        if (url.includes(`/token-pairs/v1/solana/${openaiMint}`)) return jsonResponse([openaiPair]);
        if (url.includes(`/token-pairs/v1/solana/${tslaMint}`)) return jsonResponse([tslaPair()]);
        return jsonResponse({ unexpected: true }, 404);
      },
    });

    const list = await source.listChains();
    expect(list.chains[0]?.volume24hUsd).toBeCloseTo(1_250.25);
    expect(list.chains[0]?.privateCount).toBe(1);
    expect(list.chains[0]?.privateVolume24hUsd).toBe(88_000);
    expect(list.chains[0]?.etfVolume24hUsd).toBeNull();

    const chain = await source.getChain("solana");
    expect(chain?.assets.map((asset) => asset.symbol)).toEqual(["TSLAx"]);
    expect(chain?.privateAssets?.map((asset) => asset.symbol)).toEqual(["OPENAI"]);
    expect(chain?.privateAssets?.[0]?.volume24hUsd).toBe(88_000);
    expect(chain?.privateAssets?.[0]?.issuer).toBe("PreStocks");
    expect(chain?.privateAssets?.[0]?.instrumentKind).toBe("private");
    expect(chain?.chain.volume24hUsd).toBeCloseTo(1_250.25);
    expect(chain?.chain.privateVolume24hUsd).toBe(88_000);

    const asset = await source.getAsset("solana", openaiMint);
    expect(asset?.asset.instrumentKind).toBe("private");
    expect(asset?.asset.volume24hUsd).toBe(88_000);
  });

  it("rolls ETF/index 24h separately and does not mix it into public ranking", async () => {
    const spyPair = {
      chainId: "solana",
      dexId: "raydium",
      pairAddress: "pair-spy",
      baseToken: { address: spyMint, name: "SP500 xStock", symbol: "SPYx" },
      quoteToken: { address: "usdc", name: "USDC", symbol: "USDC" },
      volume: { h24: 13_000_000 },
      liquidity: { usd: 4_000_000 },
    };
    const source = testSource({
      requestGapMs: 0,
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("/latest/dex/search")) return jsonResponse({ pairs: [tslaPair(), spyPair] });
        if (url.includes("/tokens/v1/solana/")) return jsonResponse([tslaPair(), spyPair]);
        if (url.includes(`/token-pairs/v1/solana/${spyMint}`)) return jsonResponse([spyPair]);
        if (url.includes(`/token-pairs/v1/solana/${tslaMint}`)) return jsonResponse([tslaPair()]);
        return jsonResponse({ unexpected: true }, 404);
      },
    });

    const list = await source.listChains();
    expect(list.chains[0]?.volume24hUsd).toBeCloseTo(1_250.25);
    expect(list.chains[0]?.etfCount).toBe(1);
    expect(list.chains[0]?.etfVolume24hUsd).toBe(13_000_000);
    expect(list.chains[0]?.privateVolume24hUsd).toBeNull();

    const chain = await source.getChain("solana");
    expect(chain?.assets.map((asset) => asset.symbol)).toEqual(["TSLAx"]);
    expect(chain?.etfAssets?.map((asset) => asset.symbol)).toEqual(["SPYx"]);
    expect(chain?.etfAssets?.[0]?.volume24hUsd).toBe(13_000_000);
    expect(chain?.etfAssets?.[0]?.instrumentKind).toBe("etf");
    expect(chain?.chain.volume24hUsd).toBeCloseTo(1_250.25);
    expect(chain?.chain.etfVolume24hUsd).toBe(13_000_000);
  });

  it("fails closed when search finds only crypto", async () => {
    const source = testSource({
      requestGapMs: 0,
      fetchImpl: async () =>
        jsonResponse({
          pairs: [
            {
              chainId: "solana",
              baseToken: { address: "bonk", name: "Bonk", symbol: "BONK" },
              volume: { h24: 9_000_000 },
            },
          ],
        }),
    });
    await expect(source.listChains()).rejects.toThrow(/No verifiable Solana tokenized stocks/);
  });

  it("fails closed when DexScreener returns an HTTP error", async () => {
    const source = testSource({
      requestGapMs: 0,
      enableRegistry: false,
      enableOndoRegistry: false,
      fetchImpl: async () => jsonResponse({ error: "nope" }, 502),
    });
    await expect(source.listChains()).rejects.toThrow(/502/);
  });

  it("fails closed when the search payload is not a pair list", async () => {
    const source = testSource({
      requestGapMs: 0,
      fetchImpl: async () => jsonResponse({ unexpected: true }),
    });
    await expect(source.listChains()).rejects.toThrow(/search response/);
  });

  it("uses the default discovery query set", () => {
    expect(DEFAULT_SOLANA_DISCOVERY_QUERIES).toContain("xStock");
    expect(DEFAULT_SOLANA_DISCOVERY_QUERIES).toContain("tokenized stock");
    expect(DEFAULT_SOLANA_DISCOVERY_QUERIES).toContain("tokenized share");
    expect(DEFAULT_SOLANA_DISCOVERY_QUERIES).toContain("Tesla xStock");
    expect(DEFAULT_SOLANA_DISCOVERY_QUERIES).toContain("Microsoft xStock");
    expect(DEFAULT_SOLANA_DISCOVERY_QUERIES).toContain("Robinhood xStock");
    expect(DEFAULT_SOLANA_DISCOVERY_QUERIES).toContain("Ondo Tokenized");
    expect(DEFAULT_SOLANA_DISCOVERY_QUERIES).toContain("NVIDIA (Ondo Tokenized)");
    expect(DEFAULT_SOLANA_DISCOVERY_QUERIES).toContain("PreStocks");
    expect(DEFAULT_SOLANA_DISCOVERY_QUERIES).toContain("OpenAI PreStocks");
    expect(DEFAULT_SOLANA_DISCOVERY_QUERIES).toContain("SpaceX xStock");
    expect(DEFAULT_SOLANA_DISCOVERY_QUERIES).toContain("Backpack Securities");
    for (const ticker of BACKPACK_SUNRISE_BATCH_TICKERS) {
      expect(DEFAULT_SOLANA_DISCOVERY_QUERIES).toContain(`${ticker} - Backpack Securities`);
    }
    expect(DEFAULT_SOLANA_DISCOVERY_QUERIES).toContain("Nike - Backpack Securities");
    expect(DEFAULT_SOLANA_DISCOVERY_QUERIES).toContain("Shopify - Backpack Securities");
    expect(DEFAULT_SOLANA_DISCOVERY_QUERIES).toContain("Hertz - Backpack Securities");
    expect(DEFAULT_SOLANA_DISCOVERY_QUERIES).toContain("AMC Entertainment - Backpack Securities");
    expect(DEFAULT_SOLANA_DISCOVERY_QUERIES).toContain("DJT - Backpack Securities");
    expect(DEFAULT_SOLANA_DISCOVERY_QUERIES).toContain("LULU - Backpack Securities");
    expect(DEFAULT_SOLANA_DISCOVERY_QUERIES).toContain("MGM - Backpack Securities");
    expect(DEFAULT_SOLANA_DISCOVERY_QUERIES).toContain("SNAP - Backpack Securities");
    expect(DEFAULT_SOLANA_DISCOVERY_QUERIES).toContain("IBM - Backpack Securities");
    expect(DEFAULT_SOLANA_DISCOVERY_QUERIES).toContain("Trump Media - Backpack Securities");
    expect(DEFAULT_SOLANA_DISCOVERY_QUERIES).toContain("lululemon - Backpack Securities");
    expect(DEFAULT_SOLANA_DISCOVERY_QUERIES).toContain("MGM Resorts - Backpack Securities");
    expect(DEFAULT_SOLANA_DISCOVERY_QUERIES).toContain("Snap - Backpack Securities");
    expect(DEFAULT_SOLANA_DISCOVERY_QUERIES).toContain("T-SpaceX");
    expect(DEFAULT_SOLANA_DISCOVERY_QUERIES).toContain("tKalshi");
  });

  it("keeps DexScreener search when the xStocks registry is down", async () => {
    const source = testSource({
      requestGapMs: 0,
      discoveryQueries: ["xStock"],
      enableRegistry: true,
      enableOndoRegistry: false,
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("/public/assets")) return jsonResponse({ error: "nope" }, 502);
        if (url.includes("/latest/dex/search")) return jsonResponse({ pairs: [tslaPair()] });
        if (url.includes("/tokens/v1/solana/")) return jsonResponse([tslaPair()]);
        if (url.includes("/token-pairs/v1/solana/")) return jsonResponse([tslaPair()]);
        return jsonResponse({ unexpected: true }, 404);
      },
    });

    const chain = await source.getChain("solana");
    expect(chain?.assets.map((asset) => asset.symbol)).toEqual(["TSLAx"]);
    expect(chain?.provenance.notes.some((note) => /xStocks public registry unavailable/.test(note))).toBe(true);
  });

  it("admits public Ondo mints from the published GM list and keeps them off any allowlist", async () => {
    const ondoMint = "KeGv7bsfR4MheC1CkmnAVceoApjrkvBhHYjWb67ondo";
    const spyOnMint = "111111111111111111111111111111111111spyondo";
    const source = testSource({
      requestGapMs: 0,
      discoveryQueries: ["xStock"],
      enableRegistry: false,
      enableOndoRegistry: true,
      ondoRegistryUrl: "https://raw.githubusercontent.com/ondoprotocol/gm-solana-simulator/main/constants.rs",
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("gm-solana-simulator")) {
          return new Response(
            `pub const GM_TOKENS: [(&str, &str); 2] = [\n    ("TSLAon", "${ondoMint}"),\n    ("SPYon", "${spyOnMint}"),\n];`,
            { status: 200, headers: { "content-type": "text/plain" } },
          );
        }
        if (url.includes("/latest/dex/search")) return jsonResponse({ pairs: [] });
        if (url.includes("/tokens/v1/solana/")) return jsonResponse([]);
        return jsonResponse({ unexpected: true }, 404);
      },
    });

    const chain = await source.getChain("solana");
    expect(chain?.assets.map((asset) => asset.symbol)).toEqual(["TSLAon"]);
    expect(chain?.assets[0]?.issuer).toBe("Ondo");
    expect(chain?.assets[0]?.volume24hUsd).toBeNull();
    expect(chain?.assets[0]?.volumeCoverage).toBe("no_indexed_pools");
    expect(chain?.etfAssets?.map((asset) => asset.symbol)).toEqual(["SPYon"]);
  });

  it("admits official Tessera T-Tokens from the public docs list into the private lane", async () => {
    const tesseraMint = "TSPXcLV76s6V2zDiZQ18kBfcbnjaE2ZzNT3ga2Pd99v";
    const tesseraPair = {
      chainId: "solana",
      dexId: "meteora",
      pairAddress: "pair-tspacex",
      baseToken: { address: tesseraMint, name: "T-SpaceX", symbol: "tSpaceX" },
      quoteToken: { address: "usdc", name: "USDC", symbol: "USDC" },
      volume: { h24: 378_000 },
      liquidity: { usd: 570_000 },
    };
    const source = testSource({
      requestGapMs: 0,
      discoveryQueries: ["xStock"],
      enableRegistry: false,
      enableTesseraRegistry: true,
      tesseraRegistryUrl: "https://docs.tessera.pe/technicals/on-chain-programs.md",
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("docs.tessera.pe")) {
          return new Response(
            [
              "### Token Mints",
              "",
              "#### T-SpaceX (tSpaceX)",
              "",
              "| Property | Value |",
              "| --- | --- |",
              `| Mint Address | \`${tesseraMint}\` |`,
              "| Symbol | tSpaceX |",
            ].join("\n"),
            { status: 200, headers: { "content-type": "text/markdown" } },
          );
        }
        if (url.includes("/latest/dex/search")) return jsonResponse({ pairs: [] });
        if (url.includes(`/tokens/v1/solana/`) && url.includes(tesseraMint)) return jsonResponse([tesseraPair]);
        if (url.includes(`/token-pairs/v1/solana/${tesseraMint}`)) return jsonResponse([tesseraPair]);
        if (url.includes("/tokens/v1/solana/")) return jsonResponse([]);
        return jsonResponse({ unexpected: true }, 404);
      },
    });

    const chain = await source.getChain("solana");
    expect(chain?.assets).toEqual([]);
    expect(chain?.privateAssets?.map((asset) => asset.symbol)).toEqual(["tSpaceX"]);
    expect(chain?.privateAssets?.[0]?.volume24hUsd).toBe(378_000);
    expect(chain?.privateAssets?.[0]?.issuer).toBe("Tessera");
  });

  it("admits official Sunrise Backpack names as candidates without using them as an allowlist", async () => {
    const nkeMint = "NKEda5nHhNGgjrE9nDdMvaEmkmJ96qqxzBVZEcKmjSg";
    const shopMint = "SH55hfaipFAbwT42nQYhRoM5o5t61QpkmJ6p62vXB3m";
    const dramMint = "DRAMjSWR7HRfJKjRkvQWYL2bcaejaVhuxEcjf4pAY4Cw";
    const nkePair = {
      chainId: "solana",
      dexId: "raydium",
      pairAddress: "pair-nke",
      baseToken: { address: nkeMint, name: "NIKE - Backpack Securities", symbol: "NKE" },
      quoteToken: { address: "usdc", name: "USDC", symbol: "USDC" },
      volume: { h24: 2_500_000 },
      liquidity: { usd: 150_000 },
    };
    const source = testSource({
      requestGapMs: 0,
      discoveryQueries: ["xStock"],
      enableRegistry: false,
      enableSunriseRegistry: true,
      sunriseRegistryUrl: "https://api.sunrise.xyz",
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("api.sunrise.xyz/v1/tokens")) {
          return jsonResponse({
            success: true,
            data: {
              tokens: [
                {
                  chain: "solana",
                  address: nkeMint,
                  symbol: "NKE",
                  name: "NIKE - Backpack Securities",
                  assetClass: "stock",
                  issuer: null,
                },
                {
                  chain: "solana",
                  address: shopMint,
                  symbol: "SHOP",
                  name: "Shopify - Backpack Securities",
                  assetClass: "stock",
                  issuer: "backpack_securities",
                },
                {
                  chain: "solana",
                  address: dramMint,
                  symbol: "DRAM",
                  name: "Roundhill Memory ETF - Backpack Securities",
                  assetClass: "stock",
                  issuer: "backpack_securities",
                },
                {
                  chain: "solana",
                  address: "BPxxfRCXkUVhig4HS1Lh7kZqV6SPJhzfEk4x6fVBjPCy",
                  symbol: "BP",
                  name: "Backpack",
                  assetClass: "crypto",
                  issuer: null,
                },
              ],
              pagination: { nextCursor: null },
            },
          });
        }
        if (url.includes("/latest/dex/search")) return jsonResponse({ pairs: [] });
        if (url.includes(`/tokens/v1/solana/`) && url.includes(nkeMint)) return jsonResponse([nkePair]);
        if (url.includes(`/token-pairs/v1/solana/${nkeMint}`)) return jsonResponse([nkePair]);
        if (url.includes("/tokens/v1/solana/")) return jsonResponse([]);
        return jsonResponse({ unexpected: true }, 404);
      },
    });

    const chain = await source.getChain("solana");
    expect(chain?.assets.map((asset) => asset.symbol).sort()).toEqual(["NKE", "SHOP"]);
    expect(chain?.assets.find((asset) => asset.symbol === "NKE")?.volume24hUsd).toBe(2_500_000);
    expect(chain?.etfAssets?.map((asset) => asset.symbol)).toEqual(["DRAM"]);
    expect(chain?.assets.find((asset) => asset.symbol === "BP")).toBeUndefined();
  });

  it("reuses a cached light snapshot without refetching DexScreener", async () => {
    let searchCalls = 0;
    const source = testSource({
      requestGapMs: 0,
      cacheMs: 60_000,
      discoveryQueries: ["xStock"],
      enableRegistry: false,
      enableOndoRegistry: false,
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("/latest/dex/search")) {
          searchCalls += 1;
          return jsonResponse({ pairs: [tslaPair()] });
        }
        if (url.includes("/tokens/v1/solana/")) return jsonResponse([tslaPair()]);
        if (url.includes("/token-pairs/v1/solana/")) return jsonResponse([tslaPair()]);
        return jsonResponse({ unexpected: true }, 404);
      },
    });

    await source.listChains();
    await source.listChains();
    expect(searchCalls).toBe(1);
  });

  it("keeps search-pair volume when the DexScreener preview budget is already spent", async () => {
    const tokenUrls: string[] = [];
    const source = testSource({
      requestGapMs: 0,
      homeBudgetMs: 0,
      fullBudgetMs: 0,
      enableRegistry: true,
      registryBaseUrl: "https://api.xstocks.fi/api/v2",
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("/latest/dex/search")) return jsonResponse({ pairs: [tslaPair()] });
        if (url.includes("/public/assets")) {
          return jsonResponse({
            nodes: [
              {
                name: "Tesla xStock",
                symbol: "TSLAx",
                deployments: [{ network: "Solana", address: tslaMint }],
              },
              {
                name: "Robinhood xStock",
                symbol: "HOODx",
                deployments: [{ network: "Solana", address: hoodMint }],
              },
              {
                name: "Unpaired Hood xStock",
                symbol: "UHOODx",
                deployments: [{ network: "Solana", address: unpairedMint }],
              },
            ],
            page: { currentPage: 0, hasNextPage: false },
          });
        }
        if (url.includes("/tokens/v1/solana/")) {
          tokenUrls.push(url);
          return jsonResponse([tslaPair()]);
        }
        if (url.includes("/token-pairs/v1/solana/")) return jsonResponse([tslaPair()]);
        return jsonResponse({ unexpected: true }, 404);
      },
    });

    const list = await source.listChains();
    expect(list.chains[0]?.assetCount).toBe(3);
    expect(list.chains[0]?.assetsWithVolume).toBeGreaterThan(0);
    expect(list.chains[0]?.assetsStillHydrating).toBeGreaterThan(0);
    expect(tokenUrls).toEqual([]);

    const chain = await source.getChain("solana");
    const tsla = chain?.assets.find((asset) => asset.symbol === "TSLAx");
    const unpaired = chain?.assets.find((asset) => asset.contractAddress === unpairedMint);
    expect(tsla?.volume24hUsd).toBeCloseTo(1_250.25);
    expect(tsla?.volumeCoverage).toBe("reported");
    expect(unpaired?.volume24hUsd).toBeNull();
    expect(unpaired?.volumeCoverage).toBe("hydrate_incomplete");
    expect(chain?.provenance.notes.some((note) => /still hydrating/.test(note))).toBe(true);
  });

  it("hydrates remaining registry mints in the background so with-volume counts rise", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const hoodPair = {
      chainId: "solana",
      dexId: "raydium",
      pairAddress: "pair-hood",
      baseToken: { address: hoodMint, name: "Robinhood xStock", symbol: "HOODx" },
      quoteToken: { address: "usdc", name: "USDC", symbol: "USDC" },
      volume: { h24: 40 },
      liquidity: { usd: 12 },
    };
    const source = testSource({
      requestGapMs: 0,
      homeBudgetMs: 0,
      fullBudgetMs: 5_000,
      backgroundEnrichment: true,
      enableRegistry: true,
      registryBaseUrl: "https://api.xstocks.fi/api/v2",
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("/latest/dex/search")) return jsonResponse({ pairs: [tslaPair()] });
        if (url.includes("/public/assets")) {
          return jsonResponse({
            nodes: [
              {
                name: "Tesla xStock",
                symbol: "TSLAx",
                deployments: [{ network: "Solana", address: tslaMint }],
              },
              {
                name: "Robinhood xStock",
                symbol: "HOODx",
                deployments: [{ network: "Solana", address: hoodMint }],
              },
            ],
            page: { currentPage: 0, hasNextPage: false },
          });
        }
        if (url.includes("/tokens/v1/solana/")) {
          await gate;
          return jsonResponse([hoodPair]);
        }
        return jsonResponse({ unexpected: true }, 404);
      },
    });

    const first = await source.listChains();
    expect(first.chains[0]?.assetsWithVolume).toBe(1);
    expect(first.chains[0]?.assetsStillHydrating).toBeGreaterThan(0);
    release?.();
    await source.flushBackgroundWork();
    const second = await source.listChains();
    expect(second.chains[0]?.assetsWithVolume).toBe(2);
    expect(second.chains[0]?.assetsStillHydrating).toBe(0);
  });

  it("keeps classified equities when one DexScreener pool hydrate fails", async () => {
    const source = testSource({
      requestGapMs: 0,
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("/latest/dex/search")) return jsonResponse({ pairs: [tslaPair()] });
        if (url.includes("/tokens/v1/solana/")) return jsonResponse([tslaPair()]);
        if (url.includes("/token-pairs/v1/solana/")) return jsonResponse({ error: "nope" }, 502);
        return jsonResponse({ unexpected: true }, 404);
      },
    });

    const chain = await source.getChain("solana");
    expect(chain?.assets).toHaveLength(1);
    expect(chain?.assets[0]?.symbol).toBe("TSLAx");
    expect(chain?.assets[0]?.volume24hUsd).toBeCloseTo(1_250.25);
    expect(chain?.assets[0]?.volumeCoverage).toBe("reported");
  });

  it("skips DexScreener preview for mints already confirmed empty", async () => {
    const tokenUrls: string[] = [];
    const source = testSource({
      requestGapMs: 0,
      cacheMs: 0,
      staleMs: 0,
      emptyCacheMs: 60_000,
      enableRegistry: true,
      registryBaseUrl: "https://api.xstocks.fi/api/v2",
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("/latest/dex/search")) return jsonResponse({ pairs: [tslaPair()] });
        if (url.includes("/public/assets")) {
          return jsonResponse({
            nodes: [
              {
                name: "Tesla xStock",
                symbol: "TSLAx",
                deployments: [{ network: "Solana", address: tslaMint }],
              },
              {
                name: "Unpaired Hood xStock",
                symbol: "UHOODx",
                deployments: [{ network: "Solana", address: unpairedMint }],
              },
            ],
            page: { currentPage: 0, hasNextPage: false },
          });
        }
        if (url.includes("/tokens/v1/solana/")) {
          tokenUrls.push(url);
          return jsonResponse([]);
        }
        if (url.includes("/token-pairs/v1/solana/")) return jsonResponse([tslaPair()]);
        return jsonResponse({ unexpected: true }, 404);
      },
    });

    const first = await source.listChains();
    expect(first.chains[0]?.assetsWithNoIndexedPools).toBeGreaterThan(0);
    const previewCallsAfterFirst = tokenUrls.length;
    expect(previewCallsAfterFirst).toBeGreaterThan(0);

    await source.listChains();
    expect(tokenUrls.length).toBe(previewCallsAfterFirst);

    const chain = await source.getChain("solana");
    const unpaired = chain?.assets.find((asset) => asset.contractAddress === unpairedMint);
    expect(unpaired?.volumeCoverage).toBe("no_indexed_pools");
    expect(unpaired?.volume24hUsd).toBeNull();
  });

  it("merges public GeckoTerminal search candidates without treating them as an admission list", async () => {
    const urls: string[] = [];
    const geckoMint = "XsGeckoHood11111111111111111111111111111";
    const geckoPair = {
      chainId: "solana",
      dexId: "raydium",
      pairAddress: "pair-gecko",
      baseToken: { address: geckoMint, name: "Robinhood xStock", symbol: "HOODx" },
      quoteToken: { address: "usdc", name: "USDC", symbol: "USDC" },
      volume: { h24: 88 },
      liquidity: { usd: 20 },
    };
    const source = testSource({
      requestGapMs: 0,
      enableGeckoTerminal: true,
      geckoTerminalBaseUrl: "https://api.geckoterminal.com/api/v2",
      fetchImpl: async (input) => {
        const url = String(input);
        urls.push(url);
        if (url.includes("/latest/dex/search")) return jsonResponse({ pairs: [tslaPair()] });
        if (url.includes("geckoterminal.com")) {
          return jsonResponse({
            data: [],
            included: [
              {
                type: "token",
                attributes: { address: geckoMint, name: "Robinhood xStock", symbol: "HOODx" },
              },
            ],
          });
        }
        if (url.includes(`/tokens/v1/solana/`) && url.includes(geckoMint)) return jsonResponse([geckoPair]);
        if (url.includes(`/token-pairs/v1/solana/${geckoMint}`)) return jsonResponse([geckoPair]);
        if (url.includes(`/token-pairs/v1/solana/${tslaMint}`)) return jsonResponse([tslaPair()]);
        if (url.includes("/tokens/v1/solana/")) return jsonResponse([tslaPair()]);
        return jsonResponse({ unexpected: true }, 404);
      },
    });

    const chain = await source.getChain("solana");
    expect(urls.some((url) => url.includes("geckoterminal.com") && url.includes("search/pools"))).toBe(true);
    expect(chain?.assets.map((asset) => asset.symbol).sort()).toEqual(["HOODx", "TSLAx"]);
    const hood = chain?.assets.find((asset) => asset.symbol === "HOODx");
    expect(hood?.volume24hUsd).toBe(88);
    expect(hood?.volumeCoverage).toBe("reported");
  });

  it("builds daily volume from DexScreener desk snapshots and never fetches GeckoTerminal OHLCV", async () => {
    const urls: string[] = [];
    const snapshots = new MemoryDeskVolumeSnapshotStore();
    const source = testSource({
      requestGapMs: 0,
      enableGeckoTerminal: true,
      geckoTerminalBaseUrl: "https://api.geckoterminal.com/api/v2",
      volumeSnapshotStore: snapshots,
      fetchImpl: async (input) => {
        const url = String(input);
        urls.push(url);
        if (url.includes("/latest/dex/search")) {
          return jsonResponse({
            pairs: [
              tslaPair(),
              {
                chainId: "solana",
                dexId: "raydium",
                pairAddress: "pair-spy",
                baseToken: { address: spyMint, name: "SPY xStock", symbol: "SPYx" },
                quoteToken: { address: "usdc", name: "USDC", symbol: "USDC" },
                volume: { h24: 9_000 },
                liquidity: { usd: 1 },
              },
            ],
          });
        }
        if (url.includes("/ohlcv/")) return jsonResponse({ unexpected: true }, 500);
        if (url.includes("/tokens/v1/solana/")) return jsonResponse([tslaPair()]);
        if (url.includes("/token-pairs/v1/solana/")) return jsonResponse([tslaPair()]);
        return jsonResponse({ unexpected: true }, 404);
      },
    });

    const history = await source.getEquityVolumeHistory();
    expect(history.available).toBe(true);
    expect(urls.some((url) => url.includes("/ohlcv/"))).toBe(false);
    expect(history.seriesByMint).toEqual({});
    expect(history.definition).toMatch(/DexScreener 24h snapshots/);
    expect(history.definition).not.toMatch(/GeckoTerminal USD volume/i);
    expect(history.points).toHaveLength(1);
    expect(history.points[0]?.kind).toBe("rolling_24h");
    expect(history.points[0]?.volumeUsd).toBeCloseTo(10_250.25);
    expect(history.volume24hUsd).toBeCloseTo(1_250.25);
    expect(history.points.some((point) => point.volumeUsd === 0)).toBe(false);
    const stored = await snapshots.load();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.combined24hUsd).toBeCloseTo(10_250.25);
    expect(stored[0]?.publicEquity24hUsd).toBeCloseTo(1_250.25);
    expect(stored[0]?.etfIndex24hUsd).toBe(9_000);
  });

  it("keeps prior DexScreener snapshot days and does not invent Gecko history when OHLCV fails", async () => {
    const priorT = Date.UTC(2026, 8, 14) / 1000;
    const snapshots = new MemoryDeskVolumeSnapshotStore([
      {
        date: "2026-09-14",
        t: priorT,
        publicEquity24hUsd: 10,
        private24hUsd: null,
        etfIndex24hUsd: null,
        combined24hUsd: 10,
        publicMintCount: 1,
        publicPoolCount: 1,
        generatedAt: "2026-09-14T12:00:00.000Z",
      },
    ]);
    const urls: string[] = [];
    const source = testSource({
      requestGapMs: 0,
      enableGeckoTerminal: true,
      geckoTerminalBaseUrl: "https://api.geckoterminal.com/api/v2",
      volumeSnapshotStore: snapshots,
      fetchImpl: async (input) => {
        const url = String(input);
        urls.push(url);
        if (url.includes("/latest/dex/search")) return jsonResponse({ pairs: [tslaPair()] });
        if (url.includes("/ohlcv/")) return jsonResponse({ error: "nope" }, 429);
        if (url.includes("/tokens/v1/solana/")) return jsonResponse([tslaPair()]);
        return jsonResponse({ unexpected: true }, 404);
      },
    });
    const history = await source.getEquityVolumeHistory();
    expect(urls.some((url) => url.includes("/ohlcv/"))).toBe(false);
    expect(history.available).toBe(true);
    expect(history.points[0]).toEqual({ t: priorT, volumeUsd: 10, kind: "calendar_day" });
    const latest = history.points[history.points.length - 1];
    expect(latest?.kind).toBe("rolling_24h");
    expect(latest?.volumeUsd).toBeCloseTo(1_250.25);
    expect(history.points.some((point) => point.kind === "calendar_day" && point.volumeUsd === 0)).toBe(false);
    expect(history.definition).toMatch(/DexScreener 24h snapshots/);
    expect(history.definition).not.toMatch(/No GeckoTerminal daily candles/);
  });

  it("loads per-mint price closes from GeckoTerminal and never treats volume as price", async () => {
    const urls: string[] = [];
    const source = testSource({
      requestGapMs: 0,
      enableGeckoTerminal: true,
      geckoTerminalBaseUrl: "https://api.geckoterminal.com/api/v2",
      fetchImpl: async (input) => {
        const url = String(input);
        urls.push(url);
        if (url.includes("/latest/dex/search")) return jsonResponse({ pairs: [tslaPair()] });
        if (url.includes("/tokens/v1/solana/")) return jsonResponse([tslaPair()]);
        if (url.includes("/token-pairs/v1/solana/")) return jsonResponse([tslaPair()]);
        if (url.includes("/ohlcv/day") && url.includes("pair-1")) {
          return jsonResponse({
            data: {
              attributes: {
                ohlcv_list: [
                  [1_700_000_000, 90, 110, 80, 100.5, 9_999],
                  [1_700_086_400, 100, 120, 95, 108, 40],
                ],
              },
            },
          });
        }
        if (url.includes("/ohlcv/hour") && url.includes("pair-1")) {
          return jsonResponse({
            data: {
              attributes: {
                ohlcv_list: [[1_700_086_400, 107, 109, 106, 108.2, 12]],
              },
            },
          });
        }
        return jsonResponse({ unexpected: true }, 404);
      },
    });

    const history = await source.getAssetPriceHistory("solana", "TSLAx");
    expect(history.available).toBe(true);
    expect(history.pairAddress).toBe("pair-1");
    expect(history.daily.map((point) => point.priceUsd)).toEqual([100.5, 108]);
    expect(history.hourly).toEqual([{ t: 1_700_086_400, priceUsd: 108.2 }]);
    expect(history.daily.some((point) => point.priceUsd === 9_999)).toBe(false);
    expect(history.dailyVolume).toEqual([
      { t: 1_700_000_000, volumeUsd: 9_999 },
      { t: 1_700_086_400, volumeUsd: 40 },
    ]);
    expect(history.hourlyVolume).toEqual([{ t: 1_700_086_400, volumeUsd: 12 }]);
    expect(urls.some((url) => url.includes("/ohlcv/day") && url.includes("pair-1"))).toBe(true);
    expect(urls.some((url) => url.includes("/ohlcv/hour") && url.includes("pair-1"))).toBe(true);
  });

  it("fails closed when GeckoTerminal price candles are missing", async () => {
    const source = testSource({
      requestGapMs: 0,
      enableGeckoTerminal: true,
      geckoTerminalBaseUrl: "https://api.geckoterminal.com/api/v2",
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("/latest/dex/search")) return jsonResponse({ pairs: [tslaPair()] });
        if (url.includes("/tokens/v1/solana/")) return jsonResponse([tslaPair()]);
        if (url.includes("/ohlcv/")) return jsonResponse({ error: "nope" }, 429);
        return jsonResponse({ unexpected: true }, 404);
      },
    });
    const history = await source.getAssetPriceHistory("solana", "TSLAx");
    expect(history.available).toBe(false);
    expect(history.daily).toEqual([]);
    expect(history.hourly).toEqual([]);
    expect(history.dailyVolume).toEqual([]);
    expect(history.hourlyVolume).toEqual([]);
    expect(history.emptyReason).toMatch(/did not return usable USD closes/i);
  });

  it("prefers DexScreener base imageUrl and falls back to mint-keyed Jupiter/xStocks logos", async () => {
    const urls: string[] = [];
    const pairLogo = "https://dd.dexscreener.com/ds-data/tokens/solana/tsla.png";
    const catalogLogo = "https://xstocks-metadata.backed.fi/logos/tokens/NFLXx.png";
    const jupiterLogo = "https://xstocks-metadata.backed.fi/logos/tokens/HOODx.png";
    const hoodPair = {
      chainId: "solana",
      dexId: "raydium",
      pairAddress: "pair-hood",
      baseToken: { address: hoodMint, name: "Robinhood xStock", symbol: "HOODx" },
      quoteToken: { address: "usdc", name: "USDC", symbol: "USDC" },
      volume: { h24: 40 },
      liquidity: { usd: 12 },
    };
    const source = testSource({
      requestGapMs: 0,
      enableRegistry: true,
      enableJupiterTokenLogos: true,
      jupiterTokenBaseUrl: "https://lite-api.jup.ag/tokens/v2",
      registryBaseUrl: "https://api.xstocks.fi/api/v2",
      fetchImpl: async (input) => {
        const url = String(input);
        urls.push(url);
        if (url.includes("/latest/dex/search")) {
          return jsonResponse({
            pairs: [{ ...tslaPair(), info: { imageUrl: pairLogo } }, hoodPair],
          });
        }
        if (url.includes("/public/assets")) {
          return jsonResponse({
            nodes: [
              {
                name: "Netflix xStock",
                symbol: "NFLXx",
                logo: catalogLogo,
                deployments: [{ network: "Solana", address: unpairedMint }],
              },
            ],
            page: { hasNextPage: false },
          });
        }
        if (url.includes("/tokens/v2/search")) {
          expect(decodeURIComponent(url)).toContain(hoodMint);
          return jsonResponse([
            { id: hoodMint, symbol: "HOODx", icon: jupiterLogo },
            { id: "So11111111111111111111111111111111111111112", symbol: "SOL", icon: "https://example.com/sol.png" },
            { id: tslaMint, symbol: "TSLAx", icon: "https://example.com/should-not-override.png" },
          ]);
        }
        if (url.includes("/tokens/v1/solana/") || url.includes("/token-pairs/v1/solana/")) {
          if (url.includes(hoodMint)) return jsonResponse([hoodPair]);
          return jsonResponse([{ ...tslaPair(), info: { imageUrl: pairLogo } }]);
        }
        return jsonResponse({ unexpected: true }, 404);
      },
    });

    const chain = await source.getChain("solana");
    expect(chain?.assets.find((asset) => asset.contractAddress === tslaMint)?.logoUrl).toBe(pairLogo);
    expect(chain?.assets.find((asset) => asset.contractAddress === unpairedMint)?.logoUrl).toBe(catalogLogo);
    expect(chain?.assets.find((asset) => asset.contractAddress === hoodMint)?.logoUrl).toBe(jupiterLogo);
    expect(urls.some((url) => url.includes("/tokens/v2/search"))).toBe(true);
    expect(urls.some((url) => url.includes("example.com/sol.png"))).toBe(false);
  });

  it("loads hourly Gecko volume for card sparklines and omits a one-point series", async () => {
    const now = Math.floor(Date.now() / 1000);
    const urls: string[] = [];
    const source = testSource({
      requestGapMs: 0,
      enableGeckoTerminal: true,
      geckoTerminalBaseUrl: "https://api.geckoterminal.com/api/v2",
      fetchImpl: async (input) => {
        const url = String(input);
        urls.push(url);
        if (url.includes("/latest/dex/search")) return jsonResponse({ pairs: [tslaPair()] });
        if (url.includes("/tokens/v1/solana/")) return jsonResponse([tslaPair()]);
        if (url.includes("/token-pairs/v1/solana/")) return jsonResponse([tslaPair()]);
        if (url.includes("/ohlcv/hour") && url.includes("pair-1")) {
          return jsonResponse({
            data: {
              attributes: {
                ohlcv_list: [
                  [now - 7200, 100, 101, 99, 100.5, 40],
                  [now - 3600, 100, 102, 99, 101, 18],
                  [now - 60, 101, 103, 100, 102, 22],
                ],
              },
            },
          });
        }
        return jsonResponse({ unexpected: true }, 404);
      },
    });

    const series = await source.getEquityCardDayVolumeSeries();
    expect(series[tslaMint]?.map((point) => point.volumeUsd)).toEqual([40, 18, 22]);
    expect(urls.some((url) => url.includes("/ohlcv/hour") && url.includes("pair-1"))).toBe(true);
    expect(urls.some((url) => url.includes("/ohlcv/day"))).toBe(false);
  });

  it("omits card volume sparklines when Gecko hourly candles are missing", async () => {
    const source = testSource({
      requestGapMs: 0,
      enableGeckoTerminal: true,
      geckoTerminalBaseUrl: "https://api.geckoterminal.com/api/v2",
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("/latest/dex/search")) return jsonResponse({ pairs: [tslaPair()] });
        if (url.includes("/tokens/v1/solana/")) return jsonResponse([tslaPair()]);
        if (url.includes("/ohlcv/")) return jsonResponse({ error: "nope" }, 429);
        return jsonResponse({ unexpected: true }, 404);
      },
    });
    await expect(source.getEquityCardDayVolumeSeries()).resolves.toEqual({});
  });
});
