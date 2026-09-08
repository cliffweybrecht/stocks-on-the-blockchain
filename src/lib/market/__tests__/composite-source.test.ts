import { describe, expect, it } from "vitest";
import { CompositeMarketDataSource } from "../composite-source";
import { createLiveAdapters, createMarketDataSource, isSolanaMarketEnabled } from "../factory";
import { MockMarketDataSource } from "../mock-source";
import { SolanaMarketDataSource } from "../solana-source";
import { TerminalMarketDataSource } from "../terminal-source";
import type {
  AssetDetailResult,
  ChainDetailResult,
  ChainListResult,
  ChainVolume,
  DataProvenance,
  EquityVolumeHistoryResult,
  MarketDataSource,
  SourceKind,
} from "../types";
import { emptyEquityVolumeHistory } from "../volume-history";

function provenance(sourceId: SourceKind, label: string, failures: DataProvenance["sourceFailures"] = []): DataProvenance {
  return {
    sourceId,
    sourceLabel: label,
    fetchedAt: "2026-09-07T02:00:00.000Z",
    generatedAt: "2026-09-07T02:00:00.000Z",
    refreshStartedAt: "2026-09-07T02:00:00.000Z",
    refreshDurationMs: 10,
    cacheStatus: "fresh",
    cacheAgeMs: 0,
    notes: [`note:${sourceId}`],
    sourceFailures: failures,
  };
}

function chain(id: string, sourceId: SourceKind, volume: number | null): ChainVolume {
  return {
    id,
    name: id,
    shortName: id,
    nativeChainId: id,
    sourceId,
    sourceLabel: sourceId,
    volume24hUsd: volume,
    displayedLiquidityUsd: 1,
    usdGLiquidityUsd: null,
    assetCount: 1,
    assetsWithVolume: volume === null ? 0 : 1,
    assetsWithPools: 1,
    assetsStillHydrating: 0,
    assetsWithNoIndexedPools: 0,
    reportedPoolCount: 1,
    peakDexCount: 1,
    etfCount: 0,
    volumeAggregation: "all-pools",
    completenessPct: 100,
    coverageNote: "test",
  };
}

class FakeSource implements MarketDataSource {
  constructor(
    readonly id: SourceKind,
    readonly label: string,
    private readonly impl: {
      list?: () => Promise<ChainListResult>;
      chain?: (chainId: string) => Promise<ChainDetailResult | null>;
      asset?: (chainId: string, symbol: string) => Promise<AssetDetailResult | null>;
      history?: () => Promise<EquityVolumeHistoryResult>;
    },
  ) {}

  listChains() {
    return this.impl.list ? this.impl.list() : Promise.resolve({ chains: [], provenance: provenance(this.id, this.label) });
  }

  getChain(chainId: string) {
    return this.impl.chain ? this.impl.chain(chainId) : Promise.resolve(null);
  }

  getAsset(chainId: string, symbol: string) {
    return this.impl.asset ? this.impl.asset(chainId, symbol) : Promise.resolve(null);
  }

  getEquityVolumeHistory() {
    return this.impl.history
      ? this.impl.history()
      : Promise.resolve(emptyEquityVolumeHistory(`No history on ${this.id}.`));
  }
}

describe("CompositeMarketDataSource", () => {
  it("merges chains from Terminal + Solana and ranks by volume", async () => {
    const terminal = new FakeSource("terminal", "Terminal", {
      list: async () => ({
        chains: [chain("robinhood-chain", "terminal", 5_000_000)],
        provenance: provenance("terminal", "Terminal"),
      }),
    });
    const solana = new FakeSource("solana", "Solana", {
      list: async () => ({
        chains: [chain("solana", "solana", 12_000_000)],
        provenance: provenance("solana", "Solana"),
      }),
    });

    const composite = new CompositeMarketDataSource([terminal, solana]);
    const result = await composite.listChains();
    expect(result.chains.map((entry) => entry.id)).toEqual(["solana", "robinhood-chain"]);
    expect(result.provenance.sourceId).toBe("composite");
    expect(result.provenance.sourceFailures).toEqual([]);
  });

  it("keeps a successful adapter when the other fails closed", async () => {
    const terminal = new FakeSource("terminal", "Terminal", {
      list: async () => ({
        chains: [chain("robinhood-chain", "terminal", 1)],
        provenance: provenance("terminal", "Terminal"),
      }),
    });
    const solana = new FakeSource("solana", "Solana", {
      list: async () => {
        throw new Error("DexScreener 502");
      },
    });

    const result = await new CompositeMarketDataSource([terminal, solana]).listChains();
    expect(result.chains).toHaveLength(1);
    expect(result.chains[0]?.id).toBe("robinhood-chain");
    expect(result.provenance.sourceFailures).toEqual([
      { sourceId: "solana", sourceLabel: "Solana", message: "DexScreener 502" },
    ]);
  });

  it("keeps Terminal failures as a quiet note when Solana coverage loaded", async () => {
    const terminal = new FakeSource("terminal", "Terminal", {
      list: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    const solana = new FakeSource("solana", "Solana", {
      list: async () => ({
        chains: [chain("solana", "solana", 12_000_000)],
        provenance: provenance("solana", "Solana"),
      }),
    });

    const result = await new CompositeMarketDataSource([solana, terminal]).listChains();
    expect(result.chains.map((entry) => entry.id)).toEqual(["solana"]);
    expect(result.provenance.sourceFailures).toEqual([]);
    expect(result.provenance.sourceLabel).toBe("Solana");
    expect(result.provenance.cacheStatus).toBe("fresh");
    expect(result.provenance.notes.some((note) => /Robinhood Terminal unavailable/.test(note))).toBe(true);
  });

  it("throws only when every adapter fails", async () => {
    const a = new FakeSource("terminal", "Terminal", {
      list: async () => {
        throw new Error("down");
      },
    });
    const b = new FakeSource("solana", "Solana", {
      list: async () => {
        throw new Error("also down");
      },
    });
    await expect(new CompositeMarketDataSource([a, b]).listChains()).rejects.toThrow(/Terminal: down/);
  });

  it("sorts null volume last", async () => {
    const result = await new CompositeMarketDataSource([
      new FakeSource("terminal", "Terminal", {
        list: async () => ({
          chains: [chain("robinhood-chain", "terminal", null)],
          provenance: provenance("terminal", "Terminal"),
        }),
      }),
      new FakeSource("solana", "Solana", {
        list: async () => ({
          chains: [chain("solana", "solana", 10)],
          provenance: provenance("solana", "Solana"),
        }),
      }),
    ]).listChains();
    expect(result.chains.map((entry) => entry.id)).toEqual(["solana", "robinhood-chain"]);
  });

  it("routes getChain to the adapter that owns the id", async () => {
    const terminal = new FakeSource("terminal", "Terminal", {
      chain: async (id) =>
        id === "robinhood-chain"
          ? { chain: chain("robinhood-chain", "terminal", 1), assets: [], provenance: provenance("terminal", "Terminal") }
          : null,
    });
    const solana = new FakeSource("solana", "Solana", {
      chain: async (id) =>
        id === "solana"
          ? { chain: chain("solana", "solana", 2), assets: [], provenance: provenance("solana", "Solana") }
          : null,
    });
    const composite = new CompositeMarketDataSource([terminal, solana]);
    expect((await composite.getChain("solana"))?.chain.sourceId).toBe("solana");
    expect((await composite.getChain("robinhood-chain"))?.chain.sourceId).toBe("terminal");
    expect(await composite.getChain("base")).toBeNull();
  });

  it("routes equity volume history to the Solana adapter and stays empty without one", async () => {
    const solana = new FakeSource("solana", "Solana", {
      history: async () => ({
        ...emptyEquityVolumeHistory("unused"),
        available: true,
        points: [{ t: 1, volumeUsd: 2 }],
        emptyReason: null,
      }),
    });
    const terminal = new FakeSource("terminal", "Terminal", {});
    const withSolana = new CompositeMarketDataSource([terminal, solana]);
    const history = await withSolana.getEquityVolumeHistory();
    expect(history.available).toBe(true);
    expect(history.points).toHaveLength(1);

    const terminalOnly = new CompositeMarketDataSource([terminal]);
    const empty = await terminalOnly.getEquityVolumeHistory();
    expect(empty.available).toBe(false);
    expect(empty.points).toEqual([]);
  });
});

describe("createMarketDataSource", () => {
  it("uses mock when no live adapters are configured", () => {
    expect(createMarketDataSource({})).toBeInstanceOf(MockMarketDataSource);
  });

  it("uses Terminal alone when only TERMINAL_BASE_URL is set", () => {
    const source = createMarketDataSource({ TERMINAL_BASE_URL: "http://127.0.0.1:3000" });
    expect(source).toBeInstanceOf(TerminalMarketDataSource);
  });

  it("uses Solana alone when only SOLANA_MARKET_ENABLED is set", () => {
    const source = createMarketDataSource({ SOLANA_MARKET_ENABLED: "true" });
    expect(source).toBeInstanceOf(SolanaMarketDataSource);
  });

  it("composites Terminal + Solana when both are enabled", () => {
    const source = createMarketDataSource({
      TERMINAL_BASE_URL: "http://127.0.0.1:3000",
      SOLANA_MARKET_ENABLED: "1",
    });
    expect(source).toBeInstanceOf(CompositeMarketDataSource);
  });

  it("does not treat an unset Solana flag as enabled", () => {
    expect(isSolanaMarketEnabled({})).toBe(false);
    expect(createLiveAdapters({ TERMINAL_BASE_URL: "http://t" })).toHaveLength(1);
  });
});
