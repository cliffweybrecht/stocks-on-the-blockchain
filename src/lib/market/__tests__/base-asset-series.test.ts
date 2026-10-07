import { afterEach, describe, expect, it } from "vitest";
import type { DexScreenerPair } from "../map-solana";
import { BASE_DESK } from "../base-desk-volume";
import { snapshotDeskChainShell } from "../snapshot-desk-volume";
import { COINBASE_ISSUER_LABEL, buildBaseMarketLanes, type BaseListedToken } from "../base-markets";
import {
  advanceBaseAllMarkets,
  applyBaseReportedStats,
  enrichBaseAssetDetail,
  geckoOhlcvBaseMatchesMint,
  loadBaseAssetPriceHistory,
  parseGeckoBaseHolderCount,
  parseGeckoBaseTotalSupply,
  resetBaseAssetSeriesForTests,
  baseListedIssuer,
} from "../base-asset-series";
import type { AssetDetail, AssetDetailResult } from "../types";

const NVDA = "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC";
const OTHER = "0x1111111111111111111111111111111111111111";

afterEach(() => {
  resetBaseAssetSeriesForTests();
});

function token(partial: Partial<BaseListedToken> = {}): BaseListedToken {
  return {
    address: NVDA,
    symbol: "AAPLc",
    name: "Apple Inc.",
    issuer: COINBASE_ISSUER_LABEL,
    kind: "equity",
    logoUrl: null,
    ...partial,
  };
}

function pair(input: {
  pairAddress: string;
  volume?: number | null;
  liquidity?: number | null;
  price?: number | null;
  baseAddress?: string;
  name?: string;
  chainId?: string;
  pairCreatedAt?: number;
}): DexScreenerPair {
  return {
    chainId: input.chainId ?? "base",
    dexId: "uniswap",
    pairAddress: input.pairAddress,
    url: `https://dexscreener.com/base/${input.pairAddress}`,
    baseToken: {
      address: input.baseAddress ?? NVDA,
      symbol: "AAPLc",
      name: input.name ?? "Apple Inc.",
    },
    quoteToken: { address: "0xusdg", symbol: "USDG", name: "Global Dollar" },
    priceUsd: input.price ?? null,
    priceChange: { h24: input.price != null ? 0.2 : null },
    volume: { h24: input.volume ?? null },
    liquidity: { usd: input.liquidity ?? null },
    pairCreatedAt: input.pairCreatedAt,
  };
}

function detail(pairs: DexScreenerPair[], listed = token()): AssetDetail {
  const asset = buildBaseMarketLanes([listed], pairs, { volumeHydrated: true }).details[0];
  if (!asset) throw new Error("expected a detail");
  return asset;
}

function resultFor(asset: AssetDetail): AssetDetailResult {
  return {
    chain: { ...snapshotDeskChainShell(BASE_DESK), sourceId: "base", sourceLabel: "DexScreener · Base" },
    asset,
    provenance: {
      sourceId: "base",
      sourceLabel: "DexScreener · Base",
      fetchedAt: "2026-10-07T00:00:00.000Z",
      generatedAt: "2026-10-07T00:00:00.000Z",
      refreshStartedAt: null,
      refreshDurationMs: null,
      cacheStatus: "fresh",
      cacheAgeMs: 0,
      notes: [],
      sourceFailures: [],
    },
  };
}

function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function ohlcv(rows: number[][], base = NVDA.toLowerCase()) {
  return {
    data: { attributes: { ohlcv_list: rows } },
    meta: { base: { address: base, symbol: "AAPLc" } },
  };
}

describe("Base reported stats", () => {
  it("reads normalized supply and holder count and ignores market cap", () => {
    expect(
      parseGeckoBaseTotalSupply({
        data: { attributes: { normalized_total_supply: "10.5", market_cap_usd: "999999", total_supply: "1e22" } },
      }),
    ).toBe(10.5);
    expect(parseGeckoBaseTotalSupply({ data: { attributes: { market_cap_usd: 17_000_000 } } })).toBeNull();
    expect(parseGeckoBaseHolderCount({ data: { attributes: { holders: { count: "186100" } } } })).toBe(186100);
    expect(parseGeckoBaseHolderCount({ data: { attributes: {} } })).toBeNull();
    expect(geckoOhlcvBaseMatchesMint(ohlcv([[1, 1, 1, 1, 2, 3]]), NVDA)).toBe(true);
    expect(geckoOhlcvBaseMatchesMint(ohlcv([[1, 1, 1, 1, 2, 3]], OTHER), NVDA)).toBe(false);
  });

  it("prices FDV from DEX price times supply and does not invent circulating or market cap", () => {
    const asset = detail([
      pair({ pairAddress: "0xpool", volume: 10, liquidity: 50, price: 200 }),
    ]);
    const next = applyBaseReportedStats(asset, { totalSupply: 10.5, holderCount: 12 });
    expect(next.totalSupply).toBe(10.5);
    expect(next.holderCount).toBe(12);
    expect(next.fdvUsd).toBe(200 * 10.5);
    expect(next.circulatingSupply).toBeNull();
    expect(next.marketCapUsd).toBeNull();

    const blank = applyBaseReportedStats(asset, { totalSupply: null, holderCount: null });
    expect(blank.fdvUsd).toBeNull();
    expect(blank.totalSupply).toBeNull();
  });

  it("keeps the registry issuer", () => {
    expect(baseListedIssuer({ issuer: "Ondo" })).toBe("Ondo");
    expect(baseListedIssuer({ issuer: COINBASE_ISSUER_LABEL })).toBe(COINBASE_ISSUER_LABEL);
    expect(baseListedIssuer({ issuer: "  " })).toBe("");
  });
});

describe("enrichBaseAssetDetail", () => {
  it("sums every DexScreener pool and keeps Gecko market cap out of the statistics", async () => {
    const listed = token({
      name: "Apple Inc.",
      issuer: COINBASE_ISSUER_LABEL,
      symbol: "AAPLc",
    });
    const urls: string[] = [];
    const enriched = await enrichBaseAssetDetail(
      resultFor(detail([pair({ pairAddress: "0xone", volume: 1, price: 10 })], listed)),
      {
        cache: false,
        dexBaseUrl: "https://dex.example",
        geckoBaseUrl: "https://gecko.example/api/v2",
        fetchImpl: async (url) => {
          urls.push(String(url));
          if (String(url).includes("/token-pairs/")) {
            return jsonResponse([
              pair({ pairAddress: "0xbig", volume: 14, liquidity: 100, price: 240, pairCreatedAt: 1_700_000_000_000 }),
              pair({ pairAddress: "0xsmall", volume: 6, liquidity: 40, price: 230, pairCreatedAt: 1_710_000_000_000 }),
              pair({ pairAddress: "0xsol", volume: 999, chainId: "solana" }),
            ]);
          }
          if (String(url).endsWith("/info")) {
            return jsonResponse({ data: { attributes: { holders: { count: 186100 } } } });
          }
          return jsonResponse({
            data: {
              attributes: {
                normalized_total_supply: "100",
                market_cap_usd: "999999",
                fdv_usd: "888888",
              },
            },
          });
        },
      },
    );

    expect(enriched.asset.issuer).toBe(COINBASE_ISSUER_LABEL);
    expect(enriched.asset.issuer).not.toBe("Ondo");
    expect(enriched.asset.volume24hUsd).toBe(20);
    expect(enriched.asset.displayedLiquidityUsd).toBe(140);
    expect(enriched.asset.poolCount).toBe(2);
    expect(enriched.asset.pools[0]?.pairCreatedAt).toBe(1_700_000_000_000);
    expect(enriched.asset.totalSupply).toBe(100);
    expect(enriched.asset.holderCount).toBe(186100);
    expect(enriched.asset.fdvUsd).toBe(240 * 100);
    expect(enriched.asset.marketCapUsd).toBeNull();
    expect(enriched.asset.circulatingSupply).toBeNull();
    expect(urls.some((url) => url.includes("/networks/base/tokens/"))).toBe(true);
  });

  it("keeps the shell asset when DexScreener and Gecko both fail", async () => {
    const asset = detail([pair({ pairAddress: "0xone", volume: 4, liquidity: 9, price: 20 })]);
    const enriched = await enrichBaseAssetDetail(resultFor(asset), {
      cache: false,
      fetchImpl: async () => {
        throw new Error("down");
      },
    });
    expect(enriched.asset.volume24hUsd).toBe(4);
    expect(enriched.asset.displayedLiquidityUsd).toBe(9);
    expect(enriched.asset.totalSupply).toBeNull();
    expect(enriched.asset.holderCount).toBeNull();
    expect(enriched.asset.marketCapUsd).toBeNull();
  });
});

describe("loadBaseAssetPriceHistory", () => {
  it("uses Base network candles and skips a pool whose base is a different token", async () => {
    const asset = detail([
      pair({ pairAddress: "0xwrong", volume: 30, price: 1 }),
      pair({ pairAddress: "0xright", volume: 10, price: 240 }),
    ]);
    const urls: string[] = [];
    const history = await loadBaseAssetPriceHistory(asset, {
      geckoBaseUrl: "https://gecko.example/api/v2",
      fetchImpl: async (url) => {
        urls.push(String(url));
        if (String(url).includes("0xwrong")) return jsonResponse(ohlcv([[1_700_000_000, 1, 1, 1, 9, 3]], OTHER));
        if (String(url).includes("/ohlcv/day")) {
          return jsonResponse(ohlcv([[1_700_000_000, 1, 1, 1, 240, 1000]]));
        }
        return jsonResponse(ohlcv([[1_700_003_600, 1, 1, 1, 241, 50]]));
      },
    });
    expect(history.available).toBe(true);
    expect(history.pairAddress).toBe("0xright");
    expect(history.daily).toEqual([{ t: 1_700_000_000, priceUsd: 240 }]);
    expect(history.hourlyVolume).toEqual([{ t: 1_700_003_600, volumeUsd: 50 }]);
    expect(urls.every((url) => url.includes("/networks/base/pools/"))).toBe(true);
    expect(history.dailyVolume).toEqual([{ t: 1_700_000_000, volumeUsd: 1000 }]);
  });

  it("does not invent points when Gecko returns nothing usable", async () => {
    const asset = detail([pair({ pairAddress: "0xpool", volume: 1, price: 10 })]);
    const history = await loadBaseAssetPriceHistory(asset, {
      geckoBaseUrl: "https://gecko.example/api/v2",
      dexIoBaseUrl: "https://io.example",
      fetchImpl: async () => jsonResponse({ data: { attributes: { ohlcv_list: [] } } }, 200),
    });
    expect(history.available).toBe(false);
    expect(history.daily).toEqual([]);
    expect(history.hourly).toEqual([]);
    expect(history.dailyVolume).toEqual([]);
    expect(history.hourlyVolume).toEqual([]);
    expect(history.emptyReason).toMatch(/does not invent|did not return/i);
  });

  it("skips a Gecko miss and uses the next pool", async () => {
    const asset = detail([
      pair({ pairAddress: "0xmissing", volume: 30, price: 1 }),
      pair({ pairAddress: "0xright", volume: 10, price: 240 }),
    ]);
    const history = await loadBaseAssetPriceHistory(asset, {
      geckoBaseUrl: "https://gecko.example/api/v2",
      dexIoBaseUrl: "https://io.example",
      fetchImpl: async (url) => {
        if (String(url).includes("0xmissing")) return jsonResponse({ error: "missing" }, 404);
        if (String(url).includes("/ohlcv/day")) return jsonResponse(ohlcv([[1_700_000_000, 1, 1, 1, 240, 80]]));
        return jsonResponse(ohlcv([[1_700_003_600, 1, 1, 1, 241, 8]]));
      },
    });
    expect(history.available).toBe(true);
    expect(history.pairAddress).toBe("0xright");
    expect(history.daily).toEqual([{ t: 1_700_000_000, priceUsd: 240 }]);
    expect(history.dailyVolume).toEqual([{ t: 1_700_000_000, volumeUsd: 80 }]);
  });

  it("uses DexScreener bars when Gecko's primary pool has no candles", async () => {
    const asset = detail([pair({ pairAddress: "0xpool", volume: 12, price: 200 })]);
    const urls: string[] = [];
    const history = await loadBaseAssetPriceHistory(asset, {
      geckoBaseUrl: "https://gecko.example/api/v2",
      dexIoBaseUrl: "https://io.example",
      fetchImpl: async (url) => {
        urls.push(String(url));
        if (String(url).includes("/dex/chart/")) {
          const hourly = String(url).includes("res=60");
          return jsonResponse({
            bars: [
              {
                timestamp: hourly ? 1_700_003_600_000 : 1_700_000_000_000,
                closeUsd: hourly ? "241.5" : "240.5",
                volumeUsd: hourly ? "12" : "900",
              },
            ],
          });
        }
        return jsonResponse({ data: { attributes: { ohlcv_list: [] } } });
      },
    });
    expect(history.available).toBe(true);
    expect(history.sourceLabel).toMatch(/DexScreener/);
    expect(history.daily).toEqual([{ t: 1_700_000_000, priceUsd: 240.5 }]);
    expect(history.hourlyVolume).toEqual([{ t: 1_700_003_600, volumeUsd: 12 }]);
    expect(history.dailyVolume).toEqual([{ t: 1_700_000_000, volumeUsd: 900 }]);
    expect(urls.some((url) => url.includes("/dex/chart/amm/v3/base/0xpool"))).toBe(true);
  });

  it("keeps Gecko closes and fills volume from DexScreener when the candle has no volume element", async () => {
    const asset = detail([pair({ pairAddress: "0xpool", volume: 12, price: 200 })]);
    const history = await loadBaseAssetPriceHistory(asset, {
      geckoBaseUrl: "https://gecko.example/api/v2",
      dexIoBaseUrl: "https://io.example",
      fetchImpl: async (url) => {
        if (String(url).includes("/dex/chart/")) {
          const hourly = String(url).includes("res=60") && !String(url).includes("res=1440");
          return jsonResponse({
            bars: [
              {
                timestamp: hourly ? 1_700_003_600 : 1_700_000_000,
                closeUsd: "1",
                volumeUsd: hourly ? "4" : "70",
              },
            ],
          });
        }
        if (String(url).includes("/ohlcv/day")) return jsonResponse(ohlcv([[1_700_000_000, 1, 1, 1, 240]]));
        return jsonResponse(ohlcv([[1_700_003_600, 1, 1, 1, 241]]));
      },
    });
    expect(history.daily).toEqual([{ t: 1_700_000_000, priceUsd: 240 }]);
    expect(history.hourly).toEqual([{ t: 1_700_003_600, priceUsd: 241 }]);
    expect(history.dailyVolume).toEqual([{ t: 1_700_000_000, volumeUsd: 70 }]);
    expect(history.hourlyVolume).toEqual([{ t: 1_700_003_600, volumeUsd: 4 }]);
    expect(history.sourceLabel).toMatch(/GeckoTerminal/);
    expect(history.sourceLabel).toMatch(/DexScreener/);
  });
});

describe("advanceBaseAllMarkets", () => {
  it("sums closed candles only after every pool resolves", async () => {
    const asset = detail([
      pair({ pairAddress: "0xaaa", volume: 10, price: 1 }),
      pair({ pairAddress: "0xbbb", volume: 4, price: 1 }),
    ]);
    const calls: string[] = [];
    const fetchImpl = async (url: string) => {
      calls.push(url);
      const volume = url.includes("0xaaa") ? 100 : 40;
      return jsonResponse(ohlcv([[1_700_000_000, 1, 1, 1, 1, volume]]));
    };
    const options = { geckoBaseUrl: "https://gecko.example/api/v2", fetchImpl, cache: false as const };

    const first = await advanceBaseAllMarkets(asset, options);
    expect(first.pending).toBe(true);
    expect(first.complete).toBe(false);
    expect(first.daily).toEqual([]);
    expect(first.resolvedPools).toBe(1);
    expect(first.totalPools).toBe(2);

    const second = await advanceBaseAllMarkets(asset, options);
    expect(second.complete).toBe(true);
    expect(second.pending).toBe(false);
    expect(second.daily).toEqual([{ t: 1_700_000_000, volumeUsd: 140 }]);

    const third = await advanceBaseAllMarkets(asset, options);
    expect(third.hourlyComplete).toBe(false);
    const fourth = await advanceBaseAllMarkets(asset, options);
    expect(fourth.hourlyComplete).toBe(true);
    expect(fourth.hourly).toEqual([{ t: 1_700_000_000, volumeUsd: 140 }]);
    expect(calls).toHaveLength(4);
  });

  it("does not label all-markets when a live pool is a definitive Gecko miss", async () => {
    const asset = detail([
      pair({ pairAddress: "0xaaa", volume: 10, price: 1 }),
      pair({ pairAddress: "0xbbb", volume: 4, price: 1 }),
    ]);
    const fetchImpl = async (url: string) => {
      if (url.includes("0xbbb")) return jsonResponse({ error: "missing" }, 404);
      return jsonResponse(ohlcv([[1_700_000_000, 1, 1, 1, 1, 100]]));
    };
    const options = { geckoBaseUrl: "https://gecko.example/api/v2", fetchImpl };
    await advanceBaseAllMarkets(asset, options);
    const done = await advanceBaseAllMarkets(asset, options);
    expect(done.complete).toBe(false);
    expect(done.pending).toBe(false);
    expect(done.daily).toEqual([]);
  });

  it("leaves the pool open across a 429 and does not write a zero", async () => {
    const asset = detail([pair({ pairAddress: "0xaaa", volume: 10, price: 1 })]);
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      if (calls === 1) return jsonResponse({ error: "slow" }, 429, { "retry-after": "30" });
      return jsonResponse(ohlcv([[1_700_000_000, 1, 1, 1, 1, 80]]));
    };
    const options = { geckoBaseUrl: "https://gecko.example/api/v2", fetchImpl, nowMs: 1_000 };
    const cooled = await advanceBaseAllMarkets(asset, options);
    expect(cooled.pending).toBe(true);
    expect(cooled.daily).toEqual([]);
    expect(cooled.resolvedPools).toBe(0);

    const stillCooling = await advanceBaseAllMarkets(asset, { ...options, nowMs: 2_000 });
    expect(stillCooling.resolvedPools).toBe(0);
    expect(calls).toBe(1);

    const ready = await advanceBaseAllMarkets(asset, { ...options, nowMs: 40_000 });
    expect(ready.complete).toBe(true);
    expect(ready.daily).toEqual([{ t: 1_700_000_000, volumeUsd: 80 }]);
  });

  it("sums resolved pools before every pool finishes and does not price a different base", async () => {
    const asset = detail([
      pair({ pairAddress: "0xaaa", volume: 100, price: 1 }),
      pair({ pairAddress: "0xbbb", volume: 5, price: 240 }),
    ]);
    const fetchImpl = async (url: string) => {
      if (url.includes("0xaaa")) return jsonResponse(ohlcv([[1_700_000_000, 1, 1, 1, 1, 40]], OTHER));
      return jsonResponse(ohlcv([[1_700_000_000, 1, 1, 1, 240, 10]]));
    };
    const options = { geckoBaseUrl: "https://gecko.example/api/v2", fetchImpl };
    const first = await advanceBaseAllMarkets(asset, options);
    expect(first.complete).toBe(false);
    expect(first.pending).toBe(true);
    expect(first.daily).toEqual([]);
    expect(first.observedDaily).toEqual([{ t: 1_700_000_000, volumeUsd: 40 }]);
    expect(first.priceDaily).toEqual([]);

    const second = await advanceBaseAllMarkets(asset, options);
    expect(second.complete).toBe(true);
    expect(second.observedDaily).toEqual([{ t: 1_700_000_000, volumeUsd: 50 }]);
    expect(second.priceDaily).toEqual([{ t: 1_700_000_000, priceUsd: 240 }]);
    expect(second.pricePairAddress).toBe("0xbbb");
  });

  it("keeps the resolved sum when a live pool is a Gecko miss", async () => {
    const asset = detail([
      pair({ pairAddress: "0xaaa", volume: 10, price: 1 }),
      pair({ pairAddress: "0xbbb", volume: 4, price: 1 }),
    ]);
    const fetchImpl = async (url: string) => {
      if (url.includes("0xbbb")) return jsonResponse({ error: "missing" }, 404);
      return jsonResponse(ohlcv([[1_700_000_000, 1, 1, 1, 240, 100]]));
    };
    const options = { geckoBaseUrl: "https://gecko.example/api/v2", fetchImpl };
    await advanceBaseAllMarkets(asset, options);
    const done = await advanceBaseAllMarkets(asset, options);
    expect(done.complete).toBe(false);
    expect(done.pending).toBe(false);
    expect(done.daily).toEqual([]);
    expect(done.observedDaily).toEqual([{ t: 1_700_000_000, volumeUsd: 100 }]);
    expect(done.priceDaily).toEqual([{ t: 1_700_000_000, priceUsd: 240 }]);
    expect(done.hourlyPending).toBe(true);
  });
});
