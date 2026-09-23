import { describe, expect, it } from "vitest";
import { SolanaMarketDataSource } from "../solana-source";
import type { ChainDetailResult, ChainVolume, DataProvenance } from "../types";
import {
  formatDeskVolumeSnapshotSuccess,
  runDeskVolumeSnapshotCli,
  runDeskVolumeSnapshotJob,
} from "../volume-snapshot-job";
import { MemoryDeskVolumeSnapshotStore } from "../volume-snapshots";

const tslaMint = "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB";
const spyMint = "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
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

function mockProvenance(generatedAt = "2026-09-23T12:00:00.000Z"): DataProvenance {
  return {
    sourceId: "solana",
    sourceLabel: "Solana DexScreener",
    fetchedAt: generatedAt,
    generatedAt,
    refreshStartedAt: generatedAt,
    refreshDurationMs: 1,
    cacheStatus: "fresh",
    cacheAgeMs: 0,
    notes: [],
    sourceFailures: [],
  };
}

function mockChain(partial: {
  volume24hUsd?: number | null;
  privateVolume24hUsd?: number | null;
  etfVolume24hUsd?: number | null;
}): ChainVolume {
  return {
    id: "solana",
    name: "Solana",
    shortName: "SOL",
    nativeChainId: "solana",
    sourceId: "solana",
    sourceLabel: "Solana DexScreener",
    volume24hUsd: partial.volume24hUsd ?? null,
    displayedLiquidityUsd: null,
    usdGLiquidityUsd: null,
    assetCount: 3,
    assetsWithVolume: 2,
    assetsWithPools: 2,
    assetsStillHydrating: 0,
    assetsWithNoIndexedPools: 0,
    reportedPoolCount: 8,
    peakDexCount: 2,
    etfCount: 1,
    privateCount: 1,
    privateVolume24hUsd: partial.privateVolume24hUsd ?? null,
    etfVolume24hUsd: partial.etfVolume24hUsd ?? null,
    volumeAggregation: "all-pools",
    completenessPct: 100,
    coverageNote: "test",
  };
}

function mockDetail(partial: {
  volume24hUsd?: number | null;
  privateVolume24hUsd?: number | null;
  etfVolume24hUsd?: number | null;
  generatedAt?: string;
}): ChainDetailResult {
  return {
    chain: mockChain(partial),
    assets: [],
    provenance: mockProvenance(partial.generatedAt),
  };
}

describe("runDeskVolumeSnapshotJob", () => {
  it("records DexScreener public / private / ETF legs and omits nulls", async () => {
    const store = new MemoryDeskVolumeSnapshotStore();
    const result = await runDeskVolumeSnapshotJob({
      source: {
        getChain: async () =>
          mockDetail({ volume24hUsd: 86_200_000, privateVolume24hUsd: 8_700_000, etfVolume24hUsd: 32_100_000 }),
      },
      store,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.written).toBe(true);
      expect(result.snapshot.combined24hUsd).toBeCloseTo(127_000_000);
      expect(result.snapshot.publicEquity24hUsd).toBe(86_200_000);
      expect(result.snapshot.etfIndex24hUsd).toBe(32_100_000);
      expect(formatDeskVolumeSnapshotSuccess(result, "data/volume-snapshots/solana.json")).toMatch(
        /wrote 2026-09-23 combined=127000000/,
      );
    }
  });

  it("fails closed when getChain returns null or DexScreener 24h is all-null", async () => {
    const store = new MemoryDeskVolumeSnapshotStore();
    const missing = await runDeskVolumeSnapshotJob({
      source: { getChain: async () => null },
      store,
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.reason).toMatch(/returned null/);

    const allNull = await runDeskVolumeSnapshotJob({
      source: { getChain: async () => mockDetail({}) },
      store,
    });
    expect(allNull.ok).toBe(false);
    if (!allNull.ok) {
      expect(allNull.reason).toMatch(/all-null/);
      expect(allNull.reason).toMatch(/not \$0/);
    }
    expect(await store.load()).toEqual([]);
  });

  it("loads the Solana all-pools source the same way the desk does", async () => {
    const store = new MemoryDeskVolumeSnapshotStore();
    const urls: string[] = [];
    const source = new SolanaMarketDataSource({
      requestGapMs: 0,
      retries: 0,
      discoveryQueries: ["xStock"],
      enableRegistry: false,
      enableOndoRegistry: false,
      enableTesseraRegistry: false,
      enableSunriseRegistry: false,
      enableGeckoTerminal: false,
      backgroundEnrichment: false,
      volumeSnapshotStore: store,
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

    const result = await runDeskVolumeSnapshotJob({ source, store });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.snapshot.publicEquity24hUsd).toBeCloseTo(1_250.25);
      expect(result.snapshot.etfIndex24hUsd).toBe(9_000);
      expect(result.snapshot.combined24hUsd).toBeCloseTo(10_250.25);
    }
    expect(urls.some((url) => url.includes("/token-pairs/v1/solana/"))).toBe(true);
    expect(urls.some((url) => url.includes("/ohlcv/"))).toBe(false);
    expect(await store.load()).toHaveLength(1);
  });
});

describe("runDeskVolumeSnapshotCli", () => {
  it("exits non-zero when Solana is not enabled", async () => {
    const errors: string[] = [];
    const code = await runDeskVolumeSnapshotCli({
      env: {},
      error: (message) => errors.push(message),
    });
    expect(code).toBe(1);
    expect(errors[0]).toMatch(/SOLANA_MARKET_ENABLED/);
    expect(errors[0]).toMatch(/seed adapter/);
  });

  it("exits 0 after upserting today's DexScreener desk snapshot", async () => {
    const store = new MemoryDeskVolumeSnapshotStore();
    const logs: string[] = [];
    const code = await runDeskVolumeSnapshotCli({
      env: { SOLANA_MARKET_ENABLED: "true", SOLANA_VOLUME_SNAPSHOT_DIR: "data/volume-snapshots" },
      source: {
        getChain: async () => mockDetail({ volume24hUsd: 10, privateVolume24hUsd: null, etfVolume24hUsd: 2 }),
      },
      store,
      log: (message) => logs.push(message),
    });
    expect(code).toBe(0);
    expect(logs[0]).toMatch(/wrote 2026-09-23 combined=12 public=10 private=null etf=2/);
    expect(logs[0]).toMatch(/data\/volume-snapshots\/solana\.json/);
    expect(await store.load()).toHaveLength(1);
  });

  it("exits non-zero with a clear message when DexScreener 24h is all-null", async () => {
    const errors: string[] = [];
    const code = await runDeskVolumeSnapshotCli({
      env: { SOLANA_MARKET_ENABLED: "1" },
      source: { getChain: async () => mockDetail({}) },
      store: new MemoryDeskVolumeSnapshotStore(),
      error: (message) => errors.push(message),
    });
    expect(code).toBe(1);
    expect(errors[0]).toMatch(/all-null/);
    expect(errors[0]).toMatch(/not \$0/);
  });
});
