import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { writeAllMarketsProgress } from "../all-markets-volume-cache";
import { BACKPACK_SUNRISE_BATCH_TICKERS, DEFAULT_SOLANA_DISCOVERY_QUERIES } from "../solana-discover";
import { SolanaMarketDataSource, type SolanaMarketDataSourceOptions } from "../solana-source";
import { MemoryDeskVolumeSnapshotStore } from "../volume-snapshots";

const tslaMint = "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB";
const hoodMint = "XsNotAllowlisted1111111111111111111111111";
const spyMint = "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W";
const unpairedMint = "XsUnpairedHood111111111111111111111111111";

async function removeCacheDir(directory: string) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await rm(directory, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? (error as { code?: string }).code : undefined;
      if (code !== "ENOTEMPTY" || attempt === 7) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}

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
    cardVolumeSeriesGapMs: 0,
    cardVolumeSeriesSlowGapMs: 0,
    cardVolumeSeriesCooldownMs: 0,
    cardVolumeSeriesRetries: 0,
    cardVolumeSeriesSparseCacheMs: 0,
    cardVolumeSeriesTransientRetryMs: 0,
    discoveryQueries: ["xStock"],
    enableRegistry: false,
    enableOndoRegistry: false,
    enableTesseraRegistry: false,
    enableSunriseRegistry: false,
    enableGeckoTerminal: false,
    enableJupiterTokenLogos: false,
    backgroundEnrichment: false,
    volumeSnapshotStore: new MemoryDeskVolumeSnapshotStore(),
    allMarketsVolumeCacheDir: null,
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

  it("keeps the detail chart on the primary pool and fills all-markets daily volume in the background", async () => {
    const urls: string[] = [];
    const day = 1_700_000_000;
    const source = testSource({
      requestGapMs: 0,
      enableGeckoTerminal: true,
      geckoTerminalBaseUrl: "https://api.geckoterminal.com/api/v2",
      fetchImpl: async (input) => {
        const url = String(input);
        urls.push(url);
        if (url.includes("/latest/dex/search")) return jsonResponse({ pairs: [tslaPair()] });
        if (url.includes("/tokens/v1/solana/") || url.includes("/token-pairs/v1/solana/")) {
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
        if (url.includes("/ohlcv/day") && url.includes("pair-1")) {
          return jsonResponse({
            meta: { base: { address: tslaMint } },
            data: { attributes: { ohlcv_list: [[day, 1, 1, 1, 100, 4_000], [day + 86_400, 1, 1, 1, 100, 1_000]] } },
          });
        }
        if (url.includes("/ohlcv/hour") && url.includes("pair-1")) {
          return jsonResponse({
            meta: { base: { address: tslaMint } },
            data: { attributes: { ohlcv_list: [[day, 1, 1, 1, 100, 12]] } },
          });
        }
        if (url.includes("/ohlcv/day") && url.includes("pair-2")) {
          return jsonResponse({
            data: { attributes: { ohlcv_list: [[day, 1, 1, 1, 100, 7_000]] } },
          });
        }
        return jsonResponse({ unexpected: true }, 404);
      },
    });

    const history = await source.getAssetPriceHistory("solana", "TSLAx");
    expect(history.pairAddress).toBe("pair-1");
    const chartOhlcv = urls.filter((url) => url.includes("/ohlcv/"));
    expect(chartOhlcv.some((url) => url.includes("pair-2"))).toBe(false);

    const first = await source.getAssetAllMarketsVolumeSnapshot("solana", "TSLAx");
    expect(first.pending).toBe(true);
    expect(first.complete).toBe(false);
    expect(first.daily).toEqual([]);

    const done = await vi.waitFor(async () => {
      const snap = await source.getAssetAllMarketsVolumeSnapshot("solana", "TSLAx");
      expect(snap.complete).toBe(true);
      return snap;
    });
    expect(done.pending).toBe(false);
    expect(done.resolvedPools).toBe(2);
    expect(done.totalPools).toBe(2);
    expect(done.daily).toEqual([
      { t: day, volumeUsd: 11_000 },
      { t: day + 86_400, volumeUsd: 1_000 },
    ]);
    expect(urls.some((url) => url.includes("/ohlcv/day") && url.includes("pair-2"))).toBe(true);
    expect(done.hourlyComplete).toBe(false);
    expect(done.hourly).toEqual([]);
  });

  it("sums hourly candles into the 24H series after the daily snapshot is already complete", async () => {
    const day = 1_700_000_000;
    const hour = day + 3_600;
    const source = testSource({
      requestGapMs: 0,
      enableGeckoTerminal: true,
      geckoTerminalBaseUrl: "https://api.geckoterminal.com/api/v2",
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("/latest/dex/search") || url.includes("/tokens/v1/solana/") || url.includes("/token-pairs/v1/solana/")) {
          return jsonResponse([
            tslaPair(),
            { ...tslaPair(), dexId: "orca", pairAddress: "pair-2", volume: { h24: 4_000_000 }, liquidity: { usd: 100 } },
          ]);
        }
        if (url.includes("/ohlcv/day") && url.includes("limit=60") && url.includes("pair-1")) {
          return jsonResponse({
            data: { attributes: { ohlcv_list: [[day, 1, 1, 1, 100, 1_000]] } },
          });
        }
        if (url.includes("/ohlcv/day") && url.includes("limit=60") && url.includes("pair-2")) {
          return jsonResponse({
            data: { attributes: { ohlcv_list: [[day, 1, 1, 1, 100, 7_000]] } },
          });
        }
        if (url.includes("/ohlcv/hour") && url.includes("limit=24") && url.includes("pair-1")) {
          return jsonResponse({
            data: { attributes: { ohlcv_list: [[day, 1, 1, 1, 100, 100_000], [hour, 1, 1, 1, 100, 50_000]] } },
          });
        }
        if (url.includes("/ohlcv/hour") && url.includes("limit=24") && url.includes("pair-2")) {
          return jsonResponse({
            data: { attributes: { ohlcv_list: [[day, 1, 1, 1, 100, 4_000_000]] } },
          });
        }
        return jsonResponse({ unexpected: true }, 404);
      },
    });

    const first = await source.getAssetAllMarketsVolumeSnapshot("solana", "TSLAx");
    expect(first.hourlyComplete).toBe(false);
    expect(first.hourly).toEqual([]);

    const done = await vi.waitFor(async () => {
      const snap = await source.getAssetAllMarketsVolumeSnapshot("solana", "TSLAx");
      expect(snap.hourlyComplete).toBe(true);
      return snap;
    });
    expect(done.pending).toBe(false);
    expect(done.complete).toBe(true);
    expect(done.hourlyPending).toBe(false);
    expect(done.daily).toEqual([{ t: day, volumeUsd: 8_000 }]);
    expect(done.hourly).toEqual([
      { t: day, volumeUsd: 4_100_000 },
      { t: hour, volumeUsd: 50_000 },
    ]);
  });

  it("does not label hourly all-markets when a live pool 404s, and keeps the daily total", async () => {
    const directory = await mkdtemp(join(tmpdir(), "all-markets-hour-miss-"));
    const day = 1_700_000_000;
    const source = testSource({
      requestGapMs: 0,
      enableGeckoTerminal: true,
      geckoTerminalBaseUrl: "https://api.geckoterminal.com/api/v2",
      allMarketsVolumeCacheDir: directory,
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("/latest/dex/search") || url.includes("/tokens/v1/solana/") || url.includes("/token-pairs/v1/solana/")) {
          return jsonResponse([
            tslaPair(),
            { ...tslaPair(), dexId: "orca", pairAddress: "pair-2", volume: { h24: 10 }, liquidity: { usd: 100 } },
          ]);
        }
        if (url.includes("/ohlcv/day") && url.includes("limit=60")) {
          return jsonResponse({
            data: { attributes: { ohlcv_list: [[day, 1, 1, 1, 100, url.includes("pair-2") ? 7_000 : 4_000]] } },
          });
        }
        if (url.includes("/ohlcv/hour") && url.includes("pair-1")) {
          return jsonResponse({
            data: { attributes: { ohlcv_list: [[day, 1, 1, 1, 100, 100]] } },
          });
        }
        if (url.includes("/ohlcv/hour") && url.includes("pair-2")) {
          return jsonResponse({ error: "missing" }, 404);
        }
        return jsonResponse({ unexpected: true }, 404);
      },
    });

    try {
      const done = await vi.waitFor(async () => {
        const snap = await source.getAssetAllMarketsVolumeSnapshot("solana", "TSLAx");
        expect(snap.complete).toBe(true);
        expect(snap.hourlyPending).toBe(false);
        return snap;
      });
      expect(done.hourlyComplete).toBe(false);
      expect(done.hourly).toEqual([]);
      expect(done.daily).toEqual([{ t: day, volumeUsd: 11_000 }]);
      const cached = JSON.parse(await readFile(join(directory, `${tslaMint}.json`), "utf8")) as {
        hourly?: unknown;
      };
      expect(cached.hourly).toBeUndefined();
    } finally {
      await removeCacheDir(directory);
    }
  });

  it("resumes the hourly series across a Gecko 429 without refetching resolved pools", async () => {
    const directory = await mkdtemp(join(tmpdir(), "all-markets-hour-429-"));
    const day = 1_700_000_000;
    let pair2HourCalls = 0;
    let pair1HourCalls = 0;
    const pair2Hold: { release: (() => void) | null } = { release: null };
    const pair2Gate = new Promise<void>((resolve) => {
      pair2Hold.release = resolve;
    });
    const source = testSource({
      requestGapMs: 0,
      enableGeckoTerminal: true,
      geckoTerminalBaseUrl: "https://api.geckoterminal.com/api/v2",
      allMarketsVolumeCacheDir: directory,
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("/latest/dex/search") || url.includes("/tokens/v1/solana/") || url.includes("/token-pairs/v1/solana/")) {
          return jsonResponse([
            tslaPair(),
            { ...tslaPair(), dexId: "orca", pairAddress: "pair-2", volume: { h24: 10 }, liquidity: { usd: 100 } },
          ]);
        }
        if (url.includes("/ohlcv/day") && url.includes("limit=60")) {
          return jsonResponse({
            data: { attributes: { ohlcv_list: [[day, 1, 1, 1, 100, url.includes("pair-2") ? 7_000 : 4_000]] } },
          });
        }
        if (url.includes("/ohlcv/hour") && url.includes("limit=24") && url.includes("pair-1")) {
          pair1HourCalls += 1;
          return jsonResponse({
            data: { attributes: { ohlcv_list: [[day, 1, 1, 1, 100, 100_000]] } },
          });
        }
        if (url.includes("/ohlcv/hour") && url.includes("limit=24") && url.includes("pair-2")) {
          pair2HourCalls += 1;
          if (pair2HourCalls === 1) {
            return new Response(JSON.stringify({ error: "slow down" }), {
              status: 429,
              headers: { "content-type": "application/json", "retry-after": "0" },
            });
          }
          await pair2Gate;
          return jsonResponse({
            data: { attributes: { ohlcv_list: [[day, 1, 1, 1, 100, 4_000_000]] } },
          });
        }
        return jsonResponse({ unexpected: true }, 404);
      },
    });

    try {
      const mid = await vi.waitFor(async () => {
        const snap = await source.getAssetAllMarketsVolumeSnapshot("solana", "TSLAx");
        expect(snap.complete).toBe(true);
        expect(snap.hourlyPending).toBe(true);
        expect(snap.hourlyComplete).toBe(false);
        expect(snap.hourlyResolvedPools).toBe(1);
        expect(snap.daily).toEqual([{ t: day, volumeUsd: 11_000 }]);
        expect(pair2HourCalls).toBeGreaterThanOrEqual(1);
        return snap;
      });
      expect(mid.hourly).toEqual([]);
      expect(pair1HourCalls).toBe(1);
      const progress = JSON.parse(await readFile(join(directory, `${tslaMint}.hourly.progress.json`), "utf8")) as {
        pools: { pairAddress: string }[];
      };
      expect(progress.pools.map((pool) => pool.pairAddress)).toEqual(["pair-1"]);
      const before = JSON.parse(await readFile(join(directory, `${tslaMint}.json`), "utf8")) as { hourly?: unknown };
      expect(before.hourly).toBeUndefined();

      pair2Hold.release?.();
      const done = await vi.waitFor(
        async () => {
          const snap = await source.getAssetAllMarketsVolumeSnapshot("solana", "TSLAx");
          expect(snap.hourlyComplete).toBe(true);
          return snap;
        },
        { timeout: 3_000 },
      );
      expect(done.hourly).toEqual([{ t: day, volumeUsd: 4_100_000 }]);
      expect(done.daily).toEqual([{ t: day, volumeUsd: 11_000 }]);
      expect(pair1HourCalls).toBe(1);
      const cached = JSON.parse(await readFile(join(directory, `${tslaMint}.json`), "utf8")) as {
        hourly: { t: number; volumeUsd: number }[];
      };
      expect(cached.hourly).toEqual(done.hourly);
      await expect(readFile(join(directory, `${tslaMint}.hourly.progress.json`), "utf8")).rejects.toThrow();
    } finally {
      pair2Hold.release?.();
      await removeCacheDir(directory);
    }
  });

  it("resumes an all-markets fill across a Gecko 429 and writes the cache when every pool resolves", async () => {
    const day = 1_700_000_000;
    const directory = await mkdtemp(join(tmpdir(), "all-markets-"));
    let pair2Calls = 0;
    const pair2Hold: { release: (() => void) | null } = { release: null };
    const pair2Gate = new Promise<void>((resolve) => {
      pair2Hold.release = resolve;
    });
    const urls: string[] = [];
    const source = testSource({
      requestGapMs: 0,
      enableGeckoTerminal: true,
      geckoTerminalBaseUrl: "https://api.geckoterminal.com/api/v2",
      allMarketsVolumeCacheDir: directory,
      fetchImpl: async (input) => {
        const url = String(input);
        urls.push(url);
        if (url.includes("/latest/dex/search") || url.includes("/tokens/v1/solana/") || url.includes("/token-pairs/v1/solana/")) {
          return jsonResponse([
            tslaPair(),
            { ...tslaPair(), dexId: "orca", pairAddress: "pair-2", volume: { h24: 10 }, liquidity: { usd: 100 } },
          ]);
        }
        if (url.includes("/ohlcv/day") && url.includes("limit=60") && url.includes("pair-1")) {
          return jsonResponse({
            data: { attributes: { ohlcv_list: [[day, 1, 1, 1, 100, 4_000], [day + 86_400, 1, 1, 1, 100, 1_000]] } },
          });
        }
        if (url.includes("/ohlcv/day") && url.includes("limit=60") && url.includes("pair-2")) {
          pair2Calls += 1;
          if (pair2Calls === 1) {
            return new Response(JSON.stringify({ error: "slow down" }), {
              status: 429,
              headers: { "content-type": "application/json", "retry-after": "0" },
            });
          }
          await pair2Gate;
          return jsonResponse({
            data: { attributes: { ohlcv_list: [[day, 1, 1, 1, 100, 7_000]] } },
          });
        }
        return jsonResponse({ unexpected: true }, 404);
      },
    });

    try {
      const first = await source.getAssetAllMarketsVolumeSnapshot("solana", "TSLAx");
      expect(first.pending).toBe(true);
      expect(first.complete).toBe(false);
      expect(first.daily).toEqual([]);

      const mid = await vi.waitFor(async () => {
        const snap = await source.getAssetAllMarketsVolumeSnapshot("solana", "TSLAx");
        expect(snap.pending).toBe(true);
        expect(snap.complete).toBe(false);
        expect(snap.daily).toEqual([]);
        expect(snap.resolvedPools).toBe(1);
        expect(snap.totalPools).toBe(2);
        expect(pair2Calls).toBeGreaterThanOrEqual(1);
        return snap;
      });
      expect(mid.resolvedPools).toBe(1);

      const progress = JSON.parse(await readFile(join(directory, `${tslaMint}.progress.json`), "utf8")) as {
        pools: { pairAddress: string; status: string }[];
      };
      expect(progress.pools.map((pool) => pool.pairAddress)).toEqual(["pair-1"]);
      await expect(readFile(join(directory, `${tslaMint}.json`), "utf8")).rejects.toThrow();

      pair2Hold.release?.();
      const done = await vi.waitFor(
        async () => {
          const snap = await source.getAssetAllMarketsVolumeSnapshot("solana", "TSLAx");
          expect(snap.complete).toBe(true);
          return snap;
        },
        { timeout: 3_000 },
      );
      expect(done.pending).toBe(false);
      expect(done.resolvedPools).toBe(2);
      expect(done.daily).toEqual([
        { t: day, volumeUsd: 11_000 },
        { t: day + 86_400, volumeUsd: 1_000 },
      ]);
      const cached = JSON.parse(await readFile(join(directory, `${tslaMint}.json`), "utf8")) as {
        daily: { t: number; volumeUsd: number }[];
      };
      expect(cached.daily).toEqual(done.daily);
      await expect(readFile(join(directory, `${tslaMint}.progress.json`), "utf8")).rejects.toThrow();
    } finally {
      pair2Hold.release?.();
      await removeCacheDir(directory);
    }
  });

  it("does not write an all-markets cache when a live pool is a definitive Gecko miss", async () => {
    const directory = await mkdtemp(join(tmpdir(), "all-markets-miss-"));
    const source = testSource({
      requestGapMs: 0,
      enableGeckoTerminal: true,
      geckoTerminalBaseUrl: "https://api.geckoterminal.com/api/v2",
      allMarketsVolumeCacheDir: directory,
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("/latest/dex/search") || url.includes("/tokens/v1/solana/") || url.includes("/token-pairs/v1/solana/")) {
          return jsonResponse([
            tslaPair(),
            { ...tslaPair(), dexId: "orca", pairAddress: "pair-2", volume: { h24: 10 }, liquidity: { usd: 100 } },
          ]);
        }
        if (url.includes("/ohlcv/day") && url.includes("limit=60") && url.includes("pair-1")) {
          return jsonResponse({
            data: { attributes: { ohlcv_list: [[1_700_000_000, 1, 1, 1, 100, 4_000]] } },
          });
        }
        if (url.includes("/ohlcv/day") && url.includes("limit=60") && url.includes("pair-2")) {
          return jsonResponse({ error: "missing" }, 404);
        }
        return jsonResponse({ unexpected: true }, 404);
      },
    });

    try {
      const done = await vi.waitFor(async () => {
        const snap = await source.getAssetAllMarketsVolumeSnapshot("solana", "TSLAx");
        expect(snap.pending).toBe(false);
        expect(snap.totalPools).toBe(2);
        return snap;
      });
      expect(done.complete).toBe(false);
      expect(done.daily).toEqual([]);
      expect(done.resolvedPools).toBe(2);
      await expect(readFile(join(directory, `${tslaMint}.json`), "utf8")).rejects.toThrow();
    } finally {
      await removeCacheDir(directory);
    }
  });

  it("continues an all-markets fill from saved pool progress without refetching resolved pools", async () => {
    const day = 1_700_000_000;
    const directory = await mkdtemp(join(tmpdir(), "all-markets-resume-"));
    const urls: string[] = [];
    await writeAllMarketsProgress({
      directory,
      mint: tslaMint,
      pairAddresses: ["pair-1", "pair-2"],
      pools: [
        {
          pairAddress: "pair-1",
          status: "points",
          points: [
            { t: day, volumeUsd: 4_000 },
            { t: day + 86_400, volumeUsd: 1_000 },
          ],
        },
      ],
    });
    const source = testSource({
      requestGapMs: 0,
      enableGeckoTerminal: true,
      geckoTerminalBaseUrl: "https://api.geckoterminal.com/api/v2",
      allMarketsVolumeCacheDir: directory,
      fetchImpl: async (input) => {
        const url = String(input);
        urls.push(url);
        if (url.includes("/latest/dex/search") || url.includes("/tokens/v1/solana/") || url.includes("/token-pairs/v1/solana/")) {
          return jsonResponse([
            tslaPair(),
            { ...tslaPair(), dexId: "orca", pairAddress: "pair-2", volume: { h24: 10 }, liquidity: { usd: 100 } },
          ]);
        }
        if (url.includes("/ohlcv/day") && url.includes("limit=60") && url.includes("pair-2")) {
          return jsonResponse({
            data: { attributes: { ohlcv_list: [[day, 1, 1, 1, 100, 7_000]] } },
          });
        }
        return jsonResponse({ unexpected: true }, 404);
      },
    });

    try {
      const first = await source.getAssetAllMarketsVolumeSnapshot("solana", "TSLAx");
      expect(first.pending).toBe(true);
      expect(first.resolvedPools).toBe(1);
      expect(first.totalPools).toBe(2);
      expect(first.daily).toEqual([]);

      const done = await vi.waitFor(async () => {
        const snap = await source.getAssetAllMarketsVolumeSnapshot("solana", "TSLAx");
        expect(snap.complete).toBe(true);
        return snap;
      });
      expect(done.daily).toEqual([
        { t: day, volumeUsd: 11_000 },
        { t: day + 86_400, volumeUsd: 1_000 },
      ]);
      expect(urls.some((url) => url.includes("limit=60") && url.includes("pair-1"))).toBe(false);
      expect(urls.some((url) => url.includes("limit=60") && url.includes("pair-2"))).toBe(true);
      await expect(readFile(join(directory, `${tslaMint}.json`), "utf8")).resolves.toContain("\"volumeUsd\":11000");
    } finally {
      await removeCacheDir(directory);
    }
  });

  it("lets the detail chart use the Gecko lane before the all-markets fill retries a 429", async () => {
    const order: string[] = [];
    const source = testSource({
      requestGapMs: 0,
      enableGeckoTerminal: true,
      geckoTerminalBaseUrl: "https://api.geckoterminal.com/api/v2",
      cardVolumeSeriesCooldownMs: 300,
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("/latest/dex/search") || url.includes("/tokens/v1/solana/") || url.includes("/token-pairs/v1/solana/")) {
          return jsonResponse([tslaPair(), { ...tslaPair(), pairAddress: "pair-2", volume: { h24: 10 }, liquidity: { usd: 100 } }]);
        }
        if (url.includes("/ohlcv/") && url.includes("limit=60")) {
          order.push("fill");
          if (order.filter((kind) => kind === "fill").length === 1) {
            return new Response(JSON.stringify({ error: "slow down" }), {
              status: 429,
              headers: { "content-type": "application/json", "retry-after": "0" },
            });
          }
          return jsonResponse({
            data: { attributes: { ohlcv_list: [[1_700_000_000, 1, 1, 1, 100, 10]] } },
          });
        }
        if (url.includes("/ohlcv/")) {
          order.push("chart");
          const close = url.includes("/ohlcv/hour") ? 108.2 : 100.5;
          return jsonResponse({
            meta: { base: { address: tslaMint } },
            data: { attributes: { ohlcv_list: [[1_700_000_000, close, close, close, close, 40]] } },
          });
        }
        return jsonResponse({ unexpected: true }, 404);
      },
    });

    const first = await source.getAssetAllMarketsVolumeSnapshot("solana", "TSLAx");
    expect(first.pending).toBe(true);
    await vi.waitFor(() => {
      expect(order.includes("fill")).toBe(true);
    });
    const history = await source.getAssetPriceHistory("solana", "TSLAx");
    expect(history.available).toBe(true);
    const firstChart = order.indexOf("chart");
    const secondFill = order.indexOf("fill", order.indexOf("fill") + 1);
    expect(firstChart).toBeGreaterThan(-1);
    expect(secondFill === -1 || firstChart < secondFill).toBe(true);

    await vi.waitFor(
      async () => {
        const snap = await source.getAssetAllMarketsVolumeSnapshot("solana", "TSLAx");
        expect(snap.complete).toBe(true);
      },
      { timeout: 3_000 },
    );
  });

  it("does not take a Gecko slot for all-markets while the detail chart request is in flight", async () => {
    const chartHold: { release: (() => void) | null } = { release: null };
    const chartGate = new Promise<void>((resolve) => {
      chartHold.release = resolve;
    });
    let fillCalls = 0;
    const source = testSource({
      requestGapMs: 0,
      enableGeckoTerminal: true,
      geckoTerminalBaseUrl: "https://api.geckoterminal.com/api/v2",
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("/latest/dex/search") || url.includes("/tokens/v1/solana/") || url.includes("/token-pairs/v1/solana/")) {
          return jsonResponse([tslaPair()]);
        }
        if (url.includes("/ohlcv/") && url.includes("limit=60")) {
          fillCalls += 1;
          return jsonResponse({
            data: { attributes: { ohlcv_list: [[1_700_000_000, 1, 1, 1, 100, 4_000]] } },
          });
        }
        if (url.includes("/ohlcv/")) {
          await chartGate;
          const close = url.includes("/ohlcv/hour") ? 108.2 : 100.5;
          return jsonResponse({
            meta: { base: { address: tslaMint } },
            data: { attributes: { ohlcv_list: [[1_700_000_000, close, close, close, close, 40]] } },
          });
        }
        return jsonResponse({ unexpected: true }, 404);
      },
    });

    try {
      const historyPromise = source.getAssetPriceHistory("solana", "TSLAx");
      const snap = await source.getAssetAllMarketsVolumeSnapshot("solana", "TSLAx");
      expect(snap.pending).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(fillCalls).toBe(0);
      chartHold.release?.();
      const history = await historyPromise;
      expect(history.available).toBe(true);
      const done = await vi.waitFor(async () => {
        const next = await source.getAssetAllMarketsVolumeSnapshot("solana", "TSLAx");
        expect(next.complete).toBe(true);
        return next;
      });
      expect(done.daily).toEqual([{ t: 1_700_000_000, volumeUsd: 4_000 }]);
      expect(fillCalls).toBe(1);
    } finally {
      chartHold.release?.();
    }
  });

  it("retries a Gecko 429 for the detail chart instead of treating it as missing closes", async () => {
    let ohlcvCalls = 0;
    const source = testSource({
      requestGapMs: 0,
      enableGeckoTerminal: true,
      geckoTerminalBaseUrl: "https://api.geckoterminal.com/api/v2",
      cardVolumeSeriesRetries: 2,
      cardVolumeSeriesCooldownMs: 0,
      cardVolumeSeriesSlowGapMs: 0,
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("/latest/dex/search")) return jsonResponse({ pairs: [tslaPair()] });
        if (url.includes("/tokens/v1/solana/") || url.includes("/token-pairs/v1/solana/")) {
          return jsonResponse([tslaPair()]);
        }
        if (url.includes("/ohlcv/")) {
          ohlcvCalls += 1;
          if (ohlcvCalls <= 2) {
            return new Response(JSON.stringify({ error: "slow down" }), {
              status: 429,
              headers: { "content-type": "application/json", "retry-after": "0" },
            });
          }
          const close = url.includes("/ohlcv/hour") ? 108.2 : 100.5;
          return jsonResponse({
            meta: { base: { address: tslaMint, symbol: "TSLAx" } },
            data: {
              attributes: {
                ohlcv_list: [[1_700_000_000, close, close, close, close, 40]],
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
    expect(history.emptyReason).toBeNull();
    expect(history.daily.map((point) => point.priceUsd)).toEqual([100.5]);
    expect(history.hourly.map((point) => point.priceUsd)).toEqual([108.2]);
    expect(ohlcvCalls).toBeGreaterThan(2);
  });

  it("does not chart a pool whose Gecko OHLCV base is a different token", async () => {
    const memeMint = "memeMint111111111111111111111111111111111";
    const source = testSource({
      requestGapMs: 0,
      enableGeckoTerminal: true,
      geckoTerminalBaseUrl: "https://api.geckoterminal.com/api/v2",
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("/latest/dex/search")) {
          return jsonResponse({
            pairs: [
              tslaPair(),
              {
                ...tslaPair(),
                pairAddress: "pair-meme",
                baseToken: { address: memeMint, name: "Meme", symbol: "MEME" },
                quoteToken: { address: tslaMint, name: "Tesla xStock", symbol: "TSLAx" },
                volume: { h24: 9_000_000 },
                priceUsd: "0.00005",
              },
            ],
          });
        }
        if (url.includes("/tokens/v1/solana/") || url.includes("/token-pairs/v1/solana/")) {
          return jsonResponse([
            tslaPair(),
            {
              ...tslaPair(),
              pairAddress: "pair-meme",
              baseToken: { address: memeMint, name: "Meme", symbol: "MEME" },
              quoteToken: { address: tslaMint, name: "Tesla xStock", symbol: "TSLAx" },
              volume: { h24: 9_000_000 },
              priceUsd: "0.00005",
            },
          ]);
        }
        if (url.includes("/ohlcv/") && url.includes("pair-1")) {
          return jsonResponse({
            meta: { base: { address: memeMint, symbol: "MEME" } },
            data: { attributes: { ohlcv_list: [[1_700_000_000, 1, 1, 1, 0.00002, 10]] } },
          });
        }
        if (url.includes("/ohlcv/") && url.includes("pair-meme")) {
          const close = url.includes("/ohlcv/hour") ? 101 : 100.5;
          return jsonResponse({
            meta: { base: { address: tslaMint, symbol: "TSLAx" } },
            data: { attributes: { ohlcv_list: [[1_700_000_000, close, close, close, close, 12]] } },
          });
        }
        return jsonResponse({ unexpected: true }, 404);
      },
    });

    const history = await source.getAssetPriceHistory("solana", "TSLAx");
    expect(history.available).toBe(true);
    expect(history.pairAddress).toBe("pair-meme");
    expect(history.hourly.map((point) => point.priceUsd)).toEqual([101]);
    expect(history.daily.some((point) => point.priceUsd === 0.00002)).toBe(false);
  });

  it("stops Gecko search on a 429 instead of retrying it into the detail chart", async () => {
    const geckoStatus: number[] = [];
    const source = testSource({
      requestGapMs: 0,
      enableGeckoTerminal: true,
      geckoTerminalBaseUrl: "https://api.geckoterminal.com/api/v2",
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("/latest/dex/search")) return jsonResponse({ pairs: [tslaPair()] });
        if (url.includes("geckoterminal.com") && url.includes("search/pools")) {
          geckoStatus.push(geckoStatus.length === 0 ? 200 : 429);
          if (geckoStatus.length === 1) {
            return jsonResponse({
              data: [],
              included: [
                { type: "token", attributes: { address: tslaMint, name: "Tesla xStock", symbol: "TSLAx" } },
              ],
            });
          }
          return new Response(JSON.stringify({ error: "slow down" }), {
            status: 429,
            headers: { "content-type": "application/json", "retry-after": "0" },
          });
        }
        if (url.includes("/tokens/v1/solana/") || url.includes("/token-pairs/v1/solana/")) {
          return jsonResponse([tslaPair()]);
        }
        return jsonResponse({ unexpected: true }, 404);
      },
    });

    const chain = await source.getChain("solana");
    expect(chain?.assets.some((asset) => asset.symbol === "TSLAx")).toBe(true);
    expect(geckoStatus.filter((status) => status === 429)).toEqual([429]);
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
    const hourCalls = urls.filter((url) => url.includes("/ohlcv/hour")).length;
    await source.getEquityCardDayVolumeSeries();
    expect(urls.filter((url) => url.includes("/ohlcv/hour")).length).toBe(hourCalls);
  });

  it("retries a Gecko 429 for the card sparkline instead of dropping the pool", async () => {
    const now = Math.floor(Date.now() / 1000);
    let hourCalls = 0;
    const source = testSource({
      enableGeckoTerminal: true,
      geckoTerminalBaseUrl: "https://api.geckoterminal.com/api/v2",
      cardVolumeSeriesRetries: 2,
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("/latest/dex/search")) return jsonResponse({ pairs: [tslaPair()] });
        if (url.includes("/tokens/v1/solana/") || url.includes("/token-pairs/v1/solana/")) {
          return jsonResponse([tslaPair()]);
        }
        if (url.includes("/ohlcv/hour") && url.includes("pair-1")) {
          hourCalls += 1;
          if (hourCalls === 1) {
            return new Response(JSON.stringify({ error: "slow down" }), {
              status: 429,
              headers: { "content-type": "application/json", "retry-after": "0" },
            });
          }
          return jsonResponse({
            data: {
              attributes: {
                ohlcv_list: [
                  [now - 7200, 100, 101, 99, 100.5, 40],
                  [now - 3600, 100, 102, 99, 101, 18],
                ],
              },
            },
          });
        }
        return jsonResponse({ unexpected: true }, 404);
      },
    });

    const series = await source.getEquityCardDayVolumeSeries();
    expect(series[tslaMint]?.map((point) => point.volumeUsd)).toEqual([40, 18]);
    expect(hourCalls).toBe(2);
  });

  it("does not freeze an empty card-volume build after a rate-limited miss", async () => {
    const now = Math.floor(Date.now() / 1000);
    let hourCalls = 0;
    const source = testSource({
      enableGeckoTerminal: true,
      geckoTerminalBaseUrl: "https://api.geckoterminal.com/api/v2",
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("/latest/dex/search")) return jsonResponse({ pairs: [tslaPair()] });
        if (url.includes("/tokens/v1/solana/") || url.includes("/token-pairs/v1/solana/")) {
          return jsonResponse([tslaPair()]);
        }
        if (url.includes("/ohlcv/hour")) {
          hourCalls += 1;
          if (hourCalls === 1) return jsonResponse({ error: "nope" }, 429);
          return jsonResponse({
            data: {
              attributes: {
                ohlcv_list: [
                  [now - 7200, 1, 1, 1, 1, 4],
                  [now - 3600, 1, 1, 1, 1, 9],
                ],
              },
            },
          });
        }
        return jsonResponse({ unexpected: true }, 404);
      },
    });

    await expect(source.getEquityCardDayVolumeSeries()).resolves.toEqual({});
    const series = await source.getEquityCardDayVolumeSeries();
    expect(series[tslaMint]?.map((point) => point.volumeUsd)).toEqual([4, 9]);
    expect(hourCalls).toBe(2);
  });

  it("remembers a missing pool and does not refetch it for the card sparkline", async () => {
    let hourCalls = 0;
    const source = testSource({
      enableGeckoTerminal: true,
      geckoTerminalBaseUrl: "https://api.geckoterminal.com/api/v2",
      cardVolumeSeriesRetries: 2,
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("/latest/dex/search")) return jsonResponse({ pairs: [tslaPair()] });
        if (url.includes("/tokens/v1/solana/") || url.includes("/token-pairs/v1/solana/")) {
          return jsonResponse([tslaPair()]);
        }
        if (url.includes("/ohlcv/")) {
          hourCalls += 1;
          return jsonResponse({ error: "missing" }, 404);
        }
        return jsonResponse({ unexpected: true }, 404);
      },
    });

    await expect(source.getEquityCardDayVolumeSeries()).resolves.toEqual({});
    await expect(source.getEquityCardDayVolumeSeries()).resolves.toEqual({});
    expect(hourCalls).toBe(1);
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

  it("prices market cap and FDV from mint UI supply and ignores DexScreener caps", async () => {
    const rpcUrl = "https://rpc.example.test";
    const calls: string[] = [];
    const source = testSource({
      rpcUrl,
      fetchImpl: async (input, init) => {
        const url = String(input);
        calls.push(url);
        if (url === rpcUrl) {
          expect(init?.method).toBe("POST");
          expect(JSON.parse(String(init?.body))).toMatchObject({
            method: "getTokenSupply",
            params: [tslaMint],
          });
          return jsonResponse({
            jsonrpc: "2.0",
            result: {
              value: {
                amount: "32127242493018",
                decimals: 8,
                uiAmount: 321272.42493018,
                uiAmountString: "321818.97255174",
              },
            },
          });
        }
        const pair = { ...tslaPair(), marketCap: 225_000, fdv: 225_000 };
        if (url.includes("/latest/dex/search")) return jsonResponse({ pairs: [pair] });
        if (url.includes("/tokens/v1/solana/") || url.includes("/token-pairs/v1/solana/")) {
          return jsonResponse([pair]);
        }
        return jsonResponse({ unexpected: true }, 404);
      },
    });

    const chain = await source.getChain("solana");
    expect(chain?.assets[0]?.volume24hUsd).toBeCloseTo(1_250.25);
    expect(calls.some((url) => url === rpcUrl)).toBe(false);

    const asset = await source.getAsset("solana", "tslax");
    expect(asset?.asset.circulatingSupply).toBeCloseTo(321818.97255174);
    expect(asset?.asset.totalSupply).toBeCloseTo(321818.97255174);
    expect(asset?.asset.marketCapUsd).toBeCloseTo(100.5 * 321818.97255174);
    expect(asset?.asset.fdvUsd).toBe(asset?.asset.marketCapUsd);
    expect(asset?.asset.marketCapUsd).not.toBe(225_000);
    expect(calls.filter((url) => url === rpcUrl)).toHaveLength(1);

    const again = await source.getAsset("solana", tslaMint);
    expect(again?.asset.marketCapUsd).toBeCloseTo(100.5 * 321818.97255174);
    expect(calls.filter((url) => url === rpcUrl)).toHaveLength(1);
  });

  it("does not show a DexScreener market cap when mint supply is missing", async () => {
    const source = testSource({
      rpcUrl: "https://rpc.example.test",
      fetchImpl: async (input) => {
        const url = String(input);
        const pair = { ...tslaPair(), marketCap: 225_300, fdv: 225_300, liquidity: { usd: 4_100_000 } };
        if (url.includes("/latest/dex/search")) return jsonResponse({ pairs: [pair] });
        if (url.includes("/tokens/v1/solana/") || url.includes("/token-pairs/v1/solana/")) {
          return jsonResponse([pair]);
        }
        return jsonResponse({ error: "down" }, 502);
      },
    });

    const asset = await source.getAsset("solana", "tslax");
    expect(asset?.asset.displayedLiquidityUsd).toBe(4_100_000);
    expect(asset?.asset.volume24hUsd).toBeCloseTo(1_250.25);
    expect(asset?.asset.circulatingSupply).toBeNull();
    expect(asset?.asset.totalSupply).toBeNull();
    expect(asset?.asset.marketCapUsd).toBeNull();
    expect(asset?.asset.fdvUsd).toBeNull();
    expect(asset?.asset.holderCount).toBeNull();
  });
});
