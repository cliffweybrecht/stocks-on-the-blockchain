import { afterEach, describe, expect, it } from "vitest";
import type { DexScreenerPair } from "../map-solana";
import { robinhoodSnapshotChainShell } from "../robinhood-desk-volume";
import {
  ONDO_NAMED_UNVERIFIED_LABEL,
  RHJ_ISSUER_LABEL,
  buildRobinhoodMarketLanes,
  type RobinhoodListedToken,
} from "../robinhood-markets";
import {
  advanceRobinhoodAllMarkets,
  applyRobinhoodReportedStats,
  enrichRobinhoodAssetDetail,
  geckoOhlcvBaseMatchesMint,
  loadRobinhoodAssetPriceHistory,
  parseGeckoRobinhoodHolderCount,
  parseGeckoRobinhoodTotalSupply,
  resetRobinhoodAssetSeriesForTests,
  robinhoodListedIssuer,
} from "../robinhood-asset-series";
import type { AssetDetail, AssetDetailResult } from "../types";

const NVDA = "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC";
const OTHER = "0x1111111111111111111111111111111111111111";

afterEach(() => {
  resetRobinhoodAssetSeriesForTests();
});

function token(partial: Partial<RobinhoodListedToken> = {}): RobinhoodListedToken {
  return {
    address: NVDA,
    symbol: "NVDA",
    name: "NVIDIA • Robinhood Token",
    issuer: RHJ_ISSUER_LABEL,
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
    chainId: input.chainId ?? "robinhood",
    dexId: "uniswap",
    pairAddress: input.pairAddress,
    url: `https://dexscreener.com/robinhood/${input.pairAddress}`,
    baseToken: {
      address: input.baseAddress ?? NVDA,
      symbol: "NVDA",
      name: input.name ?? "NVIDIA • Robinhood Token",
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
  const asset = buildRobinhoodMarketLanes([listed], pairs, { volumeHydrated: true }).details[0];
  if (!asset) throw new Error("expected a detail");
  return asset;
}

function resultFor(asset: AssetDetail): AssetDetailResult {
  return {
    chain: { ...robinhoodSnapshotChainShell(), sourceId: "robinhood", sourceLabel: "DexScreener · Robinhood Chain" },
    asset,
    provenance: {
      sourceId: "robinhood",
      sourceLabel: "DexScreener · Robinhood Chain",
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
    meta: { base: { address: base, symbol: "NVDA" } },
  };
}

describe("Robinhood reported stats", () => {
  it("reads normalized supply and holder count and ignores market cap", () => {
    expect(
      parseGeckoRobinhoodTotalSupply({
        data: { attributes: { normalized_total_supply: "10.5", market_cap_usd: "999999", total_supply: "1e22" } },
      }),
    ).toBe(10.5);
    expect(parseGeckoRobinhoodTotalSupply({ data: { attributes: { market_cap_usd: 17_000_000 } } })).toBeNull();
    expect(parseGeckoRobinhoodHolderCount({ data: { attributes: { holders: { count: "186100" } } } })).toBe(186100);
    expect(parseGeckoRobinhoodHolderCount({ data: { attributes: {} } })).toBeNull();
    expect(geckoOhlcvBaseMatchesMint(ohlcv([[1, 1, 1, 1, 2, 3]]), NVDA)).toBe(true);
    expect(geckoOhlcvBaseMatchesMint(ohlcv([[1, 1, 1, 1, 2, 3]], OTHER), NVDA)).toBe(false);
  });

  it("prices FDV from DEX price times supply and does not invent circulating or market cap", () => {
    const asset = detail([
      pair({ pairAddress: "0xpool", volume: 10, liquidity: 50, price: 200 }),
    ]);
    const next = applyRobinhoodReportedStats(asset, { totalSupply: 10.5, holderCount: 12 });
    expect(next.totalSupply).toBe(10.5);
    expect(next.holderCount).toBe(12);
    expect(next.fdvUsd).toBe(200 * 10.5);
    expect(next.circulatingSupply).toBeNull();
    expect(next.marketCapUsd).toBeNull();

    const blank = applyRobinhoodReportedStats(asset, { totalSupply: null, holderCount: null });
    expect(blank.fdvUsd).toBeNull();
    expect(blank.totalSupply).toBeNull();
  });

  it("keeps Ondo-named tokens unverified", () => {
    expect(
      robinhoodListedIssuer({ issuer: "Ondo", name: "NVIDIA Tokenized Stock (Ondo)" }),
    ).toBe(ONDO_NAMED_UNVERIFIED_LABEL);
    expect(robinhoodListedIssuer({ issuer: RHJ_ISSUER_LABEL, name: "NVIDIA • Robinhood Token" })).toBe(
      RHJ_ISSUER_LABEL,
    );
  });
});

describe("enrichRobinhoodAssetDetail", () => {
  it("sums every DexScreener pool and keeps Gecko market cap out of the statistics", async () => {
    const listed = token({
      name: "NVIDIA Tokenized Stock (Ondo)",
      issuer: ONDO_NAMED_UNVERIFIED_LABEL,
      symbol: "NVDAON",
    });
    const urls: string[] = [];
    const enriched = await enrichRobinhoodAssetDetail(
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

    expect(enriched.asset.issuer).toBe(ONDO_NAMED_UNVERIFIED_LABEL);
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
    expect(urls.some((url) => url.includes("/networks/robinhood/tokens/"))).toBe(true);
  });

  it("keeps the shell asset when DexScreener and Gecko both fail", async () => {
    const asset = detail([pair({ pairAddress: "0xone", volume: 4, liquidity: 9, price: 20 })]);
    const enriched = await enrichRobinhoodAssetDetail(resultFor(asset), {
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

describe("loadRobinhoodAssetPriceHistory", () => {
  it("uses Robinhood network candles and skips a pool whose base is a different token", async () => {
    const asset = detail([
      pair({ pairAddress: "0xwrong", volume: 30, price: 1 }),
      pair({ pairAddress: "0xright", volume: 10, price: 240 }),
    ]);
    const urls: string[] = [];
    const history = await loadRobinhoodAssetPriceHistory(asset, {
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
    expect(urls.every((url) => url.includes("/networks/robinhood/pools/"))).toBe(true);
    expect(history.dailyVolume).toEqual([{ t: 1_700_000_000, volumeUsd: 1000 }]);
  });

  it("does not invent points when Gecko returns nothing usable", async () => {
    const asset = detail([pair({ pairAddress: "0xpool", volume: 1, price: 10 })]);
    const history = await loadRobinhoodAssetPriceHistory(asset, {
      geckoBaseUrl: "https://gecko.example/api/v2",
      fetchImpl: async () => jsonResponse({ data: { attributes: { ohlcv_list: [] } } }, 200),
    });
    expect(history.available).toBe(false);
    expect(history.daily).toEqual([]);
    expect(history.hourly).toEqual([]);
    expect(history.dailyVolume).toEqual([]);
    expect(history.hourlyVolume).toEqual([]);
    expect(history.emptyReason).toMatch(/does not invent|did not return/i);
  });
});

describe("advanceRobinhoodAllMarkets", () => {
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

    const first = await advanceRobinhoodAllMarkets(asset, options);
    expect(first.pending).toBe(true);
    expect(first.complete).toBe(false);
    expect(first.daily).toEqual([]);
    expect(first.resolvedPools).toBe(1);
    expect(first.totalPools).toBe(2);

    const second = await advanceRobinhoodAllMarkets(asset, options);
    expect(second.complete).toBe(true);
    expect(second.pending).toBe(false);
    expect(second.daily).toEqual([{ t: 1_700_000_000, volumeUsd: 140 }]);

    const third = await advanceRobinhoodAllMarkets(asset, options);
    expect(third.hourlyComplete).toBe(false);
    const fourth = await advanceRobinhoodAllMarkets(asset, options);
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
    await advanceRobinhoodAllMarkets(asset, options);
    const done = await advanceRobinhoodAllMarkets(asset, options);
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
    const cooled = await advanceRobinhoodAllMarkets(asset, options);
    expect(cooled.pending).toBe(true);
    expect(cooled.daily).toEqual([]);
    expect(cooled.resolvedPools).toBe(0);

    const stillCooling = await advanceRobinhoodAllMarkets(asset, { ...options, nowMs: 2_000 });
    expect(stillCooling.resolvedPools).toBe(0);
    expect(calls).toBe(1);

    const ready = await advanceRobinhoodAllMarkets(asset, { ...options, nowMs: 40_000 });
    expect(ready.complete).toBe(true);
    expect(ready.daily).toEqual([{ t: 1_700_000_000, volumeUsd: 80 }]);
  });
});
