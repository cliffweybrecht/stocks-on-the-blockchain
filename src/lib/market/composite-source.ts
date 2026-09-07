import { sortByVolumeThenLiquidity } from "./aggregate";
import { COMPOSITE_SOURCE_NOTE } from "./trust";
import type {
  AssetDetailResult,
  ChainDetailResult,
  ChainListResult,
  DataProvenance,
  MarketDataSource,
  SourceFailure,
} from "./types";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown adapter failure.";
}

export class CompositeMarketDataSource implements MarketDataSource {
  readonly id = "composite" as const;
  readonly label: string;

  constructor(private readonly adapters: readonly MarketDataSource[]) {
    if (adapters.length === 0) {
      throw new Error("CompositeMarketDataSource requires at least one adapter.");
    }
    this.label = `Composite (${adapters.map((adapter) => adapter.label).join(" + ")})`;
  }

  async listChains(): Promise<ChainListResult> {
    const settled = await Promise.allSettled(this.adapters.map((adapter) => adapter.listChains()));
    const chains: ChainListResult["chains"] = [];
    const failures: SourceFailure[] = [];
    const notes = [COMPOSITE_SOURCE_NOTE];
    const fetchedAt = new Date().toISOString();
    let generatedAt: string | null = null;

    settled.forEach((result, index) => {
      const adapter = this.adapters[index];
      if (!adapter) return;
      if (result.status === "fulfilled") {
        chains.push(...result.value.chains);
        notes.push(...result.value.provenance.notes);
        generatedAt = generatedAt ?? result.value.provenance.generatedAt;
        failures.push(...result.value.provenance.sourceFailures);
        return;
      }
      failures.push({
        sourceId: adapter.id,
        sourceLabel: adapter.label,
        message: errorMessage(result.reason),
      });
    });

    if (chains.length === 0 && failures.length === this.adapters.length) {
      throw new Error(failures.map((failure) => `${failure.sourceLabel}: ${failure.message}`).join(" · "));
    }

    const provenance: DataProvenance = {
      sourceId: "composite",
      sourceLabel: this.label,
      fetchedAt,
      generatedAt,
      refreshStartedAt: fetchedAt,
      refreshDurationMs: null,
      cacheStatus: failures.length > 0 ? "partial" : "fresh",
      cacheAgeMs: 0,
      notes,
      sourceFailures: failures,
    };

    return {
      chains: sortByVolumeThenLiquidity(chains),
      provenance,
    };
  }

  async getChain(chainId: string): Promise<ChainDetailResult | null> {
    const errors: Error[] = [];
    for (const adapter of this.adapters) {
      try {
        const result = await adapter.getChain(chainId);
        if (result) return result;
      } catch (error) {
        errors.push(error instanceof Error ? error : new Error(errorMessage(error)));
      }
    }
    if (errors.length > 0) {
      throw errors[0];
    }
    return null;
  }

  async getAsset(chainId: string, symbol: string): Promise<AssetDetailResult | null> {
    const errors: Error[] = [];
    for (const adapter of this.adapters) {
      try {
        const result = await adapter.getAsset(chainId, symbol);
        if (result) return result;
      } catch (error) {
        errors.push(error instanceof Error ? error : new Error(errorMessage(error)));
      }
    }
    if (errors.length > 0) {
      throw errors[0];
    }
    return null;
  }
}
