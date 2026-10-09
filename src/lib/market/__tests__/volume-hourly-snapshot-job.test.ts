import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SolanaMarketDataSource } from "../solana-source";
import type { ChainDetailResult, ChainVolume, DataProvenance } from "../types";
import {
  formatDeskHourlyVolumeSnapshotSuccess,
  readHourlyTargetHour,
  runDeskHourlyVolumeSnapshotCli,
  runDeskHourlyVolumeSnapshotJob,
} from "../volume-hourly-snapshot-job";
import { FileDeskHourlyVolumeSnapshotStore } from "../volume-hourly-snapshot-store";
import { MemoryDeskHourlyVolumeSnapshotStore } from "../volume-hourly-snapshots";
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

function mockChain(): ChainVolume {
  return {
    id: "solana",
    name: "Solana",
    shortName: "SOL",
    nativeChainId: "solana",
    sourceId: "solana",
    sourceLabel: "Solana DexScreener",
    volume24hUsd: 86_200_000,
    displayedLiquidityUsd: 40_000_000,
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
    privateVolume24hUsd: 8_700_000,
    etfVolume24hUsd: 32_100_000,
    volumeAggregation: "all-pools",
    completenessPct: 100,
    coverageNote: "test",
  };
}

function mockDetail(generatedAt = "2026-09-23T12:00:00.000Z"): ChainDetailResult {
  return {
    chain: mockChain(),
    assets: [],
    etfAssets: [{ displayedLiquidityUsd: 7_500_000 } as ChainDetailResult["assets"][number]],
    privateAssets: [{ displayedLiquidityUsd: 2_000_000 } as ChainDetailResult["assets"][number]],
    provenance: mockProvenance(generatedAt),
  };
}

describe("runDeskHourlyVolumeSnapshotJob", () => {
  it("records compact public / private / ETF totals and lane liquidity", async () => {
    const store = new MemoryDeskHourlyVolumeSnapshotStore();
    const result = await runDeskHourlyVolumeSnapshotJob({
      source: { getChain: async () => mockDetail() },
      store,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.written).toBe(true);
    expect(result.snapshot.hour).toBe("2026-09-23T08");
    expect(result.snapshot.offset).toBe("-04:00");
    expect(result.snapshot.combined24hUsd).toBeCloseTo(127_000_000);
    expect(result.snapshot.publicLiquidityUsd).toBe(40_000_000);
    expect(result.snapshot.privateLiquidityUsd).toBe(2_000_000);
    expect(result.snapshot.etfIndexLiquidityUsd).toBe(7_500_000);
    expect(result.snapshot.combinedLiquidityUsd).toBe(49_500_000);
    expect(formatDeskHourlyVolumeSnapshotSuccess(result, "data/volume-snapshots/solana-hourly.json")).toMatch(
      /wrote 2026-09-23T08-04:00 combined=127000000/,
    );
    expect(JSON.stringify(await store.load())).not.toMatch(/pairAddress|assets|pools/);
  });

  it("fails closed when getChain returns null or DexScreener 24h is all-null", async () => {
    const store = new MemoryDeskHourlyVolumeSnapshotStore();
    const missing = await runDeskHourlyVolumeSnapshotJob({
      source: { getChain: async () => null },
      store,
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.reason).toMatch(/returned null/);

    const empty = mockDetail();
    empty.chain = { ...empty.chain, volume24hUsd: null, privateVolume24hUsd: null, etfVolume24hUsd: null };
    const allNull = await runDeskHourlyVolumeSnapshotJob({
      source: { getChain: async () => empty },
      store,
    });
    expect(allNull.ok).toBe(false);
    if (!allNull.ok) {
      expect(allNull.reason).toMatch(/all-null/);
      expect(allNull.reason).toMatch(/not \$0/);
    }
    expect(await store.load()).toEqual([]);
  });

  it("reads the Solana all-pools desk and persists totals only", async () => {
    const store = new MemoryDeskHourlyVolumeSnapshotStore();
    const dailySideEffect = new MemoryDeskVolumeSnapshotStore();
    const urls: string[] = [];
    const source = new SolanaMarketDataSource({
      requestGapMs: 0,
      retries: 0,
      discoveryQueries: ["xStock"],
      enableRegistry: false,
      enableOndoRegistry: false,
      enableTesseraRegistry: false,
      enableSunriseRegistry: false,
      enableSecuritizeRegistry: false,
      enableGeckoTerminal: false,
      backgroundEnrichment: false,
      volumeSnapshotStore: dailySideEffect,
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

    const result = await runDeskHourlyVolumeSnapshotJob({ source, store });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.publicEquity24hUsd).toBeCloseTo(1_250.25);
    expect(result.snapshot.etfIndex24hUsd).toBe(9_000);
    expect(result.snapshot.combined24hUsd).toBeCloseTo(10_250.25);
    expect(result.snapshot.publicLiquidityUsd).toBe(9_000);
    expect(result.snapshot.etfIndexLiquidityUsd).toBe(1);
    expect(result.snapshot.combinedLiquidityUsd).toBe(9_001);
    expect(urls.some((url) => url.includes("/token-pairs/v1/solana/"))).toBe(true);
    expect(urls.some((url) => url.includes("/ohlcv/"))).toBe(false);
    const saved = await store.load();
    expect(saved).toHaveLength(1);
    expect(JSON.stringify(saved[0])).not.toMatch(/TSLAx|pair-spy|pairAddress/);
  });
});

describe("pinned Eastern hour", () => {
  const lateFetch = "2026-09-23T13:10:00.000Z";
  const clockT = Date.parse(lateFetch) / 1000;

  it("writes the target hour when DexScreener finishes after the hour rolls", async () => {
    const store = new MemoryDeskHourlyVolumeSnapshotStore();
    const result = await runDeskHourlyVolumeSnapshotJob({
      source: { getChain: async () => mockDetail(lateFetch) },
      store,
      targetHour: "2026-09-23T08",
      clockT,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.hour).toBe("2026-09-23T08");
    expect(result.snapshot.offset).toBe("-04:00");
    expect(result.snapshot.t).toBe(Date.parse("2026-09-23T08:00:00-04:00") / 1000);
    expect(result.snapshot.generatedAt).toBe(lateFetch);
    expect(result.snapshot.combined24hUsd).toBeCloseTo(127_000_000);
    expect(await store.load()).toEqual([result.snapshot]);
  });

  it("stamps the fetch hour when no target is pinned", async () => {
    const store = new MemoryDeskHourlyVolumeSnapshotStore();
    const result = await runDeskHourlyVolumeSnapshotJob({
      source: { getChain: async () => mockDetail(lateFetch) },
      store,
      clockT,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.hour).toBe("2026-09-23T09");
    expect(result.snapshot.generatedAt).toBe(lateFetch);
  });

  it("does not fetch or write when the pin would backfill a past miss", async () => {
    const store = new MemoryDeskHourlyVolumeSnapshotStore();
    let calls = 0;
    const result = await runDeskHourlyVolumeSnapshotJob({
      source: {
        getChain: async () => {
          calls += 1;
          return mockDetail(lateFetch);
        },
      },
      store,
      targetHour: "2026-09-20T08",
      clockT,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/not backfilled/);
    expect(calls).toBe(0);
    expect(await store.load()).toEqual([]);
  });

  it("reads HOURLY_TARGET_HOUR and --hour without touching solana.json", async () => {
    expect(readHourlyTargetHour({ HOURLY_TARGET_HOUR: "2026-09-23T08", SNAPSHOT_HOUR: "2026-09-23T09" })).toEqual({
      ok: true,
      hour: "2026-09-23T08",
    });
    expect(readHourlyTargetHour({ SNAPSHOT_HOUR: "2026-09-23T09" }, ["--hour", "2026-09-23T08"])).toEqual({
      ok: true,
      hour: "2026-09-23T08",
    });
    expect(readHourlyTargetHour({}, ["--snapshot-hour=2026-09-23T08"])).toEqual({
      ok: true,
      hour: "2026-09-23T08",
    });
    expect(readHourlyTargetHour({}, ["--hour"])).toEqual({
      ok: false,
      reason: "--hour needs an America/New_York hour (YYYY-MM-DDTHH).",
    });

    const dir = await mkdtemp(join(tmpdir(), "sotb-hourly-pin-"));
    const sentinel = '{"version":1,"records":[{"date":"sentinel"}]}\n';
    await writeFile(join(dir, "solana.json"), sentinel, "utf8");
    const logs: string[] = [];
    const code = await runDeskHourlyVolumeSnapshotCli({
      env: {
        SOLANA_MARKET_ENABLED: "true",
        SOLANA_VOLUME_SNAPSHOT_DIR: dir,
        HOURLY_TARGET_HOUR: "2026-09-23T08",
      },
      source: { getChain: async () => mockDetail(lateFetch) },
      clockT,
      log: (message) => logs.push(message),
    });
    expect(code).toBe(0);
    expect(logs[0]).toMatch(/wrote 2026-09-23T08-04:00 combined=127000000/);
    expect(await readFile(join(dir, "solana.json"), "utf8")).toBe(sentinel);
    const hourly = JSON.parse(await readFile(join(dir, "solana-hourly.json"), "utf8")) as {
      records: { hour: string; generatedAt: string; combined24hUsd: number }[];
    };
    expect(hourly.records).toHaveLength(1);
    expect(hourly.records[0]?.hour).toBe("2026-09-23T08");
    expect(hourly.records[0]?.generatedAt).toBe(lateFetch);
    expect(hourly.records[0]?.combined24hUsd).toBeCloseTo(127_000_000);
  });
});

describe("runDeskHourlyVolumeSnapshotCli", () => {
  it("exits non-zero when Solana is not enabled", async () => {
    const errors: string[] = [];
    const code = await runDeskHourlyVolumeSnapshotCli({
      env: {},
      error: (message) => errors.push(message),
    });
    expect(code).toBe(1);
    expect(errors[0]).toMatch(/SOLANA_MARKET_ENABLED/);
    expect(errors[0]).toMatch(/seed adapter/);
  });

  it("writes the hourly file and leaves the closed-day snapshot untouched", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sotb-hourly-cli-"));
    const sentinel = '{"version":1,"records":[{"date":"sentinel"}]}\n';
    await writeFile(join(dir, "solana.json"), sentinel, "utf8");
    const logs: string[] = [];
    const code = await runDeskHourlyVolumeSnapshotCli({
      env: { SOLANA_MARKET_ENABLED: "true", SOLANA_VOLUME_SNAPSHOT_DIR: dir },
      source: { getChain: async () => mockDetail() },
      log: (message) => logs.push(message),
    });
    expect(code).toBe(0);
    expect(logs[0]).toMatch(/wrote 2026-09-23T08-04:00 combined=127000000/);
    expect(logs[0]).toMatch(/solana-hourly\.json/);
    expect(await readFile(join(dir, "solana.json"), "utf8")).toBe(sentinel);
    const hourly = JSON.parse(await readFile(join(dir, "solana-hourly.json"), "utf8")) as {
      kind: string;
      records: { hour: string; combined24hUsd: number }[];
    };
    expect(hourly.kind).toBe("rolling_h24_totals");
    expect(hourly.records).toHaveLength(1);
    expect(hourly.records[0]?.hour).toBe("2026-09-23T08");
    expect(await new FileDeskHourlyVolumeSnapshotStore(dir).load()).toHaveLength(1);
  });

  it("exits non-zero with a clear message when DexScreener 24h is all-null", async () => {
    const errors: string[] = [];
    const empty = mockDetail();
    empty.chain = { ...empty.chain, volume24hUsd: null, privateVolume24hUsd: null, etfVolume24hUsd: null };
    const code = await runDeskHourlyVolumeSnapshotCli({
      env: { SOLANA_MARKET_ENABLED: "1" },
      source: { getChain: async () => empty },
      store: new MemoryDeskHourlyVolumeSnapshotStore(),
      error: (message) => errors.push(message),
    });
    expect(code).toBe(1);
    expect(errors[0]).toMatch(/all-null/);
    expect(errors[0]).toMatch(/not \$0/);
  });
});
